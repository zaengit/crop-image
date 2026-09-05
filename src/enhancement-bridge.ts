import './enhancement.css'
import { DEFAULT_ENHANCEMENT, type EnhancementSettings } from './enhance'

const root = document.createElement('section')
root.id = 'enhance-global'
root.className = 'enhance-global'
root.hidden = true
root.innerHTML = `
  <div class="enhance-head">
    <div>
      <p class="eyebrow">GLOBAL ENHANCE</p>
      <h2>Improve image quality</h2>
      <p>Enhancement is optional. Adjust the current image before generating crops if needed.</p>
    </div>
    <div class="enhance-actions">
      <button id="enhance-auto" class="primary" type="button">Auto Enhance</button>
      <button id="enhance-compare" class="secondary" type="button">Hold to compare</button>
      <button id="enhance-reset" class="secondary" type="button">Reset</button>
    </div>
  </div>
  <div class="enhance-grid">
    ${slider('brightness','Brightness',-50,50,0)}
    ${slider('contrast','Contrast',-50,50,0)}
    ${slider('highlights','Highlights',-50,50,0)}
    ${slider('shadows','Shadows',-50,50,0)}
    ${slider('saturation','Saturation',-50,50,0)}
    ${slider('temperature','Temperature',-50,50,0)}
    ${slider('sharpness','Sharpness',0,100,0)}
    ${slider('denoise','Noise reduction',0,100,0)}
  </div>
  <div class="enhance-toggles">
    ${toggle('lowLight','Low light')}
    ${toggle('faceEnhance','Face enhance')}
    ${toggle('deblur','Deblur')}
    ${toggle('restorePhoto','Restore photo')}
    ${toggle('upscale2x','AI Upscale 2×')}
  </div>
  <small id="enhance-status" class="enhance-status" aria-live="polite">Optional — crop can be generated without enhancement.</small>
`

function slider(key: keyof EnhancementSettings, label: string, min: number, max: number, value: number) {
  return `<label class="enhance-control"><span>${label}<output data-value-for="${key}">${value}</output></span><input data-enhance-range="${key}" type="range" min="${min}" max="${max}" value="${value}" step="1" /></label>`
}

function toggle(key: keyof EnhancementSettings, label: string) {
  return `<button class="enhance-toggle" type="button" data-enhance-toggle="${key}" aria-pressed="false">${label}</button>`
}

const upload = document.querySelector('#image-batch') ?? document.querySelector('#dropzone')
upload?.insertAdjacentElement('afterend', root)

let settings: EnhancementSettings = { ...DEFAULT_ENHANCEMENT }
let latestWorker: Worker | undefined
let timer: number | undefined
let comparing = false
const status = root.querySelector<HTMLElement>('#enhance-status')!
const focusImage = document.querySelector<HTMLImageElement>('#focus-image')

function isAiHeavy(value: EnhancementSettings) {
  return value.denoise >= 20 || value.deblur || value.restorePhoto || value.faceEnhance || value.upscale2x
}

function sendEnhancement(reason = 'Applying enhancement…') {
  applyPreview()
  if (!latestWorker) return
  status.textContent = reason
  latestWorker.postMessage({ type: 'enhancement', settings })
}

function schedule() {
  applyPreview()
  if (timer) window.clearTimeout(timer)
  if (isAiHeavy(settings)) {
    status.textContent = 'Release the slider to apply AI enhancement.'
    return
  }
  timer = window.setTimeout(() => sendEnhancement(), 140)
}

function applyPreview() {
  if (!focusImage) return
  if (comparing) {
    focusImage.style.filter = 'none'
    return
  }
  const brightness = 100 + settings.brightness * 0.7 + (settings.lowLight ? 8 : 0)
  const contrast = 100 + settings.contrast
  const saturation = 100 + settings.saturation
  const warmth = settings.temperature
  focusImage.style.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) sepia(${Math.max(0, warmth) * .18}%)`
}

function syncControls() {
  root.querySelectorAll<HTMLInputElement>('[data-enhance-range]').forEach((input) => {
    const key = input.dataset.enhanceRange as keyof EnhancementSettings
    const value = settings[key]
    if (typeof value !== 'number') return
    input.value = String(value)
    const output = root.querySelector<HTMLOutputElement>(`[data-value-for="${key}"]`)
    if (output) output.value = String(value)
  })
  root.querySelectorAll<HTMLButtonElement>('[data-enhance-toggle]').forEach((button) => {
    const key = button.dataset.enhanceToggle as keyof EnhancementSettings
    const active = Boolean(settings[key])
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  applyPreview()
}

root.querySelectorAll<HTMLInputElement>('[data-enhance-range]').forEach((input) => {
  input.addEventListener('input', () => {
    const key = input.dataset.enhanceRange as keyof EnhancementSettings
    ;(settings as unknown as Record<string, number>)[key] = Number(input.value)
    const output = root.querySelector<HTMLOutputElement>(`[data-value-for="${key}"]`)
    if (output) output.value = input.value
    schedule()
  })
  input.addEventListener('change', () => {
    if (isAiHeavy(settings)) sendEnhancement('Applying AI enhancement…')
  })
})

root.querySelectorAll<HTMLButtonElement>('[data-enhance-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.enhanceToggle as keyof EnhancementSettings
    ;(settings as unknown as Record<string, boolean>)[key] = !Boolean(settings[key])
    syncControls()
    const aiRestore = (key === 'deblur' || key === 'restorePhoto') && Boolean(settings[key])
    sendEnhancement(
      key === 'upscale2x' && settings.upscale2x
        ? 'Preparing AI super resolution…'
        : key === 'faceEnhance' && settings.faceEnhance
          ? 'Preparing AI face enhancement…'
          : aiRestore
            ? 'Preparing AI restoration…'
            : 'Applying enhancement…',
    )
  })
})

root.querySelector<HTMLButtonElement>('#enhance-reset')?.addEventListener('click', () => {
  settings = { ...DEFAULT_ENHANCEMENT }
  syncControls()
  sendEnhancement('Resetting enhancement…')
})

root.querySelector<HTMLButtonElement>('#enhance-auto')?.addEventListener('click', () => {
  if (!latestWorker) return
  status.textContent = 'Analyzing image locally…'
  latestWorker.postMessage({ type: 'enhancement-auto' })
})

const compare = root.querySelector<HTMLButtonElement>('#enhance-compare')!
const beginCompare = () => { comparing = true; root.classList.add('is-comparing'); applyPreview() }
const endCompare = () => { comparing = false; root.classList.remove('is-comparing'); applyPreview() }
compare.addEventListener('pointerdown', beginCompare)
compare.addEventListener('pointerup', endCompare)
compare.addEventListener('pointercancel', endCompare)
compare.addEventListener('pointerleave', endCompare)
compare.addEventListener('keydown', (event) => { if (event.key === ' ' || event.key === 'Enter') beginCompare() })
compare.addEventListener('keyup', endCompare)

function bindCropWorker(worker: Worker) {
  if (latestWorker === worker) return
  latestWorker = worker
  root.hidden = false

  worker.addEventListener('message', (event) => {
    const message = event.data
    if (message?.type === 'enhancement-settings') {
      settings = { ...DEFAULT_ENHANCEMENT, ...message.settings } as EnhancementSettings
      syncControls()
      const restoreLabel = message.restoration
        ? message.restoration.method === 'ai'
          ? 'AI Restoration'
          : 'local restoration fallback'
        : ''
      const faceLabel = message.faceEnhance
        ? message.faceEnhance.method === 'ai'
          ? `AI Face Enhance (${message.faceEnhance.faces})`
          : message.faceEnhance.faces === 0
            ? 'No face detected'
            : 'local face fallback'
        : ''

      if (message.upscale) {
        const scale = Number(message.upscale.scale ?? 1).toFixed(2).replace(/\.00$/, '')
        const method = message.upscale.method === 'ai' ? 'AI Super Resolution' : 'high-quality fallback'
        const suffix = [restoreLabel, faceLabel].filter(Boolean).map((label) => ` · ${label}`).join('')
        status.textContent = `${method} ${scale}× ready — ${message.upscale.width} × ${message.upscale.height}${suffix}. Click Generate crop to update outputs.`
      } else if (restoreLabel || faceLabel) {
        status.textContent = `${[restoreLabel, faceLabel].filter(Boolean).join(' · ')} ready. Click Generate crop to update outputs.`
      } else if (message.auto) {
        status.textContent = 'Auto Enhance ready — click Generate crop to update outputs.'
      } else {
        status.textContent = Object.values(settings).some((value) => value !== 0 && value !== false)
          ? 'Enhancement ready — click Generate crop to update outputs.'
          : 'Optional — crop can be generated without enhancement.'
      }
    }
    if (message?.type === 'done' && !status.textContent?.startsWith('Auto Enhance') && !status.textContent?.includes('ready —') && !status.textContent?.includes('Restoration') && !status.textContent?.includes('Face Enhance')) {
      status.textContent = 'Optional — crop can be generated without enhancement.'
    }
    if (message?.type === 'error' && String(message.message ?? '').toLowerCase().includes('enhanc')) {
      status.textContent = `Enhancement error: ${message.message}`
    }
  })

  const nativeTerminate = worker.terminate.bind(worker)
  worker.terminate = () => {
    nativeTerminate()
    if (latestWorker === worker) latestWorker = undefined
  }
}

function isCropLoadMessage(message: unknown) {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Record<string, unknown>
  return candidate.type === 'load'
    && candidate.rgba instanceof ArrayBuffer
    && typeof candidate.width === 'number'
    && typeof candidate.height === 'number'
}

const nativePostMessage = Worker.prototype.postMessage
const callNativePostMessage = nativePostMessage.call.bind(nativePostMessage) as (
  worker: Worker,
  message: unknown,
  transferOrOptions?: Transferable[] | StructuredSerializeOptions,
) => void

Worker.prototype.postMessage = function (
  this: Worker,
  message: unknown,
  transferOrOptions?: Transferable[] | StructuredSerializeOptions,
) {
  if (isCropLoadMessage(message)) bindCropWorker(this)
  callNativePostMessage(this, message, transferOrOptions)
} as Worker['postMessage']

syncControls()

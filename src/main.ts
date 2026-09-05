import './style.css'
import './enhancement-bridge'
import { Zip, ZipDeflate, strToU8 } from 'fflate'
import { initStoreAssets } from './store-assets'
import { createCropWorker } from './worker-channel'
import type { ImagePreset, PresetGroup } from './presets'

const fileInput = document.querySelector<HTMLInputElement>('#file')!
const pick = document.querySelector<HTMLButtonElement>('#pick')!
const dropzone = document.querySelector<HTMLElement>('#dropzone')!
const status = document.querySelector<HTMLElement>('#status')!
const results = document.querySelector<HTMLElement>('#results')!
const grid = document.querySelector<HTMLElement>('#grid')!
const emptyState = document.querySelector<HTMLElement>('#empty-state')!
const downloadAll = document.querySelector<HTMLButtonElement>('#download-all')!
const focusEditor = document.querySelector<HTMLElement>('#focus-editor')!
const focusStage = document.querySelector<HTMLElement>('#focus-stage')!
const focusImage = document.querySelector<HTMLImageElement>('#focus-image')!
const focusTarget = document.querySelector<HTMLButtonElement>('#focus-target')!
const resetFocus = document.querySelector<HTMLButtonElement>('#reset-focus')!
const formatSelect = document.querySelector<HTMLSelectElement>('#format')!
const qualityInput = document.querySelector<HTMLInputElement>('#quality')!
const qualityValue = document.querySelector<HTMLElement>('#quality-value')!
const qualityWrap = document.querySelector<HTMLElement>('#quality-wrap')!
const menuButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-menu]')]
const socialPanel = document.querySelector<HTMLElement>('#social-panel')!
const passportPanel = document.querySelector<HTMLElement>('#passport-panel')!
const customPanel = document.querySelector<HTMLElement>('#custom-panel')!
const storePanel = document.querySelector<HTMLElement>('#store-panel')!
const generateSocial = document.querySelector<HTMLButtonElement>('#generate-social')!
const generatePassport = document.querySelector<HTMLButtonElement>('#generate-passport')!
const customForm = document.querySelector<HTMLFormElement>('#custom-form')!
const customGenerate = customForm.querySelector<HTMLButtonElement>('button[type="submit"]')!
const customWidth = document.querySelector<HTMLInputElement>('#custom-width')!
const customHeight = document.querySelector<HTMLInputElement>('#custom-height')!
const lockRatio = document.querySelector<HTMLInputElement>('#lock-ratio')!
const customError = document.querySelector<HTMLElement>('#custom-error')!
const ratioButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-ratio]')]
const backgroundButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-background]')]
const passportBackgroundColor = document.querySelector<HTMLInputElement>('#passport-background-color')!
const backgroundStatus = document.querySelector<HTMLElement>('#background-status')!

const MAX_WORKING_PIXELS = 12_000_000
const MAX_WORKING_EDGE = 4096
const MAX_CUSTOM_PIXELS = 32_000_000
const MIN_CUSTOM_EDGE = 64
const MAX_CUSTOM_EDGE = 8192

type OutputFormat = 'png' | 'jpeg' | 'webp'
type Generated = { preset: ImagePreset; blob: Blob; url: string; extension: string; mime: string }
type DecodedImage = {
  rgba: Uint8ClampedArray
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  scaled: boolean
}
type WorkerErrorScope = 'load' | 'crop' | 'enhancement' | 'background' | 'settings' | 'focus'

let generated: Generated[] = []
let activeWorker: Worker | undefined
let originalUrl: string | undefined
let dragging = false
let focusTimer: number | undefined
let pendingFocus: { x: number; y: number } | undefined
let currentFileName = 'crop-image'
let activeMenu: PresetGroup = 'social'
let customSequence = 0
let lockedRatio = 1
let activeBackground = 'original'
let processRevision = 0
let generationBusy = false
let workerReady = false

function currentFormat() { return formatSelect.value as OutputFormat }
function currentQuality() { return Number(qualityInput.value) / 100 }

function setGenerateBusy(busy: boolean) {
  generationBusy = busy
  generateSocial.disabled = busy
  generatePassport.disabled = busy
  customGenerate.disabled = busy
}

function markOutputsStale(message: string) {
  if (generated.length) downloadAll.disabled = true
  status.textContent = message
}

function revokeResults() {
  for (const item of generated) URL.revokeObjectURL(item.url)
  generated = []
  grid.replaceChildren()
  renderGrid()
}

function upsertResult(next: Generated) {
  const existingIndex = generated.findIndex((item) => item.preset.id === next.preset.id)
  if (existingIndex >= 0) {
    URL.revokeObjectURL(generated[existingIndex].url)
    generated[existingIndex] = next
  } else {
    generated.push(next)
  }
  renderGrid()
}

function workingDimensions(width: number, height: number) {
  const pixels = width * height
  const scaleByPixels = pixels > MAX_WORKING_PIXELS ? Math.sqrt(MAX_WORKING_PIXELS / pixels) : 1
  const longestEdge = Math.max(width, height)
  const scaleByEdge = longestEdge > MAX_WORKING_EDGE ? MAX_WORKING_EDGE / longestEdge : 1
  const scale = Math.min(1, scaleByPixels, scaleByEdge)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

function renderDecodedSource(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): DecodedImage {
  if (!sourceWidth || !sourceHeight) throw new Error('Image has invalid dimensions.')
  const target = workingDimensions(sourceWidth, sourceHeight)
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser could not create an image canvas.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, target.width, target.height)
  const image = ctx.getImageData(0, 0, target.width, target.height)
  return {
    rgba: image.data,
    width: target.width,
    height: target.height,
    sourceWidth,
    sourceHeight,
    scaled: target.scale < 0.999,
  }
}

function decodeWithImageElement(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    const cleanup = () => URL.revokeObjectURL(url)
    image.onload = () => {
      try {
        resolve(renderDecodedSource(image, image.naturalWidth, image.naturalHeight))
      } catch (error) {
        reject(error)
      } finally {
        cleanup()
      }
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('This browser could not decode the selected image. Try JPEG, PNG, or WebP.'))
    }
    image.src = url
  })
}

async function decode(file: File): Promise<DecodedImage> {
  let bitmapError: unknown
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      try {
        return renderDecodedSource(bitmap, bitmap.width, bitmap.height)
      } finally {
        bitmap.close()
      }
    } catch (error) {
      bitmapError = error
      console.warn('createImageBitmap failed; retrying with image-element decoder.', error)
    }
  }

  try {
    return await decodeWithImageElement(file)
  } catch (fallbackError) {
    const primary = bitmapError instanceof Error ? bitmapError.message : bitmapError ? String(bitmapError) : ''
    const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
    throw new Error(primary ? `${fallback} Primary decoder: ${primary}` : fallback)
  }
}

function download(blob: Blob, filename: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

function humanBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function removeCustom(id: string) {
  const index = generated.findIndex((item) => item.preset.id === id)
  if (index < 0) return
  URL.revokeObjectURL(generated[index].url)
  generated.splice(index, 1)
  activeWorker?.postMessage({ type: 'remove-custom', id })
  renderGrid()
  downloadAll.disabled = generated.length === 0
}

function createCard(item: Generated) {
  const card = document.createElement('article')
  card.className = 'card'

  const thumb = document.createElement('div')
  thumb.className = 'thumb'
  const image = document.createElement('img')
  image.src = item.url
  image.alt = `${item.preset.platform} ${item.preset.label}`
  image.width = item.preset.width
  image.height = item.preset.height
  image.loading = 'lazy'
  image.style.aspectRatio = `${item.preset.width} / ${item.preset.height}`
  thumb.append(image)

  const body = document.createElement('div')
  body.className = 'card-body'
  const meta = document.createElement('div')
  meta.className = 'card-meta'
  const strong = document.createElement('strong')
  strong.textContent = item.preset.platform
  const span = document.createElement('span')
  span.textContent = item.preset.label
  meta.append(strong, span)
  const details = document.createElement('small')
  details.textContent = `${item.preset.width} × ${item.preset.height} · ${item.extension.toUpperCase()} · ${humanBytes(item.blob.size)}`
  body.append(meta, details)

  const actions = document.createElement('div')
  actions.className = 'card-actions'
  const button = document.createElement('button')
  button.textContent = 'Download'
  button.addEventListener('click', () => download(item.blob, `${item.preset.id}.${item.extension}`))
  actions.append(button)

  if (item.preset.group === 'custom') {
    const remove = document.createElement('button')
    remove.className = 'remove-button'
    remove.type = 'button'
    remove.textContent = 'Delete'
    remove.addEventListener('click', () => removeCustom(item.preset.id))
    actions.append(remove)
  }

  body.append(actions)
  card.append(thumb, body)
  return card
}

function renderGrid() {
  if (activeMenu === 'store') {
    grid.hidden = true
    emptyState.hidden = true
    return
  }
  grid.hidden = false
  const visible = generated.filter((item) => item.preset.group === activeMenu)
  grid.replaceChildren(...visible.map(createCard))
  emptyState.hidden = visible.length > 0 || activeMenu === 'passport' || activeMenu === 'social'
}

function renderedImageBox() {
  const stageWidth = focusStage.clientWidth
  const stageHeight = focusStage.clientHeight
  if (!focusImage.naturalWidth || !focusImage.naturalHeight || !stageWidth || !stageHeight) {
    return { left: 0, top: 0, width: stageWidth, height: stageHeight }
  }
  const imageRatio = focusImage.naturalWidth / focusImage.naturalHeight
  const stageRatio = stageWidth / stageHeight
  if (imageRatio > stageRatio) {
    const height = stageWidth / imageRatio
    return { left: 0, top: (stageHeight - height) / 2, width: stageWidth, height }
  }
  const width = stageHeight * imageRatio
  return { left: (stageWidth - width) / 2, top: 0, width, height: stageHeight }
}

function setTarget(x: number, y: number) {
  const nx = Math.min(1, Math.max(0, x))
  const ny = Math.min(1, Math.max(0, y))
  const box = renderedImageBox()
  focusTarget.style.left = `${box.left + nx * box.width}px`
  focusTarget.style.top = `${box.top + ny * box.height}px`
  focusTarget.dataset.x = String(nx)
  focusTarget.dataset.y = String(ny)
}

function repositionTarget() {
  setTarget(Number(focusTarget.dataset.x ?? 0.5), Number(focusTarget.dataset.y ?? 0.5))
}

function flushPendingFocus() {
  if (focusTimer) {
    window.clearTimeout(focusTimer)
    focusTimer = undefined
  }
  if (!pendingFocus) return
  const focus = pendingFocus
  pendingFocus = undefined
  activeWorker?.postMessage({ type: 'focus', x: focus.x, y: focus.y })
}

function scheduleFocus(x: number, y: number) {
  const nx = Math.min(1, Math.max(0, x))
  const ny = Math.min(1, Math.max(0, y))
  setTarget(nx, ny)
  pendingFocus = { x: nx, y: ny }
  if (focusTimer) window.clearTimeout(focusTimer)
  focusTimer = window.setTimeout(() => {
    focusTimer = undefined
    const focus = pendingFocus
    pendingFocus = undefined
    if (!focus) return
    activeWorker?.postMessage({ type: 'focus', x: focus.x, y: focus.y })
    if (!generationBusy) markOutputsStale('Manual focus updated — click Generate crop to refresh outputs.')
  }, 180)
}

function focusFromPointer(event: PointerEvent) {
  const stageRect = focusStage.getBoundingClientRect()
  const box = renderedImageBox()
  const x = (event.clientX - stageRect.left - box.left) / Math.max(1, box.width)
  const y = (event.clientY - stageRect.top - box.top) / Math.max(1, box.height)
  scheduleFocus(x, y)
}

function updateQualityUi() {
  qualityValue.textContent = qualityInput.value
  qualityWrap.hidden = currentFormat() === 'png'
}

function updateOutputSettings() {
  updateQualityUi()
  if (!activeWorker) return
  activeWorker.postMessage({ type: 'settings', format: currentFormat(), quality: currentQuality() })
  markOutputsStale('Output settings updated — click Generate crop to refresh outputs.')
}

function folderFor(group: PresetGroup) {
  if (group === 'passport') return 'passport-photo'
  if (group === 'custom') return 'custom'
  if (group === 'store') return 'app-store-assets'
  return 'social-media'
}

async function createStreamingZip(entries: Array<{ path: string; blob?: Blob; bytes?: Uint8Array }>) {
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let settled = false
    const zip = new Zip((error, data, final) => {
      if (settled) return
      if (error) {
        settled = true
        reject(error)
        return
      }
      chunks.push(data)
      if (final) {
        settled = true
        resolve(new Blob(chunks.map((chunk) => chunk.slice().buffer), { type: 'application/zip' }))
      }
    })

    ;(async () => {
      try {
        for (const entry of entries) {
          const file = new ZipDeflate(entry.path, { level: 6 })
          zip.add(file)
          const bytes = entry.bytes ?? new Uint8Array(await entry.blob!.arrayBuffer())
          file.push(bytes, true)
          await Promise.resolve()
        }
        zip.end()
      } catch (error) {
        if (!settled) {
          settled = true
          reject(error)
        }
      }
    })()
  })
}

async function downloadZip() {
  if (!generated.length || downloadAll.disabled) return
  downloadAll.disabled = true
  status.textContent = 'Creating ZIP locally…'
  try {
    const entries: Array<{ path: string; blob?: Blob; bytes?: Uint8Array }> = generated.map((item) => ({
      path: `${folderFor(item.preset.group)}/${item.preset.id}.${item.extension}`,
      blob: item.blob,
    }))
    entries.push({
      path: 'manifest.json',
      bytes: strToU8(JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: currentFileName,
        format: currentFormat(),
        quality: currentFormat() === 'png' ? null : Number(qualityInput.value),
        passportBackground: activeBackground,
        files: generated.map((item) => ({
          id: item.preset.id,
          group: item.preset.group,
          label: item.preset.label,
          width: item.preset.width,
          height: item.preset.height,
          filename: `${folderFor(item.preset.group)}/${item.preset.id}.${item.extension}`,
        })),
      }, null, 2)),
    })
    const zipped = await createStreamingZip(entries)
    download(zipped, 'image-sizes.zip')
    status.textContent = `Done — ZIP contains ${generated.length} images.`
  } catch (error) {
    status.textContent = `Error creating ZIP: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    downloadAll.disabled = generated.length === 0
  }
}

function setMenu(menu: PresetGroup) {
  activeMenu = menu
  for (const button of menuButtons) {
    const active = button.dataset.menu === menu
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  }
  socialPanel.hidden = menu !== 'social'
  passportPanel.hidden = menu !== 'passport'
  customPanel.hidden = menu !== 'custom'
  storePanel.hidden = menu !== 'store'
  results.classList.toggle('store-mode', menu === 'store')
  renderGrid()
}

function selectBackground(value: string) {
  activeBackground = value
  for (const button of backgroundButtons) {
    const active = button.dataset.background === value
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  }
  if (value !== 'original' && !backgroundButtons.some((button) => button.dataset.background === value)) {
    for (const button of backgroundButtons) {
      button.classList.remove('active')
      button.setAttribute('aria-pressed', 'false')
    }
  }
}

function requestBackground(value: string) {
  if (!activeWorker) {
    backgroundStatus.textContent = 'Choose an image first.'
    return
  }
  selectBackground(value)
  backgroundStatus.textContent = value === 'original'
    ? 'Restoring the original background…'
    : 'Removing the original background locally…'
  status.textContent = value === 'original'
    ? 'Preparing the original passport background…'
    : 'Preparing the passport background…'
  activeWorker.postMessage({ type: 'background', value })
}

function customDimensions() {
  const width = Math.round(Number(customWidth.value))
  const height = Math.round(Number(customHeight.value))
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { error: 'Enter a valid width and height.' }
  if (width < MIN_CUSTOM_EDGE || height < MIN_CUSTOM_EDGE) return { error: `Minimum size is ${MIN_CUSTOM_EDGE} × ${MIN_CUSTOM_EDGE} px.` }
  if (width > MAX_CUSTOM_EDGE || height > MAX_CUSTOM_EDGE) return { error: `Maximum edge is ${MAX_CUSTOM_EDGE} px.` }
  if (width * height > MAX_CUSTOM_PIXELS) return { error: 'Custom output is limited to 32 megapixels.' }
  return { width, height }
}

function syncLockedHeight() {
  if (!lockRatio.checked || !lockedRatio) return
  const width = Math.max(MIN_CUSTOM_EDGE, Math.min(MAX_CUSTOM_EDGE, Math.round(Number(customWidth.value) || MIN_CUSTOM_EDGE)))
  customHeight.value = String(Math.max(MIN_CUSTOM_EDGE, Math.min(MAX_CUSTOM_EDGE, Math.round(width / lockedRatio))))
}

function syncLockedWidth() {
  if (!lockRatio.checked || !lockedRatio) return
  const height = Math.max(MIN_CUSTOM_EDGE, Math.min(MAX_CUSTOM_EDGE, Math.round(Number(customHeight.value) || MIN_CUSTOM_EDGE)))
  customWidth.value = String(Math.max(MIN_CUSTOM_EDGE, Math.min(MAX_CUSTOM_EDGE, Math.round(height * lockedRatio))))
}

async function process(file: File) {
  if (!file.type.startsWith('image/')) {
    status.textContent = 'Please choose an image file.'
    return
  }

  const revision = ++processRevision
  if (focusTimer) window.clearTimeout(focusTimer)
  focusTimer = undefined
  pendingFocus = undefined
  activeWorker?.terminate()
  activeWorker = undefined
  workerReady = false
  setGenerateBusy(false)
  revokeResults()
  customSequence = 0
  activeBackground = 'original'
  selectBackground('original')
  backgroundStatus.textContent = ''
  setMenu('social')
  currentFileName = file.name
  focusEditor.hidden = false
  status.textContent = 'Reading image…'
  pick.disabled = true
  downloadAll.disabled = true

  if (originalUrl) URL.revokeObjectURL(originalUrl)
  originalUrl = URL.createObjectURL(file)
  focusImage.src = originalUrl
  setTarget(0.5, 0.5)

  try {
    const image = await decode(file)
    if (revision !== processRevision) return

    if (image.scaled) {
      const sourceMp = (image.sourceWidth * image.sourceHeight / 1_000_000).toFixed(1)
      const workingMp = (image.width * image.height / 1_000_000).toFixed(1)
      status.textContent = `Optimized ${sourceMp} MP photo to ${workingMp} MP working image. Finding the subject…`
    } else {
      status.textContent = 'Finding the subject…'
    }

    const worker = createCropWorker()
    activeWorker = worker

    worker.onmessage = (event) => {
      if (activeWorker !== worker || revision !== processRevision) return
      const message = event.data
      if (message.type === 'status') status.textContent = message.message
      if (message.type === 'auto-focus-point') setTarget(message.x, message.y)
      if (message.type === 'ready') {
        workerReady = true
        status.textContent = 'Ready — adjust the focal point if needed, then click Generate crop.'
        pick.disabled = false
        setGenerateBusy(false)
        downloadAll.disabled = generated.length === 0
      }
      if (message.type === 'settings-ready' && !generationBusy) {
        markOutputsStale('Output settings updated — click Generate crop to refresh outputs.')
      }
      if (message.type === 'focus-ready' && !generationBusy) {
        markOutputsStale(message.manual
          ? 'Manual focus updated — click Generate crop to refresh outputs.'
          : 'Auto focus restored — click Generate crop to refresh outputs.')
      }
      if (message.type === 'background-ready') {
        backgroundStatus.textContent = message.value === 'original'
          ? 'Original background ready.'
          : 'Background ready. The person mask is cached for faster color changes.'
        if (!generationBusy) markOutputsStale('Background ready — click Generate crop to refresh passport photos.')
      }
      if (message.type === 'enhancement-settings' && workerReady && !generationBusy) {
        markOutputsStale('Enhancement ready — click Generate crop to refresh outputs.')
      }
      if (message.type === 'result') {
        const blob = new Blob([message.bytes], { type: message.mime })
        upsertResult({
          preset: message.preset as ImagePreset,
          blob,
          url: URL.createObjectURL(blob),
          extension: message.extension,
          mime: message.mime,
        })
        status.textContent = `Generated ${message.index + 1} / ${message.total}`
      }
      if (message.type === 'done') {
        status.textContent = message.manual
          ? 'Done — manual focus applied to generated sizes.'
          : `Done — ${generated.length} images generated locally.`
        pick.disabled = false
        setGenerateBusy(false)
        downloadAll.disabled = generated.length === 0
      }
      if (message.type === 'error') {
        const scope = message.scope as WorkerErrorScope | undefined
        status.textContent = `Error: ${message.message}`
        if (scope === 'background') backgroundStatus.textContent = `Background error: ${message.message}`
        pick.disabled = false
        setGenerateBusy(false)
        downloadAll.disabled = generated.length === 0
      }
    }

    worker.onerror = (event) => {
      if (activeWorker !== worker || revision !== processRevision) return
      const detail = event.message || 'Crop worker failed to start in this browser.'
      status.textContent = `Error: ${detail}`
      pick.disabled = false
      setGenerateBusy(false)
      downloadAll.disabled = generated.length === 0
    }

    worker.postMessage({
      type: 'load',
      rgba: image.rgba.buffer,
      width: image.width,
      height: image.height,
      format: currentFormat(),
      quality: currentQuality(),
    }, [image.rgba.buffer])
  } catch (error) {
    if (revision !== processRevision) return
    status.textContent = `Error reading image: ${error instanceof Error ? error.message : String(error)}`
    pick.disabled = false
    setGenerateBusy(false)
    downloadAll.disabled = generated.length === 0
  }
}

pick.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (file) void process(file)
})
dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('drag') })
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'))
dropzone.addEventListener('drop', (event) => {
  event.preventDefault()
  dropzone.classList.remove('drag')
  const file = event.dataTransfer?.files[0]
  if (file) void process(file)
})

generateSocial.addEventListener('click', () => {
  if (!activeWorker || !workerReady) {
    status.textContent = 'Choose an image first.'
    return
  }
  flushPendingFocus()
  setMenu('social')
  status.textContent = 'Generating social media crops…'
  downloadAll.disabled = true
  setGenerateBusy(true)
  activeWorker.postMessage({ type: 'social' })
})

generatePassport.addEventListener('click', () => {
  if (!activeWorker || !workerReady) {
    status.textContent = 'Choose an image first.'
    return
  }
  flushPendingFocus()
  setMenu('passport')
  status.textContent = 'Generating passport photo crops…'
  downloadAll.disabled = true
  setGenerateBusy(true)
  activeWorker.postMessage({ type: 'passport' })
})

downloadAll.addEventListener('click', () => void downloadZip())
formatSelect.addEventListener('change', updateOutputSettings)
qualityInput.addEventListener('input', updateQualityUi)
qualityInput.addEventListener('change', updateOutputSettings)
menuButtons.forEach((button) => button.addEventListener('click', () => setMenu(button.dataset.menu as PresetGroup)))
backgroundButtons.forEach((button) => button.addEventListener('click', () => requestBackground(button.dataset.background ?? 'original')))
passportBackgroundColor.addEventListener('input', () => selectBackground(passportBackgroundColor.value))
passportBackgroundColor.addEventListener('change', () => requestBackground(passportBackgroundColor.value))

customForm.addEventListener('submit', (event) => {
  event.preventDefault()
  customError.textContent = ''
  if (!activeWorker || !workerReady) {
    customError.textContent = 'Choose an image first.'
    return
  }
  const dimensions = customDimensions()
  if ('error' in dimensions) {
    customError.textContent = dimensions.error ?? 'Invalid custom size.'
    return
  }
  customSequence += 1
  const preset: ImagePreset = {
    id: `custom-${dimensions.width}x${dimensions.height}-${customSequence}`,
    group: 'custom',
    platform: 'Custom',
    label: `${dimensions.width} × ${dimensions.height}`,
    width: dimensions.width!,
    height: dimensions.height!,
    facePadding: 0.12,
  }
  flushPendingFocus()
  status.textContent = `Generating ${preset.width} × ${preset.height}…`
  downloadAll.disabled = true
  setGenerateBusy(true)
  activeWorker.postMessage({ type: 'custom', preset })
})

lockRatio.addEventListener('change', () => {
  if (lockRatio.checked) {
    const width = Number(customWidth.value) || 1
    const height = Number(customHeight.value) || 1
    lockedRatio = width / height
  }
})
customWidth.addEventListener('input', syncLockedHeight)
customHeight.addEventListener('input', syncLockedWidth)
ratioButtons.forEach((button) => button.addEventListener('click', () => {
  const [w, h] = (button.dataset.ratio ?? '1/1').split('/').map(Number)
  lockedRatio = w / h
  lockRatio.checked = true
  syncLockedHeight()
}))

focusStage.addEventListener('pointerdown', (event) => {
  dragging = true
  focusStage.setPointerCapture(event.pointerId)
  focusFromPointer(event)
})
focusStage.addEventListener('pointermove', (event) => { if (dragging) focusFromPointer(event) })
focusStage.addEventListener('pointerup', (event) => {
  dragging = false
  focusStage.releasePointerCapture(event.pointerId)
  focusFromPointer(event)
})
focusStage.addEventListener('pointercancel', () => { dragging = false })
resetFocus.addEventListener('click', () => {
  if (focusTimer) window.clearTimeout(focusTimer)
  focusTimer = undefined
  pendingFocus = undefined
  activeWorker?.postMessage({ type: 'auto' })
  markOutputsStale('Auto focus restored — click Generate crop to refresh outputs.')
})
focusImage.addEventListener('load', repositionTarget)
window.addEventListener('resize', repositionTarget)

updateQualityUi()
setMenu('social')
selectBackground('original')
setGenerateBusy(false)
downloadAll.disabled = true
initStoreAssets()
document.documentElement.dataset.appReady = 'true'

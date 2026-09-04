import './style.css'
import { zipSync, strToU8 } from 'fflate'
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
const customForm = document.querySelector<HTMLFormElement>('#custom-form')!
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

let generated: Generated[] = []
let activeWorker: Worker | undefined
let originalUrl: string | undefined
let dragging = false
let regenTimer: number | undefined
let currentFileName = 'crop-image'
let activeMenu: PresetGroup = 'social'
let passportRequested = false
let customSequence = 0
let lockedRatio = 1
let activeBackground = 'original'

function currentFormat() { return formatSelect.value as OutputFormat }
function currentQuality() { return Number(qualityInput.value) / 100 }

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

async function decode(file: File): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file)
  const sourceWidth = bitmap.width
  const sourceHeight = bitmap.height
  const target = workingDimensions(sourceWidth, sourceHeight)
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, target.width, target.height)
  bitmap.close()
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

function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
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
  image.style.aspectRatio = `${item.preset.width} / ${item.preset.height}`
  thumb.append(image)

  const body = document.createElement('div')
  body.className = 'card-body'
  const meta = document.createElement('div')
  meta.className = 'card-meta'
  meta.innerHTML = `<strong>${item.preset.platform}</strong><span>${item.preset.label}</span>`
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

function scheduleFocus(x: number, y: number) {
  const nx = Math.min(1, Math.max(0, x))
  const ny = Math.min(1, Math.max(0, y))
  setTarget(nx, ny)
  if (regenTimer) window.clearTimeout(regenTimer)
  regenTimer = window.setTimeout(() => {
    downloadAll.disabled = true
    activeWorker?.postMessage({ type: 'focus', x: nx, y: ny })
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

function regenerateWithSettings() {
  updateQualityUi()
  if (!activeWorker) return
  downloadAll.disabled = true
  status.textContent = 'Updating output settings…'
  activeWorker.postMessage({ type: 'settings', format: currentFormat(), quality: currentQuality() })
}

function folderFor(group: PresetGroup) {
  if (group === 'passport') return 'passport-photo'
  if (group === 'custom') return 'custom'
  return 'social-media'
}

async function downloadZip() {
  if (!generated.length || downloadAll.disabled) return
  downloadAll.disabled = true
  status.textContent = 'Creating ZIP locally…'
  try {
    const files: Record<string, Uint8Array> = {}
    for (const item of generated) {
      files[`${folderFor(item.preset.group)}/${item.preset.id}.${item.extension}`] = new Uint8Array(await item.blob.arrayBuffer())
    }
    files['manifest.json'] = strToU8(JSON.stringify({
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
    }, null, 2))
    const zipped = zipSync(files, { level: 6 })
    download(new Blob([zipped.slice().buffer], { type: 'application/zip' }), 'image-sizes.zip')
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
  renderGrid()

  if (menu === 'passport' && activeWorker && !passportRequested) {
    passportRequested = true
    status.textContent = 'Generating passport photo sizes…'
    downloadAll.disabled = true
    activeWorker.postMessage({ type: 'passport' })
  }
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
    ? 'Restoring passport photo background…'
    : 'Replacing passport photo background…'
  downloadAll.disabled = true
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

  activeWorker?.terminate()
  revokeResults()
  passportRequested = false
  customSequence = 0
  activeBackground = 'original'
  selectBackground('original')
  backgroundStatus.textContent = ''
  activeMenu = 'social'
  setMenu('social')
  currentFileName = file.name
  results.hidden = false
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
    if (image.scaled) {
      const sourceMp = (image.sourceWidth * image.sourceHeight / 1_000_000).toFixed(1)
      const workingMp = (image.width * image.height / 1_000_000).toFixed(1)
      status.textContent = `Optimized ${sourceMp} MP photo to ${workingMp} MP working image…`
    } else {
      status.textContent = 'Starting local smart crop…'
    }

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    activeWorker = worker

    worker.onmessage = (event) => {
      const message = event.data
      if (message.type === 'status') status.textContent = message.message
      if (message.type === 'auto-focus-point') setTarget(message.x, message.y)
      if (message.type === 'background-ready') {
        backgroundStatus.textContent = message.value === 'original'
          ? 'Original background restored.'
          : 'Background replaced. The person mask is cached for faster color changes.'
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
        downloadAll.disabled = generated.length === 0
      }
      if (message.type === 'error') {
        status.textContent = `Error: ${message.message}`
        backgroundStatus.textContent = `Background error: ${message.message}`
        pick.disabled = false
        downloadAll.disabled = generated.length === 0
      }
    }
    worker.onerror = (event) => {
      status.textContent = `Error: ${event.message}`
      pick.disabled = false
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
    status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`
    pick.disabled = false
    downloadAll.disabled = generated.length === 0
  }
}

pick.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => fileInput.files?.[0] && process(fileInput.files[0]))
dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('drag') })
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'))
dropzone.addEventListener('drop', (event) => {
  event.preventDefault()
  dropzone.classList.remove('drag')
  const file = event.dataTransfer?.files[0]
  if (file) process(file)
})

downloadAll.addEventListener('click', downloadZip)
formatSelect.addEventListener('change', regenerateWithSettings)
qualityInput.addEventListener('input', updateQualityUi)
qualityInput.addEventListener('change', regenerateWithSettings)
menuButtons.forEach((button) => button.addEventListener('click', () => setMenu(button.dataset.menu as PresetGroup)))
backgroundButtons.forEach((button) => button.addEventListener('click', () => requestBackground(button.dataset.background ?? 'original')))
passportBackgroundColor.addEventListener('input', () => {
  selectBackground(passportBackgroundColor.value)
})
passportBackgroundColor.addEventListener('change', () => requestBackground(passportBackgroundColor.value))

customForm.addEventListener('submit', (event) => {
  event.preventDefault()
  customError.textContent = ''
  if (!activeWorker) {
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
  status.textContent = `Generating ${preset.width} × ${preset.height}…`
  downloadAll.disabled = true
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
focusStage.addEventListener('pointerup', (event) => { dragging = false; focusStage.releasePointerCapture(event.pointerId); focusFromPointer(event) })
focusStage.addEventListener('pointercancel', () => { dragging = false })
resetFocus.addEventListener('click', () => {
  if (regenTimer) window.clearTimeout(regenTimer)
  downloadAll.disabled = true
  status.textContent = 'Restoring auto focus…'
  activeWorker?.postMessage({ type: 'auto' })
})
focusImage.addEventListener('load', repositionTarget)
window.addEventListener('resize', repositionTarget)

updateQualityUi()
setMenu('social')
selectBackground('original')
downloadAll.disabled = true

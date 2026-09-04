import './style.css'
import { zipSync, strToU8 } from 'fflate'
import type { SocialPreset } from './presets'

const fileInput = document.querySelector<HTMLInputElement>('#file')!
const pick = document.querySelector<HTMLButtonElement>('#pick')!
const dropzone = document.querySelector<HTMLElement>('#dropzone')!
const status = document.querySelector<HTMLElement>('#status')!
const results = document.querySelector<HTMLElement>('#results')!
const grid = document.querySelector<HTMLElement>('#grid')!
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

const MAX_WORKING_PIXELS = 12_000_000
const MAX_WORKING_EDGE = 4096

type OutputFormat = 'png' | 'jpeg' | 'webp'
type Generated = { preset: SocialPreset; blob: Blob; url: string; extension: string; mime: string }
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

function currentFormat() { return formatSelect.value as OutputFormat }
function currentQuality() { return Number(qualityInput.value) / 100 }

function revokeResults() {
  for (const item of generated) URL.revokeObjectURL(item.url)
  generated = []
  grid.replaceChildren()
}

function replaceResults(next: Generated) {
  const existingIndex = generated.findIndex((item) => item.preset.id === next.preset.id)
  if (existingIndex >= 0) URL.revokeObjectURL(generated[existingIndex].url)
  if (existingIndex >= 0) generated[existingIndex] = next
  else generated.push(next)
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

function createCard(item: Generated) {
  const card = document.createElement('article')
  card.className = 'card'
  card.innerHTML = `<div class="thumb"><img src="${item.url}" alt="${item.preset.platform} ${item.preset.label}" /></div><div class="card-body"><div><strong>${item.preset.platform}</strong><span>${item.preset.label}</span></div><small>${item.preset.width} × ${item.preset.height} · ${item.extension.toUpperCase()} · ${humanBytes(item.blob.size)}</small><button>Download</button></div>`
  card.querySelector('button')!.addEventListener('click', () => download(item.blob, `${item.preset.id}.${item.extension}`))
  return card
}

function renderGrid() {
  grid.replaceChildren(...generated.map(createCard))
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

async function downloadZip() {
  if (!generated.length || downloadAll.disabled) return
  downloadAll.disabled = true
  status.textContent = 'Creating ZIP locally…'
  try {
    const files: Record<string, Uint8Array> = {}
    for (const item of generated) {
      files[`${item.preset.platform.toLowerCase()}/${item.preset.id}.${item.extension}`] = new Uint8Array(await item.blob.arrayBuffer())
    }
    files['manifest.json'] = strToU8(JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: currentFileName,
      format: currentFormat(),
      quality: currentFormat() === 'png' ? null : Number(qualityInput.value),
      files: generated.map((item) => ({
        id: item.preset.id,
        platform: item.preset.platform,
        label: item.preset.label,
        width: item.preset.width,
        height: item.preset.height,
        filename: `${item.preset.platform.toLowerCase()}/${item.preset.id}.${item.extension}`,
      })),
    }, null, 2))
    const zipped = zipSync(files, { level: 6 })
    const zipBuffer = zipped.slice().buffer
    download(new Blob([zipBuffer], { type: 'application/zip' }), 'social-media-crops.zip')
    status.textContent = `Done — ZIP contains ${generated.length} images.`
  } catch (error) {
    status.textContent = `Error creating ZIP: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    downloadAll.disabled = false
  }
}

async function process(file: File) {
  if (!file.type.startsWith('image/')) {
    status.textContent = 'Please choose an image file.'
    return
  }

  activeWorker?.terminate()
  revokeResults()
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
      status.textContent = 'Starting local AI…'
    }

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    activeWorker = worker

    worker.onmessage = (event) => {
      const message = event.data
      if (message.type === 'status') status.textContent = message.message
      if (message.type === 'result') {
        const blob = new Blob([message.bytes], { type: message.mime })
        const item: Generated = {
          preset: message.preset as SocialPreset,
          blob,
          url: URL.createObjectURL(blob),
          extension: message.extension,
          mime: message.mime,
        }
        if (message.replace) replaceResults(item)
        else { generated.push(item); renderGrid() }
        status.textContent = `Generated ${message.index + 1} / ${message.total}`
      }
      if (message.type === 'done') {
        status.textContent = message.manual
          ? 'Done — manual focus applied to every format.'
          : `Done — ${generated.length} images generated locally.`
        pick.disabled = false
        downloadAll.disabled = generated.length === 0
      }
      if (message.type === 'error') {
        status.textContent = `Error: ${message.message}`
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
  setTarget(0.5, 0.5)
  downloadAll.disabled = true
  activeWorker?.postMessage({ type: 'auto' })
})
focusImage.addEventListener('load', repositionTarget)
window.addEventListener('resize', repositionTarget)

updateQualityUi()
downloadAll.disabled = true

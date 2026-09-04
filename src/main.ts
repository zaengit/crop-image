import './style.css'
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

type Generated = { preset: SocialPreset; blob: Blob; url: string }
let generated: Generated[] = []
let activeWorker: Worker | undefined
let originalUrl: string | undefined
let dragging = false
let regenTimer: number | undefined

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

async function decode(file: File) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { rgba: image.data, width: canvas.width, height: canvas.height }
}

function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function createCard(item: Generated) {
  const card = document.createElement('article')
  card.className = 'card'
  card.innerHTML = `<div class="thumb"><img src="${item.url}" alt="${item.preset.platform} ${item.preset.label}" /></div><div class="card-body"><div><strong>${item.preset.platform}</strong><span>${item.preset.label}</span></div><small>${item.preset.width} × ${item.preset.height}</small><button>Download</button></div>`
  card.querySelector('button')!.addEventListener('click', () => download(item.blob, `${item.preset.id}.png`))
  return card
}

function renderGrid() {
  grid.replaceChildren(...generated.map(createCard))
}

function setTarget(x: number, y: number) {
  const nx = Math.min(1, Math.max(0, x))
  const ny = Math.min(1, Math.max(0, y))
  focusTarget.style.left = `${nx * 100}%`
  focusTarget.style.top = `${ny * 100}%`
  focusTarget.dataset.x = String(nx)
  focusTarget.dataset.y = String(ny)
}

function scheduleFocus(x: number, y: number) {
  setTarget(x, y)
  if (regenTimer) window.clearTimeout(regenTimer)
  regenTimer = window.setTimeout(() => activeWorker?.postMessage({ type: 'focus', x, y }), 140)
}

function focusFromPointer(event: PointerEvent) {
  const rect = focusStage.getBoundingClientRect()
  scheduleFocus((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
}

async function process(file: File) {
  activeWorker?.terminate()
  revokeResults()
  results.hidden = false
  focusEditor.hidden = false
  status.textContent = 'Reading image…'
  pick.disabled = true

  if (originalUrl) URL.revokeObjectURL(originalUrl)
  originalUrl = URL.createObjectURL(file)
  focusImage.src = originalUrl
  setTarget(0.5, 0.5)

  try {
    const image = await decode(file)
    status.textContent = 'Starting local AI…'
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    activeWorker = worker

    worker.onmessage = (event) => {
      const message = event.data
      if (message.type === 'status') status.textContent = message.message
      if (message.type === 'result') {
        const blob = new Blob([message.bytes], { type: 'image/png' })
        const item = { preset: message.preset as SocialPreset, blob, url: URL.createObjectURL(blob) }
        if (message.replace) replaceResults(item)
        else { generated.push(item); renderGrid() }
        status.textContent = `Generated ${message.index + 1} / ${message.total}`
      }
      if (message.type === 'done') {
        status.textContent = message.manual ? 'Done — manual focus applied to every format.' : `Done — ${generated.length} images generated locally.`
        pick.disabled = false
      }
      if (message.type === 'error') {
        status.textContent = `Error: ${message.message}`
        pick.disabled = false
      }
    }
    worker.onerror = (event) => {
      status.textContent = `Error: ${event.message}`
      pick.disabled = false
    }
    worker.postMessage({ type: 'load', rgba: image.rgba.buffer, width: image.width, height: image.height }, [image.rgba.buffer])
  } catch (error) {
    status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`
    pick.disabled = false
  }
}

pick.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => fileInput.files?.[0] && process(fileInput.files[0]))
dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('drag') })
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'))
dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('drag'); const file = event.dataTransfer?.files[0]; if (file?.type.startsWith('image/')) process(file) })

downloadAll.addEventListener('click', () => { generated.forEach((item, index) => setTimeout(() => download(item.blob, `${item.preset.id}.png`), index * 120)) })

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
  activeWorker?.postMessage({ type: 'auto' })
})

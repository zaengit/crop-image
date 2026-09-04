import './style.css'
import type { SocialPreset } from './presets'

const fileInput = document.querySelector<HTMLInputElement>('#file')!
const pick = document.querySelector<HTMLButtonElement>('#pick')!
const dropzone = document.querySelector<HTMLElement>('#dropzone')!
const status = document.querySelector<HTMLElement>('#status')!
const results = document.querySelector<HTMLElement>('#results')!
const grid = document.querySelector<HTMLElement>('#grid')!
const downloadAll = document.querySelector<HTMLButtonElement>('#download-all')!
type Generated = { preset: SocialPreset; blob: Blob; url: string }
let generated: Generated[] = []
let activeWorker: Worker | undefined

function revokeResults() { for (const item of generated) URL.revokeObjectURL(item.url); generated = []; grid.replaceChildren() }
async function decode(file: File) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width; canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0); bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { rgba: image.data, width: canvas.width, height: canvas.height }
}
function download(blob: Blob, filename: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
function addCard(item: Generated) {
  const card = document.createElement('article'); card.className = 'card'
  card.innerHTML = `<div class="thumb"><img src="${item.url}" alt="${item.preset.platform} ${item.preset.label}" /></div><div class="card-body"><div><strong>${item.preset.platform}</strong><span>${item.preset.label}</span></div><small>${item.preset.width} × ${item.preset.height}</small><button>Download</button></div>`
  card.querySelector('button')!.addEventListener('click', () => download(item.blob, `${item.preset.id}.png`)); grid.append(card)
}
async function process(file: File) {
  activeWorker?.terminate(); revokeResults(); results.hidden = false; status.textContent = 'Reading image…'; pick.disabled = true
  try {
    const image = await decode(file); status.textContent = 'Starting local AI…'
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); activeWorker = worker
    worker.onmessage = (event) => {
      const message = event.data
      if (message.type === 'status') status.textContent = message.message
      if (message.type === 'result') {
        const blob = new Blob([message.bytes], { type: 'image/png' })
        const item = { preset: message.preset as SocialPreset, blob, url: URL.createObjectURL(blob) }
        generated.push(item); addCard(item); status.textContent = `Generated ${message.index + 1} / ${message.total}`
      }
      if (message.type === 'done') { status.textContent = `Done — ${generated.length} images generated locally.`; pick.disabled = false; worker.terminate(); if (activeWorker === worker) activeWorker = undefined }
      if (message.type === 'error') { status.textContent = `Error: ${message.message}`; pick.disabled = false; worker.terminate() }
    }
    worker.onerror = (event) => { status.textContent = `Error: ${event.message}`; pick.disabled = false }
    worker.postMessage({ rgba: image.rgba.buffer, width: image.width, height: image.height }, [image.rgba.buffer])
  } catch (error) { status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`; pick.disabled = false }
}
pick.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => fileInput.files?.[0] && process(fileInput.files[0]))
dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('drag') })
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'))
dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('drag'); const file = event.dataTransfer?.files[0]; if (file?.type.startsWith('image/')) process(file) })
downloadAll.addEventListener('click', () => { generated.forEach((item, index) => setTimeout(() => download(item.blob, `${item.preset.id}.png`), index * 120)) })

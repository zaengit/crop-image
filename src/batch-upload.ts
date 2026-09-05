import './batch-upload.css'
import './enhancement-bridge'

type BatchItem = {
  id: string
  file: File
  url: string
}

const fileInput = document.querySelector<HTMLInputElement>('#file')!
const pick = document.querySelector<HTMLButtonElement>('#pick')!
const dropzone = document.querySelector<HTMLElement>('#dropzone')!
const batch = document.querySelector<HTMLElement>('#image-batch')!
const batchList = document.querySelector<HTMLElement>('#image-batch-list')!
const batchCount = document.querySelector<HTMLElement>('#image-batch-count')!
const batchAdd = document.querySelector<HTMLButtonElement>('#image-batch-add')!

let items: BatchItem[] = []
let activeId: string | undefined
let switching = false

function keyFor(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function cleanupItem(item: BatchItem) {
  URL.revokeObjectURL(item.url)
}

function setInputFile(file: File) {
  const transfer = new DataTransfer()
  transfer.items.add(file)
  switching = true
  fileInput.files = transfer.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  queueMicrotask(() => { switching = false })
}

function activate(id: string) {
  const item = items.find((entry) => entry.id === id)
  if (!item) return
  activeId = id
  render()
  setInputFile(item.file)
}

function remove(id: string) {
  const index = items.findIndex((entry) => entry.id === id)
  if (index < 0) return
  const [removed] = items.splice(index, 1)
  cleanupItem(removed)

  if (activeId === id) {
    const next = items[index] ?? items[index - 1]
    activeId = next?.id
    render()
    if (next) setInputFile(next.file)
    return
  }
  render()
}

function render() {
  batch.hidden = items.length === 0
  batchCount.textContent = items.length ? `${items.length} image${items.length === 1 ? '' : 's'}` : ''
  batchList.replaceChildren(...items.map((item, index) => {
    const card = document.createElement('article')
    card.className = `batch-item${item.id === activeId ? ' active' : ''}`
    card.setAttribute('aria-current', item.id === activeId ? 'true' : 'false')

    const select = document.createElement('button')
    select.type = 'button'
    select.className = 'batch-select'
    select.title = `Open ${item.file.name}`
    select.addEventListener('click', () => activate(item.id))

    const image = document.createElement('img')
    image.src = item.url
    image.alt = ''
    const meta = document.createElement('span')
    meta.className = 'batch-meta'
    const name = document.createElement('strong')
    name.textContent = item.file.name
    const number = document.createElement('small')
    number.textContent = `Image ${index + 1}`
    meta.append(name, number)
    select.append(image, meta)

    const removeButton = document.createElement('button')
    removeButton.type = 'button'
    removeButton.className = 'batch-remove'
    removeButton.textContent = '×'
    removeButton.setAttribute('aria-label', `Remove ${item.file.name}`)
    removeButton.addEventListener('click', () => remove(item.id))

    card.append(select, removeButton)
    return card
  }))
}

function addFiles(fileList: FileList | File[]) {
  const incoming = Array.from(fileList).filter((file) => file.type.startsWith('image/'))
  if (!incoming.length) return

  const existing = new Set(items.map((item) => keyFor(item.file)))
  const fresh = incoming.filter((file) => !existing.has(keyFor(file)))
  for (const file of fresh) {
    items.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) })
  }
  if (!items.length) return

  if (!activeId) activeId = items[0].id
  render()
}

fileInput.addEventListener('change', () => {
  if (switching || !fileInput.files?.length) return
  const selected = Array.from(fileInput.files)
  addFiles(selected)
  const first = selected.find((file) => items.some((item) => keyFor(item.file) === keyFor(file)))
  const item = first ? items.find((entry) => keyFor(entry.file) === keyFor(first)) : undefined
  if (item) {
    activeId = item.id
    render()
  }
}, { capture: true })

batchAdd.addEventListener('click', () => fileInput.click())

dropzone.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files)
}, { capture: true })

window.addEventListener('beforeunload', () => {
  for (const item of items) cleanupItem(item)
})

pick.textContent = 'Choose images'

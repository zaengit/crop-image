import { Zip, ZipDeflate, strToU8 } from 'fflate'

type StorePlatform = 'google' | 'apple' | 'both'
type StoreOrientation = 'portrait' | 'landscape' | 'both'
type ResizeMode = 'fit' | 'fill' | 'smart'
type StoreFormat = 'png' | 'jpeg'
type IconFitMode = 'fit' | 'fill'

type ScreenshotSource = {
  id: string
  file: File
  url: string
  width: number
  height: number
}

type StorePreset = {
  id: string
  platform: 'google' | 'apple'
  category: 'phone' | 'tablet7' | 'tablet10' | 'feature' | 'iphone' | 'ipad'
  label: string
  width: number
  height: number
  feature?: boolean
}

type StoreOutput = {
  id: string
  blob: Blob
  url: string
  filename: string
  folder: string
  label: string
  width: number
  height: number
  sourceName: string
  quality: string
  upscale: number
}

type IconOutput = {
  id: string
  blob: Blob
  url: string
  filename: string
  folder: string
  label: string
  width: number
  height: number
}

type DecodedStoreSource = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  scaled: boolean
}

const GOOGLE_PRESETS: StorePreset[] = [
  { id: 'google-phone', platform: 'google', category: 'phone', label: 'Google Play · Phone', width: 1080, height: 1920 },
  { id: 'google-tablet-7', platform: 'google', category: 'tablet7', label: 'Google Play · 7-inch tablet', width: 1440, height: 2560 },
  { id: 'google-tablet-10', platform: 'google', category: 'tablet10', label: 'Google Play · 10-inch tablet', width: 1800, height: 3200 },
  { id: 'google-feature', platform: 'google', category: 'feature', label: 'Google Play · Feature graphic', width: 1024, height: 500, feature: true },
]

const APPLE_PRESETS: StorePreset[] = [
  { id: 'apple-iphone-69', platform: 'apple', category: 'iphone', label: 'Apple App Store · iPhone 6.9-inch', width: 1290, height: 2796 },
  { id: 'apple-ipad-13', platform: 'apple', category: 'ipad', label: 'Apple App Store · iPad 13-inch', width: 2064, height: 2752 },
]

const APPLE_ICON_SIZES = [1024, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20]
const MAX_STORE_WORKING_PIXELS = 12_000_000
const MAX_STORE_WORKING_EDGE = 4096

function byId<T extends HTMLElement>(id: string) {
  return document.querySelector<T>(`#${id}`)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function safeBaseName(name: string) {
  return name
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image'
}

function download(blob: Blob, filename: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1200)
}

function workingDimensions(width: number, height: number) {
  const pixels = width * height
  const byPixels = pixels > MAX_STORE_WORKING_PIXELS ? Math.sqrt(MAX_STORE_WORKING_PIXELS / pixels) : 1
  const byEdge = Math.max(width, height) > MAX_STORE_WORKING_EDGE ? MAX_STORE_WORKING_EDGE / Math.max(width, height) : 1
  const scale = Math.min(1, byPixels, byEdge)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

function renderDecodedSource(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): DecodedStoreSource {
  if (!sourceWidth || !sourceHeight) throw new Error('Image has invalid dimensions.')
  const target = workingDimensions(sourceWidth, sourceHeight)
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not create an App Store image canvas.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, target.width, target.height)
  return {
    canvas,
    width: target.width,
    height: target.height,
    sourceWidth,
    sourceHeight,
    scaled: target.scale < 0.999,
  }
}

function decodeWithImageElement(file: File): Promise<DecodedStoreSource> {
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

async function decodeStoreFile(file: File): Promise<DecodedStoreSource> {
  let primaryError: unknown
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      try {
        return renderDecodedSource(bitmap, bitmap.width, bitmap.height)
      } finally {
        bitmap.close()
      }
    } catch (error) {
      primaryError = error
      console.warn('App Store createImageBitmap failed; using image-element fallback.', error)
    }
  }

  try {
    return await decodeWithImageElement(file)
  } catch (fallbackError) {
    const primary = primaryError instanceof Error ? primaryError.message : primaryError ? String(primaryError) : ''
    const fallback = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
    throw new Error(primary ? `${fallback} Primary decoder: ${primary}` : fallback)
  }
}

function canvasBlob(canvas: HTMLCanvasElement, format: StoreFormat, quality = 0.92) {
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Unable to encode image')), mime, quality)
  })
}

function fillSolid(ctx: CanvasRenderingContext2D, width: number, height: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  focus = { x: 0.5, y: 0.5 },
) {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const cropWidth = targetWidth / scale
  const cropHeight = targetHeight / scale
  const sx = clamp(focus.x * sourceWidth - cropWidth / 2, 0, Math.max(0, sourceWidth - cropWidth))
  const sy = clamp(focus.y * sourceHeight - cropHeight / 2, 0, Math.max(0, sourceHeight - cropHeight))
  ctx.drawImage(image, sx, sy, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight)
  return scale
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  ctx.drawImage(image, (targetWidth - width) / 2, (targetHeight - height) / 2, width, height)
  return scale
}

function estimateFocus(image: CanvasImageSource, width: number, height: number) {
  const sampleWidth = 48
  const sampleHeight = Math.max(24, Math.round(sampleWidth * height / width))
  const canvas = document.createElement('canvas')
  canvas.width = sampleWidth
  canvas.height = sampleHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { x: 0.5, y: 0.5 }
  ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight)
  const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data

  let bestScore = -Infinity
  let bestX = 0.5
  let bestY = 0.5
  for (let y = 1; y < sampleHeight - 1; y++) {
    for (let x = 1; x < sampleWidth - 1; x++) {
      const i = (y * sampleWidth + x) * 4
      const right = (y * sampleWidth + x + 1) * 4
      const down = ((y + 1) * sampleWidth + x) * 4
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      const lumaRight = data[right] * 0.299 + data[right + 1] * 0.587 + data[right + 2] * 0.114
      const lumaDown = data[down] * 0.299 + data[down + 1] * 0.587 + data[down + 2] * 0.114
      const gradient = Math.abs(luma - lumaRight) + Math.abs(luma - lumaDown)
      const max = Math.max(data[i], data[i + 1], data[i + 2])
      const min = Math.min(data[i], data[i + 1], data[i + 2])
      const saturation = max - min
      const nx = x / (sampleWidth - 1)
      const ny = y / (sampleHeight - 1)
      const centerBias = 1 - Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * 1.15)
      const score = gradient * 0.72 + saturation * 0.18 + centerBias * 25
      if (score > bestScore) {
        bestScore = score
        bestX = nx
        bestY = ny
      }
    }
  }
  return { x: bestX, y: bestY }
}

function upscaleLabel(scale: number) {
  if (scale <= 1.05) return 'Native quality'
  if (scale <= 1.5) return `Good · Upscaled ${scale.toFixed(1)}×`
  if (scale <= 2) return `Caution · Upscaled ${scale.toFixed(1)}×`
  return `Low source resolution · Upscaled ${scale.toFixed(1)}×`
}

async function renderScreenshot(
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: ResizeMode,
  background: string,
  format: StoreFormat,
) {
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Unable to create screenshot output canvas')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (mode === 'fit') {
    if (background === 'auto') {
      ctx.save()
      ctx.filter = 'blur(28px) saturate(0.9)'
      drawCover(ctx, image, sourceWidth, sourceHeight, targetWidth, targetHeight)
      ctx.restore()
      ctx.save()
      ctx.fillStyle = 'rgba(255,255,255,.14)'
      ctx.fillRect(0, 0, targetWidth, targetHeight)
      ctx.restore()
    } else {
      fillSolid(ctx, targetWidth, targetHeight, background)
    }
    const scale = drawContain(ctx, image, sourceWidth, sourceHeight, targetWidth, targetHeight)
    return { blob: await canvasBlob(canvas, format), scale }
  }

  fillSolid(ctx, targetWidth, targetHeight, background === 'auto' ? '#f8fafc' : background)
  const focus = mode === 'smart' ? estimateFocus(image, sourceWidth, sourceHeight) : { x: 0.5, y: 0.5 }
  const scale = drawCover(ctx, image, sourceWidth, sourceHeight, targetWidth, targetHeight, focus)
  return { blob: await canvasBlob(canvas, format), scale }
}

async function renderIcon(
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  size: number,
  mode: IconFitMode,
  background: string,
) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Unable to create app icon output canvas')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (background !== 'transparent') fillSolid(ctx, size, size, background)
  if (mode === 'fill') {
    drawCover(ctx, image, sourceWidth, sourceHeight, size, size)
  } else {
    const inset = Math.round(size * 0.08)
    const inner = size - inset * 2
    const scale = Math.min(inner / sourceWidth, inner / sourceHeight)
    const width = sourceWidth * scale
    const height = sourceHeight * scale
    ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
  }
  return canvasBlob(canvas, 'png')
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

export function initStoreAssets() {
  const storePanel = byId<HTMLElement>('store-panel')
  if (!storePanel) return

  const storeViewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-store-view]')]
  const screenshotView = byId<HTMLElement>('store-screenshots')!
  const iconView = byId<HTMLElement>('store-icon')!
  const screenshotInput = byId<HTMLInputElement>('store-screenshot-input')!
  const screenshotPick = byId<HTMLButtonElement>('store-pick-screenshots')!
  const screenshotDrop = byId<HTMLElement>('store-screenshot-drop')!
  const screenshotList = byId<HTMLElement>('store-screenshot-list')!
  const platformSelect = byId<HTMLSelectElement>('store-platform')!
  const orientationSelect = byId<HTMLSelectElement>('store-orientation')!
  const resizeModeSelect = byId<HTMLSelectElement>('store-resize-mode')!
  const formatSelect = byId<HTMLSelectElement>('store-format')!
  const screenshotBgButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-store-bg]')]
  const screenshotBgColor = byId<HTMLInputElement>('store-bg-color')!
  const presetChecks = [...document.querySelectorAll<HTMLInputElement>('[data-store-preset]')]
  const generateScreenshotsButton = byId<HTMLButtonElement>('store-generate-screenshots')!
  const screenshotStatus = byId<HTMLElement>('store-screenshot-status')!
  const screenshotResults = byId<HTMLElement>('store-screenshot-results')!
  const screenshotZipButton = byId<HTMLButtonElement>('store-download-screenshots')!

  const iconInput = byId<HTMLInputElement>('store-icon-input')!
  const iconPick = byId<HTMLButtonElement>('store-pick-icon')!
  const iconDrop = byId<HTMLElement>('store-icon-drop')!
  const iconSourceInfo = byId<HTMLElement>('store-icon-source-info')!
  const iconFitMode = byId<HTMLSelectElement>('icon-fit-mode')!
  const iconBgButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-icon-bg]')]
  const iconBgColor = byId<HTMLInputElement>('icon-bg-color')!
  const iconPreviewSquare = byId<HTMLElement>('icon-preview-square')!
  const iconPreviewRounded = byId<HTMLElement>('icon-preview-rounded')!
  const iconPreviewImage = byId<HTMLImageElement>('icon-preview-image')!
  const iconPreviewRoundedImage = byId<HTMLImageElement>('icon-preview-rounded-image')!
  const generateIconsButton = byId<HTMLButtonElement>('store-generate-icons')!
  const iconStatus = byId<HTMLElement>('store-icon-status')!
  const iconResults = byId<HTMLElement>('store-icon-results')!
  const iconZipButton = byId<HTMLButtonElement>('store-download-icons')!

  let screenshotSources: ScreenshotSource[] = []
  let screenshotOutputs: StoreOutput[] = []
  let screenshotBackground = 'auto'
  let draggedSourceId: string | undefined
  let iconSource: ScreenshotSource | undefined
  let iconBackground = 'transparent'
  let iconOutputs: IconOutput[] = []
  let screenshotRevision = 0
  let iconRevision = 0

  function revokeScreenshotOutputs() {
    for (const item of screenshotOutputs) URL.revokeObjectURL(item.url)
    screenshotOutputs = []
    screenshotResults.replaceChildren()
    screenshotZipButton.disabled = true
  }

  function revokeIconOutputs() {
    for (const item of iconOutputs) URL.revokeObjectURL(item.url)
    iconOutputs = []
    iconResults.replaceChildren()
    iconZipButton.disabled = true
  }

  function invalidateScreenshots(message?: string) {
    screenshotRevision += 1
    revokeScreenshotOutputs()
    if (message) screenshotStatus.textContent = message
  }

  function invalidateIcons(message?: string) {
    iconRevision += 1
    revokeIconOutputs()
    if (message) iconStatus.textContent = message
  }

  function setView(view: 'screenshots' | 'icon') {
    screenshotView.hidden = view !== 'screenshots'
    iconView.hidden = view !== 'icon'
    for (const button of storeViewButtons) {
      const active = button.dataset.storeView === view
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    }
  }

  function moveSource(id: string, direction: -1 | 1) {
    const index = screenshotSources.findIndex((item) => item.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= screenshotSources.length) return
    const [item] = screenshotSources.splice(index, 1)
    screenshotSources.splice(target, 0, item)
    invalidateScreenshots('Screenshot order changed — generate again when ready.')
    renderSourceList()
  }

  function removeSource(id: string) {
    const index = screenshotSources.findIndex((item) => item.id === id)
    if (index < 0) return
    URL.revokeObjectURL(screenshotSources[index].url)
    screenshotSources.splice(index, 1)
    invalidateScreenshots()
    renderSourceList()
    screenshotStatus.textContent = screenshotSources.length
      ? `${screenshotSources.length} screenshot${screenshotSources.length === 1 ? '' : 's'} ready.`
      : 'No screenshots added.'
  }

  function renderSourceList() {
    screenshotList.replaceChildren()
    screenshotSources.forEach((source, index) => {
      const row = document.createElement('article')
      row.className = 'source-row'
      row.draggable = true
      row.dataset.sourceId = source.id

      const img = document.createElement('img')
      img.src = source.url
      img.alt = source.file.name

      const info = document.createElement('div')
      info.className = 'source-info'
      const strong = document.createElement('strong')
      strong.textContent = `${String(index + 1).padStart(2, '0')} · ${source.file.name}`
      const small = document.createElement('small')
      small.textContent = `${source.width} × ${source.height}`
      info.append(strong, small)

      const actions = document.createElement('div')
      actions.className = 'source-actions'
      const up = document.createElement('button')
      up.type = 'button'
      up.textContent = '↑'
      up.title = 'Move up'
      up.disabled = index === 0
      up.addEventListener('click', () => moveSource(source.id, -1))
      const down = document.createElement('button')
      down.type = 'button'
      down.textContent = '↓'
      down.title = 'Move down'
      down.disabled = index === screenshotSources.length - 1
      down.addEventListener('click', () => moveSource(source.id, 1))
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = 'Delete'
      remove.addEventListener('click', () => removeSource(source.id))
      actions.append(up, down, remove)

      row.addEventListener('dragstart', () => {
        draggedSourceId = source.id
        row.classList.add('dragging')
      })
      row.addEventListener('dragend', () => {
        draggedSourceId = undefined
        row.classList.remove('dragging')
      })
      row.addEventListener('dragover', (event) => event.preventDefault())
      row.addEventListener('drop', (event) => {
        event.preventDefault()
        if (!draggedSourceId || draggedSourceId === source.id) return
        const from = screenshotSources.findIndex((item) => item.id === draggedSourceId)
        const to = screenshotSources.findIndex((item) => item.id === source.id)
        if (from < 0 || to < 0) return
        const [moving] = screenshotSources.splice(from, 1)
        screenshotSources.splice(to, 0, moving)
        invalidateScreenshots('Screenshot order changed — generate again when ready.')
        renderSourceList()
      })

      row.append(img, info, actions)
      screenshotList.append(row)
    })
  }

  async function addScreenshotFiles(files: FileList | File[]) {
    const images = [...files].filter((file) => file.type.startsWith('image/'))
    const remaining = Math.max(0, 10 - screenshotSources.length)
    if (!remaining) {
      screenshotStatus.textContent = 'Maximum 10 screenshots.'
      return
    }

    screenshotStatus.textContent = 'Reading screenshots…'
    for (const file of images.slice(0, remaining)) {
      const decoded = await decodeStoreFile(file)
      screenshotSources.push({
        id: `shot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        url: URL.createObjectURL(file),
        width: decoded.sourceWidth,
        height: decoded.sourceHeight,
      })
      await Promise.resolve()
    }
    invalidateScreenshots()
    renderSourceList()
    screenshotStatus.textContent = `${screenshotSources.length} screenshot${screenshotSources.length === 1 ? '' : 's'} ready.`
  }

  function selectedPresets() {
    const platform = platformSelect.value as StorePlatform
    const orientation = orientationSelect.value as StoreOrientation
    const checked = new Set(presetChecks.filter((input) => input.checked).map((input) => input.dataset.storePreset))
    const sourcePresets = [
      ...(platform === 'google' || platform === 'both' ? GOOGLE_PRESETS : []),
      ...(platform === 'apple' || platform === 'both' ? APPLE_PRESETS : []),
    ].filter((preset) => checked.has(preset.category))

    const expanded: StorePreset[] = []
    for (const preset of sourcePresets) {
      if (preset.feature) {
        expanded.push(preset)
        continue
      }
      if (orientation === 'portrait' || orientation === 'both') expanded.push({ ...preset, id: `${preset.id}-portrait` })
      if (orientation === 'landscape' || orientation === 'both') {
        expanded.push({ ...preset, id: `${preset.id}-landscape`, label: `${preset.label} · Landscape`, width: preset.height, height: preset.width })
      }
    }
    return expanded
  }

  function outputCard(item: StoreOutput | IconOutput, icon = false) {
    const card = document.createElement('article')
    card.className = 'store-result-card'
    const preview = document.createElement('div')
    preview.className = icon ? 'store-result-preview icon-result-preview' : 'store-result-preview'
    const image = document.createElement('img')
    image.src = item.url
    image.alt = item.label
    image.loading = 'lazy'
    preview.append(image)

    const body = document.createElement('div')
    body.className = 'store-result-body'
    const strong = document.createElement('strong')
    strong.textContent = item.label
    const dimensions = document.createElement('small')
    dimensions.textContent = `${item.width} × ${item.height}`
    body.append(strong, dimensions)
    if ('quality' in item) {
      const quality = document.createElement('small')
      quality.className = item.upscale > 2 ? 'quality-low' : item.upscale > 1.5 ? 'quality-warn' : 'quality-good'
      quality.textContent = item.quality
      body.append(quality)
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary compact'
    button.textContent = 'Download'
    button.addEventListener('click', () => download(item.blob, item.filename))
    body.append(button)
    card.append(preview, body)
    return card
  }

  async function generateScreenshots() {
    if (!screenshotSources.length) {
      screenshotStatus.textContent = 'Add at least one screenshot first.'
      return
    }
    const presets = selectedPresets()
    if (!presets.length) {
      screenshotStatus.textContent = 'Select at least one output preset.'
      return
    }

    const revision = ++screenshotRevision
    revokeScreenshotOutputs()
    generateScreenshotsButton.disabled = true
    screenshotStatus.textContent = 'Generating store screenshots locally…'
    const mode = resizeModeSelect.value as ResizeMode
    const format = formatSelect.value as StoreFormat
    const extension = format === 'jpeg' ? 'jpg' : 'png'

    try {
      let completed = 0
      const expected = screenshotSources.reduce((count, _source, index) => count + presets.filter((preset) => !preset.feature || index === 0).length, 0)
      for (let sourceIndex = 0; sourceIndex < screenshotSources.length; sourceIndex++) {
        if (revision !== screenshotRevision) return
        const source = screenshotSources[sourceIndex]
        const decoded = await decodeStoreFile(source.file)
        if (decoded.scaled) {
          screenshotStatus.textContent = `Optimized ${decoded.sourceWidth} × ${decoded.sourceHeight} source for memory-safe processing…`
        }
        for (const preset of presets) {
          if (revision !== screenshotRevision) return
          if (preset.feature && sourceIndex !== 0) continue
          const rendered = await renderScreenshot(decoded.canvas, decoded.width, decoded.height, preset.width, preset.height, mode, screenshotBackground, format)
          if (revision !== screenshotRevision) return
          const order = String(sourceIndex + 1).padStart(2, '0')
          const orientation = preset.width >= preset.height ? 'landscape' : 'portrait'
          const base = safeBaseName(source.file.name)
          const filename = `${order}-${base}-${preset.id}-${preset.width}x${preset.height}.${extension}`
          const folder = preset.platform === 'google'
            ? `app-store-assets/screenshots/google-play/${preset.category}`
            : `app-store-assets/screenshots/apple-app-store/${preset.category}`
          const output: StoreOutput = {
            id: `${source.id}-${preset.id}`,
            blob: rendered.blob,
            url: URL.createObjectURL(rendered.blob),
            filename,
            folder,
            label: `${preset.label} · ${orientation}`,
            width: preset.width,
            height: preset.height,
            sourceName: source.file.name,
            quality: upscaleLabel(rendered.scale),
            upscale: rendered.scale,
          }
          screenshotOutputs.push(output)
          screenshotResults.append(outputCard(output))
          completed += 1
          screenshotStatus.textContent = `Generated ${completed} / ${expected}`
          await Promise.resolve()
        }
      }
      if (revision !== screenshotRevision) return
      screenshotZipButton.disabled = screenshotOutputs.length === 0
      screenshotStatus.textContent = `Done — ${screenshotOutputs.length} store asset${screenshotOutputs.length === 1 ? '' : 's'} generated.`
    } catch (error) {
      if (revision === screenshotRevision) screenshotStatus.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      if (revision === screenshotRevision) generateScreenshotsButton.disabled = false
    }
  }

  async function downloadScreenshotZip() {
    if (!screenshotOutputs.length) return
    screenshotZipButton.disabled = true
    screenshotStatus.textContent = 'Creating screenshots ZIP…'
    try {
      const manifest = strToU8(JSON.stringify({
        generatedAt: new Date().toISOString(),
        resizeMode: resizeModeSelect.value,
        background: screenshotBackground,
        files: screenshotOutputs.map((item) => ({
          filename: `${item.folder}/${item.filename}`,
          source: item.sourceName,
          width: item.width,
          height: item.height,
          upscale: Number(item.upscale.toFixed(2)),
          quality: item.quality,
        })),
      }, null, 2))
      const entries = screenshotOutputs.map((output) => ({ path: `${output.folder}/${output.filename}`, blob: output.blob }))
      entries.push({ path: 'app-store-assets/screenshots/manifest.json', bytes: manifest } as { path: string; blob?: Blob; bytes?: Uint8Array })
      const zip = await createStreamingZip(entries)
      download(zip, 'app-store-screenshots.zip')
      screenshotStatus.textContent = 'Screenshots ZIP ready.'
    } catch (error) {
      screenshotStatus.textContent = `ZIP error: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      screenshotZipButton.disabled = screenshotOutputs.length === 0
    }
  }

  function updateIconPreview() {
    const source = iconSource
    const bg = iconBackground === 'transparent' ? 'transparent' : iconBackground
    for (const preview of [iconPreviewSquare, iconPreviewRounded]) preview.style.background = bg
    const fit = iconFitMode.value === 'fit' ? 'contain' : 'cover'
    iconPreviewImage.style.objectFit = fit
    iconPreviewRoundedImage.style.objectFit = fit
    if (!source) return
    iconPreviewImage.src = source.url
    iconPreviewRoundedImage.src = source.url
  }

  async function setIconFile(file: File) {
    if (!file.type.startsWith('image/')) {
      iconStatus.textContent = 'Choose an image file.'
      return
    }
    iconStatus.textContent = 'Reading icon…'
    const decoded = await decodeStoreFile(file)
    if (iconSource) URL.revokeObjectURL(iconSource.url)
    invalidateIcons()
    iconSource = {
      id: `icon-${Date.now()}`,
      file,
      url: URL.createObjectURL(file),
      width: decoded.sourceWidth,
      height: decoded.sourceHeight,
    }
    const squareWarning = iconSource.width === iconSource.height ? '' : ' · Non-square source: Fit is recommended.'
    const resolutionWarning = Math.min(iconSource.width, iconSource.height) < 1024 ? ' · Source is below 1024 px and may look soft.' : ''
    iconSourceInfo.textContent = `${iconSource.width} × ${iconSource.height}${squareWarning}${resolutionWarning}`
    updateIconPreview()
    iconStatus.textContent = 'Icon ready.'
  }

  async function generateIcons() {
    if (!iconSource) {
      iconStatus.textContent = 'Choose an icon first.'
      return
    }
    const revision = ++iconRevision
    revokeIconOutputs()
    generateIconsButton.disabled = true
    iconStatus.textContent = 'Generating app icons locally…'

    try {
      const decoded = await decodeStoreFile(iconSource.file)
      const mode = iconFitMode.value as IconFitMode
      const specs = [
        { id: 'master', folder: 'app-store-assets/icons/master', filename: 'master-1024.png', label: 'Master icon', size: 1024 },
        { id: 'google-512', folder: 'app-store-assets/icons/google-play', filename: 'icon-512.png', label: 'Google Play icon', size: 512 },
        ...APPLE_ICON_SIZES.map((size) => ({ id: `apple-${size}`, folder: 'app-store-assets/icons/apple-app-store', filename: `icon-${size}.png`, label: `Apple icon ${size}`, size })),
      ]

      for (let index = 0; index < specs.length; index++) {
        if (revision !== iconRevision) return
        const spec = specs[index]
        const blob = await renderIcon(decoded.canvas, decoded.width, decoded.height, spec.size, mode, iconBackground)
        if (revision !== iconRevision) return
        const output: IconOutput = {
          id: spec.id,
          blob,
          url: URL.createObjectURL(blob),
          filename: spec.filename,
          folder: spec.folder,
          label: spec.label,
          width: spec.size,
          height: spec.size,
        }
        iconOutputs.push(output)
        iconResults.append(outputCard(output, true))
        iconStatus.textContent = `Generated ${index + 1} / ${specs.length}`
        await Promise.resolve()
      }
      iconZipButton.disabled = false
      const alphaWarning = iconBackground === 'transparent'
        ? ' Transparent background is preserved; use an opaque background for Apple marketing icons if required.'
        : ''
      iconStatus.textContent = `Done — ${iconOutputs.length} icons generated.${alphaWarning}`
    } catch (error) {
      if (revision === iconRevision) iconStatus.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      if (revision === iconRevision) generateIconsButton.disabled = false
    }
  }

  async function downloadIconZip() {
    if (!iconOutputs.length) return
    iconZipButton.disabled = true
    iconStatus.textContent = 'Creating icons ZIP…'
    try {
      const manifest = strToU8(JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: iconSource?.file.name,
        sourceSize: iconSource ? { width: iconSource.width, height: iconSource.height } : null,
        layout: iconFitMode.value,
        background: iconBackground,
        roundedCornersBakedIn: false,
        files: iconOutputs.map((item) => ({ filename: `${item.folder}/${item.filename}`, width: item.width, height: item.height })),
      }, null, 2))
      const entries = iconOutputs.map((output) => ({ path: `${output.folder}/${output.filename}`, blob: output.blob }))
      entries.push({ path: 'app-store-assets/icons/manifest.json', bytes: manifest } as { path: string; blob?: Blob; bytes?: Uint8Array })
      const zip = await createStreamingZip(entries)
      download(zip, 'app-icons.zip')
      iconStatus.textContent = 'Icons ZIP ready.'
    } catch (error) {
      iconStatus.textContent = `ZIP error: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      iconZipButton.disabled = iconOutputs.length === 0
    }
  }

  const screenshotSettingChanged = () => invalidateScreenshots('Settings changed — generate screenshot assets when ready.')
  platformSelect.addEventListener('change', screenshotSettingChanged)
  orientationSelect.addEventListener('change', screenshotSettingChanged)
  resizeModeSelect.addEventListener('change', screenshotSettingChanged)
  formatSelect.addEventListener('change', screenshotSettingChanged)
  presetChecks.forEach((input) => input.addEventListener('change', screenshotSettingChanged))

  storeViewButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.storeView === 'icon' ? 'icon' : 'screenshots')))

  screenshotPick.addEventListener('click', () => screenshotInput.click())
  screenshotInput.addEventListener('change', () => {
    const files = screenshotInput.files
    screenshotInput.value = ''
    if (files) void addScreenshotFiles(files).catch((error) => { screenshotStatus.textContent = `Error: ${error instanceof Error ? error.message : String(error)}` })
  })
  screenshotDrop.addEventListener('dragover', (event) => { event.preventDefault(); screenshotDrop.classList.add('drag') })
  screenshotDrop.addEventListener('dragleave', () => screenshotDrop.classList.remove('drag'))
  screenshotDrop.addEventListener('drop', (event) => {
    event.preventDefault()
    screenshotDrop.classList.remove('drag')
    if (event.dataTransfer?.files) void addScreenshotFiles(event.dataTransfer.files).catch((error) => { screenshotStatus.textContent = `Error: ${error instanceof Error ? error.message : String(error)}` })
  })
  screenshotBgButtons.forEach((button) => button.addEventListener('click', () => {
    screenshotBackground = button.dataset.storeBg ?? 'auto'
    screenshotBgButtons.forEach((candidate) => {
      const active = candidate === button
      candidate.classList.toggle('active', active)
      candidate.setAttribute('aria-pressed', String(active))
    })
    screenshotSettingChanged()
  }))
  screenshotBgColor.addEventListener('input', () => {
    screenshotBackground = screenshotBgColor.value
    screenshotBgButtons.forEach((button) => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false') })
    screenshotSettingChanged()
  })
  generateScreenshotsButton.addEventListener('click', () => void generateScreenshots())
  screenshotZipButton.addEventListener('click', () => void downloadScreenshotZip())

  iconPick.addEventListener('click', () => iconInput.click())
  iconInput.addEventListener('change', () => {
    const file = iconInput.files?.[0]
    iconInput.value = ''
    if (file) void setIconFile(file).catch((error) => { iconStatus.textContent = `Error: ${error instanceof Error ? error.message : String(error)}` })
  })
  iconDrop.addEventListener('dragover', (event) => { event.preventDefault(); iconDrop.classList.add('drag') })
  iconDrop.addEventListener('dragleave', () => iconDrop.classList.remove('drag'))
  iconDrop.addEventListener('drop', (event) => {
    event.preventDefault()
    iconDrop.classList.remove('drag')
    const file = event.dataTransfer?.files[0]
    if (file) void setIconFile(file).catch((error) => { iconStatus.textContent = `Error: ${error instanceof Error ? error.message : String(error)}` })
  })
  iconFitMode.addEventListener('change', () => { updateIconPreview(); invalidateIcons('Icon settings changed — generate again when ready.') })
  iconBgButtons.forEach((button) => button.addEventListener('click', () => {
    iconBackground = button.dataset.iconBg ?? 'transparent'
    iconBgButtons.forEach((candidate) => {
      const active = candidate === button
      candidate.classList.toggle('active', active)
      candidate.setAttribute('aria-pressed', String(active))
    })
    updateIconPreview()
    invalidateIcons('Icon settings changed — generate again when ready.')
  }))
  iconBgColor.addEventListener('input', () => {
    iconBackground = iconBgColor.value
    iconBgButtons.forEach((button) => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false') })
    updateIconPreview()
    invalidateIcons('Icon settings changed — generate again when ready.')
  })
  generateIconsButton.addEventListener('click', () => void generateIcons())
  iconZipButton.addEventListener('click', () => void downloadIconZip())

  setView('screenshots')
}

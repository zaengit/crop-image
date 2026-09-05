import { strToU8, zipSync } from 'fflate'
import { createEnhancedStoreBitmap } from './store-global-enhance'

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
  const x = (targetWidth - width) / 2
  const y = (targetHeight - height) / 2
  ctx.drawImage(image, x, y, width, height)
  return scale
}

function estimateFocus(bitmap: ImageBitmap) {
  const sampleWidth = 48
  const sampleHeight = Math.max(24, Math.round(sampleWidth * bitmap.height / bitmap.width))
  const canvas = document.createElement('canvas')
  canvas.width = sampleWidth
  canvas.height = sampleHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight)
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
  bitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
  mode: ResizeMode,
  background: string,
  format: StoreFormat,
) {
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (mode === 'fit') {
    if (background === 'auto') {
      ctx.save()
      ctx.filter = 'blur(28px) saturate(0.9)'
      drawCover(ctx, bitmap, bitmap.width, bitmap.height, targetWidth, targetHeight)
      ctx.restore()
      ctx.save()
      ctx.fillStyle = 'rgba(255,255,255,.14)'
      ctx.fillRect(0, 0, targetWidth, targetHeight)
      ctx.restore()
    } else {
      fillSolid(ctx, targetWidth, targetHeight, background)
    }
    const scale = drawContain(ctx, bitmap, bitmap.width, bitmap.height, targetWidth, targetHeight)
    return { blob: await canvasBlob(canvas, format), scale }
  }

  fillSolid(ctx, targetWidth, targetHeight, background === 'auto' ? '#f8fafc' : background)
  const focus = mode === 'smart' ? estimateFocus(bitmap) : { x: 0.5, y: 0.5 }
  const scale = drawCover(ctx, bitmap, bitmap.width, bitmap.height, targetWidth, targetHeight, focus)
  return { blob: await canvasBlob(canvas, format), scale }
}

async function renderIcon(
  bitmap: ImageBitmap,
  size: number,
  mode: IconFitMode,
  background: string,
) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (background !== 'transparent') fillSolid(ctx, size, size, background)
  if (mode === 'fill') drawCover(ctx, bitmap, bitmap.width, bitmap.height, size, size)
  else {
    const inset = Math.round(size * 0.08)
    const inner = size - inset * 2
    const scale = Math.min(inner / bitmap.width, inner / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height)
  }
  return canvasBlob(canvas, 'png')
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
    renderSourceList()
  }

  function removeSource(id: string) {
    const index = screenshotSources.findIndex((item) => item.id === id)
    if (index < 0) return
    URL.revokeObjectURL(screenshotSources[index].url)
    screenshotSources.splice(index, 1)
    revokeScreenshotOutputs()
    renderSourceList()
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
        renderSourceList()
      })

      row.append(img, info, actions)
      screenshotList.append(row)
    })
  }

  async function addScreenshotFiles(files: FileList | File[]) {
    const images = [...files].filter((file) => file.type.startsWith('image/'))
    const remaining = Math.max(0, 10 - screenshotSources.length)
    for (const file of images.slice(0, remaining)) {
      const bitmap = await createImageBitmap(file)
      const source: ScreenshotSource = {
        id: `shot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        url: URL.createObjectURL(file),
        width: bitmap.width,
        height: bitmap.height,
      }
      bitmap.close()
      screenshotSources.push(source)
    }
    revokeScreenshotOutputs()
    renderSourceList()
    screenshotStatus.textContent = screenshotSources.length
      ? `${screenshotSources.length} screenshot${screenshotSources.length === 1 ? '' : 's'} ready.`
      : 'No screenshots added.'
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
        const source = screenshotSources[sourceIndex]
        const bitmap = await createEnhancedStoreBitmap(source.file)
        try {
          for (const preset of presets) {
            if (preset.feature && sourceIndex !== 0) continue
            const rendered = await renderScreenshot(bitmap, preset.width, preset.height, mode, screenshotBackground, format)
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
          }
        } finally {
          bitmap.close()
        }
      }
      screenshotZipButton.disabled = screenshotOutputs.length === 0
      screenshotStatus.textContent = `Done — ${screenshotOutputs.length} store asset${screenshotOutputs.length === 1 ? '' : 's'} generated.`
    } catch (error) {
      screenshotStatus.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      generateScreenshotsButton.disabled = false
    }
  }

  async function downloadScreenshotZip() {
    if (!screenshotOutputs.length) return
    screenshotZipButton.disabled = true
    screenshotStatus.textContent = 'Creating screenshots ZIP…'
    try {
      const files: Record<string, Uint8Array> = {}
      for (const output of screenshotOutputs) {
        files[`${output.folder}/${output.filename}`] = new Uint8Array(await output.blob.arrayBuffer())
      }
      files['app-store-assets/screenshots/manifest.json'] = strToU8(JSON.stringify({
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
      const zipped = zipSync(files, { level: 6 })
      download(new Blob([zipped.slice().buffer], { type: 'application/zip' }), 'app-store-screenshots.zip')
      screenshotStatus.textContent = 'Screenshots ZIP ready.'
    } finally {
      screenshotZipButton.disabled = false
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
    if (iconSource) URL.revokeObjectURL(iconSource.url)
    revokeIconOutputs()
    const bitmap = await createImageBitmap(file)
    iconSource = {
      id: `icon-${Date.now()}`,
      file,
      url: URL.createObjectURL(file),
      width: bitmap.width,
      height: bitmap.height,
    }
    bitmap.close()
    const squareWarning = iconSource.width === iconSource.height ? '' : ' · Non-square source: Fit is recommended.'
    const resolutionWarning = Math.min(iconSource.width, iconSource.height) < 1024 ? ' · Source is below 1024 px and may look soft.' : ''
    iconSourceInfo.textContent = `${iconSource.width} × ${iconSource.height}${squareWarning}${resolutionWarning}`
    updateIconPreview()
  }

  async function generateIcons() {
    if (!iconSource) {
      iconStatus.textContent = 'Choose an icon first.'
      return
    }
    revokeIconOutputs()
    generateIconsButton.disabled = true
    iconStatus.textContent = 'Generating app icons locally…'
    const bitmap = await createEnhancedStoreBitmap(iconSource.file)
    const mode = iconFitMode.value as IconFitMode

    try {
      const specs = [
        { id: 'master', folder: 'app-store-assets/icons/master', filename: 'master-1024.png', label: 'Master icon', size: 1024 },
        { id: 'google-512', folder: 'app-store-assets/icons/google-play', filename: 'icon-512.png', label: 'Google Play icon', size: 512 },
        ...APPLE_ICON_SIZES.map((size) => ({ id: `apple-${size}`, folder: 'app-store-assets/icons/apple-app-store', filename: `icon-${size}.png`, label: `Apple icon ${size}`, size })),
      ]

      for (let index = 0; index < specs.length; index++) {
        const spec = specs[index]
        const blob = await renderIcon(bitmap, spec.size, mode, iconBackground)
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
      }
      iconZipButton.disabled = false
      const alphaWarning = iconBackground === 'transparent'
        ? ' Transparent background is preserved; use an opaque background for Apple marketing icons if required.'
        : ''
      iconStatus.textContent = `Done — ${iconOutputs.length} icons generated.${alphaWarning}`
    } catch (error) {
      iconStatus.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      bitmap.close()
      generateIconsButton.disabled = false
    }
  }

  async function downloadIconZip() {
    if (!iconOutputs.length) return
    iconZipButton.disabled = true
    iconStatus.textContent = 'Creating icons ZIP…'
    try {
      const files: Record<string, Uint8Array> = {}
      for (const output of iconOutputs) {
        files[`${output.folder}/${output.filename}`] = new Uint8Array(await output.blob.arrayBuffer())
      }
      files['app-store-assets/icons/manifest.json'] = strToU8(JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: iconSource?.file.name,
        sourceSize: iconSource ? { width: iconSource.width, height: iconSource.height } : null,
        layout: iconFitMode.value,
        background: iconBackground,
        roundedCornersBakedIn: false,
        files: iconOutputs.map((item) => ({ filename: `${item.folder}/${item.filename}`, width: item.width, height: item.height })),
      }, null, 2))
      const zipped = zipSync(files, { level: 6 })
      download(new Blob([zipped.slice().buffer], { type: 'application/zip' }), 'app-icons.zip')
      iconStatus.textContent = 'Icons ZIP ready.'
    } finally {
      iconZipButton.disabled = false
    }
  }

  storeViewButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.storeView === 'icon' ? 'icon' : 'screenshots')))

  screenshotPick.addEventListener('click', () => screenshotInput.click())
  screenshotInput.addEventListener('change', () => screenshotInput.files && addScreenshotFiles(screenshotInput.files))
  screenshotDrop.addEventListener('dragover', (event) => { event.preventDefault(); screenshotDrop.classList.add('drag') })
  screenshotDrop.addEventListener('dragleave', () => screenshotDrop.classList.remove('drag'))
  screenshotDrop.addEventListener('drop', (event) => {
    event.preventDefault()
    screenshotDrop.classList.remove('drag')
    if (event.dataTransfer?.files) addScreenshotFiles(event.dataTransfer.files)
  })
  screenshotBgButtons.forEach((button) => button.addEventListener('click', () => {
    screenshotBackground = button.dataset.storeBg ?? 'auto'
    screenshotBgButtons.forEach((candidate) => {
      const active = candidate === button
      candidate.classList.toggle('active', active)
      candidate.setAttribute('aria-pressed', String(active))
    })
  }))
  screenshotBgColor.addEventListener('input', () => {
    screenshotBackground = screenshotBgColor.value
    screenshotBgButtons.forEach((button) => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false') })
  })
  generateScreenshotsButton.addEventListener('click', generateScreenshots)
  screenshotZipButton.addEventListener('click', downloadScreenshotZip)

  iconPick.addEventListener('click', () => iconInput.click())
  iconInput.addEventListener('change', () => iconInput.files?.[0] && setIconFile(iconInput.files[0]))
  iconDrop.addEventListener('dragover', (event) => { event.preventDefault(); iconDrop.classList.add('drag') })
  iconDrop.addEventListener('dragleave', () => iconDrop.classList.remove('drag'))
  iconDrop.addEventListener('drop', (event) => {
    event.preventDefault()
    iconDrop.classList.remove('drag')
    const file = event.dataTransfer?.files[0]
    if (file) setIconFile(file)
  })
  iconFitMode.addEventListener('change', updateIconPreview)
  iconBgButtons.forEach((button) => button.addEventListener('click', () => {
    iconBackground = button.dataset.iconBg ?? 'transparent'
    iconBgButtons.forEach((candidate) => {
      const active = candidate === button
      candidate.classList.toggle('active', active)
      candidate.setAttribute('aria-pressed', String(active))
    })
    updateIconPreview()
  }))
  iconBgColor.addEventListener('input', () => {
    iconBackground = iconBgColor.value
    iconBgButtons.forEach((button) => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false') })
    updateIconPreview()
  })
  generateIconsButton.addEventListener('click', generateIcons)
  iconZipButton.addEventListener('click', downloadIconZip)

  setView('screenshots')
}

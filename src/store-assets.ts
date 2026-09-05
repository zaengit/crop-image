import { Zip, ZipDeflate, strToU8 } from 'fflate'

export type StorePlatform = 'google' | 'apple' | 'both'
export type StoreOrientation = 'portrait' | 'landscape' | 'both'
export type ResizeMode = 'fit' | 'fill' | 'smart'
export type StoreFormat = 'png' | 'jpeg'
export type IconFitMode = 'fit' | 'fill'

export type ScreenshotSource = {
  id: string
  file: File
  url: string
  width: number
  height: number
}

export type StorePresetCategory = 'phone' | 'tablet7' | 'tablet10' | 'feature' | 'iphone' | 'ipad'

export type StoreScreenshotOptions = {
  platform: StorePlatform
  orientation: StoreOrientation
  resizeMode: ResizeMode
  format: StoreFormat
  background: string
  categories: StorePresetCategory[]
}

export type StoreIconOptions = {
  fitMode: IconFitMode
  background: string
}

export type StoreOutput = {
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

export type IconOutput = {
  id: string
  blob: Blob
  url: string
  filename: string
  folder: string
  label: string
  width: number
  height: number
}

type StorePreset = {
  id: string
  platform: 'google' | 'apple'
  category: StorePresetCategory
  label: string
  width: number
  height: number
  feature?: boolean
}

type DecodedStoreSource = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  scaled: boolean
}

type ZipEntry = { path: string; blob?: Blob; bytes?: Uint8Array }

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

export function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1200)
}

function workingDimensions(width: number, height: number) {
  const pixels = width * height
  const byPixels = pixels > MAX_STORE_WORKING_PIXELS ? Math.sqrt(MAX_STORE_WORKING_PIXELS / pixels) : 1
  const longest = Math.max(width, height)
  const byEdge = longest > MAX_STORE_WORKING_EDGE ? MAX_STORE_WORKING_EDGE / longest : 1
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

function selectedPresets(options: StoreScreenshotOptions) {
  const checked = new Set(options.categories)
  const sourcePresets = [
    ...(options.platform === 'google' || options.platform === 'both' ? GOOGLE_PRESETS : []),
    ...(options.platform === 'apple' || options.platform === 'both' ? APPLE_PRESETS : []),
  ].filter((preset) => checked.has(preset.category))

  const expanded: StorePreset[] = []
  for (const preset of sourcePresets) {
    if (preset.feature) {
      expanded.push(preset)
      continue
    }
    if (options.orientation === 'portrait' || options.orientation === 'both') expanded.push({ ...preset, id: `${preset.id}-portrait` })
    if (options.orientation === 'landscape' || options.orientation === 'both') {
      expanded.push({ ...preset, id: `${preset.id}-landscape`, label: `${preset.label} · Landscape`, width: preset.height, height: preset.width })
    }
  }
  return expanded
}

export async function createScreenshotSource(file: File): Promise<ScreenshotSource> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  const decoded = await decodeStoreFile(file)
  return {
    id: `source-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    url: URL.createObjectURL(file),
    width: decoded.sourceWidth,
    height: decoded.sourceHeight,
  }
}

export async function generateStoreScreenshots(
  sources: ScreenshotSource[],
  options: StoreScreenshotOptions,
  onProgress?: (completed: number, total: number) => void,
): Promise<StoreOutput[]> {
  if (!sources.length) throw new Error('Add at least one screenshot first.')
  const presets = selectedPresets(options)
  if (!presets.length) throw new Error('Select at least one output preset.')
  const outputs: StoreOutput[] = []
  const extension = options.format === 'jpeg' ? 'jpg' : 'png'
  const total = sources.reduce((count, _source, index) => count + presets.filter((preset) => !preset.feature || index === 0).length, 0)
  let completed = 0

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex]
    const decoded = await decodeStoreFile(source.file)
    for (const preset of presets) {
      if (preset.feature && sourceIndex !== 0) continue
      const rendered = await renderScreenshot(
        decoded.canvas,
        decoded.width,
        decoded.height,
        preset.width,
        preset.height,
        options.resizeMode,
        options.background,
        options.format,
      )
      const order = String(sourceIndex + 1).padStart(2, '0')
      const orientation = preset.width >= preset.height ? 'landscape' : 'portrait'
      const base = safeBaseName(source.file.name)
      const filename = `${order}-${base}-${preset.id}-${preset.width}x${preset.height}.${extension}`
      const folder = preset.platform === 'google'
        ? `app-store-assets/screenshots/google-play/${preset.category}`
        : `app-store-assets/screenshots/apple-app-store/${preset.category}`
      outputs.push({
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
      })
      completed += 1
      onProgress?.(completed, total)
      await Promise.resolve()
    }
  }

  return outputs
}

export async function generateStoreIcons(
  source: ScreenshotSource,
  options: StoreIconOptions,
  onProgress?: (completed: number, total: number) => void,
): Promise<IconOutput[]> {
  const decoded = await decodeStoreFile(source.file)
  const specs = [
    { id: 'master', folder: 'app-store-assets/icons/master', filename: 'master-1024.png', label: 'Master icon', size: 1024 },
    { id: 'google-512', folder: 'app-store-assets/icons/google-play', filename: 'icon-512.png', label: 'Google Play icon', size: 512 },
    ...APPLE_ICON_SIZES.map((size) => ({ id: `apple-${size}`, folder: 'app-store-assets/icons/apple-app-store', filename: `icon-${size}.png`, label: `Apple icon ${size}`, size })),
  ]
  const outputs: IconOutput[] = []
  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index]
    const blob = await renderIcon(decoded.canvas, decoded.width, decoded.height, spec.size, options.fitMode, options.background)
    outputs.push({
      id: spec.id,
      blob,
      url: URL.createObjectURL(blob),
      filename: spec.filename,
      folder: spec.folder,
      label: spec.label,
      width: spec.size,
      height: spec.size,
    })
    onProgress?.(index + 1, specs.length)
    await Promise.resolve()
  }
  return outputs
}

async function createStreamingZip(entries: ZipEntry[]) {
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

export async function createScreenshotZip(outputs: StoreOutput[], options: StoreScreenshotOptions) {
  const manifest = strToU8(JSON.stringify({
    generatedAt: new Date().toISOString(),
    resizeMode: options.resizeMode,
    background: options.background,
    files: outputs.map((item) => ({
      filename: `${item.folder}/${item.filename}`,
      source: item.sourceName,
      width: item.width,
      height: item.height,
      upscale: Number(item.upscale.toFixed(2)),
      quality: item.quality,
    })),
  }, null, 2))
  const entries: ZipEntry[] = outputs.map((output) => ({ path: `${output.folder}/${output.filename}`, blob: output.blob }))
  entries.push({ path: 'app-store-assets/screenshots/manifest.json', bytes: manifest })
  return createStreamingZip(entries)
}

export async function createIconZip(source: ScreenshotSource, outputs: IconOutput[], options: StoreIconOptions) {
  const manifest = strToU8(JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: source.file.name,
    sourceSize: { width: source.width, height: source.height },
    layout: options.fitMode,
    background: options.background,
    roundedCornersBakedIn: false,
    files: outputs.map((item) => ({ filename: `${item.folder}/${item.filename}`, width: item.width, height: item.height })),
  }, null, 2))
  const entries: ZipEntry[] = outputs.map((output) => ({ path: `${output.folder}/${output.filename}`, blob: output.blob }))
  entries.push({ path: 'app-store-assets/icons/manifest.json', bytes: manifest })
  return createStreamingZip(entries)
}

export function revokeOutputs(outputs: Array<{ url: string }>) {
  for (const output of outputs) URL.revokeObjectURL(output.url)
}

export function revokeSources(sources: ScreenshotSource[]) {
  for (const source of sources) URL.revokeObjectURL(source.url)
}

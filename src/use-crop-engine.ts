import { Zip, ZipDeflate, strToU8 } from 'fflate'
import { createCropWorker } from './worker-channel'
import type { ImagePreset, PresetGroup } from './presets'
import { DEFAULT_ENHANCEMENT, type EnhancementSettings } from './enhance'
import { setEnhancementSettings } from './enhancement-state'

const MAX_WORKING_PIXELS = 12_000_000
const MAX_WORKING_EDGE = 4096
const MAX_CUSTOM_PIXELS = 32_000_000
const MIN_CUSTOM_EDGE = 64
const MAX_CUSTOM_EDGE = 8192

type OutputFormat = 'png' | 'jpeg' | 'webp'
type WorkerErrorScope = 'load' | 'crop' | 'enhancement' | 'background' | 'settings' | 'focus'

type DecodedImage = {
  rgba: Uint8ClampedArray
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  scaled: boolean
}

export type Generated = {
  preset: ImagePreset
  blob: Blob
  url: string
  extension: string
  mime: string
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

export function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1200)
}

export function humanBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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

export function useCropEngine() {
  const [status, setStatus] = React.useState('Ready')
  const [generated, setGenerated] = React.useState<Generated[]>([])
  const [sourceUrl, setSourceUrl] = React.useState<string | undefined>(undefined)
  const [workerReady, setWorkerReady] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [format, setFormatState] = React.useState<OutputFormat>('jpeg')
  const [quality, setQualityState] = React.useState(90)
  const [focus, setFocus] = React.useState({ x: 0.5, y: 0.5 })
  const [background, setBackgroundState] = React.useState('original')
  const [backgroundStatus, setBackgroundStatus] = React.useState('')
  const [enhancement, setEnhancementState] = React.useState<EnhancementSettings>({ ...DEFAULT_ENHANCEMENT })
  const [enhancementStatus, setEnhancementStatus] = React.useState('Optional — crop can be generated without enhancement.')

  const workerRef = React.useRef<Worker | undefined>(undefined)
  const generatedRef = React.useRef<Generated[]>([])
  const sourceUrlRef = React.useRef<string | undefined>(undefined)
  const processRevision = React.useRef(0)
  const customSequence = React.useRef(0)
  const currentFileName = React.useRef('crop-image')
  const focusTimer = React.useRef<number | undefined>(undefined)
  const pendingFocus = React.useRef<{ x: number; y: number } | undefined>(undefined)
  const formatRef = React.useRef<OutputFormat>('jpeg')
  const qualityRef = React.useRef(90)
  const backgroundRef = React.useRef('original')
  const enhancementRef = React.useRef<EnhancementSettings>({ ...DEFAULT_ENHANCEMENT })

  const replaceGenerated = (next: Generated[]) => {
    generatedRef.current = next
    setGenerated(next)
  }

  const revokeGenerated = () => {
    for (const item of generatedRef.current) URL.revokeObjectURL(item.url)
    replaceGenerated([])
  }

  const upsertGenerated = (next: Generated) => {
    const items = [...generatedRef.current]
    const index = items.findIndex((item) => item.preset.id === next.preset.id)
    if (index >= 0) {
      URL.revokeObjectURL(items[index].url)
      items[index] = next
    } else {
      items.push(next)
    }
    replaceGenerated(items)
  }

  const markOutputsStale = (message: string) => setStatus(message)

  const flushPendingFocus = () => {
    if (focusTimer.current) {
      window.clearTimeout(focusTimer.current)
      focusTimer.current = undefined
    }
    const pending = pendingFocus.current
    pendingFocus.current = undefined
    if (pending) workerRef.current?.postMessage({ type: 'focus', x: pending.x, y: pending.y })
  }

  const updateFocus = (x: number, y: number) => {
    const next = {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    }
    setFocus(next)
    pendingFocus.current = next
    if (focusTimer.current) window.clearTimeout(focusTimer.current)
    focusTimer.current = window.setTimeout(() => {
      focusTimer.current = undefined
      const pending = pendingFocus.current
      pendingFocus.current = undefined
      if (!pending) return
      workerRef.current?.postMessage({ type: 'focus', x: pending.x, y: pending.y })
      if (!busy) markOutputsStale('Manual focus updated — click Generate crop to refresh outputs.')
    }, 180)
  }

  const resetFocus = () => {
    if (focusTimer.current) window.clearTimeout(focusTimer.current)
    focusTimer.current = undefined
    pendingFocus.current = undefined
    workerRef.current?.postMessage({ type: 'auto' })
    markOutputsStale('Auto focus restored — click Generate crop to refresh outputs.')
  }

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setStatus('Please choose an image file.')
      return
    }

    const revision = ++processRevision.current
    if (focusTimer.current) window.clearTimeout(focusTimer.current)
    focusTimer.current = undefined
    pendingFocus.current = undefined
    workerRef.current?.terminate()
    workerRef.current = undefined
    setWorkerReady(false)
    setBusy(false)
    revokeGenerated()
    customSequence.current = 0
    backgroundRef.current = 'original'
    setBackgroundState('original')
    setBackgroundStatus('')
    currentFileName.current = file.name
    setStatus('Reading image…')
    setFocus({ x: 0.5, y: 0.5 })

    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current)
    const url = URL.createObjectURL(file)
    sourceUrlRef.current = url
    setSourceUrl(url)

    try {
      const image = await decode(file)
      if (revision !== processRevision.current) return
      if (image.scaled) {
        const sourceMp = (image.sourceWidth * image.sourceHeight / 1_000_000).toFixed(1)
        const workingMp = (image.width * image.height / 1_000_000).toFixed(1)
        setStatus(`Optimized ${sourceMp} MP photo to ${workingMp} MP working image. Finding the subject…`)
      } else {
        setStatus('Finding the subject…')
      }

      const worker = createCropWorker()
      workerRef.current = worker
      worker.onmessage = (event) => {
        if (workerRef.current !== worker || revision !== processRevision.current) return
        const message = event.data
        if (message.type === 'status') setStatus(message.message)
        if (message.type === 'auto-focus-point') setFocus({ x: message.x, y: message.y })
        if (message.type === 'ready') {
          setWorkerReady(true)
          setBusy(false)
          setStatus('Ready — adjust the focal point if needed, then click Generate crop.')
        }
        if (message.type === 'settings-ready') markOutputsStale('Output settings updated — click Generate crop to refresh outputs.')
        if (message.type === 'focus-ready') {
          markOutputsStale(message.manual
            ? 'Manual focus updated — click Generate crop to refresh outputs.'
            : 'Auto focus restored — click Generate crop to refresh outputs.')
        }
        if (message.type === 'background-ready') {
          setBackgroundStatus(message.value === 'original'
            ? 'Original background ready.'
            : 'Background ready. The person mask is cached for faster color changes.')
          markOutputsStale('Background ready — click Generate crop to refresh passport photos.')
        }
        if (message.type === 'enhancement-settings') {
          const next = { ...DEFAULT_ENHANCEMENT, ...message.settings } as EnhancementSettings
          enhancementRef.current = next
          setEnhancementState(next)
          setEnhancementSettings(next)
          const restoreLabel = message.restoration
            ? message.restoration.method === 'ai' ? 'AI Restoration' : 'local restoration fallback'
            : ''
          const faceLabel = message.faceEnhance
            ? message.faceEnhance.method === 'ai'
              ? `AI Face Enhance (${message.faceEnhance.faces})`
              : message.faceEnhance.faces === 0 ? 'No face detected' : 'local face fallback'
            : ''
          if (message.upscale) {
            const scale = Number(message.upscale.scale ?? 1).toFixed(2).replace(/\.00$/, '')
            const method = message.upscale.method === 'ai' ? 'AI Super Resolution' : 'high-quality fallback'
            const suffix = [restoreLabel, faceLabel].filter(Boolean).map((label) => ` · ${label}`).join('')
            setEnhancementStatus(`${method} ${scale}× ready — ${message.upscale.width} × ${message.upscale.height}${suffix}. Click Generate crop to update outputs.`)
          } else if (restoreLabel || faceLabel) {
            setEnhancementStatus(`${[restoreLabel, faceLabel].filter(Boolean).join(' · ')} ready. Click Generate crop to update outputs.`)
          } else if (message.auto) {
            setEnhancementStatus('Auto Enhance ready — click Generate crop to update outputs.')
          } else {
            setEnhancementStatus(Object.values(next).some((value) => value !== 0 && value !== false)
              ? 'Enhancement ready — click Generate crop to update outputs.'
              : 'Optional — crop can be generated without enhancement.')
          }
          markOutputsStale('Enhancement ready — click Generate crop to refresh outputs.')
        }
        if (message.type === 'result') {
          const blob = new Blob([message.bytes], { type: message.mime })
          upsertGenerated({
            preset: message.preset as ImagePreset,
            blob,
            url: URL.createObjectURL(blob),
            extension: message.extension,
            mime: message.mime,
          })
          setStatus(`Generated ${message.index + 1} / ${message.total}`)
        }
        if (message.type === 'done') {
          setStatus(message.manual
            ? 'Done — manual focus applied to generated sizes.'
            : `Done — ${generatedRef.current.length} images generated locally.`)
          setBusy(false)
        }
        if (message.type === 'error') {
          const scope = message.scope as WorkerErrorScope | undefined
          setStatus(`Error: ${message.message}`)
          if (scope === 'background') setBackgroundStatus(`Background error: ${message.message}`)
          if (scope === 'enhancement') setEnhancementStatus(`Enhancement error: ${message.message}`)
          setBusy(false)
        }
      }
      worker.onerror = (event) => {
        if (workerRef.current !== worker || revision !== processRevision.current) return
        setStatus(`Error: ${event.message || 'Crop worker failed to start in this browser.'}`)
        setBusy(false)
      }
      worker.postMessage({
        type: 'load',
        rgba: image.rgba.buffer,
        width: image.width,
        height: image.height,
        format: formatRef.current,
        quality: qualityRef.current / 100,
      }, [image.rgba.buffer])
    } catch (error) {
      if (revision !== processRevision.current) return
      setStatus(`Error reading image: ${error instanceof Error ? error.message : String(error)}`)
      setBusy(false)
    }
  }

  const setFormat = (next: OutputFormat) => {
    formatRef.current = next
    setFormatState(next)
    workerRef.current?.postMessage({ type: 'settings', format: next, quality: qualityRef.current / 100 })
    if (workerRef.current) markOutputsStale('Output settings updated — click Generate crop to refresh outputs.')
  }

  const setQuality = (next: number) => {
    qualityRef.current = next
    setQualityState(next)
  }

  const commitQuality = () => {
    workerRef.current?.postMessage({ type: 'settings', format: formatRef.current, quality: qualityRef.current / 100 })
    if (workerRef.current) markOutputsStale('Output settings updated — click Generate crop to refresh outputs.')
  }

  const generateGroup = (group: 'social' | 'passport') => {
    if (!workerRef.current || !workerReady) {
      setStatus('Choose an image first.')
      return
    }
    flushPendingFocus()
    setBusy(true)
    setStatus(group === 'social' ? 'Generating social media crops…' : 'Generating passport photo crops…')
    workerRef.current.postMessage({ type: group })
  }

  const generateCustom = (widthInput: number, heightInput: number) => {
    const width = Math.round(widthInput)
    const height = Math.round(heightInput)
    if (!workerRef.current || !workerReady) return 'Choose an image first.'
    if (!Number.isFinite(width) || !Number.isFinite(height)) return 'Enter a valid width and height.'
    if (width < MIN_CUSTOM_EDGE || height < MIN_CUSTOM_EDGE) return `Minimum size is ${MIN_CUSTOM_EDGE} × ${MIN_CUSTOM_EDGE} px.`
    if (width > MAX_CUSTOM_EDGE || height > MAX_CUSTOM_EDGE) return `Maximum edge is ${MAX_CUSTOM_EDGE} px.`
    if (width * height > MAX_CUSTOM_PIXELS) return 'Custom output is limited to 32 megapixels.'

    customSequence.current += 1
    const preset: ImagePreset = {
      id: `custom-${width}x${height}-${customSequence.current}`,
      group: 'custom',
      platform: 'Custom',
      label: `${width} × ${height}`,
      width,
      height,
      facePadding: 0.12,
    }
    flushPendingFocus()
    setStatus(`Generating ${width} × ${height}…`)
    setBusy(true)
    workerRef.current.postMessage({ type: 'custom', preset })
    return ''
  }

  const removeCustom = (id: string) => {
    const items = [...generatedRef.current]
    const index = items.findIndex((item) => item.preset.id === id)
    if (index < 0) return
    URL.revokeObjectURL(items[index].url)
    items.splice(index, 1)
    replaceGenerated(items)
    workerRef.current?.postMessage({ type: 'remove-custom', id })
  }

  const setBackground = (value: string) => {
    backgroundRef.current = value
    setBackgroundState(value)
    if (!workerRef.current) {
      setBackgroundStatus('Choose an image first.')
      return
    }
    setBackgroundStatus(value === 'original' ? 'Restoring the original background…' : 'Removing the original background locally…')
    setStatus(value === 'original' ? 'Preparing the original passport background…' : 'Preparing the passport background…')
    workerRef.current.postMessage({ type: 'background', value })
  }

  const applyEnhancement = (next: EnhancementSettings, reason = 'Applying enhancement…') => {
    enhancementRef.current = { ...next }
    setEnhancementState({ ...next })
    setEnhancementSettings(next)
    if (!workerRef.current) return
    setEnhancementStatus(reason)
    workerRef.current.postMessage({ type: 'enhancement', settings: next })
  }

  const autoEnhance = () => {
    if (!workerRef.current) return
    setEnhancementStatus('Analyzing image locally…')
    workerRef.current.postMessage({ type: 'enhancement-auto' })
  }

  const resetEnhancement = () => applyEnhancement({ ...DEFAULT_ENHANCEMENT }, 'Resetting enhancement…')

  const downloadZip = async () => {
    if (!generatedRef.current.length) return
    setStatus('Creating ZIP locally…')
    try {
      const entries: Array<{ path: string; blob?: Blob; bytes?: Uint8Array }> = generatedRef.current.map((item) => ({
        path: `${folderFor(item.preset.group)}/${item.preset.id}.${item.extension}`,
        blob: item.blob,
      }))
      entries.push({
        path: 'manifest.json',
        bytes: strToU8(JSON.stringify({
          generatedAt: new Date().toISOString(),
          source: currentFileName.current,
          format: formatRef.current,
          quality: formatRef.current === 'png' ? null : qualityRef.current,
          passportBackground: backgroundRef.current,
          files: generatedRef.current.map((item) => ({
            id: item.preset.id,
            group: item.preset.group,
            label: item.preset.label,
            width: item.preset.width,
            height: item.preset.height,
            filename: `${folderFor(item.preset.group)}/${item.preset.id}.${item.extension}`,
          })),
        }, null, 2)),
      })
      const zip = await createStreamingZip(entries)
      downloadBlob(zip, 'image-sizes.zip')
      setStatus(`Done — ZIP contains ${generatedRef.current.length} images.`)
    } catch (error) {
      setStatus(`Error creating ZIP: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  React.useEffect(() => () => {
    processRevision.current += 1
    if (focusTimer.current) window.clearTimeout(focusTimer.current)
    workerRef.current?.terminate()
    for (const item of generatedRef.current) URL.revokeObjectURL(item.url)
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current)
  }, [])

  return {
    status,
    generated,
    sourceUrl,
    hasImage: Boolean(sourceUrl),
    workerReady,
    busy,
    format,
    quality,
    focus,
    background,
    backgroundStatus,
    enhancement,
    enhancementStatus,
    processFile,
    setFormat,
    setQuality,
    commitQuality,
    updateFocus,
    resetFocus,
    generateGroup,
    generateCustom,
    removeCustom,
    setBackground,
    applyEnhancement,
    autoEnhance,
    resetEnhancement,
    downloadZip,
  }
}

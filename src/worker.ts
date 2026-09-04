/// <reference lib="webworker" />

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import initWasm, { smart_crop_png } from './wasm/pkg/crop_image_wasm.js'
import { detectFaces, type FocusRegion } from './ai'
import { PASSPORT_PRESETS, SOCIAL_PRESETS, type ImagePreset } from './presets'

type OutputFormat = 'png' | 'jpeg' | 'webp'
type Mode = { kind: 'focus'; x: number; y: number } | { kind: 'auto' }

let wasmReady: Promise<unknown> | undefined
let segmenterReady: Promise<ImageSegmenter> | undefined
let segmenterCanvas: OffscreenCanvas | undefined
let cachedRgba: Uint8ClampedArray | undefined
let cachedWidth = 0
let cachedHeight = 0
let cachedFocus: FocusRegion[] = []
let cachedPersonMask: Float32Array | undefined
let passportRgba: Uint8ClampedArray | undefined
let passportBackground = 'original'
let generating = false
let pendingMode: Mode | undefined
let currentMode: Mode = { kind: 'auto' }
let outputFormat: OutputFormat = 'jpeg'
let outputQuality = 0.9
const activePresets = new Map<string, ImagePreset>()

function ensureWasm() { wasmReady ??= initWasm(); return wasmReady }

function ensureSegmenter() {
  segmenterReady ??= (async () => {
    self.postMessage({ type: 'status', message: 'Loading local background remover…' })
    const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm')
    segmenterCanvas = new OffscreenCanvas(1, 1)
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: new URL(`${import.meta.env.BASE_URL}models/selfie_segmenter.tflite`, self.location.origin).href,
        delegate: 'CPU',
      },
      canvas: segmenterCanvas,
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })
  })()
  return segmenterReady
}

function mimeFor(format: OutputFormat) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

function extensionFromMime(mime: string) {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  return 'png'
}

function autoFocusPoint() {
  if (!cachedFocus.length) return { x: 0.5, y: 0.5 }
  let totalWeight = 0
  let x = 0
  let y = 0
  for (const region of cachedFocus) {
    const weight = Math.max(0.01, region.confidence)
    x += (region.x + region.width / 2) * weight
    y += (region.y + region.height / 2) * weight
    totalWeight += weight
  }
  return {
    x: Math.min(1, Math.max(0, x / totalWeight)),
    y: Math.min(1, Math.max(0, y / totalWeight)),
  }
}

function postAutoFocusPoint() {
  const point = autoFocusPoint()
  self.postMessage({ type: 'auto-focus-point', x: point.x, y: point.y })
}

function parseHexColor(value: string) {
  const hex = value.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Invalid background color')
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }
}

async function ensurePersonMask() {
  if (cachedPersonMask) return cachedPersonMask
  if (!cachedRgba) throw new Error('No image loaded')

  const segmenter = await ensureSegmenter()
  self.postMessage({ type: 'status', message: 'Separating the person from the background…' })

  const canvas = new OffscreenCanvas(cachedWidth, cachedHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Unable to create segmentation canvas')
  const source = new Uint8ClampedArray(cachedRgba)
  ctx.putImageData(new ImageData(source, cachedWidth, cachedHeight), 0, 0)

  const result = segmenter.segment(canvas)
  try {
    const mask = result.confidenceMasks?.[0]
    if (!mask) throw new Error('Person segmentation did not return a confidence mask')
    cachedPersonMask = new Float32Array(mask.getAsFloat32Array())
    return cachedPersonMask
  } finally {
    result.close()
  }
}

async function composePassportBackground(background: string) {
  passportBackground = background
  if (background === 'original') {
    passportRgba = undefined
    return
  }
  if (!cachedRgba) throw new Error('No image loaded')

  const color = parseHexColor(background)
  const mask = await ensurePersonMask()
  if (mask.length !== cachedWidth * cachedHeight) throw new Error('Unexpected segmentation mask size')

  const output = new Uint8ClampedArray(cachedRgba.length)
  for (let i = 0; i < mask.length; i++) {
    const alpha = Math.min(1, Math.max(0, mask[i]))
    const inv = 1 - alpha
    const p = i * 4
    output[p] = Math.round(cachedRgba[p] * alpha + color.r * inv)
    output[p + 1] = Math.round(cachedRgba[p + 1] * alpha + color.g * inv)
    output[p + 2] = Math.round(cachedRgba[p + 2] * alpha + color.b * inv)
    output[p + 3] = 255
  }
  passportRgba = output
}

async function encodeOutput(pngBytes: Uint8Array, width: number, height: number) {
  if (outputFormat === 'png') {
    return { bytes: pngBytes.slice().buffer, mime: 'image/png', extension: 'png' }
  }

  const sourceBuffer = pngBytes.slice().buffer
  const bitmap = await createImageBitmap(new Blob([sourceBuffer], { type: 'image/png' }))
  try {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unable to create worker canvas')
    ctx.drawImage(bitmap, 0, 0)
    const blob = await canvas.convertToBlob({ type: mimeFor(outputFormat), quality: outputQuality })
    const bytes = await blob.arrayBuffer()
    const mime = blob.type || mimeFor(outputFormat)
    return { bytes, mime, extension: extensionFromMime(mime) }
  } finally {
    bitmap.close()
  }
}

function currentManualFocus() {
  return currentMode.kind === 'focus' ? { x: currentMode.x, y: currentMode.y } : undefined
}

async function generatePresets(presets: ImagePreset[], manualFocus = currentManualFocus(), replace = false) {
  if (!cachedRgba) throw new Error('No image loaded')
  if (!presets.length) return

  const manualX = manualFocus ? manualFocus.x : -1
  const manualY = manualFocus ? manualFocus.y : -1

  self.postMessage({
    type: 'status',
    message: manualFocus
      ? 'Applying manual focus…'
      : cachedFocus.length
        ? `Found ${cachedFocus.length} face${cachedFocus.length > 1 ? 's' : ''}. Cropping…`
        : 'Using smart crop…',
  })

  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i]
    const sourcePixels = preset.group === 'passport' && passportRgba ? passportRgba : cachedRgba
    const wasmPixels = new Uint8Array(sourcePixels.buffer as ArrayBuffer, sourcePixels.byteOffset, sourcePixels.byteLength)
    const png = smart_crop_png(
      wasmPixels,
      cachedWidth,
      cachedHeight,
      preset.width,
      preset.height,
      JSON.stringify(cachedFocus),
      preset.safeTop ?? 0,
      preset.safeBottom ?? 0,
      preset.facePadding ?? 0.1,
      manualX,
      manualY,
    )
    const encoded = await encodeOutput(png, preset.width, preset.height)
    self.postMessage({
      type: 'result',
      preset,
      bytes: encoded.bytes,
      mime: encoded.mime,
      extension: encoded.extension,
      index: i,
      total: presets.length,
      replace,
    }, [encoded.bytes])
  }
}

async function regenerateActive(mode: Mode) {
  pendingMode = mode
  currentMode = mode
  if (generating) return

  generating = true
  try {
    while (pendingMode) {
      const next = pendingMode
      pendingMode = undefined
      if (next.kind === 'auto') postAutoFocusPoint()
      const manual = next.kind === 'focus' ? { x: next.x, y: next.y } : undefined
      await generatePresets([...activePresets.values()], manual, true)
      self.postMessage({ type: 'done', manual: next.kind === 'focus', format: outputFormat, quality: outputQuality })
    }
  } finally {
    generating = false
  }
}

self.onmessage = async (event: MessageEvent<
  | { type: 'load'; rgba: ArrayBuffer; width: number; height: number; format?: OutputFormat; quality?: number }
  | { type: 'focus'; x: number; y: number }
  | { type: 'auto' }
  | { type: 'settings'; format: OutputFormat; quality: number }
  | { type: 'passport' }
  | { type: 'background'; value: string }
  | { type: 'custom'; preset: ImagePreset }
  | { type: 'remove-custom'; id: string }
>) => {
  try {
    await ensureWasm()

    if (event.data.type === 'settings') {
      outputFormat = event.data.format
      outputQuality = Math.min(1, Math.max(0.1, event.data.quality))
      await regenerateActive(currentMode)
      return
    }

    if (event.data.type === 'focus') {
      await regenerateActive({ kind: 'focus', x: event.data.x, y: event.data.y })
      return
    }

    if (event.data.type === 'auto') {
      await regenerateActive({ kind: 'auto' })
      return
    }

    if (event.data.type === 'passport') {
      const fresh = PASSPORT_PRESETS.filter((preset) => !activePresets.has(preset.id))
      for (const preset of PASSPORT_PRESETS) activePresets.set(preset.id, preset)
      if (fresh.length) await generatePresets(fresh, currentManualFocus())
      self.postMessage({ type: 'done', manual: currentMode.kind === 'focus', format: outputFormat, quality: outputQuality })
      return
    }

    if (event.data.type === 'background') {
      for (const preset of PASSPORT_PRESETS) activePresets.set(preset.id, preset)
      await composePassportBackground(event.data.value)
      self.postMessage({ type: 'background-ready', value: passportBackground })
      await generatePresets(PASSPORT_PRESETS, currentManualFocus(), true)
      self.postMessage({ type: 'done', manual: currentMode.kind === 'focus', format: outputFormat, quality: outputQuality })
      return
    }

    if (event.data.type === 'custom') {
      activePresets.set(event.data.preset.id, event.data.preset)
      await generatePresets([event.data.preset], currentManualFocus())
      self.postMessage({ type: 'done', manual: currentMode.kind === 'focus', format: outputFormat, quality: outputQuality })
      return
    }

    if (event.data.type === 'remove-custom') {
      activePresets.delete(event.data.id)
      return
    }

    outputFormat = event.data.format ?? outputFormat
    outputQuality = Math.min(1, Math.max(0.1, event.data.quality ?? outputQuality))
    cachedWidth = event.data.width
    cachedHeight = event.data.height
    cachedRgba = new Uint8ClampedArray(event.data.rgba)
    cachedFocus = []
    cachedPersonMask = undefined
    passportRgba = undefined
    passportBackground = 'original'
    pendingMode = undefined
    currentMode = { kind: 'auto' }
    activePresets.clear()
    for (const preset of SOCIAL_PRESETS) activePresets.set(preset.id, preset)
    self.postMessage({ type: 'status', message: 'Finding the subject…' })
    try { cachedFocus = await detectFaces(cachedRgba, cachedWidth, cachedHeight) }
    catch (error) { console.warn('Face detector unavailable; using smart-crop fallback.', error) }
    postAutoFocusPoint()
    await generatePresets(SOCIAL_PRESETS)
    self.postMessage({ type: 'done', manual: false, format: outputFormat, quality: outputQuality })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

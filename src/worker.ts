/// <reference lib="webworker" />

import initWasm, { smart_crop_png } from './wasm/pkg/crop_image_wasm.js'
import { detectFaces, type FocusRegion } from './ai'
import { aiEnhanceFaces } from './ai-face-enhance'
import { aiRestoreImage } from './ai-restore'
import { aiUpscale2x } from './ai-upscale'
import { hasGlobalAdjustments, runGlobalAdjustmentsWebGpu } from './gpu-adjustments'
import { adaptiveLowLightAccelerated } from './low-light'
import { PASSPORT_PRESETS, SOCIAL_PRESETS, type ImagePreset } from './presets'
import { autoEnhancement, DEFAULT_ENHANCEMENT, enhanceRgba, type EnhancementSettings } from './enhance'

type MediaPipeModule = typeof import('@mediapipe/tasks-vision')
type Segmenter = Awaited<ReturnType<MediaPipeModule['ImageSegmenter']['createFromOptions']>>
type OutputFormat = 'png' | 'jpeg' | 'webp'
type Mode = { kind: 'focus'; x: number; y: number } | { kind: 'auto' }
type ErrorScope = 'load' | 'crop' | 'enhancement' | 'background' | 'settings' | 'focus'

type UpscaleInfo = {
  scale: number
  width: number
  height: number
  method: 'ai' | 'resample'
  fallback?: string
}

type RestorationInfo = {
  method: 'ai' | 'local'
  fallback?: string
}

type FaceEnhanceInfo = {
  method: 'ai' | 'local'
  faces: number
  fallback?: string
}

type EnhancedImage = {
  rgba: Uint8ClampedArray
  width: number
  height: number
  upscale?: UpscaleInfo
  restoration?: RestorationInfo
  faceEnhance?: FaceEnhanceInfo
}

const MAX_UPSCALE_PIXELS = 24_000_000
const MAX_UPSCALE_EDGE = 8192

let wasmReady: Promise<unknown> | undefined
let segmenterReady: Promise<Segmenter> | undefined
let segmenterCanvas: OffscreenCanvas | undefined
let sourceRgba: Uint8ClampedArray | undefined
let sourceWidth = 0
let sourceHeight = 0
let cachedRgba: Uint8ClampedArray | undefined
let cachedWidth = 0
let cachedHeight = 0
let cachedFocus: FocusRegion[] = []
let cachedPersonMask: Float32Array | undefined
let passportRgba: Uint8ClampedArray | undefined
let passportBackground = 'original'
let enhancementSettings: EnhancementSettings = { ...DEFAULT_ENHANCEMENT }
let currentMode: Mode = { kind: 'auto' }
let outputFormat: OutputFormat = 'jpeg'
let outputQuality = 0.9
let generationRevision = 0
let enhancementRevision = 0
let backgroundRevision = 0

function ensureWasm() { wasmReady ??= initWasm(); return wasmReady }

function progressPercent(done: number, total: number) {
  return total > 0 ? Math.max(0, Math.min(100, Math.round(done / total * 100))) : 0
}

function ensureSegmenter() {
  segmenterReady ??= (async () => {
    self.postMessage({ type: 'status', message: 'Loading local background remover…' })
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
    const wasmPath = new URL(`${import.meta.env.BASE_URL}mediapipe-wasm`, self.location.origin).href.replace(/\/$/, '')
    const resolveVision = FilesetResolver.forVisionTasks as unknown as (path: string, useModuleLoader?: boolean) => Promise<{ wasmLoaderPath: string; [key: string]: unknown }>
    const fileset = await resolveVision(wasmPath, true)
    const modelUrl = new URL(`${import.meta.env.BASE_URL}models/selfie_segmenter.tflite`, self.location.origin).href
    const modelResponse = await fetch(modelUrl)
    if (!modelResponse.ok) throw new Error(`Unable to load background model (${modelResponse.status})`)
    const modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer())
    segmenterCanvas = new OffscreenCanvas(1, 1)
    return ImageSegmenter.createFromOptions(fileset as never, {
      baseOptions: { modelAssetBuffer, delegate: 'CPU' },
      canvas: segmenterCanvas,
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })
  })().catch((error) => { segmenterReady = undefined; throw error })
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
  let totalWeight = 0, x = 0, y = 0
  for (const region of cachedFocus) {
    const weight = Math.max(0.01, region.confidence)
    x += (region.x + region.width / 2) * weight
    y += (region.y + region.height / 2) * weight
    totalWeight += weight
  }
  return { x: Math.min(1, Math.max(0, x / totalWeight)), y: Math.min(1, Math.max(0, y / totalWeight)) }
}

function postAutoFocusPoint() {
  const point = autoFocusPoint()
  self.postMessage({ type: 'auto-focus-point', x: point.x, y: point.y })
}

function parseHexColor(value: string) {
  const hex = value.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Invalid background color')
  return { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16) }
}

function upscaleDimensions(width: number, height: number) {
  const pixels = width * height
  const byPixels = pixels > 0 ? Math.sqrt(MAX_UPSCALE_PIXELS / pixels) : 1
  const byEdge = MAX_UPSCALE_EDGE / Math.max(1, width, height)
  const scale = Math.max(1, Math.min(2, byPixels, byEdge))
  return {
    scale,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function resampleRgba(source: Uint8ClampedArray, width: number, height: number, targetWidth: number, targetHeight: number) {
  if (targetWidth === width && targetHeight === height) return new Uint8ClampedArray(source)
  const sourceCanvas = new OffscreenCanvas(width, height)
  const sourceCtx = sourceCanvas.getContext('2d')
  if (!sourceCtx) throw new Error('Unable to create upscale source canvas')
  sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(source), width, height), 0, 0)

  const targetCanvas = new OffscreenCanvas(targetWidth, targetHeight)
  const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true })
  if (!targetCtx) throw new Error('Unable to create upscale output canvas')
  targetCtx.imageSmoothingEnabled = true
  targetCtx.imageSmoothingQuality = 'high'
  targetCtx.drawImage(sourceCanvas, 0, 0, width, height, 0, 0, targetWidth, targetHeight)
  return targetCtx.getImageData(0, 0, targetWidth, targetHeight).data
}

async function upscaleRgba(source: Uint8ClampedArray, width: number, height: number) {
  const target = upscaleDimensions(width, height)
  if (target.scale <= 1.001) {
    return { rgba: new Uint8ClampedArray(source), width, height, scale: 1, method: 'resample' as const }
  }

  if (target.scale >= 1.999) {
    try {
      self.postMessage({ type: 'status', message: 'Loading AI super-resolution model…' })
      const ai = await aiUpscale2x(source, width, height, (done, total) => {
        self.postMessage({ type: 'status', message: `AI upscaling… ${progressPercent(done, total)}%` })
      })
      return { rgba: ai.rgba, width: ai.width, height: ai.height, scale: 2, method: 'ai' as const }
    } catch (error) {
      console.warn('AI super resolution unavailable; using high-quality resampling.', error)
      self.postMessage({ type: 'status', message: 'AI model unavailable. Using high-quality 2× fallback…' })
      const rgba = await resampleRgba(source, width, height, target.width, target.height)
      return {
        rgba,
        width: target.width,
        height: target.height,
        scale: target.scale,
        method: 'resample' as const,
        fallback: error instanceof Error ? error.message : String(error),
      }
    }
  }

  self.postMessage({ type: 'status', message: 'Image is large. Using memory-safe upscale…' })
  const rgba = await resampleRgba(source, width, height, target.width, target.height)
  return { rgba, width: target.width, height: target.height, scale: target.scale, method: 'resample' as const }
}

async function ensurePersonMask() {
  if (cachedPersonMask) return cachedPersonMask
  if (!cachedRgba) throw new Error('No image loaded')
  const segmenter = await ensureSegmenter()
  self.postMessage({ type: 'status', message: 'Separating the person from the background…' })
  const canvas = new OffscreenCanvas(cachedWidth, cachedHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Unable to create segmentation canvas')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(cachedRgba), cachedWidth, cachedHeight), 0, 0)
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

async function composePassportBackground(background: string, revision = ++backgroundRevision) {
  passportBackground = background
  if (background === 'original') {
    passportRgba = undefined
    return revision === backgroundRevision
  }
  if (!cachedRgba) throw new Error('No image loaded')
  const color = parseHexColor(background)
  const mask = await ensurePersonMask()
  if (revision !== backgroundRevision || background !== passportBackground) return false
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
  if (revision !== backgroundRevision || background !== passportBackground) return false
  passportRgba = output
  return true
}

async function encodeOutput(pngBytes: Uint8Array, width: number, height: number) {
  if (outputFormat === 'png') return { bytes: pngBytes.slice().buffer, mime: 'image/png', extension: 'png' }
  const bitmap = await createImageBitmap(new Blob([pngBytes.slice().buffer], { type: 'image/png' }))
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

async function generatePresets(presets: ImagePreset[], revision: number, manualFocus = currentManualFocus(), replace = false) {
  if (!cachedRgba) throw new Error('No image loaded')
  if (!presets.length) return false
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
    if (revision !== generationRevision) return false
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
    if (revision !== generationRevision) return false
    const encoded = await encodeOutput(png, preset.width, preset.height)
    if (revision !== generationRevision) return false
    self.postMessage({ type: 'result', preset, bytes: encoded.bytes, mime: encoded.mime, extension: encoded.extension, index: i, total: presets.length, replace }, [encoded.bytes])
  }
  return revision === generationRevision
}

async function buildEnhancedImage(settings: EnhancementSettings): Promise<EnhancedImage> {
  if (!sourceRgba) throw new Error('Enhancement requires a loaded image')

  let enhancementSource = sourceRgba
  let effectiveSettings = settings
  if (settings.lowLight) {
    self.postMessage({ type: 'status', message: 'Optimizing low light…' })
    const lowLight = await adaptiveLowLightAccelerated(sourceRgba)
    enhancementSource = lowLight.rgba
    effectiveSettings = { ...settings, lowLight: false }
  }

  if (hasGlobalAdjustments(effectiveSettings)) {
    try {
      self.postMessage({ type: 'status', message: 'Applying GPU adjustments…' })
      enhancementSource = await runGlobalAdjustmentsWebGpu(enhancementSource, effectiveSettings)
      effectiveSettings = {
        ...effectiveSettings,
        brightness: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        saturation: 0,
        temperature: 0,
      }
    } catch (error) {
      console.warn('WebGPU global adjustments unavailable; using CPU fallback.', error)
    }
  }

  const useAiRestore = effectiveSettings.denoise >= 20 || effectiveSettings.deblur || effectiveSettings.restorePhoto
  const localSettings = useAiRestore ? { ...effectiveSettings, denoise: 0, deblur: false } : effectiveSettings
  let pixels = enhanceRgba(enhancementSource, sourceWidth, sourceHeight, localSettings, cachedFocus)
  let width = sourceWidth
  let height = sourceHeight
  let restoration: RestorationInfo | undefined
  let faceEnhance: FaceEnhanceInfo | undefined
  let upscale: UpscaleInfo | undefined

  if (useAiRestore) {
    try {
      const strength = Math.min(0.9, 0.42 + Math.min(0.25, effectiveSettings.denoise / 250) + (effectiveSettings.deblur ? 0.14 : 0) + (effectiveSettings.restorePhoto ? 0.08 : 0))
      self.postMessage({ type: 'status', message: 'Loading AI restoration model…' })
      const restored = await aiRestoreImage(pixels, width, height, strength, (done, total) => {
        self.postMessage({ type: 'status', message: `AI restoring… ${progressPercent(done, total)}%` })
      })
      pixels = restored.rgba
      restoration = { method: 'ai' }
    } catch (error) {
      console.warn('AI restoration unavailable; using local denoise/deblur fallback.', error)
      self.postMessage({ type: 'status', message: 'AI restoration unavailable. Using local fallback…' })
      pixels = enhanceRgba(enhancementSource, sourceWidth, sourceHeight, effectiveSettings, cachedFocus)
      restoration = { method: 'local', fallback: error instanceof Error ? error.message : String(error) }
    }
  }

  if (settings.faceEnhance) {
    if (!cachedFocus.length) {
      faceEnhance = { method: 'local', faces: 0, fallback: 'No face detected' }
    } else {
      try {
        self.postMessage({ type: 'status', message: `Enhancing ${cachedFocus.length} detected face${cachedFocus.length > 1 ? 's' : ''}…` })
        const enhanced = await aiEnhanceFaces(pixels, width, height, cachedFocus, (done, total) => {
          self.postMessage({ type: 'status', message: `AI face enhancement… ${progressPercent(done, total)}%` })
        })
        pixels = enhanced.rgba
        faceEnhance = { method: 'ai', faces: enhanced.faces }
      } catch (error) {
        console.warn('AI face enhancement unavailable; keeping local face enhancement.', error)
        faceEnhance = { method: 'local', faces: cachedFocus.length, fallback: error instanceof Error ? error.message : String(error) }
      }
    }
  }

  if (settings.upscale2x) {
    const scaled = await upscaleRgba(pixels, width, height)
    pixels = scaled.rgba
    width = scaled.width
    height = scaled.height
    upscale = {
      scale: scaled.scale,
      width,
      height,
      method: scaled.method,
      ...(scaled.fallback ? { fallback: scaled.fallback } : {}),
    }
  }

  return { rgba: pixels, width, height, upscale, restoration, faceEnhance }
}

async function applyEnhancement(settings: EnhancementSettings, auto = false) {
  if (!sourceRgba) throw new Error('Enhancement requires a loaded image')
  const revision = ++enhancementRevision
  generationRevision += 1
  const requested = { ...DEFAULT_ENHANCEMENT, ...settings }
  self.postMessage({ type: 'status', message: auto ? 'Applying Auto Enhance…' : 'Applying global enhancement…' })
  const built = await buildEnhancedImage(requested)
  if (revision !== enhancementRevision) return false

  enhancementSettings = requested
  cachedRgba = built.rgba
  cachedWidth = built.width
  cachedHeight = built.height
  cachedPersonMask = undefined
  passportRgba = undefined
  backgroundRevision += 1

  const selectedBackground = passportBackground
  if (selectedBackground !== 'original') {
    const backgroundReady = await composePassportBackground(selectedBackground)
    if (!backgroundReady || revision !== enhancementRevision) return false
  }
  if (revision !== enhancementRevision) return false
  self.postMessage({
    type: 'enhancement-settings',
    settings: enhancementSettings,
    auto,
    upscale: built.upscale,
    restoration: built.restoration,
    faceEnhance: built.faceEnhance,
  })
  return true
}

type WorkerMessage =
  | { type: 'load'; rgba: ArrayBuffer; width: number; height: number; format?: OutputFormat; quality?: number }
  | { type: 'focus'; x: number; y: number }
  | { type: 'auto' }
  | { type: 'settings'; format: OutputFormat; quality: number }
  | { type: 'social' }
  | { type: 'passport' }
  | { type: 'background'; value: string }
  | { type: 'custom'; preset: ImagePreset }
  | { type: 'remove-custom'; id: string }
  | { type: 'enhancement'; settings: EnhancementSettings }
  | { type: 'enhancement-auto' }

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  let scope: ErrorScope = 'load'
  try {
    await ensureWasm()
    const message = event.data

    if (message.type === 'enhancement') {
      scope = 'enhancement'
      await applyEnhancement(message.settings)
      return
    }
    if (message.type === 'enhancement-auto') {
      scope = 'enhancement'
      if (!sourceRgba) throw new Error('Enhancement requires a loaded image')
      await applyEnhancement(autoEnhancement(sourceRgba), true)
      return
    }
    if (message.type === 'settings') {
      scope = 'settings'
      generationRevision += 1
      outputFormat = message.format
      outputQuality = Math.min(1, Math.max(0.1, message.quality))
      self.postMessage({ type: 'settings-ready', format: outputFormat, quality: outputQuality })
      return
    }
    if (message.type === 'focus') {
      scope = 'focus'
      generationRevision += 1
      currentMode = { kind: 'focus', x: message.x, y: message.y }
      self.postMessage({ type: 'focus-ready', manual: true, x: message.x, y: message.y })
      return
    }
    if (message.type === 'auto') {
      scope = 'focus'
      generationRevision += 1
      currentMode = { kind: 'auto' }
      postAutoFocusPoint()
      self.postMessage({ type: 'focus-ready', manual: false })
      return
    }
    if (message.type === 'social') {
      scope = 'crop'
      const revision = ++generationRevision
      const completed = await generatePresets(SOCIAL_PRESETS, revision, currentManualFocus(), true)
      if (completed) self.postMessage({ type: 'done', manual: currentMode.kind === 'focus', format: outputFormat, quality: outputQuality })
      return
    }
    if (message.type === 'passport') {
      scope = 'crop'
      const revision = ++generationRevision
      const completed = await generatePresets(PASSPORT_PRESETS, revision, currentManualFocus(), true)
      if (completed) self.postMessage({ type: 'done', manual: currentMode.kind === 'focus', format: outputFormat, quality: outputQuality })
      return
    }
    if (message.type === 'background') {
      scope = 'background'
      generationRevision += 1
      backgroundRevision += 1
      const revision = backgroundRevision
      const completed = await composePassportBackground(message.value, revision)
      if (completed) self.postMessage({ type: 'background-ready', value: passportBackground })
      return
    }
    if (message.type === 'custom') {
      scope = 'crop'
      const revision = ++generationRevision
      const completed = await generatePresets([message.preset], revision, currentManualFocus())
      if (completed) self.postMessage({ type: 'done', manual: currentMode.kind === 'focus', format: outputFormat, quality: outputQuality })
      return
    }
    if (message.type === 'remove-custom') return

    generationRevision += 1
    enhancementRevision += 1
    backgroundRevision += 1
    outputFormat = message.format ?? outputFormat
    outputQuality = Math.min(1, Math.max(0.1, message.quality ?? outputQuality))
    sourceWidth = message.width
    sourceHeight = message.height
    cachedWidth = sourceWidth
    cachedHeight = sourceHeight
    sourceRgba = new Uint8ClampedArray(message.rgba)
    cachedRgba = new Uint8ClampedArray(sourceRgba)
    enhancementSettings = { ...DEFAULT_ENHANCEMENT }
    cachedFocus = []
    cachedPersonMask = undefined
    passportRgba = undefined
    passportBackground = 'original'
    currentMode = { kind: 'auto' }
    self.postMessage({ type: 'status', message: 'Finding the subject…' })
    try {
      cachedFocus = await detectFaces(cachedRgba, cachedWidth, cachedHeight)
    } catch (error) {
      console.warn('Face detector unavailable; using smart-crop fallback.', error)
    }
    postAutoFocusPoint()
    self.postMessage({ type: 'enhancement-settings', settings: enhancementSettings, auto: false })
    self.postMessage({ type: 'ready' })
  } catch (error) {
    self.postMessage({ type: 'error', scope, message: error instanceof Error ? error.message : String(error) })
  }
}

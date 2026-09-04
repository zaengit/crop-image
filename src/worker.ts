/// <reference lib="webworker" />

import initWasm, { smart_crop_png } from './wasm/pkg/crop_image_wasm.js'
import { detectFaces, type FocusRegion } from './ai'
import { SOCIAL_PRESETS } from './presets'

type OutputFormat = 'png' | 'jpeg' | 'webp'
type Mode = { kind: 'focus'; x: number; y: number } | { kind: 'auto' }

let wasmReady: Promise<unknown> | undefined
let cachedRgba: Uint8ClampedArray | undefined
let cachedWidth = 0
let cachedHeight = 0
let cachedFocus: FocusRegion[] = []
let generating = false
let pendingMode: Mode | undefined
let currentMode: Mode = { kind: 'auto' }
let outputFormat: OutputFormat = 'jpeg'
let outputQuality = 0.9

function ensureWasm() { wasmReady ??= initWasm(); return wasmReady }

function mimeFor(format: OutputFormat) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

function extensionFor(format: OutputFormat) {
  return format === 'jpeg' ? 'jpg' : format
}

async function encodeOutput(pngBytes: Uint8Array, width: number, height: number) {
  if (outputFormat === 'png') {
    return { bytes: pngBytes.slice().buffer, mime: 'image/png', extension: 'png' }
  }

  const bitmap = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }))
  try {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unable to create worker canvas')
    ctx.drawImage(bitmap, 0, 0)
    const blob = await canvas.convertToBlob({ type: mimeFor(outputFormat), quality: outputQuality })
    const bytes = await blob.arrayBuffer()
    return { bytes, mime: blob.type || mimeFor(outputFormat), extension: extensionFor(outputFormat) }
  } finally {
    bitmap.close()
  }
}

async function generate(manualFocus?: { x: number; y: number }, replace = false) {
  if (!cachedRgba) throw new Error('No image loaded')
  const manualX = manualFocus ? manualFocus.x : -1
  const manualY = manualFocus ? manualFocus.y : -1
  self.postMessage({
    type: 'status',
    message: manualFocus
      ? 'Applying manual focus…'
      : cachedFocus.length
        ? `Found ${cachedFocus.length} face${cachedFocus.length > 1 ? 's' : ''}. Cropping…`
        : 'Using saliency smart crop…',
  })

  for (let i = 0; i < SOCIAL_PRESETS.length; i++) {
    const preset = SOCIAL_PRESETS[i]
    const png = smart_crop_png(
      cachedRgba,
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
      total: SOCIAL_PRESETS.length,
      replace,
    }, [encoded.bytes])
  }
  self.postMessage({ type: 'done', manual: Boolean(manualFocus), format: outputFormat, quality: outputQuality })
}

async function runQueuedGeneration(mode: Mode) {
  pendingMode = mode
  currentMode = mode
  if (generating) return

  generating = true
  try {
    while (pendingMode) {
      const next = pendingMode
      pendingMode = undefined
      if (next.kind === 'focus') await generate({ x: next.x, y: next.y }, true)
      else await generate(undefined, true)
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
>) => {
  try {
    await ensureWasm()

    if (event.data.type === 'settings') {
      outputFormat = event.data.format
      outputQuality = Math.min(1, Math.max(0.1, event.data.quality))
      await runQueuedGeneration(currentMode)
      return
    }

    if (event.data.type === 'focus') {
      await runQueuedGeneration({ kind: 'focus', x: event.data.x, y: event.data.y })
      return
    }

    if (event.data.type === 'auto') {
      await runQueuedGeneration({ kind: 'auto' })
      return
    }

    outputFormat = event.data.format ?? outputFormat
    outputQuality = Math.min(1, Math.max(0.1, event.data.quality ?? outputQuality))
    cachedWidth = event.data.width
    cachedHeight = event.data.height
    cachedRgba = new Uint8ClampedArray(event.data.rgba)
    cachedFocus = []
    pendingMode = undefined
    currentMode = { kind: 'auto' }
    self.postMessage({ type: 'status', message: 'Finding the subject…' })
    try { cachedFocus = await detectFaces(cachedRgba, cachedWidth, cachedHeight) }
    catch (error) { console.warn('Face detector unavailable; using Rust saliency fallback.', error) }
    await generate()
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

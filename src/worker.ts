/// <reference lib="webworker" />

import initWasm, { smart_crop_png } from './wasm/pkg/crop_image_wasm.js'
import { detectFaces, type FocusRegion } from './ai'
import { SOCIAL_PRESETS } from './presets'

let wasmReady: Promise<unknown> | undefined
let cachedRgba: Uint8ClampedArray | undefined
let cachedWidth = 0
let cachedHeight = 0
let cachedFocus: FocusRegion[] = []

function ensureWasm() { wasmReady ??= initWasm(); return wasmReady }

async function generate(manualFocus?: { x: number; y: number }) {
  if (!cachedRgba) throw new Error('No image loaded')
  const manualX = manualFocus ? manualFocus.x : -1
  const manualY = manualFocus ? manualFocus.y : -1
  self.postMessage({ type: 'status', message: manualFocus ? 'Applying manual focus…' : cachedFocus.length ? `Found ${cachedFocus.length} face${cachedFocus.length > 1 ? 's' : ''}. Cropping…` : 'Using saliency smart crop…' })
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
    const bytes = png.slice().buffer
    self.postMessage({ type: 'result', preset, bytes, index: i, total: SOCIAL_PRESETS.length, replace: Boolean(manualFocus) }, [bytes])
  }
  self.postMessage({ type: 'done', manual: Boolean(manualFocus) })
}

self.onmessage = async (event: MessageEvent<
  | { type: 'load'; rgba: ArrayBuffer; width: number; height: number }
  | { type: 'focus'; x: number; y: number }
>) => {
  try {
    await ensureWasm()
    if (event.data.type === 'focus') {
      await generate({ x: event.data.x, y: event.data.y })
      return
    }

    cachedWidth = event.data.width
    cachedHeight = event.data.height
    cachedRgba = new Uint8ClampedArray(event.data.rgba)
    cachedFocus = []
    self.postMessage({ type: 'status', message: 'Finding the subject…' })
    try { cachedFocus = await detectFaces(cachedRgba, cachedWidth, cachedHeight) }
    catch (error) { console.warn('Face detector unavailable; using Rust saliency fallback.', error) }
    await generate()
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

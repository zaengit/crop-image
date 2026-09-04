/// <reference lib="webworker" />

import initWasm, { smart_crop_png } from './wasm/pkg/crop_image_wasm.js'
import { detectFaces } from './ai'
import { SOCIAL_PRESETS } from './presets'

let wasmReady: Promise<unknown> | undefined
function ensureWasm() { wasmReady ??= initWasm(); return wasmReady }

self.onmessage = async (event: MessageEvent<{ rgba: ArrayBuffer; width: number; height: number }>) => {
  try {
    await ensureWasm()
    const { rgba: buffer, width, height } = event.data
    const rgba = new Uint8ClampedArray(buffer)
    self.postMessage({ type: 'status', message: 'Finding the subject…' })
    let focus = []
    try { focus = await detectFaces(rgba, width, height) }
    catch (error) { console.warn('Face detector unavailable; using Rust saliency fallback.', error) }
    self.postMessage({ type: 'status', message: focus.length ? `Found ${focus.length} face${focus.length > 1 ? 's' : ''}. Cropping…` : 'Using saliency smart crop…' })
    for (let i = 0; i < SOCIAL_PRESETS.length; i++) {
      const preset = SOCIAL_PRESETS[i]
      const png = smart_crop_png(rgba, width, height, preset.width, preset.height, JSON.stringify(focus))
      const bytes = png.slice().buffer
      self.postMessage({ type: 'result', preset, bytes, index: i, total: SOCIAL_PRESETS.length }, [bytes])
    }
    self.postMessage({ type: 'done' })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

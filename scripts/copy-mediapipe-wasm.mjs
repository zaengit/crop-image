import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

// Background removal now uses MODNet through ONNX Runtime Web. Keep this
// script name for compatibility with existing npm scripts, but only stage ORT
// runtime assets so production no longer ships MediaPipe's ModuleFactory loader.
const mediaPipeTarget = resolve('public/mediapipe-wasm')
rmSync(mediaPipeTarget, { recursive: true, force: true })

const ortSource = resolve('node_modules/onnxruntime-web/dist')
const ortTarget = resolve('public/ort-wasm')

if (!existsSync(ortSource)) {
  throw new Error(`ONNX Runtime Web assets not found at ${ortSource}. Run npm install first.`)
}

rmSync(ortTarget, { recursive: true, force: true })
mkdirSync(ortTarget, { recursive: true })

const ortAssets = readdirSync(ortSource).filter((name) => /^ort-wasm.*\.(?:mjs|wasm)$/.test(name))
if (!ortAssets.some((name) => name.endsWith('.mjs')) || !ortAssets.some((name) => name.endsWith('.wasm'))) {
  throw new Error(`Expected ONNX Runtime WASM module assets were not found in ${ortSource}`)
}

for (const asset of ortAssets) {
  cpSync(resolve(ortSource, asset), resolve(ortTarget, asset))
}
console.log(`Copied ${ortAssets.length} ONNX Runtime WASM assets to public/ort-wasm`)

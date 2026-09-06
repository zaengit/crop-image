import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const mediaPipeSource = resolve('node_modules/@mediapipe/tasks-vision/wasm')
const mediaPipeTarget = resolve('public/mediapipe-wasm')

if (!existsSync(mediaPipeSource)) {
  throw new Error(`MediaPipe WASM runtime not found at ${mediaPipeSource}. Run npm install first.`)
}

rmSync(mediaPipeTarget, { recursive: true, force: true })
mkdirSync(mediaPipeTarget, { recursive: true })
cpSync(mediaPipeSource, mediaPipeTarget, { recursive: true })
console.log('Copied MediaPipe WASM runtime to public/mediapipe-wasm')

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

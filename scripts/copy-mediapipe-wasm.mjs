import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const source = resolve('node_modules/@mediapipe/tasks-vision/wasm')
const target = resolve('public/mediapipe-wasm')

if (!existsSync(source)) {
  throw new Error(`MediaPipe WASM runtime not found at ${source}. Run npm install first.`)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })
console.log('Copied MediaPipe WASM runtime to public/mediapipe-wasm')

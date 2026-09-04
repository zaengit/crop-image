import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const target = resolve('public/models/version-RFB-320.onnx')
const url = 'https://github.com/onnx/models/raw/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx'
if (existsSync(target)) { console.log('UltraFace model already exists:', target); process.exit(0) }
mkdirSync(dirname(target), { recursive: true })
console.log('Downloading UltraFace model…')
const response = await fetch(url, { redirect: 'follow' })
if (!response.ok || !response.body) throw new Error(`Model download failed: ${response.status} ${response.statusText}`)
await finished(Readable.fromWeb(response.body).pipe(createWriteStream(target)))
console.log('Saved:', target)

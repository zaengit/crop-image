import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const models = [
  {
    name: 'UltraFace',
    target: resolve('public/models/version-RFB-320.onnx'),
    url: 'https://github.com/onnx/models/raw/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx',
  },
  {
    name: 'Selfie Segmenter',
    target: resolve('public/models/selfie_segmenter.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  },
  {
    name: 'Real-ESRGAN 2x',
    target: resolve('public/models/realesrgan_x2plus.onnx'),
    url: 'https://github.com/net2cn/Real-ESRGAN_GUI/raw/refs/heads/master/Real-ESRGAN_GUI/models/realesrgan_x2plus.onnx',
  },
]

async function downloadModel({ name, target, url }) {
  if (existsSync(target)) {
    console.log(`${name} model already exists:`, target)
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  console.log(`Downloading ${name} model…`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`${name} download failed: ${response.status} ${response.statusText}`)
  await finished(Readable.fromWeb(response.body).pipe(createWriteStream(target)))
  console.log('Saved:', target)
}

for (const model of models) await downloadModel(model)

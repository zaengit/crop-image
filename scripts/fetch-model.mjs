import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const models = [
  {
    name: 'UltraFace',
    target: resolve('public/models/version-RFB-320.onnx'),
    url: 'https://github.com/onnx/models/raw/4c46cd00fbdb7cd30b6c1c17ab54f2e1f4f7b177/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx',
    sha256: '34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017',
  },
  {
    name: 'BlazeFace short range',
    target: resolve('public/models/blaze_face_short_range.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
    sha256: 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f',
  },
  {
    name: 'EfficientDet-Lite0',
    target: resolve('public/models/efficientdet_lite0.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite',
    sha256: '40338edf5ec70d43e318b0a716a84d4564cd1802759a7a07170c7e43796dbf58',
  },
  {
    name: 'Selfie Segmenter',
    target: resolve('public/models/selfie_segmenter.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
    sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b',
  },
  {
    name: 'Real-ESRGAN 2x',
    target: resolve('public/models/realesrgan_x2plus.onnx'),
    url: 'https://github.com/net2cn/Real-ESRGAN_GUI/raw/0c4fd78d29cb4d6afde9f852195a71e58b50f53c/Real-ESRGAN_GUI/models/realesrgan_x2plus.onnx',
    sha256: '012b544d2ecf1433480165b3981223b3168926343c93a6cd688b11379f16551c',
  },
]

async function sha256File(path) {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  stream.on('data', (chunk) => hash.update(chunk))
  await finished(stream)
  return hash.digest('hex')
}

async function verifyModel({ name, target, sha256 }) {
  const actual = await sha256File(target)
  if (actual !== sha256) {
    throw new Error(`${name} checksum mismatch: expected ${sha256}, got ${actual}`)
  }
  console.log(`${name} verified (${actual.slice(0, 12)}…)`)
}

async function downloadModel(model) {
  const { name, target, url } = model
  if (existsSync(target)) {
    try {
      await verifyModel(model)
      return
    } catch (error) {
      console.warn(`${name} existing file failed verification; downloading a fresh copy.`)
      rmSync(target, { force: true })
    }
  }

  mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.download`
  rmSync(temporary, { force: true })
  console.log(`Downloading ${name} model…`)

  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`${name} download failed: ${response.status} ${response.statusText}`)

  try {
    await finished(Readable.fromWeb(response.body).pipe(createWriteStream(temporary)))
    await verifyModel({ ...model, target: temporary })
    const { renameSync } = await import('node:fs')
    renameSync(temporary, target)
    console.log('Saved:', target)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

for (const model of models) await downloadModel(model)

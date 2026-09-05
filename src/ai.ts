export type FocusRegion = {
  x: number
  y: number
  width: number
  height: number
  confidence: number
  kind: 'face'
}

const MODEL_WIDTH = 320
const MODEL_HEIGHT = 240
const SCORE_THRESHOLD = 0.72
const IOU_THRESHOLD = 0.3

type OrtModule = typeof import('onnxruntime-web/wasm')
let ortPromise: Promise<OrtModule> | undefined
let sessionPromise: Promise<Awaited<ReturnType<OrtModule['InferenceSession']['create']>>> | undefined

function getOrt() {
  ortPromise ??= import('onnxruntime-web/wasm')
  return ortPromise
}

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await getOrt()
      ort.env.wasm.numThreads = 1
      const modelUrl = `${import.meta.env.BASE_URL}models/version-RFB-320.onnx`
      return ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      })
    })().catch((error) => {
      sessionPromise = undefined
      throw error
    })
  }
  return sessionPromise
}

function iou(a: FocusRegion, b: FocusRegion) {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.width * a.height + b.width * b.height - intersection
  return union > 0 ? intersection / union : 0
}

function nms(regions: FocusRegion[]) {
  const sorted = [...regions].sort((a, b) => b.confidence - a.confidence)
  const kept: FocusRegion[] = []
  for (const candidate of sorted) {
    if (kept.every((existing) => iou(candidate, existing) < IOU_THRESHOLD)) kept.push(candidate)
  }
  return kept.slice(0, 8)
}

export async function detectFaces(rgba: Uint8ClampedArray, width: number, height: number): Promise<FocusRegion[]> {
  const canvas = new OffscreenCanvas(MODEL_WIDTH, MODEL_HEIGHT)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  const source = new OffscreenCanvas(width, height)
  const sourceCtx = source.getContext('2d')
  if (!sourceCtx) return []

  const sourcePixels = new Uint8ClampedArray(rgba.length)
  sourcePixels.set(rgba)
  sourceCtx.putImageData(new ImageData(sourcePixels, width, height), 0, 0)
  ctx.drawImage(source, 0, 0, MODEL_WIDTH, MODEL_HEIGHT)

  const pixels = ctx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT).data
  const input = new Float32Array(3 * MODEL_WIDTH * MODEL_HEIGHT)
  const plane = MODEL_WIDTH * MODEL_HEIGHT
  for (let i = 0; i < plane; i++) {
    const p = i * 4
    input[i] = (pixels[p] - 127) / 128
    input[plane + i] = (pixels[p + 1] - 127) / 128
    input[plane * 2 + i] = (pixels[p + 2] - 127) / 128
  }

  const [ort, session] = await Promise.all([getOrt(), getSession()])
  const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, MODEL_HEIGHT, MODEL_WIDTH]) })
  const tensors = Object.values(outputs)
  const scoresTensor = tensors.find((t) => t.dims.at(-1) === 2 && t.dims.length >= 2)
  const boxesTensor = tensors.find((t) => t.dims.at(-1) === 4 && t.dims.length >= 2)
  if (!scoresTensor || !boxesTensor) return []
  const scores = scoresTensor.data as Float32Array
  const boxes = boxesTensor.data as Float32Array
  const count = Math.min(scores.length / 2, boxes.length / 4)
  const regions: FocusRegion[] = []
  for (let i = 0; i < count; i++) {
    const confidence = scores[i * 2 + 1]
    if (confidence < SCORE_THRESHOLD) continue
    const x1 = Math.max(0, Math.min(1, boxes[i * 4]))
    const y1 = Math.max(0, Math.min(1, boxes[i * 4 + 1]))
    const x2 = Math.max(0, Math.min(1, boxes[i * 4 + 2]))
    const y2 = Math.max(0, Math.min(1, boxes[i * 4 + 3]))
    if (x2 <= x1 || y2 <= y1) continue
    regions.push({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, confidence, kind: 'face' })
  }
  return nms(regions)
}

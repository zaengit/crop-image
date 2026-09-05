export type FocusRegion = {
  x: number
  y: number
  width: number
  height: number
  confidence: number
  kind: 'face' | 'subject'
  label?: string
}

const MODEL_WIDTH = 320
const MODEL_HEIGHT = 240
const SCORE_THRESHOLD = 0.6
const FALLBACK_SCORE_THRESHOLD = 0.48
const OBJECT_SCORE_THRESHOLD = 0.3
const IOU_THRESHOLD = 0.3

type OrtModule = typeof import('onnxruntime-web/wasm')
type VisionModule = typeof import('@mediapipe/tasks-vision')
type ObjectDetectorInstance = Awaited<ReturnType<VisionModule['ObjectDetector']['createFromOptions']>>

let ortPromise: Promise<OrtModule> | undefined
let sessionPromise: Promise<Awaited<ReturnType<OrtModule['InferenceSession']['create']>>> | undefined
let objectDetectorPromise: Promise<ObjectDetectorInstance> | undefined

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

async function getObjectDetector() {
  objectDetectorPromise ??= (async () => {
    const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision')
    const wasmPath = new URL(`${import.meta.env.BASE_URL}mediapipe-wasm`, globalThis.location.origin).href.replace(/\/$/, '')
    const resolveVision = FilesetResolver.forVisionTasks as unknown as (path: string, useModuleLoader?: boolean) => Promise<{ wasmLoaderPath: string; [key: string]: unknown }>
    const fileset = await resolveVision(wasmPath, true)
    const modelUrl = new URL(`${import.meta.env.BASE_URL}models/efficientdet_lite0.tflite`, globalThis.location.origin).href
    const response = await fetch(modelUrl)
    if (!response.ok) throw new Error(`Unable to load object detection model (${response.status})`)
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer())
    return ObjectDetector.createFromOptions(fileset as never, {
      baseOptions: { modelAssetBuffer, delegate: 'CPU' },
      runningMode: 'IMAGE',
      scoreThreshold: OBJECT_SCORE_THRESHOLD,
      maxResults: 8,
    } as never)
  })().catch((error) => {
    objectDetectorPromise = undefined
    throw error
  })
  return objectDetectorPromise
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

function validFaceBox(x1: number, y1: number, x2: number, y2: number) {
  const width = x2 - x1
  const height = y2 - y1
  const area = width * height
  const aspect = width / Math.max(0.0001, height)
  return width > 0 && height > 0 && area >= 0.001 && area <= 0.75 && aspect >= 0.45 && aspect <= 2.2
}

function sourceCanvas(rgba: Uint8ClampedArray, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  return canvas
}

async function detectFaceRegions(rgba: Uint8ClampedArray, width: number, height: number): Promise<FocusRegion[]> {
  const canvas = new OffscreenCanvas(MODEL_WIDTH, MODEL_HEIGHT)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  const source = sourceCanvas(rgba, width, height)
  if (!source) return []
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
  let fallback: FocusRegion | undefined

  for (let i = 0; i < count; i++) {
    const confidence = scores[i * 2 + 1]
    if (confidence < FALLBACK_SCORE_THRESHOLD) continue

    const x1 = Math.max(0, Math.min(1, boxes[i * 4]))
    const y1 = Math.max(0, Math.min(1, boxes[i * 4 + 1]))
    const x2 = Math.max(0, Math.min(1, boxes[i * 4 + 2]))
    const y2 = Math.max(0, Math.min(1, boxes[i * 4 + 3]))
    if (!validFaceBox(x1, y1, x2, y2)) continue

    const region: FocusRegion = {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1,
      confidence,
      kind: 'face',
    }

    if (!fallback || confidence > fallback.confidence) fallback = region
    if (confidence >= SCORE_THRESHOLD) regions.push(region)
  }

  const detected = nms(regions)
  if (detected.length) return detected
  return fallback ? [fallback] : []
}

async function detectObjectSubject(rgba: Uint8ClampedArray, width: number, height: number): Promise<FocusRegion | undefined> {
  const canvas = sourceCanvas(rgba, width, height)
  if (!canvas) return undefined
  const detector = await getObjectDetector()
  const result = detector.detect(canvas as never)
  let best: { region: FocusRegion; rank: number } | undefined

  for (const detection of result.detections ?? []) {
    const box = detection.boundingBox
    const category = detection.categories?.[0]
    if (!box || !category) continue
    const confidence = category.score ?? 0
    if (confidence < OBJECT_SCORE_THRESHOLD) continue

    const x = Math.max(0, Math.min(1, box.originX / width))
    const y = Math.max(0, Math.min(1, box.originY / height))
    const boxWidth = Math.max(0, Math.min(1 - x, box.width / width))
    const boxHeight = Math.max(0, Math.min(1 - y, box.height / height))
    const area = boxWidth * boxHeight
    if (area < 0.002 || area > 0.95) continue

    const centerX = x + boxWidth / 2
    const centerY = y + boxHeight / 2
    const centerDistance = Math.hypot(centerX - 0.5, centerY - 0.5)
    const centerBias = Math.max(0.78, 1 - centerDistance * 0.22)
    const rank = confidence * (0.4 + Math.sqrt(area)) * centerBias
    const region: FocusRegion = {
      x,
      y,
      width: boxWidth,
      height: boxHeight,
      confidence,
      kind: 'subject',
      label: category.categoryName || category.displayName || undefined,
    }
    if (!best || rank > best.rank) best = { region, rank }
  }

  return best?.region
}

export async function detectFaces(rgba: Uint8ClampedArray, width: number, height: number): Promise<FocusRegion[]> {
  let weakFace: FocusRegion | undefined

  try {
    const faces = await detectFaceRegions(rgba, width, height)
    const strongFaces = faces.filter((face) => face.confidence >= SCORE_THRESHOLD)
    if (strongFaces.length) return strongFaces
    weakFace = faces[0]
  } catch (error) {
    console.warn('Face detection failed; trying AI object focus fallback.', error)
  }

  try {
    const subject = await detectObjectSubject(rgba, width, height)
    if (subject) return [subject]
  } catch (error) {
    console.warn('AI object focus fallback failed.', error)
  }

  return weakFace ? [weakFace] : []
}

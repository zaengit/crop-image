import { getOrtRuntime, type OrtRuntimeSession } from './ai-runtime'

const REFERENCE_SIZE = 512

type SegmenterOptions = {
  baseOptions?: {
    modelAssetBuffer?: Uint8Array | ArrayBuffer
  }
}

type MaskView = {
  getAsFloat32Array: () => Float32Array
}

type SegmentResult = {
  confidenceMasks: MaskView[]
  close: () => void
}

function errorText(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function aligned(value: number) {
  return Math.max(32, Math.round(value / 32) * 32)
}

function inferenceDimensions(width: number, height: number) {
  const longest = Math.max(width, height)
  if (longest <= 0) return { width: REFERENCE_SIZE, height: REFERENCE_SIZE }
  const scale = REFERENCE_SIZE / longest
  return {
    width: aligned(width * scale),
    height: aligned(height * scale),
  }
}

function resizeCanvas(source: OffscreenCanvas, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Unable to create ONNX background segmentation canvas')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

function toModNetInput(image: ImageData) {
  const { width, height, data } = image
  const plane = width * height
  const input = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    const p = i * 4
    input[i] = data[p] / 127.5 - 1
    input[plane + i] = data[p + 1] / 127.5 - 1
    input[plane * 2 + i] = data[p + 2] / 127.5 - 1
  }
  return input
}

function resizeMaskBilinear(
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return new Float32Array(source)
  const output = new Float32Array(targetWidth * targetHeight)
  const xScale = sourceWidth / targetWidth
  const yScale = sourceHeight / targetHeight

  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.max(0, Math.min(sourceHeight - 1, (y + 0.5) * yScale - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(sourceHeight - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.max(0, Math.min(sourceWidth - 1, (x + 0.5) * xScale - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(sourceWidth - 1, x0 + 1)
      const fx = sx - x0
      const a = source[y0 * sourceWidth + x0]
      const b = source[y0 * sourceWidth + x1]
      const c = source[y1 * sourceWidth + x0]
      const d = source[y1 * sourceWidth + x1]
      const top = a + (b - a) * fx
      const bottom = c + (d - c) * fx
      output[y * targetWidth + x] = Math.max(0, Math.min(1, top + (bottom - top) * fy))
    }
  }
  return output
}

async function createSession(model: Uint8Array | ArrayBuffer): Promise<OrtRuntimeSession> {
  const runtime = await getOrtRuntime()
  const bytes = model instanceof Uint8Array ? model : new Uint8Array(model)
  try {
    const session = await runtime.ort.InferenceSession.create(bytes, {
      graphOptimizationLevel: 'all',
      executionProviders: [runtime.backend],
    })
    return { ...runtime, session }
  } catch (error) {
    if (runtime.backend !== 'webgpu') throw error
    console.warn('MODNet WebGPU session creation failed; retrying with WASM.', error)
    const wasm = await import('onnxruntime-web/wasm')
    wasm.env.wasm.numThreads = 1
    const baseUrl = new URL(import.meta.env.BASE_URL, globalThis.location.origin)
    wasm.env.wasm.wasmPaths = new URL('ort-wasm/', baseUrl).href
    const session = await wasm.InferenceSession.create(bytes, {
      graphOptimizationLevel: 'all',
      executionProviders: ['wasm'],
    })
    return { ort: wasm, backend: 'wasm', session }
  }
}

class OnnxImageSegmenter {
  constructor(private runtime: OrtRuntimeSession) {}

  async segment(canvas: OffscreenCanvas): Promise<SegmentResult> {
    const target = inferenceDimensions(canvas.width, canvas.height)
    const image = resizeCanvas(canvas, target.width, target.height)
    const input = toModNetInput(image)
    const session = this.runtime.session
    const feeds = {
      [session.inputNames[0]]: new this.runtime.ort.Tensor('float32', input, [1, 3, target.height, target.width]),
    }

    let outputs
    try {
      outputs = await session.run(feeds)
    } catch (error) {
      throw new Error(`MODNet ${this.runtime.backend} inference failed: ${errorText(error)}`)
    }

    const tensor = outputs[session.outputNames[0]]
    if (!tensor) throw new Error('MODNet did not return an alpha matte')
    const dims = tensor.dims.map(Number)
    const outHeight = dims[dims.length - 2] || target.height
    const outWidth = dims[dims.length - 1] || target.width
    const raw = tensor.data instanceof Float32Array
      ? tensor.data
      : Float32Array.from(tensor.data as ArrayLike<number>)
    const mask = resizeMaskBilinear(raw, outWidth, outHeight, canvas.width, canvas.height)

    return {
      confidenceMasks: [{ getAsFloat32Array: () => mask }],
      close: () => undefined,
    }
  }
}

export const FilesetResolver = {
  async forVisionTasks() {
    return {}
  },
}

export const ImageSegmenter = {
  async createFromOptions(_fileset: unknown, options: SegmenterOptions) {
    const model = options.baseOptions?.modelAssetBuffer
    if (!model) throw new Error('MODNet model buffer is missing')
    const runtime = await createSession(model)
    return new OnnxImageSegmenter(runtime)
  },
}

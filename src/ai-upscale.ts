import * as ort from 'onnxruntime-web/wasm'

const SCALE = 2
const TILE = 128
const OVERLAP = 8
let sessionPromise: Promise<ort.InferenceSession> | undefined
const cachedUpscales = new WeakMap<Uint8ClampedArray, AiUpscaleResult>()

export type AiUpscaleResult = {
  rgba: Uint8ClampedArray
  width: number
  height: number
  backend: 'realesrgan'
}

export function cacheAiUpscale(source: Uint8ClampedArray, result: AiUpscaleResult) {
  cachedUpscales.set(source, result)
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

async function getSession() {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = 1
    const modelUrl = `${import.meta.env.BASE_URL}models/realesrgan_x2plus.onnx`
    sessionPromise = ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    }).catch((error) => {
      sessionPromise = undefined
      throw error
    })
  }
  return sessionPromise
}

function extractTile(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  tileWidth: number,
  tileHeight: number,
) {
  const input = new Float32Array(3 * tileWidth * tileHeight)
  const plane = tileWidth * tileHeight
  for (let y = 0; y < tileHeight; y++) {
    const sy = Math.max(0, Math.min(height - 1, y0 + y))
    for (let x = 0; x < tileWidth; x++) {
      const sx = Math.max(0, Math.min(width - 1, x0 + x))
      const src = (sy * width + sx) * 4
      const p = y * tileWidth + x
      input[p] = source[src] / 255
      input[plane + p] = source[src + 1] / 255
      input[plane * 2 + p] = source[src + 2] / 255
    }
  }
  return input
}

function copyOutputTile(
  output: Float32Array,
  outputWidth: number,
  outputHeight: number,
  destination: Uint8ClampedArray,
  destinationWidth: number,
  destinationHeight: number,
  sourceX: number,
  sourceY: number,
  coreX: number,
  coreY: number,
  coreWidth: number,
  coreHeight: number,
) {
  const plane = outputWidth * outputHeight
  const cropLeft = (coreX - sourceX) * SCALE
  const cropTop = (coreY - sourceY) * SCALE
  const copyWidth = Math.min(coreWidth * SCALE, destinationWidth - coreX * SCALE)
  const copyHeight = Math.min(coreHeight * SCALE, destinationHeight - coreY * SCALE)

  for (let y = 0; y < copyHeight; y++) {
    const oy = cropTop + y
    const dy = coreY * SCALE + y
    for (let x = 0; x < copyWidth; x++) {
      const ox = cropLeft + x
      const dx = coreX * SCALE + x
      const op = oy * outputWidth + ox
      const dp = (dy * destinationWidth + dx) * 4
      destination[dp] = clampByte(output[op] * 255)
      destination[dp + 1] = clampByte(output[plane + op] * 255)
      destination[dp + 2] = clampByte(output[plane * 2 + op] * 255)
    }
  }
}

function copyUpscaledAlpha(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  destination: Uint8ClampedArray,
  destinationWidth: number,
  destinationHeight: number,
) {
  for (let y = 0; y < destinationHeight; y++) {
    const sourceY = (y + 0.5) / SCALE - 0.5
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(sourceY)))
    const y1 = Math.max(0, Math.min(height - 1, y0 + 1))
    const fy = Math.max(0, Math.min(1, sourceY - y0))

    for (let x = 0; x < destinationWidth; x++) {
      const sourceX = (x + 0.5) / SCALE - 0.5
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(sourceX)))
      const x1 = Math.max(0, Math.min(width - 1, x0 + 1))
      const fx = Math.max(0, Math.min(1, sourceX - x0))

      const a00 = source[(y0 * width + x0) * 4 + 3]
      const a10 = source[(y0 * width + x1) * 4 + 3]
      const a01 = source[(y1 * width + x0) * 4 + 3]
      const a11 = source[(y1 * width + x1) * 4 + 3]
      const top = a00 + (a10 - a00) * fx
      const bottom = a01 + (a11 - a01) * fx
      destination[(y * destinationWidth + x) * 4 + 3] = clampByte(top + (bottom - top) * fy)
    }
  }
}

export async function aiUpscale2x(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  onProgress?: (done: number, total: number) => void,
): Promise<AiUpscaleResult> {
  const cached = cachedUpscales.get(source)
  if (cached && cached.width === width * SCALE && cached.height === height * SCALE) {
    cachedUpscales.delete(source)
    onProgress?.(1, 1)
    return cached
  }

  const session = await getSession()
  const destinationWidth = width * SCALE
  const destinationHeight = height * SCALE
  const destination = new Uint8ClampedArray(destinationWidth * destinationHeight * 4)
  const columns = Math.ceil(width / TILE)
  const rows = Math.ceil(height / TILE)
  const total = columns * rows
  let done = 0

  for (let row = 0; row < rows; row++) {
    const coreY = row * TILE
    const coreHeight = Math.min(TILE, height - coreY)
    for (let column = 0; column < columns; column++) {
      const coreX = column * TILE
      const coreWidth = Math.min(TILE, width - coreX)
      const sourceX = Math.max(0, coreX - OVERLAP)
      const sourceY = Math.max(0, coreY - OVERLAP)
      const sourceRight = Math.min(width, coreX + coreWidth + OVERLAP)
      const sourceBottom = Math.min(height, coreY + coreHeight + OVERLAP)
      const tileWidth = sourceRight - sourceX
      const tileHeight = sourceBottom - sourceY
      const input = extractTile(source, width, height, sourceX, sourceY, tileWidth, tileHeight)
      const feeds = {
        [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, tileHeight, tileWidth]),
      }
      const outputs = await session.run(feeds)
      const tensor = outputs[session.outputNames[0]]
      if (!tensor || tensor.dims.length !== 4) throw new Error('Unexpected Real-ESRGAN output shape')
      const outputHeight = Number(tensor.dims[2])
      const outputWidth = Number(tensor.dims[3])
      if (outputWidth !== tileWidth * SCALE || outputHeight !== tileHeight * SCALE) {
        throw new Error(`Unexpected Real-ESRGAN scale ${outputWidth}x${outputHeight}`)
      }
      copyOutputTile(
        tensor.data as Float32Array,
        outputWidth,
        outputHeight,
        destination,
        destinationWidth,
        destinationHeight,
        sourceX,
        sourceY,
        coreX,
        coreY,
        coreWidth,
        coreHeight,
      )
      done++
      onProgress?.(done, total)
    }
  }

  copyUpscaledAlpha(source, width, height, destination, destinationWidth, destinationHeight)
  return { rgba: destination, width: destinationWidth, height: destinationHeight, backend: 'realesrgan' }
}

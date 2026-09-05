import { aiUpscale2x } from './ai-upscale'

export type AiRestoreResult = {
  rgba: Uint8ClampedArray
  width: number
  height: number
  backend: 'realesrgan-restore'
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

async function downscale2x(source: Uint8ClampedArray, width: number, height: number) {
  const targetWidth = Math.max(1, Math.round(width / 2))
  const targetHeight = Math.max(1, Math.round(height / 2))
  const sourceCanvas = new OffscreenCanvas(width, height)
  const sourceCtx = sourceCanvas.getContext('2d')
  if (!sourceCtx) throw new Error('Unable to create AI restore source canvas')
  sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(source), width, height), 0, 0)

  const targetCanvas = new OffscreenCanvas(targetWidth, targetHeight)
  const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true })
  if (!targetCtx) throw new Error('Unable to create AI restore output canvas')
  targetCtx.imageSmoothingEnabled = true
  targetCtx.imageSmoothingQuality = 'high'
  targetCtx.drawImage(sourceCanvas, 0, 0, width, height, 0, 0, targetWidth, targetHeight)
  return targetCtx.getImageData(0, 0, targetWidth, targetHeight).data
}

export async function aiRestoreImage(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  strength = 0.65,
  onProgress?: (done: number, total: number) => void,
): Promise<AiRestoreResult> {
  const upscaled = await aiUpscale2x(source, width, height, onProgress)
  const restored = await downscale2x(upscaled.rgba, upscaled.width, upscaled.height)
  const mix = Math.max(0.2, Math.min(0.9, strength))
  const output = new Uint8ClampedArray(source.length)

  for (let i = 0; i < source.length; i += 4) {
    output[i] = clampByte(source[i] * (1 - mix) + restored[i] * mix)
    output[i + 1] = clampByte(source[i + 1] * (1 - mix) + restored[i + 1] * mix)
    output[i + 2] = clampByte(source[i + 2] * (1 - mix) + restored[i + 2] * mix)
    output[i + 3] = source[i + 3]
  }

  return { rgba: output, width, height, backend: 'realesrgan-restore' }
}

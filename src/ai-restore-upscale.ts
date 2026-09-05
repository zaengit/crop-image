import { aiUpscale2x } from './ai-upscale'

export type AiRestoreUpscaleResult = {
  rgba: Uint8ClampedArray
  width: number
  height: number
  backend: 'realesrgan-restore-upscale'
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

async function resample2x(source: Uint8ClampedArray, width: number, height: number) {
  const sourceCanvas = new OffscreenCanvas(width, height)
  const sourceCtx = sourceCanvas.getContext('2d')
  if (!sourceCtx) throw new Error('Unable to create restore-upscale source canvas')
  sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(source), width, height), 0, 0)

  const targetCanvas = new OffscreenCanvas(width * 2, height * 2)
  const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true })
  if (!targetCtx) throw new Error('Unable to create restore-upscale output canvas')
  targetCtx.imageSmoothingEnabled = true
  targetCtx.imageSmoothingQuality = 'high'
  targetCtx.drawImage(sourceCanvas, 0, 0, width, height, 0, 0, width * 2, height * 2)
  return targetCtx.getImageData(0, 0, width * 2, height * 2).data
}

export async function aiRestoreAndUpscale2x(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  strength = 0.65,
  onProgress?: (done: number, total: number) => void,
): Promise<AiRestoreUpscaleResult> {
  const [ai, base] = await Promise.all([
    aiUpscale2x(source, width, height, onProgress),
    resample2x(source, width, height),
  ])
  const mix = Math.max(0.2, Math.min(0.9, strength))
  const output = new Uint8ClampedArray(ai.rgba.length)

  for (let i = 0; i < output.length; i += 4) {
    output[i] = clampByte(base[i] * (1 - mix) + ai.rgba[i] * mix)
    output[i + 1] = clampByte(base[i + 1] * (1 - mix) + ai.rgba[i + 1] * mix)
    output[i + 2] = clampByte(base[i + 2] * (1 - mix) + ai.rgba[i + 2] * mix)
    output[i + 3] = ai.rgba[i + 3]
  }

  return { rgba: output, width: ai.width, height: ai.height, backend: 'realesrgan-restore-upscale' }
}

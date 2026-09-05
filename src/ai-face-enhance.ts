import { aiRestoreImage } from './ai-restore'

export type FaceRegion = {
  x: number
  y: number
  width: number
  height: number
  confidence?: number
}

export type FaceEnhanceResult = {
  rgba: Uint8ClampedArray
  faces: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function extractRegion(
  source: Uint8ClampedArray,
  imageWidth: number,
  x0: number,
  y0: number,
  width: number,
  height: number,
) {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const srcStart = ((y0 + y) * imageWidth + x0) * 4
    const dstStart = y * width * 4
    out.set(source.subarray(srcStart, srcStart + width * 4), dstStart)
  }
  return out
}

function blendFace(
  destination: Uint8ClampedArray,
  imageWidth: number,
  restored: Uint8ClampedArray,
  x0: number,
  y0: number,
  width: number,
  height: number,
  strength: number,
) {
  const edge = Math.max(2, Math.round(Math.min(width, height) * 0.16))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.min(x, y, width - 1 - x, height - 1 - y)
      const feather = clamp(distance / edge, 0, 1)
      const mix = feather * strength
      if (mix <= 0) continue
      const src = (y * width + x) * 4
      const dst = ((y0 + y) * imageWidth + x0 + x) * 4
      destination[dst] = Math.round(destination[dst] * (1 - mix) + restored[src] * mix)
      destination[dst + 1] = Math.round(destination[dst + 1] * (1 - mix) + restored[src + 1] * mix)
      destination[dst + 2] = Math.round(destination[dst + 2] * (1 - mix) + restored[src + 2] * mix)
    }
  }
}

export async function aiEnhanceFaces(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  faces: FaceRegion[],
  onProgress?: (done: number, total: number) => void,
): Promise<FaceEnhanceResult> {
  if (!faces.length) return { rgba: new Uint8ClampedArray(source), faces: 0 }

  const output = new Uint8ClampedArray(source)
  const selected = [...faces]
    .filter((face) => face.width > 0.025 && face.height > 0.025)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 8)

  let processed = 0
  for (const face of selected) {
    const padX = face.width * 0.42
    const padTop = face.height * 0.5
    const padBottom = face.height * 0.38
    const left = clamp(face.x - padX, 0, 1)
    const top = clamp(face.y - padTop, 0, 1)
    const right = clamp(face.x + face.width + padX, 0, 1)
    const bottom = clamp(face.y + face.height + padBottom, 0, 1)

    const x0 = Math.floor(left * width)
    const y0 = Math.floor(top * height)
    const x1 = Math.ceil(right * width)
    const y1 = Math.ceil(bottom * height)
    const cropWidth = Math.max(1, x1 - x0)
    const cropHeight = Math.max(1, y1 - y0)

    // Tiny faces do not contain enough information for restoration to help.
    if (cropWidth < 32 || cropHeight < 32) continue

    const crop = extractRegion(output, width, x0, y0, cropWidth, cropHeight)
    const restored = await aiRestoreImage(crop, cropWidth, cropHeight, 0.62)
    blendFace(output, width, restored.rgba, x0, y0, cropWidth, cropHeight, 0.72)
    processed++
    onProgress?.(processed, selected.length)
  }

  return { rgba: output, faces: processed }
}

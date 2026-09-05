import { adaptiveLowLight } from './low-light'

export type EnhancementSettings = {
  brightness: number
  contrast: number
  highlights: number
  shadows: number
  saturation: number
  temperature: number
  sharpness: number
  denoise: number
  lowLight: boolean
  faceEnhance: boolean
  deblur: boolean
  restorePhoto: boolean
  upscale2x: boolean
}

export const DEFAULT_ENHANCEMENT: EnhancementSettings = {
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  temperature: 0,
  sharpness: 0,
  denoise: 0,
  lowLight: false,
  faceEnhance: false,
  deblur: false,
  restorePhoto: false,
  upscale2x: false,
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function luma(r: number, g: number, b: number) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

function blur3x3(source: Uint8ClampedArray, width: number, height: number) {
  const out = new Uint8ClampedArray(source.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, count = 0
      for (let oy = -1; oy <= 1; oy++) {
        const py = Math.max(0, Math.min(height - 1, y + oy))
        for (let ox = -1; ox <= 1; ox++) {
          const px = Math.max(0, Math.min(width - 1, x + ox))
          const p = (py * width + px) * 4
          r += source[p]
          g += source[p + 1]
          b += source[p + 2]
          count++
        }
      }
      const p = (y * width + x) * 4
      out[p] = r / count
      out[p + 1] = g / count
      out[p + 2] = b / count
      out[p + 3] = source[p + 3]
    }
  }
  return out
}

function applyDenoise(source: Uint8ClampedArray, width: number, height: number, strength: number) {
  if (strength <= 0) return source
  const blurred = blur3x3(source, width, height)
  const mix = Math.min(0.8, strength / 125)
  const out = new Uint8ClampedArray(source.length)
  for (let i = 0; i < source.length; i += 4) {
    out[i] = clamp(source[i] * (1 - mix) + blurred[i] * mix)
    out[i + 1] = clamp(source[i + 1] * (1 - mix) + blurred[i + 1] * mix)
    out[i + 2] = clamp(source[i + 2] * (1 - mix) + blurred[i + 2] * mix)
    out[i + 3] = source[i + 3]
  }
  return out
}

function applySharpen(source: Uint8ClampedArray, width: number, height: number, amount: number) {
  if (amount <= 0) return source
  const blurred = blur3x3(source, width, height)
  const strength = Math.min(1.6, amount / 62.5)
  const out = new Uint8ClampedArray(source.length)
  for (let i = 0; i < source.length; i += 4) {
    out[i] = clamp(source[i] + (source[i] - blurred[i]) * strength)
    out[i + 1] = clamp(source[i + 1] + (source[i + 1] - blurred[i + 1]) * strength)
    out[i + 2] = clamp(source[i + 2] + (source[i + 2] - blurred[i + 2]) * strength)
    out[i + 3] = source[i + 3]
  }
  return out
}

export function autoEnhancement(source: Uint8ClampedArray): EnhancementSettings {
  let sum = 0
  let sumSq = 0
  let satSum = 0
  const pixels = source.length / 4
  const step = Math.max(1, Math.floor(pixels / 120000))
  let sampled = 0
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4
    const y = luma(source[i], source[i + 1], source[i + 2])
    const max = Math.max(source[i], source[i + 1], source[i + 2])
    const min = Math.min(source[i], source[i + 1], source[i + 2])
    sum += y
    sumSq += y * y
    satSum += max === 0 ? 0 : (max - min) / max
    sampled++
  }
  const mean = sum / Math.max(1, sampled)
  const variance = Math.max(0, sumSq / Math.max(1, sampled) - mean * mean)
  const std = Math.sqrt(variance)
  const avgSat = satSum / Math.max(1, sampled)
  const lowLight = mean < 72
  const brightnessBase = Math.max(-12, Math.min(24, (128 - mean) * 0.22))
  const shadowsBase = mean < 105 ? Math.min(35, (105 - mean) * 0.45) : 0
  return {
    ...DEFAULT_ENHANCEMENT,
    brightness: Math.round(lowLight ? Math.min(8, brightnessBase * 0.35) : brightnessBase),
    contrast: Math.round(Math.max(-8, Math.min(24, (58 - std) * 0.38))),
    shadows: Math.round(lowLight ? Math.min(10, shadowsBase * 0.28) : shadowsBase),
    highlights: mean > 165 ? Math.round(Math.max(-24, (165 - mean) * 0.35)) : 0,
    saturation: avgSat < 0.24 ? Math.round(Math.min(18, (0.24 - avgSat) * 80)) : 0,
    sharpness: 12,
    denoise: mean < 80 ? 12 : 4,
    lowLight,
  }
}

export function detailStrengths(settings: EnhancementSettings) {
  return {
    denoise: settings.denoise + (settings.restorePhoto ? 8 : 0),
    sharpen: settings.sharpness + (settings.deblur ? 30 : 0) + (settings.restorePhoto ? 10 : 0),
  }
}

export function enhanceRgba(
  original: Uint8ClampedArray,
  width: number,
  height: number,
  settings: EnhancementSettings,
  faces: Array<{ x: number; y: number; width: number; height: number }> = [],
  options: { skipDetail?: boolean } = {},
) {
  const base = settings.lowLight ? adaptiveLowLight(original).rgba : new Uint8ClampedArray(original)
  const out = new Uint8ClampedArray(base)
  const brightness = settings.brightness * 2.1
  const contrast = (259 * (settings.contrast + 255)) / (255 * (259 - settings.contrast))
  const saturation = 1 + settings.saturation / 100
  const temperature = settings.temperature * 0.7
  const restore = settings.restorePhoto ? 1 : 0

  for (let i = 0; i < out.length; i += 4) {
    let r = out[i]
    let g = out[i + 1]
    let b = out[i + 2]
    let y = luma(r, g, b)

    const shadowWeight = Math.max(0, 1 - y / 150)
    const highlightWeight = Math.max(0, (y - 105) / 150)
    const tone = brightness + settings.shadows * 0.8 * shadowWeight + settings.highlights * 0.7 * highlightWeight
    r += tone; g += tone; b += tone

    r = contrast * (r - 128) + 128
    g = contrast * (g - 128) + 128
    b = contrast * (b - 128) + 128

    y = luma(r, g, b)
    r = y + (r - y) * saturation
    g = y + (g - y) * saturation
    b = y + (b - y) * saturation

    r += temperature
    b -= temperature

    if (restore) {
      const gray = luma(r, g, b)
      r = gray + (r - gray) * 1.08
      g = gray + (g - gray) * 1.08
      b = gray + (b - gray) * 1.08
      r += 2; g += 1
    }

    out[i] = clamp(r)
    out[i + 1] = clamp(g)
    out[i + 2] = clamp(b)
  }

  let processed: Uint8ClampedArray<ArrayBufferLike> = out
  if (!options.skipDetail) {
    const detail = detailStrengths(settings)
    processed = applyDenoise(processed, width, height, detail.denoise)
    processed = applySharpen(processed, width, height, detail.sharpen)
  }

  if (settings.faceEnhance && faces.length) {
    const faceBase = new Uint8ClampedArray(processed)
    for (const face of faces) {
      const x0 = Math.max(0, Math.floor((face.x - face.width * 0.18) * width))
      const y0 = Math.max(0, Math.floor((face.y - face.height * 0.18) * height))
      const x1 = Math.min(width, Math.ceil((face.x + face.width * 1.18) * width))
      const y1 = Math.min(height, Math.ceil((face.y + face.height * 1.18) * height))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const nx = (x / width - (face.x + face.width / 2)) / Math.max(0.001, face.width * 0.7)
          const ny = (y / height - (face.y + face.height / 2)) / Math.max(0.001, face.height * 0.7)
          const feather = Math.max(0, 1 - Math.sqrt(nx * nx + ny * ny))
          if (!feather) continue
          const p = (y * width + x) * 4
          const localY = luma(faceBase[p], faceBase[p + 1], faceBase[p + 2])
          const lift = (localY < 145 ? 7 : 3) * feather
          processed[p] = clamp(faceBase[p] + lift)
          processed[p + 1] = clamp(faceBase[p + 1] + lift)
          processed[p + 2] = clamp(faceBase[p + 2] + lift)
        }
      }
    }
  }

  return processed
}

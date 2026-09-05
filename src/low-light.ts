import { runLowLightWebGpu } from './gpu-low-light'

export type LowLightInfo = {
  meanLuma: number
  gamma: number
  shadowLift: number
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function luma(r: number, g: number, b: number) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

function analyse(source: Uint8ClampedArray) {
  const pixels = source.length / 4
  const step = Math.max(1, Math.floor(pixels / 150000))
  let sum = 0
  let count = 0
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4
    sum += luma(source[i], source[i + 1], source[i + 2])
    count++
  }
  return sum / Math.max(1, count)
}

function getLowLightInfo(source: Uint8ClampedArray) {
  const mean = analyse(source)
  const darkness = Math.max(0, Math.min(1, (120 - mean) / 100))
  const gamma = 1 - darkness * 0.42
  const shadowLift = darkness * 28
  const saturationProtect = 1 - darkness * 0.08
  return {
    info: { meanLuma: mean, gamma, shadowLift },
    saturationProtect,
  }
}

function applyLowLightCpu(
  source: Uint8ClampedArray,
  gamma: number,
  shadowLift: number,
  saturationProtect: number,
) {
  const out = new Uint8ClampedArray(source.length)

  for (let i = 0; i < source.length; i += 4) {
    const r = source[i]
    const g = source[i + 1]
    const b = source[i + 2]
    const y = luma(r, g, b)
    const normalized = y / 255
    const gammaY = Math.pow(normalized, gamma) * 255
    const shadowWeight = Math.pow(1 - normalized, 1.7)
    const highlightProtect = 1 - Math.max(0, Math.min(1, (y - 165) / 90))
    const targetY = y + (gammaY - y) * highlightProtect + shadowLift * shadowWeight
    const scale = y > 1 ? targetY / y : 1
    const nr = r * scale
    const ng = g * scale
    const nb = b * scale
    const newY = luma(nr, ng, nb)

    out[i] = clampByte(newY + (nr - newY) * saturationProtect)
    out[i + 1] = clampByte(newY + (ng - newY) * saturationProtect)
    out[i + 2] = clampByte(newY + (nb - newY) * saturationProtect)
    out[i + 3] = source[i + 3]
  }

  return out
}

export function adaptiveLowLight(source: Uint8ClampedArray): { rgba: Uint8ClampedArray; info: LowLightInfo } {
  const { info, saturationProtect } = getLowLightInfo(source)
  return {
    rgba: applyLowLightCpu(source, info.gamma, info.shadowLift, saturationProtect),
    info,
  }
}

export async function adaptiveLowLightAccelerated(
  source: Uint8ClampedArray,
): Promise<{ rgba: Uint8ClampedArray; info: LowLightInfo; backend: 'webgpu' | 'cpu' }> {
  const { info, saturationProtect } = getLowLightInfo(source)
  try {
    const rgba = await runLowLightWebGpu(source, info.gamma, info.shadowLift, saturationProtect)
    return { rgba, info, backend: 'webgpu' }
  } catch (error) {
    console.warn('WebGPU low-light processing unavailable; using CPU fallback.', error)
    return {
      rgba: applyLowLightCpu(source, info.gamma, info.shadowLift, saturationProtect),
      info,
      backend: 'cpu',
    }
  }
}

export type AccelerationBackend = 'webgpu' | 'wasm'

type WebGpuNavigator = Navigator & {
  gpu?: {
    requestAdapter: (options?: { powerPreference?: 'low-power' | 'high-performance' }) => Promise<unknown | null>
  }
}

let webGpuSupportPromise: Promise<boolean> | undefined

export function hasWebGpuApi() {
  return typeof navigator !== 'undefined' && Boolean((navigator as WebGpuNavigator).gpu)
}

export async function isWebGpuSupported() {
  if (!hasWebGpuApi()) return false

  webGpuSupportPromise ??= (async () => {
    try {
      const gpu = (navigator as WebGpuNavigator).gpu
      if (!gpu) return false
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
      return Boolean(adapter)
    } catch (error) {
      console.warn('WebGPU capability check failed; falling back to WASM.', error)
      return false
    }
  })()

  return webGpuSupportPromise
}

export async function getPreferredAccelerationBackend(): Promise<AccelerationBackend> {
  return (await isWebGpuSupported()) ? 'webgpu' : 'wasm'
}

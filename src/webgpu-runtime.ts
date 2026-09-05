import { isWebGpuSupported } from './gpu-capabilities'

export type GpuBuffer = {
  destroy: () => void
  mapAsync: (mode: number) => Promise<void>
  getMappedRange: () => ArrayBuffer
  unmap: () => void
}

export type GpuPipeline = {
  getBindGroupLayout: (index: number) => unknown
}

export type GpuDevice = {
  lost?: Promise<{ message?: string; reason?: string }>
  createShaderModule: (options: { code: string }) => unknown
  createComputePipeline: (options: { layout: 'auto'; compute: { module: unknown; entryPoint: string } }) => GpuPipeline
  createBuffer: (options: { size: number; usage: number; mappedAtCreation?: boolean }) => GpuBuffer
  createBindGroup: (options: { layout: unknown; entries: Array<{ binding: number; resource: { buffer: GpuBuffer } }> }) => unknown
  createCommandEncoder: () => {
    beginComputePass: () => {
      setPipeline: (pipeline: unknown) => void
      setBindGroup: (index: number, bindGroup: unknown) => void
      dispatchWorkgroups: (x: number) => void
      end: () => void
    }
    copyBufferToBuffer: (source: GpuBuffer, sourceOffset: number, destination: GpuBuffer, destinationOffset: number, size: number) => void
    finish: () => unknown
  }
  queue: {
    writeBuffer: (buffer: GpuBuffer, offset: number, data: ArrayBufferView) => void
    submit: (commands: unknown[]) => void
  }
}

type GpuAdapter = { requestDevice: () => Promise<GpuDevice> }
type WebGpuNavigator = Navigator & {
  gpu?: {
    requestAdapter: (options?: { powerPreference?: 'low-power' | 'high-performance' }) => Promise<GpuAdapter | null>
  }
}

export type WebGpuGlobals = typeof globalThis & {
  GPUBufferUsage?: {
    STORAGE: number
    COPY_SRC: number
    COPY_DST: number
    MAP_READ: number
    UNIFORM: number
  }
  GPUMapMode?: { READ: number }
}

type SharedDevice = { device: GpuDevice; generation: number }

let devicePromise: Promise<SharedDevice> | undefined
let generation = 0

function resetDevice(expectedDevice?: GpuDevice) {
  if (!expectedDevice) {
    devicePromise = undefined
    generation += 1
    return
  }

  const current = devicePromise
  devicePromise = undefined
  generation += 1
  void current
}

export function getWebGpuGlobals() {
  const globals = globalThis as WebGpuGlobals
  const usage = globals.GPUBufferUsage
  const mapMode = globals.GPUMapMode
  if (!usage || !mapMode) throw new Error('WebGPU buffer constants unavailable')
  return { usage, mapMode }
}

export async function getSharedGpuDevice(): Promise<SharedDevice> {
  devicePromise ??= (async () => {
    if (!(await isWebGpuSupported())) throw new Error('WebGPU unavailable')
    const gpu = (navigator as WebGpuNavigator).gpu
    if (!gpu) throw new Error('WebGPU unavailable')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter')
    const device = await adapter.requestDevice()
    const deviceGeneration = generation

    if (device.lost) {
      void device.lost.then((info) => {
        console.warn('WebGPU device lost; runtime will recreate it on the next request.', info?.message || info?.reason || '')
        if (deviceGeneration === generation) resetDevice(device)
      }).catch((error) => {
        console.warn('WebGPU device loss handler failed.', error)
        if (deviceGeneration === generation) resetDevice(device)
      })
    }

    return { device, generation: deviceGeneration }
  })().catch((error) => {
    devicePromise = undefined
    generation += 1
    throw error
  })

  return devicePromise
}

export function invalidateSharedGpuDevice() {
  resetDevice()
}

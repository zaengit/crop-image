import { isWebGpuSupported } from './gpu-capabilities'

type GpuAdapter = {
  requestDevice: () => Promise<GpuDevice>
}

type GpuBuffer = {
  destroy: () => void
  mapAsync: (mode: number) => Promise<void>
  getMappedRange: () => ArrayBuffer
  unmap: () => void
}

type GpuDevice = {
  createShaderModule: (options: { code: string }) => unknown
  createComputePipeline: (options: { layout: 'auto'; compute: { module: unknown; entryPoint: string } }) => {
    getBindGroupLayout: (index: number) => unknown
  }
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

type WebGpuNavigator = Navigator & {
  gpu?: {
    requestAdapter: (options?: { powerPreference?: 'low-power' | 'high-performance' }) => Promise<GpuAdapter | null>
  }
}

type WebGpuGlobals = typeof globalThis & {
  GPUBufferUsage?: {
    STORAGE: number
    COPY_SRC: number
    COPY_DST: number
    MAP_READ: number
    UNIFORM: number
  }
  GPUMapMode?: { READ: number }
}

const SHADER = `
struct Params {
  pixelCount: u32,
  gamma: f32,
  shadowLift: f32,
  saturationProtect: f32,
}

@group(0) @binding(0) var<storage, read> inputPixels: array<u32>;
@group(0) @binding(1) var<storage, read_write> outputPixels: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

fn unpack(pixel: u32) -> vec4<f32> {
  return vec4<f32>(
    f32(pixel & 255u),
    f32((pixel >> 8u) & 255u),
    f32((pixel >> 16u) & 255u),
    f32((pixel >> 24u) & 255u)
  );
}

fn pack(rgba: vec4<f32>) -> u32 {
  let c = vec4<u32>(clamp(round(rgba), vec4<f32>(0.0), vec4<f32>(255.0)));
  return c.x | (c.y << 8u) | (c.z << 16u) | (c.w << 24u);
}

fn luma(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.pixelCount) {
    return;
  }

  let rgba = unpack(inputPixels[index]);
  let y = luma(rgba.rgb);
  let normalized = y / 255.0;
  let gammaY = pow(max(normalized, 0.0), params.gamma) * 255.0;
  let shadowWeight = pow(max(1.0 - normalized, 0.0), 1.7);
  let highlightProtect = 1.0 - clamp((y - 165.0) / 90.0, 0.0, 1.0);
  let targetY = y + (gammaY - y) * highlightProtect + params.shadowLift * shadowWeight;
  let scale = select(1.0, targetY / y, y > 1.0);
  let scaled = rgba.rgb * scale;
  let newY = luma(scaled);
  let corrected = vec3<f32>(newY) + (scaled - vec3<f32>(newY)) * params.saturationProtect;

  outputPixels[index] = pack(vec4<f32>(corrected, rgba.a));
}
`

let devicePromise: Promise<GpuDevice> | undefined

async function getDevice() {
  devicePromise ??= (async () => {
    if (!(await isWebGpuSupported())) throw new Error('WebGPU unavailable')
    const gpu = (navigator as WebGpuNavigator).gpu
    if (!gpu) throw new Error('WebGPU unavailable')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter')
    return adapter.requestDevice()
  })().catch((error) => {
    devicePromise = undefined
    throw error
  })
  return devicePromise
}

export async function runLowLightWebGpu(
  source: Uint8ClampedArray,
  gamma: number,
  shadowLift: number,
  saturationProtect: number,
) {
  const globals = globalThis as WebGpuGlobals
  const usage = globals.GPUBufferUsage
  const mapMode = globals.GPUMapMode
  if (!usage || !mapMode) throw new Error('WebGPU buffer constants unavailable')

  const device = await getDevice()
  const pixelCount = source.length / 4
  const byteLength = source.byteLength
  const packed = new Uint32Array(pixelCount)
  new Uint8Array(packed.buffer).set(source)

  const input = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_DST })
  const output = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_SRC })
  const readback = device.createBuffer({ size: byteLength, usage: usage.COPY_DST | usage.MAP_READ })
  const params = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST })

  try {
    device.queue.writeBuffer(input, 0, packed)
    const paramBytes = new ArrayBuffer(16)
    const view = new DataView(paramBytes)
    view.setUint32(0, pixelCount, true)
    view.setFloat32(4, gamma, true)
    view.setFloat32(8, shadowLift, true)
    view.setFloat32(12, saturationProtect, true)
    device.queue.writeBuffer(params, 0, new Uint8Array(paramBytes))

    const module = device.createShaderModule({ code: SHADER })
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: input } },
        { binding: 1, resource: { buffer: output } },
        { binding: 2, resource: { buffer: params } },
      ],
    })

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(pixelCount / 256))
    pass.end()
    encoder.copyBufferToBuffer(output, 0, readback, 0, byteLength)
    device.queue.submit([encoder.finish()])

    await readback.mapAsync(mapMode.READ)
    const mapped = readback.getMappedRange()
    return new Uint8ClampedArray(mapped.slice(0))
  } finally {
    input.destroy()
    output.destroy()
    params.destroy()
    readback.destroy()
  }
}

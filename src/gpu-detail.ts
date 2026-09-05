import { isWebGpuSupported } from './gpu-capabilities'

type GpuAdapter = { requestDevice: () => Promise<GpuDevice> }
type GpuBuffer = { destroy: () => void; mapAsync: (mode: number) => Promise<void>; getMappedRange: () => ArrayBuffer }
type GpuPipeline = { getBindGroupLayout: (index: number) => unknown }
type GpuDevice = {
  createShaderModule: (options: { code: string }) => unknown
  createComputePipeline: (options: { layout: 'auto'; compute: { module: unknown; entryPoint: string } }) => GpuPipeline
  createBuffer: (options: { size: number; usage: number }) => GpuBuffer
  createBindGroup: (options: { layout: unknown; entries: Array<{ binding: number; resource: { buffer: GpuBuffer } }> }) => unknown
  createCommandEncoder: () => {
    beginComputePass: () => { setPipeline: (pipeline: unknown) => void; setBindGroup: (index: number, bindGroup: unknown) => void; dispatchWorkgroups: (x: number) => void; end: () => void }
    copyBufferToBuffer: (source: GpuBuffer, sourceOffset: number, destination: GpuBuffer, destinationOffset: number, size: number) => void
    finish: () => unknown
  }
  queue: { writeBuffer: (buffer: GpuBuffer, offset: number, data: ArrayBufferView) => void; submit: (commands: unknown[]) => void }
}
type WebGpuNavigator = Navigator & { gpu?: { requestAdapter: (options?: { powerPreference?: 'low-power' | 'high-performance' }) => Promise<GpuAdapter | null> } }
type WebGpuGlobals = typeof globalThis & {
  GPUBufferUsage?: { STORAGE: number; COPY_SRC: number; COPY_DST: number; MAP_READ: number; UNIFORM: number }
  GPUMapMode?: { READ: number }
}

const SHADER = `
struct Params {
  width: u32,
  height: u32,
  pixelCount: u32,
  amount: f32,
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

fn sampleRgb(x: i32, y: i32) -> vec3<f32> {
  let sx = u32(clamp(x, 0, i32(params.width) - 1));
  let sy = u32(clamp(y, 0, i32(params.height) - 1));
  return unpack(inputPixels[sy * params.width + sx]).rgb;
}

fn blur3x3(index: u32) -> vec3<f32> {
  let x = i32(index % params.width);
  let y = i32(index / params.width);
  var sum = vec3<f32>(0.0);
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      sum = sum + sampleRgb(x + ox, y + oy);
    }
  }
  return sum / 9.0;
}

@compute @workgroup_size(256)
fn denoise(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.pixelCount) { return; }
  let rgba = unpack(inputPixels[index]);
  let blurred = blur3x3(index);
  let rgb = rgba.rgb * (1.0 - params.amount) + blurred * params.amount;
  outputPixels[index] = pack(vec4<f32>(rgb, rgba.a));
}

@compute @workgroup_size(256)
fn sharpen(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.pixelCount) { return; }
  let rgba = unpack(inputPixels[index]);
  let blurred = blur3x3(index);
  let rgb = rgba.rgb + (rgba.rgb - blurred) * params.amount;
  outputPixels[index] = pack(vec4<f32>(rgb, rgba.a));
}
`

let devicePromise: Promise<GpuDevice> | undefined
let pipelinesPromise: Promise<{ device: GpuDevice; denoise: GpuPipeline; sharpen: GpuPipeline }> | undefined

async function getDevice() {
  devicePromise ??= (async () => {
    if (!(await isWebGpuSupported())) throw new Error('WebGPU unavailable')
    const gpu = (navigator as WebGpuNavigator).gpu
    if (!gpu) throw new Error('WebGPU unavailable')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter')
    return adapter.requestDevice()
  })().catch((error) => { devicePromise = undefined; throw error })
  return devicePromise
}

async function getPipelines() {
  pipelinesPromise ??= (async () => {
    const device = await getDevice()
    const module = device.createShaderModule({ code: SHADER })
    return {
      device,
      denoise: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'denoise' } }),
      sharpen: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'sharpen' } }),
    }
  })().catch((error) => { pipelinesPromise = undefined; throw error })
  return pipelinesPromise
}

export async function runDetailWebGpu(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  denoiseAmount: number,
  sharpenAmount: number,
) {
  const globals = globalThis as WebGpuGlobals
  const usage = globals.GPUBufferUsage
  const mapMode = globals.GPUMapMode
  if (!usage || !mapMode) throw new Error('WebGPU buffer constants unavailable')

  const denoiseMix = Math.min(0.8, Math.max(0, denoiseAmount) / 125)
  const sharpenStrength = Math.min(1.6, Math.max(0, sharpenAmount) / 62.5)
  if (denoiseMix <= 0 && sharpenStrength <= 0) return new Uint8ClampedArray(source)

  const { device, denoise, sharpen } = await getPipelines()
  const pixelCount = source.length / 4
  const byteLength = source.byteLength
  const packed = new Uint32Array(pixelCount)
  new Uint8Array(packed.buffer).set(source)

  const usageStorage = usage.STORAGE | usage.COPY_DST | usage.COPY_SRC
  const a = device.createBuffer({ size: byteLength, usage: usageStorage })
  const b = device.createBuffer({ size: byteLength, usage: usageStorage })
  const readback = device.createBuffer({ size: byteLength, usage: usage.COPY_DST | usage.MAP_READ })
  const params = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST })

  try {
    device.queue.writeBuffer(a, 0, packed)
    const encoder = device.createCommandEncoder()
    let input = a
    let output = b

    const runPass = (pipeline: GpuPipeline, amount: number) => {
      const bytes = new ArrayBuffer(16)
      const view = new DataView(bytes)
      view.setUint32(0, width, true)
      view.setUint32(4, height, true)
      view.setUint32(8, pixelCount, true)
      view.setFloat32(12, amount, true)
      device.queue.writeBuffer(params, 0, new Uint8Array(bytes))
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: input } },
          { binding: 1, resource: { buffer: output } },
          { binding: 2, resource: { buffer: params } },
        ],
      })
      const pass = encoder.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.dispatchWorkgroups(Math.ceil(pixelCount / 256))
      pass.end()
      const swap = input
      input = output
      output = swap
    }

    if (denoiseMix > 0) runPass(denoise, denoiseMix)
    if (sharpenStrength > 0) runPass(sharpen, sharpenStrength)

    encoder.copyBufferToBuffer(input, 0, readback, 0, byteLength)
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(mapMode.READ)
    return new Uint8ClampedArray(readback.getMappedRange().slice(0))
  } finally {
    a.destroy(); b.destroy(); params.destroy(); readback.destroy()
  }
}

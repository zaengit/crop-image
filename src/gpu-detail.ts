import { getSharedGpuDevice, getWebGpuGlobals, type GpuBuffer, type GpuPipeline } from './webgpu-runtime'

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

let pipelinesCache: { generation: number; denoise: GpuPipeline; sharpen: GpuPipeline } | undefined

async function getPipelines() {
  const { device, generation } = await getSharedGpuDevice()
  if (!pipelinesCache || pipelinesCache.generation !== generation) {
    const module = device.createShaderModule({ code: SHADER })
    pipelinesCache = {
      generation,
      denoise: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'denoise' } }),
      sharpen: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'sharpen' } }),
    }
  }
  return { device, denoise: pipelinesCache.denoise, sharpen: pipelinesCache.sharpen }
}

export async function runDetailWebGpu(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  denoiseAmount: number,
  sharpenAmount: number,
) {
  const { usage, mapMode } = getWebGpuGlobals()

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
  const paramBuffers: GpuBuffer[] = []
  let mappedReadback: GpuBuffer | undefined

  try {
    device.queue.writeBuffer(a, 0, packed)
    const encoder = device.createCommandEncoder()
    let input = a
    let output = b

    const runPass = (pipeline: GpuPipeline, amount: number) => {
      const params = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST })
      paramBuffers.push(params)
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
    mappedReadback = readback
    const result = new Uint8ClampedArray(readback.getMappedRange().slice(0))
    readback.unmap()
    mappedReadback = undefined
    return result
  } finally {
    if (mappedReadback) mappedReadback.unmap()
    a.destroy()
    b.destroy()
    for (const buffer of paramBuffers) buffer.destroy()
    readback.destroy()
  }
}

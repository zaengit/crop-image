import type { EnhancementSettings } from './enhance'
import { getSharedGpuDevice, getWebGpuGlobals, type GpuBuffer, type GpuPipeline } from './webgpu-runtime'

const SHADER = `
struct Params {
  pixelCount: u32,
  brightness: f32,
  contrast: f32,
  highlights: f32,
  shadows: f32,
  saturation: f32,
  temperature: f32,
  _pad: f32,
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
  if (index >= params.pixelCount) { return; }

  let rgba = unpack(inputPixels[index]);
  var rgb = rgba.rgb;
  var y = luma(rgb);

  let shadowWeight = max(0.0, 1.0 - y / 150.0);
  let highlightWeight = max(0.0, (y - 105.0) / 150.0);
  let tone = params.brightness + params.shadows * 0.8 * shadowWeight + params.highlights * 0.7 * highlightWeight;
  rgb = rgb + vec3<f32>(tone);

  rgb = params.contrast * (rgb - vec3<f32>(128.0)) + vec3<f32>(128.0);

  y = luma(rgb);
  rgb = vec3<f32>(y) + (rgb - vec3<f32>(y)) * params.saturation;

  rgb.r = rgb.r + params.temperature;
  rgb.b = rgb.b - params.temperature;

  outputPixels[index] = pack(vec4<f32>(rgb, rgba.a));
}
`

let pipelineCache: { generation: number; pipeline: GpuPipeline } | undefined

async function getPipeline() {
  const { device, generation } = await getSharedGpuDevice()
  if (!pipelineCache || pipelineCache.generation !== generation) {
    const module = device.createShaderModule({ code: SHADER })
    pipelineCache = {
      generation,
      pipeline: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } }),
    }
  }
  return { device, pipeline: pipelineCache.pipeline }
}

export function hasGlobalAdjustments(settings: EnhancementSettings) {
  return settings.brightness !== 0 || settings.contrast !== 0 || settings.highlights !== 0 || settings.shadows !== 0 || settings.saturation !== 0 || settings.temperature !== 0
}

export async function runGlobalAdjustmentsWebGpu(source: Uint8ClampedArray, settings: EnhancementSettings) {
  const { usage, mapMode } = getWebGpuGlobals()
  const { device, pipeline } = await getPipeline()
  const pixelCount = source.length / 4
  const byteLength = source.byteLength
  const packed = new Uint32Array(pixelCount)
  new Uint8Array(packed.buffer).set(source)

  const input = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_DST })
  const output = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_SRC })
  const readback = device.createBuffer({ size: byteLength, usage: usage.COPY_DST | usage.MAP_READ })
  const params = device.createBuffer({ size: 32, usage: usage.UNIFORM | usage.COPY_DST })
  let mappedReadback: GpuBuffer | undefined

  try {
    device.queue.writeBuffer(input, 0, packed)
    const bytes = new ArrayBuffer(32)
    const view = new DataView(bytes)
    view.setUint32(0, pixelCount, true)
    view.setFloat32(4, settings.brightness * 2.1, true)
    view.setFloat32(8, (259 * (settings.contrast + 255)) / (255 * (259 - settings.contrast)), true)
    view.setFloat32(12, settings.highlights, true)
    view.setFloat32(16, settings.shadows, true)
    view.setFloat32(20, 1 + settings.saturation / 100, true)
    view.setFloat32(24, settings.temperature * 0.7, true)
    device.queue.writeBuffer(params, 0, new Uint8Array(bytes))

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
    mappedReadback = readback
    const result = new Uint8ClampedArray(readback.getMappedRange().slice(0))
    readback.unmap()
    mappedReadback = undefined
    return result
  } finally {
    if (mappedReadback) mappedReadback.unmap()
    input.destroy(); output.destroy(); params.destroy(); readback.destroy()
  }
}

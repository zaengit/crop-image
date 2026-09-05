import type { EnhancementSettings } from './enhance'
import { getSharedGpuDevice, getWebGpuGlobals, type GpuBuffer, type GpuPipeline } from './webgpu-runtime'

const SHADER = `
struct Params {
  width: u32,
  height: u32,
  pixelCount: u32,
  mode: u32,
  p0: f32,
  p1: f32,
  p2: f32,
  p3: f32,
  p4: f32,
  p5: f32,
  p6: f32,
  p7: f32,
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
fn process(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.pixelCount) { return; }
  let rgba = unpack(inputPixels[index]);
  var rgb = rgba.rgb;

  if (params.mode == 1u) {
    let y = luma(rgb);
    let normalized = y / 255.0;
    let gammaY = pow(max(normalized, 0.0), params.p0) * 255.0;
    let shadowWeight = pow(max(1.0 - normalized, 0.0), 1.7);
    let highlightProtect = 1.0 - clamp((y - 165.0) / 90.0, 0.0, 1.0);
    let targetY = y + (gammaY - y) * highlightProtect + params.p1 * shadowWeight;
    let scale = select(1.0, targetY / y, y > 1.0);
    let scaled = rgb * scale;
    let newY = luma(scaled);
    rgb = vec3<f32>(newY) + (scaled - vec3<f32>(newY)) * params.p2;
  } else if (params.mode == 2u) {
    var y = luma(rgb);
    let shadowWeight = max(0.0, 1.0 - y / 150.0);
    let highlightWeight = max(0.0, (y - 105.0) / 150.0);
    let tone = params.p0 + params.p3 * 0.8 * shadowWeight + params.p2 * 0.7 * highlightWeight;
    rgb = rgb + vec3<f32>(tone);
    rgb = params.p1 * (rgb - vec3<f32>(128.0)) + vec3<f32>(128.0);
    y = luma(rgb);
    rgb = vec3<f32>(y) + (rgb - vec3<f32>(y)) * params.p4;
    rgb.r = rgb.r + params.p5;
    rgb.b = rgb.b - params.p5;
    if (params.p6 > 0.5) {
      let gray = luma(rgb);
      rgb = vec3<f32>(gray) + (rgb - vec3<f32>(gray)) * 1.08;
      rgb.r = rgb.r + 2.0;
      rgb.g = rgb.g + 1.0;
    }
  } else if (params.mode == 3u) {
    let blurred = blur3x3(index);
    rgb = rgb * (1.0 - params.p0) + blurred * params.p0;
  } else if (params.mode == 4u) {
    let blurred = blur3x3(index);
    rgb = rgb + (rgb - blurred) * params.p0;
  }

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
      pipeline: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'process' } }),
    }
  }
  return { device, pipeline: pipelineCache.pipeline }
}

function meanLuma(source: Uint8ClampedArray) {
  const pixels = source.length / 4
  const step = Math.max(1, Math.floor(pixels / 150000))
  let sum = 0
  let count = 0
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4
    sum += source[i] * 0.2126 + source[i + 1] * 0.7152 + source[i + 2] * 0.0722
    count++
  }
  return sum / Math.max(1, count)
}

export function shouldUseResidentPipeline(settings: EnhancementSettings, denoise: number, sharpen: number) {
  return settings.lowLight || settings.brightness !== 0 || settings.contrast !== 0 || settings.highlights !== 0 || settings.shadows !== 0 || settings.saturation !== 0 || settings.temperature !== 0 || settings.restorePhoto || denoise > 0 || sharpen > 0
}

export async function runEnhancementPipelineWebGpu(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  settings: EnhancementSettings,
  denoiseAmount: number,
  sharpenAmount: number,
) {
  const { usage, mapMode } = getWebGpuGlobals()
  const { device, pipeline } = await getPipeline()
  const pixelCount = source.length / 4
  const byteLength = source.byteLength
  const packed = new Uint32Array(pixelCount)
  new Uint8Array(packed.buffer).set(source)
  const storageUsage = usage.STORAGE | usage.COPY_DST | usage.COPY_SRC
  const a = device.createBuffer({ size: byteLength, usage: storageUsage })
  const b = device.createBuffer({ size: byteLength, usage: storageUsage })
  const params = device.createBuffer({ size: 48, usage: usage.UNIFORM | usage.COPY_DST })
  const readback = device.createBuffer({ size: byteLength, usage: usage.COPY_DST | usage.MAP_READ })
  let mappedReadback: GpuBuffer | undefined

  try {
    device.queue.writeBuffer(a, 0, packed)
    const encoder = device.createCommandEncoder()
    let input = a
    let output = b

    const runPass = (mode: number, values: number[]) => {
      const bytes = new ArrayBuffer(48)
      const view = new DataView(bytes)
      view.setUint32(0, width, true)
      view.setUint32(4, height, true)
      view.setUint32(8, pixelCount, true)
      view.setUint32(12, mode, true)
      for (let i = 0; i < 8; i++) view.setFloat32(16 + i * 4, values[i] ?? 0, true)
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
      const swap = input; input = output; output = swap
    }

    if (settings.lowLight) {
      const mean = meanLuma(source)
      const darkness = Math.max(0, Math.min(1, (120 - mean) / 100))
      runPass(1, [1 - darkness * 0.42, darkness * 28, 1 - darkness * 0.08])
    }

    const hasTone = settings.brightness !== 0 || settings.contrast !== 0 || settings.highlights !== 0 || settings.shadows !== 0 || settings.saturation !== 0 || settings.temperature !== 0 || settings.restorePhoto
    if (hasTone) {
      runPass(2, [
        settings.brightness * 2.1,
        (259 * (settings.contrast + 255)) / (255 * (259 - settings.contrast)),
        settings.highlights,
        settings.shadows,
        1 + settings.saturation / 100,
        settings.temperature * 0.7,
        settings.restorePhoto ? 1 : 0,
      ])
    }

    const denoiseMix = Math.min(0.8, Math.max(0, denoiseAmount) / 125)
    const sharpenStrength = Math.min(1.6, Math.max(0, sharpenAmount) / 62.5)
    if (denoiseMix > 0) runPass(3, [denoiseMix])
    if (sharpenStrength > 0) runPass(4, [sharpenStrength])

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
    a.destroy(); b.destroy(); params.destroy(); readback.destroy()
  }
}

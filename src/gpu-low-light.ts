import { getSharedGpuDevice, getWebGpuGlobals, type GpuBuffer } from './webgpu-runtime'

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

let pipelineCache: { generation: number; pipeline: { getBindGroupLayout: (index: number) => unknown } } | undefined

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

export async function runLowLightWebGpu(
  source: Uint8ClampedArray,
  gamma: number,
  shadowLift: number,
  saturationProtect: number,
) {
  const { usage, mapMode } = getWebGpuGlobals()
  const { device, pipeline } = await getPipeline()
  const pixelCount = source.length / 4
  const byteLength = source.byteLength
  const packed = new Uint32Array(pixelCount)
  new Uint8Array(packed.buffer).set(source)

  const input = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_DST })
  const output = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_SRC })
  const readback = device.createBuffer({ size: byteLength, usage: usage.COPY_DST | usage.MAP_READ })
  const params = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST })
  let mappedReadback: GpuBuffer | undefined

  try {
    device.queue.writeBuffer(input, 0, packed)
    const paramBytes = new ArrayBuffer(16)
    const view = new DataView(paramBytes)
    view.setUint32(0, pixelCount, true)
    view.setFloat32(4, gamma, true)
    view.setFloat32(8, shadowLift, true)
    view.setFloat32(12, saturationProtect, true)
    device.queue.writeBuffer(params, 0, new Uint8Array(paramBytes))

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
    input.destroy()
    output.destroy()
    params.destroy()
    readback.destroy()
  }
}

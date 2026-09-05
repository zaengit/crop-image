import { getPreferredAccelerationBackend, type AccelerationBackend } from './gpu-capabilities'

type OrtModule = typeof import('onnxruntime-web/wasm')

export type OrtRuntime = {
  ort: OrtModule
  backend: AccelerationBackend
}

let runtimePromise: Promise<OrtRuntime> | undefined

async function loadWasmRuntime(): Promise<OrtRuntime> {
  const ort = await import('onnxruntime-web/wasm')
  ort.env.wasm.numThreads = 1
  return { ort, backend: 'wasm' }
}

async function loadWebGpuRuntime(): Promise<OrtRuntime> {
  const ort = await import('onnxruntime-web/webgpu') as unknown as OrtModule
  return { ort, backend: 'webgpu' }
}

export function getOrtRuntime() {
  runtimePromise ??= (async () => {
    const preferred = await getPreferredAccelerationBackend()
    if (preferred === 'webgpu') {
      try {
        return await loadWebGpuRuntime()
      } catch (error) {
        console.warn('WebGPU ONNX Runtime failed to initialize; falling back to WASM.', error)
      }
    }
    return loadWasmRuntime()
  })().catch((error) => {
    runtimePromise = undefined
    throw error
  })

  return runtimePromise
}

export async function getOrtExecutionProvider() {
  return (await getOrtRuntime()).backend
}

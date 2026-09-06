import { getPreferredAccelerationBackend, type AccelerationBackend } from './gpu-capabilities'

type OrtModule = typeof import('onnxruntime-web/wasm')
type OrtSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>

export type OrtRuntime = {
  ort: OrtModule
  backend: AccelerationBackend
}

export type OrtRuntimeSession = OrtRuntime & {
  session: OrtSession
}

let runtimePromise: Promise<OrtRuntime> | undefined
let wasmRuntimePromise: Promise<OrtRuntime> | undefined

function configureWasmRuntime(ort: OrtModule) {
  ort.env.wasm.numThreads = 1
  const baseUrl = new URL(import.meta.env.BASE_URL, globalThis.location.origin)
  ort.env.wasm.wasmPaths = new URL('ort-wasm/', baseUrl).href
}

async function loadWasmRuntime(): Promise<OrtRuntime> {
  wasmRuntimePromise ??= (async () => {
    const ort = await import('onnxruntime-web/wasm')
    configureWasmRuntime(ort)
    return { ort, backend: 'wasm' as const }
  })().catch((error) => {
    wasmRuntimePromise = undefined
    throw error
  })
  return wasmRuntimePromise
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

export async function createOrtSession(
  modelUrl: string,
  options: Omit<Parameters<OrtModule['InferenceSession']['create']>[1], 'executionProviders'> = {},
): Promise<OrtRuntimeSession> {
  const runtime = await getOrtRuntime()
  try {
    const session = await runtime.ort.InferenceSession.create(modelUrl, {
      ...options,
      executionProviders: [runtime.backend],
    })
    return { ...runtime, session }
  } catch (error) {
    if (runtime.backend !== 'webgpu') throw error
    console.warn('WebGPU ONNX session creation failed; retrying with WASM.', error)
    const wasm = await loadWasmRuntime()
    const session = await wasm.ort.InferenceSession.create(modelUrl, {
      ...options,
      executionProviders: ['wasm'],
    })
    return { ...wasm, session }
  }
}

export async function recreateOrtSessionWithWasm(
  modelUrl: string,
  options: Omit<Parameters<OrtModule['InferenceSession']['create']>[1], 'executionProviders'> = {},
): Promise<OrtRuntimeSession> {
  const wasm = await loadWasmRuntime()
  const session = await wasm.ort.InferenceSession.create(modelUrl, {
    ...options,
    executionProviders: ['wasm'],
  })
  return { ...wasm, session }
}

export async function getOrtExecutionProvider() {
  return (await getOrtRuntime()).backend
}

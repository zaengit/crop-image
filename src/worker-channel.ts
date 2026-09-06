let currentWorker: Worker | undefined
const listeners = new Set<(worker: Worker | undefined) => void>()

function publish(worker: Worker | undefined) {
  currentWorker = worker
  for (const listener of listeners) listener(currentWorker)
}

export function createCropWorker() {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'classic' })
  publish(worker)

  // Reuse the passport background-removal path for custom crops without
  // duplicating segmentation logic in the worker. The worker selects the
  // refined background image for passport presets, so custom presets are
  // temporarily tagged as passport while crossing the worker boundary.
  const nativePostMessage = worker.postMessage.bind(worker)
  worker.postMessage = ((message: unknown, transfer?: Transferable[]) => {
    if (message && typeof message === 'object') {
      const payload = message as { type?: string; preset?: Record<string, unknown> }
      if (payload.type === 'custom' && payload.preset) {
        nativePostMessage({
          ...payload,
          preset: {
            ...payload.preset,
            group: 'passport',
            __customGroup: true,
          },
        }, transfer ?? [])
        return
      }
    }
    nativePostMessage(message, transfer ?? [])
  }) as Worker['postMessage']

  // Restore the public group before useCropEngine receives generated results,
  // keeping filtering, ZIP folders and Custom result cards unchanged.
  worker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; preset?: Record<string, unknown> } | undefined
    if (data?.type === 'result' && data.preset?.__customGroup) {
      data.preset.group = 'custom'
      delete data.preset.__customGroup
    }
  })

  const nativeTerminate = worker.terminate.bind(worker)
  worker.terminate = () => {
    if (currentWorker === worker) publish(undefined)
    nativeTerminate()
  }

  return worker
}

export function onCropWorker(listener: (worker: Worker | undefined) => void) {
  listeners.add(listener)
  listener(currentWorker)
  return () => listeners.delete(listener)
}

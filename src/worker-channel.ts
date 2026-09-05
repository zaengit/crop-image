let currentWorker: Worker | undefined
const listeners = new Set<(worker: Worker | undefined) => void>()

function publish(worker: Worker | undefined) {
  currentWorker = worker
  for (const listener of listeners) listener(currentWorker)
}

export function createCropWorker(url: URL) {
  const worker = new Worker(url, { type: 'module' })
  publish(worker)

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

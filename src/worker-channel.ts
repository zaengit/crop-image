let cropWorker: Worker | undefined
const listeners = new Set<(worker: Worker | undefined) => void>()

export function registerCropWorker(worker: Worker | undefined) {
  cropWorker = worker
  for (const listener of listeners) listener(worker)
}

export function onCropWorker(listener: (worker: Worker | undefined) => void) {
  listeners.add(listener)
  listener(cropWorker)
  return () => listeners.delete(listener)
}

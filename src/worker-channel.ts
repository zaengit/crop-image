let currentWorker: Worker | undefined
const listeners = new Set<(worker: Worker | undefined) => void>()

export function registerCropWorker(worker: Worker) {
  currentWorker = worker
  for (const listener of listeners) listener(currentWorker)

  return () => {
    if (currentWorker !== worker) return
    currentWorker = undefined
    for (const listener of listeners) listener(undefined)
  }
}

export function onCropWorker(listener: (worker: Worker | undefined) => void) {
  listeners.add(listener)
  listener(currentWorker)
  return () => listeners.delete(listener)
}

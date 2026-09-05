let currentWorker: Worker | undefined
const listeners = new Set<(worker: Worker | undefined) => void>()

type TransferOptions = Transferable[] | StructuredSerializeOptions

type PendingOperation = {
  message: unknown
  transferOrOptions?: TransferOptions
  completion?: string
  key?: string
}

function publish(worker: Worker | undefined) {
  currentWorker = worker
  for (const listener of listeners) listener(currentWorker)
}

function operationInfo(message: unknown) {
  if (!message || typeof message !== 'object') return {}
  const type = (message as { type?: unknown }).type
  if (typeof type !== 'string') return {}

  switch (type) {
    case 'load': return { completion: 'ready', key: 'load' }
    case 'enhancement':
    case 'enhancement-auto': return { completion: 'enhancement-settings', key: 'enhancement' }
    case 'settings': return { completion: 'settings-ready', key: 'settings' }
    case 'focus':
    case 'auto': return { completion: 'focus-ready', key: 'focus' }
    case 'background': return { completion: 'background-ready', key: 'background' }
    case 'social':
    case 'passport':
    case 'custom': return { completion: 'done' }
    default: return {}
  }
}

export function createCropWorker(url: URL) {
  const worker = new Worker(url, { type: 'module' })
  const nativePostMessage = worker.postMessage.bind(worker)
  const nativeTerminate = worker.terminate.bind(worker)
  const queue: PendingOperation[] = []
  let inFlight: PendingOperation | undefined
  let terminated = false

  const dispatchNext = () => {
    if (terminated || inFlight || !queue.length) return
    const next = queue.shift()!

    if (next.completion) inFlight = next
    if (next.transferOrOptions === undefined) {
      nativePostMessage(next.message)
    } else if (Array.isArray(next.transferOrOptions)) {
      nativePostMessage(next.message, { transfer: next.transferOrOptions })
    } else {
      nativePostMessage(next.message, next.transferOrOptions)
    }

    if (!next.completion) queueMicrotask(dispatchNext)
  }

  const enqueue = (message: unknown, transferOrOptions?: TransferOptions) => {
    if (terminated) return
    const info = operationInfo(message)
    const operation: PendingOperation = { message, transferOrOptions, ...info }

    // State changes only need their newest queued value. Never coalesce a
    // request that is already running, and never coalesce Generate actions.
    if (operation.key) {
      const pendingIndex = queue.findIndex((candidate) => candidate.key === operation.key)
      if (pendingIndex >= 0) queue.splice(pendingIndex, 1)
    }

    queue.push(operation)
    dispatchNext()
  }

  worker.postMessage = ((message: unknown, transferOrOptions?: TransferOptions) => {
    enqueue(message, transferOrOptions)
  }) as Worker['postMessage']

  worker.addEventListener('message', (event) => {
    if (!inFlight) return
    const type = event.data?.type
    if (type !== inFlight.completion && type !== 'error') return
    inFlight = undefined
    dispatchNext()
  })

  worker.addEventListener('error', () => {
    inFlight = undefined
    queue.length = 0
  })

  worker.terminate = () => {
    terminated = true
    inFlight = undefined
    queue.length = 0
    if (currentWorker === worker) publish(undefined)
    nativeTerminate()
  }

  publish(worker)
  return worker
}

export function onCropWorker(listener: (worker: Worker | undefined) => void) {
  listeners.add(listener)
  listener(currentWorker)
  return () => listeners.delete(listener)
}

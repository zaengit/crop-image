import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type FocusPoint = { x: number; y: number }
type ImageBox = { left: number; top: number; width: number; height: number }

type FocusEditorProps = {
  sourceUrl: string | undefined
  focus: FocusPoint
  previewFilter: string
  onFocusChange: (x: number, y: number) => void
  onReset: () => void
}

export function FocusEditor({ sourceUrl, focus, previewFilter, onFocusChange, onReset }: FocusEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [dragging, setDragging] = useState(false)
  const [autoFocusActive, setAutoFocusActive] = useState(true)
  const [imageBox, setImageBox] = useState<ImageBox>({ left: 0, top: 0, width: 0, height: 0 })

  const measureImageBox = useCallback(() => {
    const stage = stageRef.current
    const image = imageRef.current
    const stageWidth = stage?.clientWidth ?? 0
    const stageHeight = stage?.clientHeight ?? 0

    if (!image?.naturalWidth || !image.naturalHeight || !stageWidth || !stageHeight) {
      setImageBox({ left: 0, top: 0, width: stageWidth, height: stageHeight })
      return
    }

    const imageRatio = image.naturalWidth / image.naturalHeight
    const stageRatio = stageWidth / stageHeight
    if (imageRatio > stageRatio) {
      const height = stageWidth / imageRatio
      setImageBox({ left: 0, top: (stageHeight - height) / 2, width: stageWidth, height })
      return
    }

    const width = stageHeight * imageRatio
    setImageBox({ left: (stageWidth - width) / 2, top: 0, width, height: stageHeight })
  }, [])

  useEffect(() => {
    setAutoFocusActive(true)
    measureImageBox()
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureImageBox)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [measureImageBox, sourceUrl])

  const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    setAutoFocusActive(false)
    onFocusChange(
      (event.clientX - rect.left - imageBox.left) / Math.max(1, imageBox.width),
      (event.clientY - rect.top - imageBox.top) / Math.max(1, imageBox.height),
    )
  }

  const useAutoFocus = () => {
    setAutoFocusActive(true)
    onReset()
  }

  const targetStyle = {
    left: `${imageBox.left + focus.x * imageBox.width}px`,
    top: `${imageBox.top + focus.y * imageBox.height}px`,
  }
  const displayX = Math.round(focus.x * imageBox.width)
  const displayY = Math.round(focus.y * imageBox.height)

  return (
    <section id="focus-editor" className="grid gap-5 rounded-[28px] border border-neutral-200 bg-white p-5 shadow-[0_20px_55px_rgba(15,23,42,0.06)] sm:p-6 lg:grid-cols-[minmax(250px,0.36fr)_1fr]">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">01 / Focal point</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">Fine-tune the smart crop</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">Drag anywhere on the image to place the subject where every generated size should prioritize it.</p>
        <button
          id="reset-focus"
          className={`secondary-button mt-5 min-h-11 rounded-xl border px-4 py-2 text-sm font-medium transition ${autoFocusActive ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-950 hover:text-neutral-950'}`}
          type="button"
          aria-pressed={autoFocusActive}
          onClick={useAutoFocus}
        >
          {autoFocusActive ? 'Auto focus active' : 'Use auto focus'}
        </button>
      </div>
      <div
        ref={stageRef}
        id="focus-stage"
        className="focus-stage relative flex min-h-[320px] touch-none items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100 sm:min-h-[380px]"
        onPointerDown={(event) => {
          setDragging(true)
          event.currentTarget.setPointerCapture?.(event.pointerId)
          updateFromPointer(event)
        }}
        onPointerMove={(event) => { if (dragging) updateFromPointer(event) }}
        onPointerUp={(event) => {
          setDragging(false)
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          updateFromPointer(event)
        }}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-neutral-200 bg-white/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600 shadow-sm backdrop-blur sm:left-4 sm:top-4">
          <span className="h-1.5 w-1.5 rounded-full bg-neutral-950" aria-hidden="true" />
          {autoFocusActive ? 'Auto focus' : 'Manual focus'}
        </div>
        <div
          id="focus-debug-coordinate"
          className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-xl border border-neutral-800 bg-neutral-950/90 px-3 py-2 font-mono text-[11px] leading-5 text-white shadow-lg backdrop-blur sm:bottom-4 sm:left-4"
          aria-live="polite"
        >
          <div>x: {focus.x.toFixed(4)} · y: {focus.y.toFixed(4)}</div>
          <div>view: {displayX}px · {displayY}px</div>
        </div>
        <img
          ref={imageRef}
          id="focus-image"
          src={sourceUrl ?? ''}
          alt="Original upload for focal-point adjustment"
          className="max-h-[560px] max-w-full select-none object-contain"
          draggable={false}
          style={{ filter: previewFilter }}
          onLoad={measureImageBox}
        />
        <button
          id="focus-target"
          className="absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-neutral-950/55 shadow-[0_0_0_5px_rgba(10,10,10,0.2)]"
          style={targetStyle}
          type="button"
          aria-label="Focal point. Drag to reposition."
        />
      </div>
    </section>
  )
}

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type FocusPoint = { x: number; y: number }
type ImageBox = { left: number; top: number; width: number; height: number }

type FocusEditorProps = {
  sourceUrl: string
  focus: FocusPoint
  previewFilter: string
  onFocusChange: (x: number, y: number) => void
  onReset: () => void
}

export function FocusEditor({ sourceUrl, focus, previewFilter, onFocusChange, onReset }: FocusEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [dragging, setDragging] = useState(false)
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
    onFocusChange(
      (event.clientX - rect.left - imageBox.left) / Math.max(1, imageBox.width),
      (event.clientY - rect.top - imageBox.top) / Math.max(1, imageBox.height),
    )
  }

  const targetStyle = {
    left: `${imageBox.left + focus.x * imageBox.width}px`,
    top: `${imageBox.top + focus.y * imageBox.height}px`,
  }

  return (
    <section id="focus-editor" className="grid gap-5 rounded-3xl border border-slate-200 bg-white p-5 lg:grid-cols-[minmax(220px,0.35fr)_1fr]">
      <div>
        <p className="text-xs font-bold tracking-[0.2em] text-cyan-700">FOCAL POINT</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">Fine-tune the smart crop</h2>
        <p className="mt-2 text-sm text-slate-600">Drag the target over the subject you want every generated size to prioritize.</p>
        <button
          id="reset-focus"
          className="mt-4 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700"
          type="button"
          onClick={onReset}
        >
          Use auto focus
        </button>
      </div>
      <div
        ref={stageRef}
        id="focus-stage"
        className="relative flex min-h-[320px] touch-none items-center justify-center overflow-hidden rounded-2xl bg-slate-50"
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
        <img
          ref={imageRef}
          id="focus-image"
          src={sourceUrl}
          alt="Original upload for focal-point adjustment"
          className="max-h-[560px] max-w-full select-none object-contain"
          draggable={false}
          style={{ filter: previewFilter }}
          onLoad={measureImageBox}
        />
        <button
          id="focus-target"
          className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-600/40 shadow-[0_0_0_5px_rgba(6,182,212,.25)]"
          style={targetStyle}
          type="button"
          aria-label="Focal point"
        />
      </div>
    </section>
  )
}

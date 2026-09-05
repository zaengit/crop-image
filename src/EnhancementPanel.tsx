import { useEffect, useRef, useState } from 'react'
import { DEFAULT_ENHANCEMENT, type EnhancementSettings } from './enhance'

type Props = {
  visible: boolean
  settings: EnhancementSettings
  status: string
  onApply: (settings: EnhancementSettings, reason?: string) => void
  onAuto: () => void
  onReset: () => void
  onCompareChange: (active: boolean) => void
}

const sliders: Array<{ key: keyof EnhancementSettings; label: string; min: number; max: number }> = [
  { key: 'brightness', label: 'Brightness', min: -50, max: 50 },
  { key: 'contrast', label: 'Contrast', min: -50, max: 50 },
  { key: 'highlights', label: 'Highlights', min: -50, max: 50 },
  { key: 'shadows', label: 'Shadows', min: -50, max: 50 },
  { key: 'saturation', label: 'Saturation', min: -50, max: 50 },
  { key: 'temperature', label: 'Temperature', min: -50, max: 50 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
  { key: 'denoise', label: 'Noise reduction', min: 0, max: 100 },
]

const toggles: Array<{ key: keyof EnhancementSettings; label: string; activeReason: string }> = [
  { key: 'lowLight', label: 'Low light', activeReason: 'Applying low-light enhancement…' },
  { key: 'faceEnhance', label: 'Face enhance', activeReason: 'Preparing AI face enhancement…' },
  { key: 'deblur', label: 'Deblur', activeReason: 'Preparing AI restoration…' },
  { key: 'restorePhoto', label: 'Restore photo', activeReason: 'Preparing AI restoration…' },
  { key: 'upscale2x', label: 'AI Upscale 2×', activeReason: 'Preparing AI super resolution…' },
]

export function enhancementPreviewFilter(settings: EnhancementSettings, comparing: boolean) {
  if (comparing) return 'none'
  const brightness = 100 + settings.brightness * 0.7 + (settings.lowLight ? 8 : 0)
  const contrast = 100 + settings.contrast
  const saturation = 100 + settings.saturation
  const warmth = settings.temperature
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) sepia(${Math.max(0, warmth) * 0.18}%)`
}

export function EnhancementPanel(props: Props) {
  const [draft, setDraft] = useState<EnhancementSettings>({ ...props.settings })
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => setDraft({ ...props.settings }), [props.settings])
  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  if (!props.visible) return null

  const applyRange = (key: keyof EnhancementSettings, value: number, commit: boolean) => {
    const next = { ...draft, [key]: value } as EnhancementSettings
    setDraft(next)
    const heavy = key === 'denoise' && value >= 20
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (heavy && !commit) return
    if (commit) {
      props.onApply(next, heavy ? 'Applying AI enhancement…' : 'Applying enhancement…')
      return
    }
    timerRef.current = window.setTimeout(() => props.onApply(next, 'Applying enhancement…'), 140)
  }

  const toggle = (item: typeof toggles[number]) => {
    const next = { ...draft, [item.key]: !Boolean(draft[item.key]) } as EnhancementSettings
    setDraft(next)
    props.onApply(next, Boolean(next[item.key]) ? item.activeReason : 'Applying enhancement…')
  }

  return (
    <section id="enhance-global" className="enhance-global rounded-[28px] border border-neutral-200 bg-white p-5 shadow-[0_20px_55px_rgba(15,23,42,0.06)] backdrop-blur sm:p-6">
      <div className="enhance-head flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">02 / Global enhance</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">Improve image quality</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600">Enhancement is optional. Adjust the current image before generating crops if needed.</p>
        </div>
        <div className="enhance-actions flex flex-wrap gap-2">
          <button id="enhance-auto" className="primary-button min-h-11 rounded-xl bg-neutral-950 px-4 py-2 font-semibold text-white transition hover:bg-neutral-800" type="button" onClick={props.onAuto}>Auto Enhance</button>
          <button
            id="enhance-compare"
            className="secondary-button min-h-11 rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition hover:border-neutral-950 hover:text-neutral-950"
            type="button"
            onPointerDown={() => props.onCompareChange(true)}
            onPointerUp={() => props.onCompareChange(false)}
            onPointerCancel={() => props.onCompareChange(false)}
            onPointerLeave={() => props.onCompareChange(false)}
            onKeyDown={(event: any) => { if (event.key === ' ' || event.key === 'Enter') props.onCompareChange(true) }}
            onKeyUp={() => props.onCompareChange(false)}
          >Hold to compare</button>
          <button id="enhance-reset" className="secondary-button min-h-11 rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition hover:border-neutral-950 hover:text-neutral-950" type="button" onClick={() => { setDraft({ ...DEFAULT_ENHANCEMENT }); props.onReset() }}>Reset</button>
        </div>
      </div>

      <div className="enhance-grid mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sliders.map((item) => {
          const value = Number(draft[item.key])
          return (
            <label key={String(item.key)} className="enhance-control rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5">
              <span className="mb-3 flex items-center justify-between text-xs font-medium text-neutral-700">
                {item.label}<output className="font-mono font-semibold text-neutral-950">{value}</output>
              </span>
              <input
                type="range"
                min={item.min}
                max={item.max}
                value={value}
                step="1"
                className="w-full accent-neutral-950"
                onInput={(event: any) => applyRange(item.key, Number(event.currentTarget.value), false)}
                onChange={(event: any) => applyRange(item.key, Number(event.currentTarget.value), true)}
              />
            </label>
          )
        })}
      </div>

      <div className="enhance-toggles mt-4 flex flex-wrap gap-2">
        {toggles.map((item) => {
          const active = Boolean(draft[item.key])
          return (
            <button
              key={String(item.key)}
              type="button"
              aria-pressed={active}
              className={`enhance-toggle min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition ${active ? 'active border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-950 hover:text-neutral-950'}`}
              onClick={() => toggle(item)}
            >{item.label}</button>
          )
        })}
      </div>
      <small id="enhance-status" className="enhance-status mt-4 block rounded-xl bg-neutral-50 px-3 py-2 text-sm text-neutral-600" aria-live="polite">{props.status}</small>
    </section>
  )
}

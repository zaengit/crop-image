import { useEffect, useRef, useState, type ChangeEvent } from 'react'

export type ColorPreset = {
  label: string
  value: string
}

type ColorPickerProps = {
  id: string
  label: string
  value: string
  fallback: string
  onChange: (value: string) => void
  presets?: ColorPreset[]
}

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value)
}

export function ColorPicker({ id, label, value, fallback, onChange, presets = [] }: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const color = isHexColor(value) ? value : fallback

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.currentTarget.value)
  }

  return (
    <div ref={pickerRef} className="relative w-full sm:w-[220px]" data-color-picker={id}>
      <button
        type="button"
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-left transition hover:border-neutral-950"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-popover`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-100 p-1 shadow-inner" aria-hidden="true">
          <span className="h-full w-full rounded-lg" style={{ backgroundColor: color }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-neutral-950">{label}</span>
          <code className="mt-0.5 block text-[11px] uppercase tracking-[0.12em] text-neutral-500">{color}</code>
        </span>
        <svg viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 text-neutral-500 transition ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div id={`${id}-popover`} role="dialog" aria-label={`${label} color picker`} className="absolute left-0 top-full z-30 mt-2 w-full min-w-[280px] rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-950 shadow-[0_18px_45px_rgba(0,0,0,0.16)] sm:left-auto sm:right-0 sm:w-[300px]">
          <div className="flex items-center gap-3 rounded-xl bg-neutral-950 p-3 text-white">
            <label htmlFor={id} className="color-picker-input-wrap flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white/10 p-1 transition hover:bg-white/20">
              <span className="sr-only">Choose {label}</span>
              <input id={id} type="color" value={color} onChange={handleColorChange} className="color-picker-input" />
            </label>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Custom color</p>
              <code className="mt-1 block truncate text-sm font-semibold uppercase tracking-[0.12em]">{color}</code>
            </div>
          </div>

          {presets.length ? (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Quick colors</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {presets.map((preset) => {
                  const active = value.toLowerCase() === preset.value.toLowerCase()
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      className={`flex min-h-10 items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-medium transition ${active ? 'border-neutral-950 bg-neutral-100 text-neutral-950' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-950'}`}
                      aria-pressed={active}
                      onClick={() => onChange(preset.value)}
                    >
                      <span className="h-5 w-5 shrink-0 rounded-md border border-neutral-200 shadow-inner" style={{ backgroundColor: preset.value }} aria-hidden="true" />
                      <span className="truncate">{preset.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between border-t border-neutral-200 pt-3">
            <span className="text-xs text-neutral-500">Click outside or press Esc to close</span>
            <button type="button" className="rounded-lg bg-neutral-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-800" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

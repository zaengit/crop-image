import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useCropEngine, type Generated } from './use-crop-engine'
import type { PresetGroup } from './presets'
import { EnhancementPanel, enhancementPreviewFilter } from './EnhancementPanel'
import { StoreAssetsPanel } from './StoreAssetsPanel'
import { FocusEditor } from './components/FocusEditor'
import { OutputSettings } from './components/OutputSettings'
import { ResultGrid } from './components/ResultGrid'
import { SizeTabs } from './components/SizeTabs'
import { UploadDropzone } from './components/UploadDropzone'

export function App() {
  const engine = useCropEngine()
  const [menu, setMenu] = useState<PresetGroup>('social')
  const [comparing, setComparing] = useState(false)
  const [customWidth, setCustomWidth] = useState(1080)
  const [customHeight, setCustomHeight] = useState(1080)
  const [lockRatio, setLockRatio] = useState(false)
  const [lockedRatio, setLockedRatio] = useState(1)
  const [customError, setCustomError] = useState('')

  useEffect(() => {
    document.documentElement.dataset.appReady = 'true'
    return () => { delete document.documentElement.dataset.appReady }
  }, [])

  const visibleResults = engine.generated.filter((item: Generated) => item.preset.group === menu)

  const processFile = (file: File | undefined) => {
    if (!file) return
    setMenu('social')
    setCustomError('')
    void engine.processFile(file)
  }

  const setRatio = (ratio: number) => {
    setLockedRatio(ratio)
    setLockRatio(true)
    setCustomHeight(Math.max(64, Math.min(8192, Math.round(customWidth / ratio))))
  }

  const updateWidth = (value: number) => {
    setCustomWidth(value)
    if (lockRatio && lockedRatio) {
      setCustomHeight(Math.max(64, Math.min(8192, Math.round(value / lockedRatio))))
    }
  }

  const updateHeight = (value: number) => {
    setCustomHeight(value)
    if (lockRatio && lockedRatio) {
      setCustomWidth(Math.max(64, Math.min(8192, Math.round(value * lockedRatio))))
    }
  }

  const submitCustom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCustomError(engine.generateCustom(customWidth, customHeight))
  }

  const toggleRatioLock = (event: ChangeEvent<HTMLInputElement>) => {
    const checked = event.currentTarget.checked
    setLockRatio(checked)
    if (checked) setLockedRatio(customWidth / Math.max(1, customHeight))
  }

  const previewFilter = enhancementPreviewFilter(engine.enhancement, comparing)

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="py-5 text-center">
          <p className="text-xs font-bold tracking-[0.22em] text-cyan-700">LOCAL • PRIVATE • WASM</p>
          <h1 className="mx-auto mt-3 max-w-4xl text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">Upload once. Get every size you need.</h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600">Smart crop runs on your device. Your image never leaves the browser.</p>
        </header>

        <UploadDropzone busy={engine.busy} status={engine.status} onFile={processFile} />

        <EnhancementPanel
          visible={engine.hasImage}
          settings={engine.enhancement}
          status={engine.enhancementStatus}
          onApply={engine.applyEnhancement}
          onAuto={engine.autoEnhance}
          onReset={engine.resetEnhancement}
          onCompareChange={setComparing}
        />

        {engine.hasImage ? (
          <FocusEditor
            sourceUrl={engine.sourceUrl}
            focus={engine.focus}
            previewFilter={previewFilter}
            onFocusChange={engine.updateFocus}
            onReset={engine.resetFocus}
          />
        ) : null}

        <section id="results" className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold tracking-[0.2em] text-cyan-700">GENERATE</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Image sizes</h2>
            </div>
            <OutputSettings engine={engine} />
          </div>

          <SizeTabs value={menu} onChange={setMenu} />

          {menu === 'social' ? (
            <section id="social-panel" className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Social media</h3>
                  <p className="text-sm text-slate-600">Adjust the focal point if needed, then generate ready-to-use social media sizes.</p>
                </div>
                <button id="generate-social" className="rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white disabled:opacity-40" type="button" disabled={engine.busy} onClick={() => engine.generateGroup('social')}>Generate crop</button>
              </div>
            </section>
          ) : null}

          {menu === 'passport' ? (
            <section id="passport-panel" className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Passport photo</h3>
                  <p className="text-sm text-slate-600">Choose the background and generate portrait-focused 2 × 3, 3 × 4, and 4 × 6 outputs.</p>
                </div>
                <button id="generate-passport" className="rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white disabled:opacity-40" type="button" disabled={engine.busy} onClick={() => engine.generateGroup('passport')}>Generate crop</button>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr]">
                <div>
                  <strong>Background</strong>
                  <p className="text-sm text-slate-600">Keep the original scene or replace it with a solid color.</p>
                </div>
                <div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Passport photo background">
                    {[
                      ['original', 'Original'],
                      ['#ffffff', 'White'],
                      ['#d71920', 'Red'],
                      ['#1769d2', 'Blue'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={`rounded-full border px-3 py-2 text-sm ${engine.background === value ? 'border-cyan-500 text-cyan-800' : 'border-slate-300'}`}
                        type="button"
                        data-background={value}
                        aria-pressed={engine.background === value}
                        onClick={() => engine.setBackground(value)}
                      >
                        {label}
                      </button>
                    ))}
                    <label className="rounded-full border border-slate-300 px-3 py-2 text-sm">
                      <span>Custom </span>
                      <input
                        id="passport-background-color"
                        type="color"
                        value={engine.background.startsWith('#') ? engine.background : '#e5e7eb'}
                        aria-label="Custom passport background color"
                        onChange={(event) => engine.setBackground(event.currentTarget.value)}
                      />
                    </label>
                  </div>
                  <small id="background-status" className="mt-2 block text-sm text-slate-600" aria-live="polite">{engine.backgroundStatus}</small>
                </div>
              </div>
            </section>
          ) : null}

          {menu === 'custom' ? (
            <section id="custom-panel" className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <h3 className="text-lg font-semibold">Custom size</h3>
                <p className="text-sm text-slate-600">Create any pixel size while keeping smart crop and your current focal point.</p>
              </div>
              <form id="custom-form" className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={submitCustom}>
                <label className="grid gap-1 text-sm">
                  <span>Width</span>
                  <input id="custom-width" className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2" type="number" min="64" max="8192" value={customWidth} inputMode="numeric" required onChange={(event) => updateWidth(Number(event.currentTarget.value))} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Height</span>
                  <input id="custom-height" className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2" type="number" min="64" max="8192" value={customHeight} inputMode="numeric" required onChange={(event) => updateHeight(Number(event.currentTarget.value))} />
                </label>
                <label className="flex items-center gap-2 self-end rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <input id="lock-ratio" type="checkbox" checked={lockRatio} onChange={toggleRatioLock} />
                  <span>Lock aspect ratio</span>
                </label>
                <div className="flex flex-wrap gap-2 md:col-span-3" aria-label="Quick aspect ratios">
                  {[[1, 1], [4, 5], [9, 16], [16, 9], [2, 3], [3, 4]].map(([w, h]) => (
                    <button key={`${w}/${h}`} type="button" data-ratio={`${w}/${h}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs" onClick={() => setRatio(w / h)}>{w}:{h}</button>
                  ))}
                </div>
                <button className="rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white disabled:opacity-40 md:col-span-3 md:w-fit" type="submit" disabled={engine.busy}>Generate custom size</button>
                <small id="custom-error" className="text-sm text-rose-700 md:col-span-3" aria-live="polite">{customError}</small>
              </form>
            </section>
          ) : null}

          {menu === 'store' ? <div className="mt-5"><StoreAssetsPanel /></div> : null}

          {menu !== 'store' ? (
            <ResultGrid items={visibleResults} showEmptyState={menu === 'custom'} onDelete={engine.removeCustom} />
          ) : null}
        </section>
      </div>
    </main>
  )
}

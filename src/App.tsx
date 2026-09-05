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
    <main className="app-shell min-h-screen bg-[#f4f4f2] px-4 py-4 text-neutral-950 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-6">
        <header className="app-header flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-neutral-950 px-4 py-3 text-white shadow-[0_18px_45px_rgba(0,0,0,0.12)] sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-black tracking-[-0.08em] text-neutral-950">CI</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">Crop Image</p>
              <p className="hidden text-[11px] text-neutral-400 sm:block">Smart crop studio</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
            <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
            <span>Local processing</span>
          </div>
        </header>

        <section className="hero-panel relative overflow-hidden rounded-[28px] bg-neutral-950 px-6 py-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.16)] sm:px-10 sm:py-12 lg:flex lg:items-end lg:justify-between lg:gap-12">
          <div className="relative z-10 max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-neutral-400">Local • private • ready for every format</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-7xl">Upload once.<br className="hidden sm:block" /> Get every size you need.</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-neutral-300 sm:text-lg">Smart crop keeps the subject in frame while you prepare social posts, passport photos, custom sizes, and app-store assets.</p>
          </div>
          <div className="relative z-10 mt-8 grid max-w-sm grid-cols-3 gap-2 border-t border-white/15 pt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400 lg:mt-0 lg:min-w-[330px]">
            <div><span className="mb-2 block text-xl font-semibold tracking-normal text-white">01</span>Upload</div>
            <div><span className="mb-2 block text-xl font-semibold tracking-normal text-white">02</span>Focus</div>
            <div><span className="mb-2 block text-xl font-semibold tracking-normal text-white">03</span>Export</div>
          </div>
          <div className="pointer-events-none absolute -right-28 -top-32 h-80 w-80 rounded-full border border-white/10" aria-hidden="true" />
          <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full border border-white/10" aria-hidden="true" />
        </section>

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

        <section id="results" className="rounded-[28px] border border-neutral-200 bg-white p-4 shadow-[0_20px_55px_rgba(15,23,42,0.06)] sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">03 / Generate</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">Choose an output</h2>
            </div>
            <OutputSettings engine={engine} />
          </div>

          <SizeTabs value={menu} onChange={setMenu} />

          {menu === 'social' ? (
            <section id="social-panel" className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Social media</h3>
                  <p className="text-sm leading-6 text-neutral-600">Adjust the focal point if needed, then generate ready-to-use social media sizes.</p>
                </div>
                <button id="generate-social" className="primary-button rounded-xl bg-neutral-950 px-4 py-2.5 font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={engine.busy} onClick={() => engine.generateGroup('social')}>Generate crop</button>
              </div>
            </section>
          ) : null}

          {menu === 'passport' ? (
            <section id="passport-panel" className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Passport photo</h3>
                  <p className="text-sm leading-6 text-neutral-600">Choose the background and generate portrait-focused 2 × 3, 3 × 4, and 4 × 6 outputs.</p>
                </div>
                <button id="generate-passport" className="primary-button rounded-xl bg-neutral-950 px-4 py-2.5 font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={engine.busy} onClick={() => engine.generateGroup('passport')}>Generate crop</button>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr]">
                <div>
                  <strong>Background</strong>
                  <p className="text-sm leading-6 text-neutral-600">Keep the original scene or replace it with a solid color.</p>
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
                        className={`rounded-full border px-3 py-2 text-sm transition ${engine.background === value ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-950'}`}
                        type="button"
                        data-background={value}
                        aria-pressed={engine.background === value}
                        onClick={() => engine.setBackground(value)}
                      >
                        {label}
                      </button>
                    ))}
                    <label className="rounded-full border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700">
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
                  <small id="background-status" className="mt-2 block text-sm text-neutral-600" aria-live="polite">{engine.backgroundStatus}</small>
                </div>
              </div>
            </section>
          ) : null}

          {menu === 'custom' ? (
            <section id="custom-panel" className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 sm:p-5">
              <div>
                <h3 className="text-lg font-semibold">Custom size</h3>
                <p className="text-sm leading-6 text-neutral-600">Create any pixel size while keeping smart crop and your current focal point.</p>
              </div>
              <form id="custom-form" className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={submitCustom}>
                <label className="grid gap-1 text-sm">
                  <span>Width</span>
                  <input id="custom-width" className="rounded-lg border border-neutral-300 bg-white px-3 py-2 transition focus:border-neutral-950" type="number" min="64" max="8192" value={customWidth} inputMode="numeric" required onChange={(event) => updateWidth(Number(event.currentTarget.value))} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Height</span>
                  <input id="custom-height" className="rounded-lg border border-neutral-300 bg-white px-3 py-2 transition focus:border-neutral-950" type="number" min="64" max="8192" value={customHeight} inputMode="numeric" required onChange={(event) => updateHeight(Number(event.currentTarget.value))} />
                </label>
                <label className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm">
                  <input id="lock-ratio" className="accent-neutral-950" type="checkbox" checked={lockRatio} onChange={toggleRatioLock} />
                  <span>Lock aspect ratio</span>
                </label>
                <div className="flex flex-wrap gap-2 md:col-span-3" aria-label="Quick aspect ratios">
                  {[[1, 1], [4, 5], [9, 16], [16, 9], [2, 3], [3, 4]].map(([w, h]) => (
                    <button key={`${w}/${h}`} type="button" data-ratio={`${w}/${h}`} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition hover:border-neutral-950 hover:text-neutral-950" onClick={() => setRatio(w / h)}>{w}:{h}</button>
                  ))}
                </div>
                <button className="primary-button rounded-xl bg-neutral-950 px-4 py-2.5 font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 md:col-span-3 md:w-fit" type="submit" disabled={engine.busy}>Generate custom size</button>
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

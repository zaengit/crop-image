import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useCropEngine, type Generated } from './use-crop-engine'
import type { PresetGroup } from './presets'
import type { EnhancementSettings } from './enhance'
import { EnhancementPanel, enhancementPreviewFilter } from './EnhancementPanel'
import { StoreAssetsPanel } from './StoreAssetsPanel'
import { FocusEditor } from './components/FocusEditor'
import { ColorPicker } from './components/ColorPicker'
import { OutputSettings } from './components/OutputSettings'
import { ResultGrid } from './components/ResultGrid'
import { SizeTabs } from './components/SizeTabs'
import { UploadDropzone } from './components/UploadDropzone'
import { ThemeToggle } from './components/ThemeToggle'

export function App() {
  const engine = useCropEngine()
  const [menu, setMenu] = useState<PresetGroup>('social')
  const [comparing, setComparing] = useState(false)
  const [previewEnhancement, setPreviewEnhancement] = useState<EnhancementSettings>({ ...engine.enhancement })
  const [customWidth, setCustomWidth] = useState(1080)
  const [customHeight, setCustomHeight] = useState(1080)
  const [lockRatio, setLockRatio] = useState(false)
  const [lockedRatio, setLockedRatio] = useState(1)
  const [selectedRatio, setSelectedRatio] = useState<string | null>(null)
  const [customError, setCustomError] = useState('')

  useEffect(() => {
    document.documentElement.dataset.appReady = 'true'
    return () => { delete document.documentElement.dataset.appReady }
  }, [])

  useEffect(() => {
    setPreviewEnhancement({ ...engine.enhancement })
  }, [engine.enhancement])

  const visibleResults = engine.generated.filter((item: Generated) => item.preset.group === menu)
  const generateDisabled = engine.busy || !engine.hasImage
  const backgroundPreparing = /^(Removing|Restoring|Preparing)/.test(engine.backgroundStatus)
  const backgroundGenerateDisabled = generateDisabled || backgroundPreparing
  const isStoreMenu = menu === 'store'

  const processFile = (file: File | undefined) => {
    if (!file) return
    setMenu('social')
    setCustomError('')
    void engine.processFile(file)
  }

  const setRatio = (w: number, h: number) => {
    const ratio = w / h
    setSelectedRatio(`${w}/${h}`)
    setLockedRatio(ratio)
    setLockRatio(true)
    setCustomHeight(Math.max(64, Math.min(8192, Math.round(customWidth / ratio))))
  }

  const updateWidth = (value: number) => {
    setSelectedRatio(null)
    setCustomWidth(value)
    if (lockRatio && lockedRatio) {
      setCustomHeight(Math.max(64, Math.min(8192, Math.round(value / lockedRatio))))
    }
  }

  const updateHeight = (value: number) => {
    setSelectedRatio(null)
    setCustomHeight(value)
    if (lockRatio && lockedRatio) {
      setCustomWidth(Math.max(64, Math.min(8192, Math.round(value * lockedRatio))))
    }
  }

  const submitCustom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (backgroundPreparing) return
    setCustomError(engine.generateCustom(customWidth, customHeight))
  }

  const toggleRatioLock = (event: ChangeEvent<HTMLInputElement>) => {
    const checked = event.currentTarget.checked
    setLockRatio(checked)
    if (!checked) setSelectedRatio(null)
    if (checked) setLockedRatio(customWidth / Math.max(1, customHeight))
  }

  const previewFilter = enhancementPreviewFilter(previewEnhancement, comparing)

  return (
    <main className="app-shell min-h-screen bg-[#f4f4f2] px-4 py-4 text-neutral-950 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-6">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-extrabold tracking-[-0.04em] text-neutral-950" aria-label="Crop">Crop</div>
          <ThemeToggle />
        </div>
        {!isStoreMenu ? (
          <>
            <UploadDropzone busy={engine.busy} status={engine.status} onFile={processFile} />

            <EnhancementPanel
              visible={engine.hasImage}
              settings={engine.enhancement}
              status={engine.enhancementStatus}
              onPreviewChange={setPreviewEnhancement}
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
          </>
        ) : null}

        <section id="results" className="rounded-[28px] border border-neutral-200 bg-white p-4 shadow-[0_20px_55px_rgba(15,23,42,0.06)] sm:p-6">
          {!isStoreMenu ? (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">03 / Generate</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">Choose an output</h2>
              </div>
              <OutputSettings engine={engine} />
            </div>
          ) : null}

          <SizeTabs value={menu} onChange={setMenu} />

          {menu === 'social' ? (
            <section id="social-panel" className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Social media</h3>
                  <p className="text-sm leading-6 text-neutral-600">Adjust the focal point if needed, then generate ready-to-use social media sizes.</p>
                </div>
                <button id="generate-social" className="primary-button rounded-xl bg-neutral-950 px-4 py-2.5 font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={generateDisabled} onClick={() => engine.generateGroup('social')}>Generate crop</button>
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
                <button id="generate-passport" className="primary-button rounded-xl bg-neutral-950 px-4 py-2.5 font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={backgroundGenerateDisabled} onClick={() => engine.generateGroup('passport')}>{backgroundPreparing ? 'Preparing background…' : 'Generate crop'}</button>
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
                    <ColorPicker
                      id="passport-background-color"
                      label="Custom background"
                      value={engine.background}
                      fallback="#e5e7eb"
                      presets={[
                        { label: 'White', value: '#ffffff' },
                        { label: 'Black', value: '#000000' },
                        { label: 'Red', value: '#d71920' },
                        { label: 'Blue', value: '#1769d2' },
                      ]}
                      onChange={(value) => engine.setBackground(value)}
                    />
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
                <p className="text-sm leading-6 text-neutral-600">Create any pixel size while keeping smart crop, your current focal point, and optional background erase.</p>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr]">
                <div>
                  <strong>Erase background</strong>
                  <p className="text-sm leading-6 text-neutral-600">Keep the original image or remove the background and replace it with a solid color.</p>
                </div>
                <div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Custom size background">
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
                        data-custom-background={value}
                        aria-pressed={engine.background === value}
                        onClick={() => engine.setBackground(value)}
                      >
                        {label}
                      </button>
                    ))}
                    <ColorPicker
                      id="custom-background-color"
                      label="Custom background"
                      value={engine.background}
                      fallback="#e5e7eb"
                      presets={[
                        { label: 'White', value: '#ffffff' },
                        { label: 'Black', value: '#000000' },
                        { label: 'Red', value: '#d71920' },
                        { label: 'Blue', value: '#1769d2' },
                      ]}
                      onChange={(value) => engine.setBackground(value)}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600" aria-live="polite">
                    {engine.background !== 'original' ? <span className="inline-block size-3 rounded-full border border-neutral-300" style={{ backgroundColor: engine.background }} aria-hidden="true" /> : null}
                    <span>{backgroundPreparing ? engine.backgroundStatus : engine.background === 'original' ? 'Erase background off — original image will be used.' : `Erase background on — ${engine.background.toUpperCase()} is ready.`}</span>
                  </div>
                </div>
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
                <div className="flex flex-wrap gap-2 md:col-span-3" role="group" aria-label="Quick aspect ratios">
                  {[[1, 1], [4, 5], [9, 16], [16, 9], [2, 3], [3, 4]].map(([w, h]) => {
                    const ratioKey = `${w}/${h}`
                    const isActive = selectedRatio === ratioKey
                    return (
                      <button
                        key={ratioKey}
                        type="button"
                        data-ratio={ratioKey}
                        aria-pressed={isActive}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${isActive ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-950 hover:text-neutral-950'}`}
                        onClick={() => setRatio(w, h)}
                      >
                        {w}:{h}
                      </button>
                    )
                  })}
                </div>
                <button className="primary-button rounded-xl bg-neutral-950 px-4 py-2.5 font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 md:col-span-3 md:w-fit" type="submit" disabled={backgroundGenerateDisabled}>{backgroundPreparing ? 'Preparing background…' : 'Generate custom size'}</button>
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

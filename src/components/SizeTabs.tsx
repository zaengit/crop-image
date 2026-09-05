import type { PresetGroup } from '../presets'

const tabs: Array<[PresetGroup, string]> = [
  ['social', 'Social media'],
  ['passport', 'Passport photo'],
  ['custom', 'Custom'],
  ['store', 'App Store assets'],
]

type SizeTabsProps = {
  value: PresetGroup
  onChange: (value: PresetGroup) => void
}

export function SizeTabs({ value, onChange }: SizeTabsProps) {
  return (
    <nav className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Image size categories">
      {tabs.map(([tabValue, label]) => (
        <button
          key={tabValue}
          className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm ${value === tabValue ? 'bg-cyan-600 font-semibold text-white' : 'border border-slate-300 text-slate-700'}`}
          type="button"
          data-menu={tabValue}
          aria-pressed={value === tabValue}
          onClick={() => onChange(tabValue)}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}

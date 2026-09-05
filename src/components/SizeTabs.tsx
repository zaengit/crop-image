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
    <nav className="mt-5 flex gap-1 overflow-x-auto rounded-2xl border border-neutral-200 bg-neutral-100 p-1" aria-label="Image size categories">
      {tabs.map(([tabValue, label]) => (
        <button
          key={tabValue}
          className={`min-h-11 whitespace-nowrap rounded-xl px-4 py-2 text-sm transition ${value === tabValue ? 'bg-neutral-950 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-white hover:text-neutral-950'}`}
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

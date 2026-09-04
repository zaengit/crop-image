export type PresetGroup = 'social' | 'passport' | 'custom'

export type ImagePreset = {
  id: string
  group: PresetGroup
  platform: string
  label: string
  width: number
  height: number
  safeTop?: number
  safeBottom?: number
  facePadding?: number
}

export type SocialPreset = ImagePreset

export const SOCIAL_PRESETS: ImagePreset[] = [
  { id: 'instagram-square', group: 'social', platform: 'Instagram', label: 'Square Post', width: 1080, height: 1080, facePadding: 0.12 },
  { id: 'instagram-portrait', group: 'social', platform: 'Instagram', label: 'Portrait Post', width: 1080, height: 1350, facePadding: 0.14 },
  { id: 'instagram-story', group: 'social', platform: 'Instagram', label: 'Story / Reel', width: 1080, height: 1920, safeTop: 0.14, safeBottom: 0.20, facePadding: 0.16 },
  { id: 'tiktok-video', group: 'social', platform: 'TikTok', label: 'Video', width: 1080, height: 1920, safeTop: 0.12, safeBottom: 0.24, facePadding: 0.16 },
  { id: 'youtube-thumbnail', group: 'social', platform: 'YouTube', label: 'Thumbnail', width: 1280, height: 720, facePadding: 0.10 },
  { id: 'x-landscape', group: 'social', platform: 'X', label: 'Landscape Post', width: 1600, height: 900, facePadding: 0.10 },
  { id: 'facebook-post', group: 'social', platform: 'Facebook', label: 'Landscape Post', width: 1200, height: 630, facePadding: 0.10 },
  { id: 'linkedin-post', group: 'social', platform: 'LinkedIn', label: 'Landscape Post', width: 1200, height: 627, facePadding: 0.10 },
  { id: 'linkedin-square', group: 'social', platform: 'LinkedIn', label: 'Square Post', width: 1200, height: 1200, facePadding: 0.12 },
]

export const PASSPORT_PRESETS: ImagePreset[] = [
  { id: 'passport-2x3', group: 'passport', platform: 'Passport photo', label: '2 × 3', width: 400, height: 600, safeTop: 0.08, safeBottom: 0.05, facePadding: 0.20 },
  { id: 'passport-3x4', group: 'passport', platform: 'Passport photo', label: '3 × 4', width: 600, height: 800, safeTop: 0.08, safeBottom: 0.05, facePadding: 0.20 },
  { id: 'passport-4x6', group: 'passport', platform: 'Passport photo', label: '4 × 6', width: 800, height: 1200, safeTop: 0.08, safeBottom: 0.05, facePadding: 0.20 },
]

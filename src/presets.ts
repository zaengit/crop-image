export type SocialPreset = {
  id: string
  platform: string
  label: string
  width: number
  height: number
  safeTop?: number
  safeBottom?: number
  facePadding?: number
}

export const SOCIAL_PRESETS: SocialPreset[] = [
  { id: 'instagram-square', platform: 'Instagram', label: 'Square Post', width: 1080, height: 1080, facePadding: 0.12 },
  { id: 'instagram-portrait', platform: 'Instagram', label: 'Portrait Post', width: 1080, height: 1350, facePadding: 0.14 },
  { id: 'instagram-story', platform: 'Instagram', label: 'Story / Reel', width: 1080, height: 1920, safeTop: 0.14, safeBottom: 0.20, facePadding: 0.16 },
  { id: 'tiktok-video', platform: 'TikTok', label: 'Video', width: 1080, height: 1920, safeTop: 0.12, safeBottom: 0.24, facePadding: 0.16 },
  { id: 'youtube-thumbnail', platform: 'YouTube', label: 'Thumbnail', width: 1280, height: 720, facePadding: 0.10 },
  { id: 'x-landscape', platform: 'X', label: 'Landscape Post', width: 1600, height: 900, facePadding: 0.10 },
  { id: 'facebook-post', platform: 'Facebook', label: 'Landscape Post', width: 1200, height: 630, facePadding: 0.10 },
  { id: 'linkedin-post', platform: 'LinkedIn', label: 'Landscape Post', width: 1200, height: 627, facePadding: 0.10 },
  { id: 'linkedin-square', platform: 'LinkedIn', label: 'Square Post', width: 1200, height: 1200, facePadding: 0.12 }
]

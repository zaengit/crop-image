export type SocialPreset = {
  id: string
  platform: string
  label: string
  width: number
  height: number
}

export const SOCIAL_PRESETS: SocialPreset[] = [
  { id: 'instagram-square', platform: 'Instagram', label: 'Square Post', width: 1080, height: 1080 },
  { id: 'instagram-portrait', platform: 'Instagram', label: 'Portrait Post', width: 1080, height: 1350 },
  { id: 'instagram-story', platform: 'Instagram', label: 'Story / Reel', width: 1080, height: 1920 },
  { id: 'tiktok-video', platform: 'TikTok', label: 'Video', width: 1080, height: 1920 },
  { id: 'youtube-thumbnail', platform: 'YouTube', label: 'Thumbnail', width: 1280, height: 720 },
  { id: 'x-landscape', platform: 'X', label: 'Landscape Post', width: 1600, height: 900 },
  { id: 'facebook-post', platform: 'Facebook', label: 'Landscape Post', width: 1200, height: 630 },
  { id: 'linkedin-post', platform: 'LinkedIn', label: 'Landscape Post', width: 1200, height: 627 },
  { id: 'linkedin-square', platform: 'LinkedIn', label: 'Square Post', width: 1200, height: 1200 }
]

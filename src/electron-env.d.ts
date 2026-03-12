import type { SkillviewerApi } from './shared/contracts'

declare global {
  interface Window {
    skillviewer: SkillviewerApi
  }
}

export {}

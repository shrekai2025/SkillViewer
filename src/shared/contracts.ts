export type SourceKind = 'global' | 'application' | 'custom'

export type DetailMode = 'preview' | 'source' | 'edit'

export interface SkillSource {
  id: string
  kind: SourceKind
  label: string
  path: string
  system: boolean
}

export interface SkillFrontmatterEntry {
  key: string
  value: string
}

export interface SkillRecord {
  id: string
  sourceId: string
  sourceKind: SourceKind
  sourceLabel: string
  directoryPath: string
  fileName: 'SKILL.md' | 'SKILL.disabled.md'
  filePath: string
  relativePath: string
  name: string
  description: string
  addedAt: string
  updatedAt: string
  enabled: boolean
  systemDisabled: boolean
  rawContent: string
  markdownBody: string
  frontmatter: SkillFrontmatterEntry[]
}

export interface AppSnapshot {
  sources: SkillSource[]
  skills: SkillRecord[]
  lastRefreshedAt: string
}

export interface SaveSkillPayload {
  filePath: string
  rawContent: string
}

export interface ToggleSkillPayload {
  enable: boolean
  filePath: string
}

export interface SkillviewerApi {
  addSource: () => Promise<AppSnapshot>
  getSnapshot: () => Promise<AppSnapshot>
  removeSource: (sourceId: string) => Promise<AppSnapshot>
  revealSkill: (filePath: string) => Promise<void>
  saveSkill: (payload: SaveSkillPayload) => Promise<SkillRecord>
  toggleSkill: (payload: ToggleSkillPayload) => Promise<SkillRecord>
}

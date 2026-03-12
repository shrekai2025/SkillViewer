export type SourceKind = 'global' | 'application' | 'custom'

export type DetailMode = 'preview' | 'source' | 'edit'

export type AppTab = 'library' | 'market'

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

export interface InstalledMarketMetadata {
  downloadUrl: string
  homepageUrl?: string
  installedAt: string
  name: string
  registryId: string
  registryLabel: string
  skillId: string
  slug: string
  updatedAt: string
  version: string
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
  marketOrigin?: InstalledMarketMetadata
}

export interface AppSnapshot {
  sources: SkillSource[]
  skills: SkillRecord[]
  lastRefreshedAt: string
}

export interface MarketRegistry {
  id: string
  label: string
  manifestUrl: string
  enabled: boolean
  system: boolean
  status: 'disabled' | 'error' | 'ready'
  error?: string
}

export interface MarketSkill {
  id: string
  slug: string
  name: string
  description: string
  author: string
  version: string
  registryId: string
  registryLabel: string
  downloadUrl: string
  homepageUrl?: string
  tags: string[]
}

export interface MarketSnapshot {
  registries: MarketRegistry[]
  installBaseDir: string
  lastRefreshedAt: string
}

export interface BrowseMarketSkillsPayload {
  cursor?: string | null
  limit?: number
  query?: string
  registryId?: string
}

export interface BrowseMarketSkillsResult {
  cursor: string | null
  hasMore: boolean
  lastRefreshedAt: string
  skills: MarketSkill[]
}

export interface SaveSkillPayload {
  filePath: string
  rawContent: string
}

export interface ToggleSkillPayload {
  enable: boolean
  filePath: string
}

export interface AddMarketRegistryPayload {
  label: string
  manifestUrl: string
}

export interface ToggleMarketRegistryPayload {
  enabled: boolean
  registryId: string
}

export interface InstallMarketSkillPayload {
  skill: MarketSkill
}

export interface InstallMarketSkillResult {
  installedPath: string
}

export interface SkillUpdateStatus {
  checkedAt: string
  currentVersion: string
  filePath: string
  latestSkill: MarketSkill
  latestVersion: string
  updateAvailable: boolean
}

export interface UpdateInstalledSkillPayload {
  filePath: string
}

export interface SkillviewerApi {
  addSource: () => Promise<AppSnapshot>
  addMarketRegistry: (payload: AddMarketRegistryPayload) => Promise<MarketSnapshot>
  browseMarketSkills: (payload: BrowseMarketSkillsPayload) => Promise<BrowseMarketSkillsResult>
  checkSkillUpdates: () => Promise<SkillUpdateStatus[]>
  getSnapshot: () => Promise<AppSnapshot>
  getMarketSnapshot: () => Promise<MarketSnapshot>
  installMarketSkill: (payload: InstallMarketSkillPayload) => Promise<InstallMarketSkillResult>
  openExternal: (url: string) => Promise<void>
  removeMarketRegistry: (registryId: string) => Promise<MarketSnapshot>
  removeSource: (sourceId: string) => Promise<AppSnapshot>
  revealSkill: (filePath: string) => Promise<void>
  saveSkill: (payload: SaveSkillPayload) => Promise<SkillRecord>
  toggleMarketRegistry: (payload: ToggleMarketRegistryPayload) => Promise<MarketSnapshot>
  toggleSkill: (payload: ToggleSkillPayload) => Promise<SkillRecord>
  updateInstalledSkill: (payload: UpdateInstalledSkillPayload) => Promise<InstallMarketSkillResult>
}

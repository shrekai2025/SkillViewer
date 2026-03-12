import { createHash } from 'node:crypto'
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import extract from 'extract-zip'
import fg from 'fast-glob'

import type {
  AddMarketRegistryPayload,
  BrowseMarketSkillsPayload,
  BrowseMarketSkillsResult,
  InstallMarketSkillPayload,
  InstallMarketSkillResult,
  MarketRegistry,
  MarketSkill,
  MarketSnapshot,
  ToggleMarketRegistryPayload,
} from '../src/shared/contracts'
import {
  readAppState,
  type PersistedMarketRegistry,
  writeAppState,
} from './state-store'

interface BuiltInRegistryDefinition {
  enabled: boolean
  id: string
  label: string
  manifestUrl: string
}

interface RegistryBrowseState {
  done?: boolean
  offset?: number
  page?: number
  pendingSkills?: MarketSkill[]
}

interface MarketBrowseCursorState {
  currentRegistryIndex: number
  query: string
  registryId: string
  registryStates: Record<string, RegistryBrowseState>
  seenSkillNames: string[]
}

interface RegistryBrowseResult {
  hasMore: boolean
  nextState: RegistryBrowseState
  skills: MarketSkill[]
}

type JsonRecord = Record<string, unknown>

const BUILT_IN_REGISTRIES: BuiltInRegistryDefinition[] = [
  {
    enabled: true,
    id: 'builtin-claude-plugins',
    label: 'Claude Plugins',
    manifestUrl: 'https://claude-plugins.dev/api/skills',
  },
  {
    enabled: true,
    id: 'builtin-skillsllm',
    label: 'SkillsLLM',
    manifestUrl: 'https://skillsllm.com/api/skills',
  },
]

const LEGACY_BUILT_IN_REGISTRY_IDS = new Set(['builtin-curated', 'builtin-labs'])

function createRegistryId(seed: string) {
  return `market-${createHash('sha1').update(seed).digest('hex').slice(0, 10)}`
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeQuery(query: string | undefined) {
  return query?.trim().toLowerCase() ?? ''
}

function getInstallBaseDir() {
  return path.join(homedir(), '.Agents', 'skills')
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

function isRemoteManifest(manifestUrl: string) {
  return /^https?:\/\//i.test(manifestUrl)
}

function isClaudePluginsRegistry(manifestUrl: string) {
  return isHostMatch(manifestUrl, 'claude-plugins.dev', '/api/skills')
}

function isSkillsllmRegistry(manifestUrl: string) {
  return isHostMatch(manifestUrl, 'skillsllm.com', '/api/skills')
}

function isSkillsmpRegistry(manifestUrl: string) {
  return isHostMatch(manifestUrl, 'skillsmp.com', '/api/v1/skills/search')
}

function getDefaultBuiltInRegistries() {
  return BUILT_IN_REGISTRIES.map((definition) => ({
    enabled: definition.enabled,
    id: definition.id,
    label: definition.label,
    manifestUrl: definition.manifestUrl,
    system: true,
  }))
}

function mergeRegistries(persistedRegistries: PersistedMarketRegistry[]) {
  const defaults = getDefaultBuiltInRegistries()
  const persistedById = new Map(persistedRegistries.map((registry) => [registry.id, registry]))
  const merged: PersistedMarketRegistry[] = []

  for (const builtIn of defaults) {
    const persisted = persistedById.get(builtIn.id)
    merged.push({
      ...builtIn,
      enabled: persisted?.enabled ?? builtIn.enabled,
    })
  }

  for (const persisted of persistedRegistries) {
    if (defaults.some((builtIn) => builtIn.id === persisted.id)) {
      continue
    }

    if (LEGACY_BUILT_IN_REGISTRY_IDS.has(persisted.id)) {
      continue
    }

    merged.push({
      ...persisted,
      system: false,
    })
  }

  return merged
}

async function readRegistries() {
  const state = await readAppState()
  return mergeRegistries(state.marketRegistries)
}

async function writeRegistries(registries: PersistedMarketRegistry[]) {
  const state = await readAppState()
  await writeAppState({
    ...state,
    marketRegistries: registries,
  })
}

function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord
  }

  return null
}

function getStringValue(value: unknown, keys: string[]) {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  return null
}

function getNumberValue(value: unknown, keys: string[]) {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate
    }
  }

  return null
}

function getStringArrayValue(value: unknown, key: string) {
  const record = asRecord(value)
  const candidate = record?.[key]

  if (!Array.isArray(candidate)) {
    return []
  }

  return candidate
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function buildMarketSkill(
  registry: PersistedMarketRegistry,
  input: {
    author?: string | null
    description?: string | null
    downloadUrl?: string | null
    homepageUrl?: string | null
    id?: string | null
    name?: string | null
    slug?: string | null
    tags?: string[] | null
    version?: string | null
  },
) {
  const name = input.name?.trim()
  const downloadUrl = input.downloadUrl?.trim()

  if (!name || !downloadUrl) {
    return null
  }

  const slug = input.slug?.trim() || slugify(name)
  const baseId = input.id?.trim() || slug

  return {
    author: input.author?.trim() || 'Unknown',
    description: input.description?.trim() || 'No description provided.',
    downloadUrl,
    homepageUrl: input.homepageUrl?.trim(),
    id: `${registry.id}:${baseId}`,
    name,
    registryId: registry.id,
    registryLabel: registry.label,
    slug,
    tags: input.tags?.filter(Boolean) ?? [],
    version: input.version?.trim() || 'latest',
  } satisfies MarketSkill
}

async function readManifestSource(manifestUrl: string) {
  if (isRemoteManifest(manifestUrl)) {
    const response = await fetch(manifestUrl)
    if (!response.ok) {
      throw new Error(`Registry request failed with status ${response.status}.`)
    }

    return {
      baseReference: manifestUrl,
      rawContent: await response.text(),
    }
  }

  const filePath = manifestUrl.startsWith('file://')
    ? fileURLToPath(manifestUrl)
    : manifestUrl

  return {
    baseReference: filePath,
    rawContent: await readFile(filePath, 'utf8'),
  }
}

async function readJsonSource(manifestUrl: string) {
  const { baseReference, rawContent } = await readManifestSource(manifestUrl)

  return {
    baseReference,
    parsed: JSON.parse(rawContent) as unknown,
  }
}

function resolveManifestUrl(downloadUrl: string, baseReference: string) {
  if (
    /^https?:\/\//i.test(downloadUrl) ||
    downloadUrl.startsWith('file://') ||
    path.isAbsolute(downloadUrl)
  ) {
    return downloadUrl
  }

  if (isRemoteManifest(baseReference)) {
    return new URL(downloadUrl, baseReference).toString()
  }

  return path.join(path.dirname(baseReference), downloadUrl)
}

function dedupeSkills(skills: MarketSkill[]) {
  const deduped = new Map<string, MarketSkill>()

  for (const skill of skills) {
    const key = skill.name.trim().toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, skill)
    }
  }

  return [...deduped.values()]
}

function matchesMarketSkillQuery(skill: MarketSkill, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true
  }

  return [
    skill.name,
    skill.description,
    skill.author,
    skill.registryLabel,
    skill.homepageUrl ?? '',
    skill.downloadUrl,
    ...skill.tags,
  ].some((value) => value.toLowerCase().includes(normalizedQuery))
}

function parseCustomManifestSkills(
  parsed: unknown,
  registry: PersistedMarketRegistry,
  baseReference: string,
) {
  const record = asRecord(parsed)
  const rawSkills = Array.isArray(record?.skills) ? record.skills : []

  return rawSkills.flatMap((skill): MarketSkill[] => {
    const item = asRecord(skill)
    if (!item) {
      return []
    }

    const nextSkill = buildMarketSkill(registry, {
      author: getStringValue(item, ['author']),
      description: getStringValue(item, ['description']),
      downloadUrl:
        item.downloadUrl !== undefined
          ? resolveManifestUrl(String(item.downloadUrl), baseReference)
          : null,
      homepageUrl: getStringValue(item, ['homepageUrl']),
      id: getStringValue(item, ['id']),
      name: getStringValue(item, ['name']),
      slug: getStringValue(item, ['slug']),
      tags: getStringArrayValue(item, 'tags'),
      version: getStringValue(item, ['version']),
    })

    return nextSkill ? [nextSkill] : []
  })
}

function parseClaudePluginsSkills(parsed: unknown, registry: PersistedMarketRegistry) {
  const record = asRecord(parsed)
  const rawSkills = Array.isArray(record?.skills) ? record.skills : []

  return rawSkills.flatMap((skill): MarketSkill[] => {
    const item = asRecord(skill)
    if (!item) {
      return []
    }

    const metadata = asRecord(item.metadata)
    const namespace = getStringValue(item, ['namespace'])
    const tags = namespace ? namespace.split('/').filter(Boolean).slice(-2) : []
    const nextSkill = buildMarketSkill(registry, {
      author: getStringValue(item, ['author']),
      description: getStringValue(item, ['description']),
      downloadUrl: getStringValue(item, ['sourceUrl']) ?? getStringValue(metadata, ['rawFileUrl']),
      homepageUrl: getStringValue(item, ['sourceUrl']),
      id: getStringValue(item, ['id']),
      name: getStringValue(item, ['name']),
      slug: namespace?.split('/').filter(Boolean).at(-1) ?? getStringValue(item, ['id']),
      tags,
      version: getStringValue(item, ['version']),
    })

    return nextSkill ? [nextSkill] : []
  })
}

function parseSkillsllmSkills(parsed: unknown, registry: PersistedMarketRegistry) {
  const record = asRecord(parsed)
  const rawSkills = Array.isArray(record?.skills) ? record.skills : []

  return rawSkills.flatMap((skill): MarketSkill[] => {
    const item = asRecord(skill)
    if (!item) {
      return []
    }

    const hasSkillMd = item.hasSkillMd === true || typeof item.skillMdContent === 'string'
    if (!hasSkillMd) {
      return []
    }

    const repoOwner = getStringValue(item, ['repoOwner', 'githubOwner', 'author'])
    const repoName = getStringValue(item, ['repoName', 'githubRepo', 'repo'])
    const nextSkill = buildMarketSkill(registry, {
      author: repoOwner,
      description: getStringValue(item, ['description', 'summary']),
      downloadUrl: getStringValue(item, ['repoUrl', 'githubUrl', 'sourceUrl']),
      homepageUrl: getStringValue(item, ['repoUrl', 'githubUrl']),
      id: getStringValue(item, ['id', 'slug']),
      name: getStringValue(item, ['name', 'title']) ?? repoName,
      slug: getStringValue(item, ['slug']) ?? repoName,
      tags: getStringArrayValue(item, 'topics'),
      version: null,
    })

    return nextSkill ? [nextSkill] : []
  })
}

function isHostMatch(manifestUrl: string, host: string, pathnamePrefix: string) {
  try {
    const url = new URL(manifestUrl)
    return url.hostname === host && url.pathname.startsWith(pathnamePrefix)
  } catch {
    return false
  }
}

async function loadManifestSkillCollection(registry: PersistedMarketRegistry) {
  const { baseReference, parsed } = await readJsonSource(registry.manifestUrl)
  const customSkills = parseCustomManifestSkills(parsed, registry, baseReference)
  if (customSkills.length > 0) {
    return dedupeSkills(customSkills)
  }

  const claudeSkills = parseClaudePluginsSkills(parsed, registry)
  if (claudeSkills.length > 0) {
    return dedupeSkills(claudeSkills)
  }

  const skillsllmSkills = parseSkillsllmSkills(parsed, registry)
  return dedupeSkills(skillsllmSkills)
}

function takeFromPending(state: RegistryBrowseState, limit: number) {
  const pendingSkills = state.pendingSkills ?? []
  if (pendingSkills.length === 0) {
    return {
      nextState: state,
      skills: [] as MarketSkill[],
    }
  }

  const skills = pendingSkills.slice(0, limit)
  const remaining = pendingSkills.slice(limit)

  return {
    nextState: {
      ...state,
      pendingSkills: remaining,
    } satisfies RegistryBrowseState,
    skills,
  }
}

async function browseManifestRegistry(
  registry: PersistedMarketRegistry,
  query: string,
  state: RegistryBrowseState,
  limit: number,
) {
  const loaded = takeFromPending(state, limit)
  if (loaded.skills.length >= limit) {
    return {
      hasMore: (loaded.nextState.pendingSkills?.length ?? 0) > 0 || !loaded.nextState.done,
      nextState: loaded.nextState,
      skills: loaded.skills,
    } satisfies RegistryBrowseResult
  }

  if (loaded.nextState.done) {
    return {
      hasMore: false,
      nextState: loaded.nextState,
      skills: loaded.skills,
    } satisfies RegistryBrowseResult
  }

  const normalizedQuery = normalizeQuery(query)
  const allSkills = (await loadManifestSkillCollection(registry)).filter((skill) =>
    matchesMarketSkillQuery(skill, normalizedQuery),
  )
  const nextOffset = loaded.nextState.offset ?? 0
  const pageSkills = allSkills.slice(nextOffset, nextOffset + (limit - loaded.skills.length))
  const resolvedOffset = nextOffset + pageSkills.length
  const nextState = {
    done: resolvedOffset >= allSkills.length,
    offset: resolvedOffset,
    pendingSkills: loaded.nextState.pendingSkills ?? [],
  } satisfies RegistryBrowseState

  return {
    hasMore: !nextState.done || (nextState.pendingSkills?.length ?? 0) > 0,
    nextState,
    skills: [...loaded.skills, ...pageSkills],
  } satisfies RegistryBrowseResult
}

async function browseClaudeRegistry(
  registry: PersistedMarketRegistry,
  query: string,
  state: RegistryBrowseState,
  limit: number,
) {
  const loaded = takeFromPending(state, limit)
  if (loaded.skills.length >= limit) {
    return {
      hasMore: (loaded.nextState.pendingSkills?.length ?? 0) > 0 || !loaded.nextState.done,
      nextState: loaded.nextState,
      skills: loaded.skills,
    } satisfies RegistryBrowseResult
  }

  if (loaded.nextState.done) {
    return {
      hasMore: false,
      nextState: loaded.nextState,
      skills: loaded.skills,
    } satisfies RegistryBrowseResult
  }

  const baseUrl = new URL(registry.manifestUrl)
  const offset = loaded.nextState.offset ?? Number(baseUrl.searchParams.get('offset') ?? '0')
  const remaining = limit - loaded.skills.length

  baseUrl.searchParams.set('limit', String(remaining))
  baseUrl.searchParams.set('offset', String(offset))
  if (query.trim().length > 0) {
    baseUrl.searchParams.set('q', query.trim())
  } else {
    baseUrl.searchParams.delete('q')
  }

  const response = await fetch(baseUrl.toString())
  if (!response.ok) {
    throw new Error(`Registry request failed with status ${response.status}.`)
  }

  const parsed = (await response.json()) as unknown
  const parsedSkills = parseClaudePluginsSkills(parsed, registry)
  const total = getNumberValue(parsed, ['total'])
  const nextOffset = offset + parsedSkills.length
  const done =
    typeof total === 'number'
      ? nextOffset >= total
      : parsedSkills.length < remaining

  return {
    hasMore: !done,
    nextState: {
      done,
      offset: nextOffset,
      pendingSkills: [],
    } satisfies RegistryBrowseState,
    skills: [...loaded.skills, ...parsedSkills],
  } satisfies RegistryBrowseResult
}

async function browseSkillsllmRegistry(
  registry: PersistedMarketRegistry,
  query: string,
  state: RegistryBrowseState,
  limit: number,
) {
  const loaded = takeFromPending(state, limit)
  if (loaded.skills.length >= limit) {
    return {
      hasMore: (loaded.nextState.pendingSkills?.length ?? 0) > 0 || !loaded.nextState.done,
      nextState: loaded.nextState,
      skills: loaded.skills,
    } satisfies RegistryBrowseResult
  }

  if (loaded.nextState.done) {
    return {
      hasMore: false,
      nextState: loaded.nextState,
      skills: loaded.skills,
    } satisfies RegistryBrowseResult
  }

  const normalizedQuery = normalizeQuery(query)
  const baseUrl = new URL(registry.manifestUrl)
  const upstreamLimit = Math.min(
    50,
    Math.max(limit - loaded.skills.length, Number(baseUrl.searchParams.get('limit') ?? '30')),
  )
  let nextPage = loaded.nextState.page ?? Number(baseUrl.searchParams.get('page') ?? '1')
  const collected = [...loaded.skills]
  let pendingSkills = loaded.nextState.pendingSkills ?? []
  let done = false

  while (collected.length < limit && !done) {
    const nextUrl = new URL(baseUrl.toString())
    nextUrl.searchParams.set('page', String(nextPage))
    nextUrl.searchParams.set('limit', String(upstreamLimit))
    if (query.trim().length > 0) {
      nextUrl.searchParams.set('q', query.trim())
    } else {
      nextUrl.searchParams.delete('q')
    }

    const response = await fetch(nextUrl.toString())
    if (!response.ok) {
      throw new Error(`Registry request failed with status ${response.status}.`)
    }

    const parsed = (await response.json()) as unknown
    const parsedSkills = parseSkillsllmSkills(parsed, registry).filter((skill) =>
      matchesMarketSkillQuery(skill, normalizedQuery),
    )
    const pagination = asRecord(asRecord(parsed)?.pagination)
    const totalPages = getNumberValue(pagination, ['pages']) ?? nextPage
    nextPage += 1

    const remaining = limit - collected.length
    if (parsedSkills.length <= remaining) {
      collected.push(...parsedSkills)
    } else {
      collected.push(...parsedSkills.slice(0, remaining))
      pendingSkills = parsedSkills.slice(remaining)
    }

    done = nextPage > totalPages
  }

  return {
    hasMore: pendingSkills.length > 0 || !done,
    nextState: {
      done,
      page: nextPage,
      pendingSkills,
    } satisfies RegistryBrowseState,
    skills: collected,
  } satisfies RegistryBrowseResult
}

async function browseRegistrySkills(
  registry: PersistedMarketRegistry,
  query: string,
  state: RegistryBrowseState,
  limit: number,
) {
  if (limit <= 0) {
    return {
      hasMore: !state.done || (state.pendingSkills?.length ?? 0) > 0,
      nextState: state,
      skills: [],
    } satisfies RegistryBrowseResult
  }

  if (isClaudePluginsRegistry(registry.manifestUrl)) {
    return browseClaudeRegistry(registry, query, state, limit)
  }

  if (isSkillsllmRegistry(registry.manifestUrl)) {
    return browseSkillsllmRegistry(registry, query, state, limit)
  }

  if (isSkillsmpRegistry(registry.manifestUrl)) {
    throw new Error('SkillsMP requires an API key. Authenticated registries are not supported yet.')
  }

  return browseManifestRegistry(registry, query, state, limit)
}

async function probeRegistryStatus(registry: PersistedMarketRegistry) {
  if (!registry.enabled) {
    return {
      ...registry,
      error: undefined,
      status: 'disabled',
    } satisfies MarketRegistry
  }

  try {
    if (isClaudePluginsRegistry(registry.manifestUrl)) {
      const url = new URL(registry.manifestUrl)
      url.searchParams.set('limit', '1')
      url.searchParams.set('offset', '0')
      const response = await fetch(url.toString())
      if (!response.ok) {
        throw new Error(`Registry request failed with status ${response.status}.`)
      }
    } else if (isSkillsllmRegistry(registry.manifestUrl)) {
      const url = new URL(registry.manifestUrl)
      url.searchParams.set('limit', '1')
      url.searchParams.set('page', '1')
      const response = await fetch(url.toString())
      if (!response.ok) {
        throw new Error(`Registry request failed with status ${response.status}.`)
      }
    } else if (isSkillsmpRegistry(registry.manifestUrl)) {
      throw new Error('SkillsMP requires an API key. Authenticated registries are not supported yet.')
    } else {
      await readJsonSource(registry.manifestUrl)
    }

    return {
      ...registry,
      error: undefined,
      status: 'ready',
    } satisfies MarketRegistry
  } catch (error) {
    return {
      ...registry,
      error: error instanceof Error ? error.message : 'Unable to load registry.',
      status: 'error',
    } satisfies MarketRegistry
  }
}

function sortRegistriesForBrowse(registries: PersistedMarketRegistry[]) {
  return [...registries].sort((left, right) => {
    const leftRemote = isRemoteManifest(left.manifestUrl)
    const rightRemote = isRemoteManifest(right.manifestUrl)

    if (leftRemote !== rightRemote) {
      return leftRemote ? -1 : 1
    }

    if (left.system !== right.system) {
      return left.system ? 1 : -1
    }

    return left.label.localeCompare(right.label)
  })
}

function encodeCursor(state: MarketBrowseCursorState) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(
  cursor: string | null | undefined,
  query: string,
  registryId: string,
) {
  if (!cursor) {
    return null
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as MarketBrowseCursorState

    if (decoded.query !== query || decoded.registryId !== registryId) {
      return null
    }

    return decoded
  } catch {
    return null
  }
}

export async function getMarketSnapshot() {
  const registries = await readRegistries()
  const resolvedRegistries = await Promise.all(
    registries.map((registry) => probeRegistryStatus(registry)),
  )

  return {
    installBaseDir: getInstallBaseDir(),
    lastRefreshedAt: new Date().toISOString(),
    registries: resolvedRegistries,
  } satisfies MarketSnapshot
}

export async function browseMarketSkills(payload: BrowseMarketSkillsPayload) {
  const limit = Math.max(1, Math.min(payload.limit ?? 18, 48))
  const query = payload.query?.trim() ?? ''
  const registryId = payload.registryId?.trim() || 'all'
  const registries = sortRegistriesForBrowse(
    (await readRegistries()).filter((registry) => registry.enabled),
  )
  const targetRegistries =
    registryId === 'all'
      ? registries
      : registries.filter((registry) => registry.id === registryId)

  const cursorState = decodeCursor(payload.cursor, query, registryId) ?? {
    currentRegistryIndex: 0,
    query,
    registryId,
    registryStates: {},
    seenSkillNames: [],
  }

  const seenSkillNames = new Set(cursorState.seenSkillNames)
  const registryStates = { ...cursorState.registryStates }
  const skills: MarketSkill[] = []
  let currentRegistryIndex = cursorState.currentRegistryIndex
  let safetyCounter = 0

  while (skills.length < limit && currentRegistryIndex < targetRegistries.length) {
    const registry = targetRegistries[currentRegistryIndex]
    const currentState = registryStates[registry.id] ?? {}
    safetyCounter += 1

    if (safetyCounter > targetRegistries.length * 8) {
      break
    }

    let page: RegistryBrowseResult
    try {
      page = await browseRegistrySkills(registry, query, currentState, limit - skills.length)
    } catch {
      registryStates[registry.id] = {
        done: true,
        pendingSkills: [],
      }
      currentRegistryIndex += 1
      continue
    }

    for (const skill of page.skills) {
      const skillKey = skill.name.trim().toLowerCase()
      if (seenSkillNames.has(skillKey)) {
        continue
      }

      seenSkillNames.add(skillKey)
      skills.push(skill)

      if (skills.length >= limit) {
        break
      }
    }

    registryStates[registry.id] = page.nextState

    if (!page.hasMore) {
      currentRegistryIndex += 1
    }
  }

  const hasMore = currentRegistryIndex < targetRegistries.length
  const cursor = hasMore
    ? encodeCursor({
        currentRegistryIndex,
        query,
        registryId,
        registryStates,
        seenSkillNames: [...seenSkillNames],
      })
    : null

  return {
    cursor,
    hasMore,
    lastRefreshedAt: new Date().toISOString(),
    skills,
  } satisfies BrowseMarketSkillsResult
}

export async function addMarketRegistry(payload: AddMarketRegistryPayload) {
  const manifestUrl = payload.manifestUrl.trim()
  const label = payload.label.trim() || manifestUrl

  if (!manifestUrl) {
    throw new Error('Registry manifest URL is required.')
  }

  const registries = await readRegistries()
  const nextRegistries = mergeRegistries([
    ...registries.filter((registry) => !registry.system),
    {
      enabled: true,
      id: createRegistryId(manifestUrl),
      label,
      manifestUrl,
      system: false,
    },
    ...registries.filter((registry) => registry.system),
  ])

  await writeRegistries(nextRegistries)
  return getMarketSnapshot()
}

export async function removeMarketRegistry(registryId: string) {
  const registries = await readRegistries()
  const nextRegistries = registries.filter((registry) => registry.system || registry.id !== registryId)
  await writeRegistries(nextRegistries)
  return getMarketSnapshot()
}

export async function toggleMarketRegistry(payload: ToggleMarketRegistryPayload) {
  const registries = await readRegistries()
  const nextRegistries = registries.map((registry) =>
    registry.id === payload.registryId
      ? {
          ...registry,
          enabled: payload.enabled,
        }
      : registry,
  )

  await writeRegistries(nextRegistries)
  return getMarketSnapshot()
}

function getGitHubArchiveUrl(downloadUrl: string) {
  try {
    const parsed = new URL(downloadUrl)
    if (parsed.hostname !== 'github.com') {
      return null
    }

    const parts = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean)
    if (parts.length < 2) {
      return null
    }

    const owner = parts[0]
    const repo = parts[1].replace(/\.git$/i, '')
    return `https://api.github.com/repos/${owner}/${repo}/zipball/HEAD`
  } catch {
    return null
  }
}

async function copyDownloadToArchive(downloadUrl: string, destinationPath: string) {
  const githubArchiveUrl = getGitHubArchiveUrl(downloadUrl)
  if (githubArchiveUrl) {
    const response = await fetch(githubArchiveUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'skillviewer-market/0.1',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}.`)
    }

    const arrayBuffer = await response.arrayBuffer()
    await writeFile(destinationPath, Buffer.from(arrayBuffer))
    return
  }

  if (/^https?:\/\//i.test(downloadUrl)) {
    const response = await fetch(downloadUrl)
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}.`)
    }

    const arrayBuffer = await response.arrayBuffer()
    await writeFile(destinationPath, Buffer.from(arrayBuffer))
    return
  }

  const sourcePath = downloadUrl.startsWith('file://')
    ? fileURLToPath(downloadUrl)
    : downloadUrl

  if (!(await pathExists(sourcePath))) {
    throw new Error(`Archive not found at ${sourcePath}.`)
  }

  const archiveBuffer = await readFile(sourcePath)
  await writeFile(destinationPath, archiveBuffer)
}

async function findSkillRoot(extractDir: string, expectedSlug: string) {
  const matches = await fg(['**/SKILL.md', '**/SKILL.disabled.md'], {
    absolute: true,
    cwd: extractDir,
    dot: true,
    followSymbolicLinks: false,
    ignore: ['**/.git/**', '**/__MACOSX/**', '**/node_modules/**'],
    onlyFiles: true,
    unique: true,
  })

  if (matches.length === 0) {
    return extractDir
  }

  const candidates = matches.map((filePath) => path.dirname(filePath))
  const expected = expectedSlug.toLowerCase()
  const exactMatch = candidates.find(
    (candidate) => path.basename(candidate).toLowerCase() === expected,
  )

  return exactMatch ?? candidates[0]
}

async function installExtractedContent(extractDir: string, targetDir: string, expectedSlug: string) {
  const skillRoot = await findSkillRoot(extractDir, expectedSlug)
  await cp(skillRoot, targetDir, { recursive: true })
}

export async function installMarketSkill(payload: InstallMarketSkillPayload) {
  const skill = payload.skill

  if (!skill?.downloadUrl || !skill.slug) {
    throw new Error('Market skill payload is incomplete.')
  }

  const installBaseDir = getInstallBaseDir()
  await mkdir(installBaseDir, { recursive: true })

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'skillviewer-market-'))
  const archivePath = path.join(tempRoot, `${skill.slug}.zip`)
  const extractDir = path.join(tempRoot, 'extracted')

  await mkdir(extractDir, { recursive: true })

  try {
    await copyDownloadToArchive(skill.downloadUrl, archivePath)
    await extract(archivePath, { dir: extractDir })

    const targetDir = path.join(installBaseDir, skill.slug)
    await rm(targetDir, { force: true, recursive: true })
    await installExtractedContent(extractDir, targetDir, skill.slug)

    return {
      installedPath: targetDir,
    } satisfies InstallMarketSkillResult
  } finally {
    await rm(tempRoot, { force: true, recursive: true })
  }
}

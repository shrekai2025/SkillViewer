import { dialog, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { access, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import fg from 'fast-glob'
import matter from 'gray-matter'

import type {
  AppSnapshot,
  InstalledMarketMetadata,
  SaveSkillPayload,
  SkillFrontmatterEntry,
  SkillRecord,
  SkillSource,
  ToggleSkillPayload,
} from '../src/shared/contracts'
import { readAppState, writeAppState } from './state-store'

type SourcePreset = Omit<SkillSource, 'path'> & {
  candidates: string[]
}

const SKILL_FILE_NAMES = ['SKILL.md', 'SKILL.disabled.md'] as const
const MARKET_METADATA_FILE = '.skillviewer-market.json'

const SOURCE_PRESETS: SourcePreset[] = [
  {
    candidates: [path.join(homedir(), '.Agents'), path.join(homedir(), '.agents')],
    id: 'preset-agents',
    kind: 'global',
    label: 'Agents Global',
    system: true,
  },
  {
    candidates: [path.join(homedir(), '.claude')],
    id: 'preset-claude',
    kind: 'global',
    label: 'Claude Global',
    system: true,
  },
  {
    candidates: [path.join(homedir(), '.codex')],
    id: 'preset-codex',
    kind: 'global',
    label: 'Codex Global',
    system: true,
  },
  {
    candidates: [
      path.join(homedir(), '.openclaw'),
      path.join(homedir(), 'Library', 'Application Support', 'OpenClaw'),
      path.join(homedir(), 'Library', 'Application Support', 'openclaw'),
    ],
    id: 'preset-openclaw',
    kind: 'application',
    label: 'OpenClaw App',
    system: true,
  },
]

const GLOB_IGNORES = [
  '**/.DS_Store',
  '**/.git/**',
  '**/.idea/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/build/**',
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**',
]

function createCustomSourceId(sourcePath: string) {
  const digest = createHash('sha1').update(sourcePath).digest('hex').slice(0, 10)
  return `custom-${digest}`
}

function normalizeSourcePath(sourcePath: string) {
  return sourcePath.endsWith(path.sep) ? sourcePath.slice(0, -1) : sourcePath
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readStateFile() {
  return readAppState()
}

async function writeStateFile(sources: SkillSource[]) {
  const state = await readAppState()
  await writeAppState({
    ...state,
    sources,
  })
}

async function discoverDefaultSources() {
  const sources: SkillSource[] = []

  for (const preset of SOURCE_PRESETS) {
    for (const candidate of preset.candidates) {
      if (!(await pathExists(candidate))) {
        continue
      }

      const resolvedPath = normalizeSourcePath(await realpath(candidate))
      sources.push({
        id: preset.id,
        kind: preset.kind,
        label: preset.label,
        path: resolvedPath,
        system: true,
      })
      break
    }
  }

  return sources
}

function mergeSources(primary: SkillSource[], secondary: SkillSource[]) {
  const sourceMap = new Map<string, SkillSource>()

  for (const source of [...primary, ...secondary]) {
    const key = normalizeSourcePath(source.path)
    if (sourceMap.has(key)) {
      continue
    }

    sourceMap.set(key, {
      ...source,
      path: key,
    })
  }

  return [...sourceMap.values()].sort((left, right) => {
    if (left.system !== right.system) {
      return left.system ? -1 : 1
    }
    return left.label.localeCompare(right.label)
  })
}

async function ensureSources() {
  const state = await readStateFile()
  const discovered = await discoverDefaultSources()
  const merged = mergeSources(state.sources, discovered)

  if (JSON.stringify(merged) !== JSON.stringify(state.sources)) {
    await writeStateFile(merged)
  }

  return merged
}

function getFrontmatterEntries(data: Record<string, unknown>) {
  return Object.entries(data).map(([key, value]) => ({
    key,
    value:
      Array.isArray(value)
        ? value.join(', ')
        : typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : String(value),
  })) satisfies SkillFrontmatterEntry[]
}

function getFallbackDescription(markdownBody: string) {
  const lines = markdownBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('```'))

  if (!lines.length) {
    return 'No description found in frontmatter or body.'
  }

  return lines[0].slice(0, 180)
}

function getName(data: Record<string, unknown>, directoryPath: string) {
  const frontmatterName = data.name
  if (typeof frontmatterName === 'string' && frontmatterName.trim().length > 0) {
    return frontmatterName.trim()
  }
  return path.basename(directoryPath)
}

function getDescription(data: Record<string, unknown>, markdownBody: string) {
  const frontmatterDescription = data.description
  if (typeof frontmatterDescription === 'string' && frontmatterDescription.trim().length > 0) {
    return frontmatterDescription.trim()
  }
  return getFallbackDescription(markdownBody)
}

async function readInstalledMarketMetadata(directoryPath: string) {
  try {
    const raw = await readFile(path.join(directoryPath, MARKET_METADATA_FILE), 'utf8')
    const parsed = JSON.parse(raw) as InstalledMarketMetadata

    if (
      typeof parsed.skillId !== 'string' ||
      typeof parsed.registryId !== 'string' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.slug !== 'string' ||
      typeof parsed.version !== 'string' ||
      typeof parsed.downloadUrl !== 'string'
    ) {
      return undefined
    }

    return parsed
  } catch {
    return undefined
  }
}

async function buildSkillRecord(source: SkillSource, filePath: string): Promise<SkillRecord> {
  const resolvedFilePath = normalizeSourcePath(await realpath(filePath))
  const rawContent = await readFile(resolvedFilePath, 'utf8')
  const parsed = matter(rawContent)
  const fileStats = await stat(resolvedFilePath)
  const directoryPath = path.dirname(resolvedFilePath)
  const marketOrigin = await readInstalledMarketMetadata(directoryPath)

  return {
    id: resolvedFilePath,
    sourceId: source.id,
    sourceKind: source.kind,
    sourceLabel: source.label,
    directoryPath,
    fileName: path.basename(resolvedFilePath) as SkillRecord['fileName'],
    filePath: resolvedFilePath,
    relativePath: path.relative(source.path, directoryPath) || '.',
    name: getName(parsed.data, directoryPath),
    description: getDescription(parsed.data, parsed.content),
    addedAt: new Date(
      fileStats.birthtimeMs > 0 ? fileStats.birthtimeMs : fileStats.ctimeMs,
    ).toISOString(),
    updatedAt: new Date(fileStats.mtimeMs).toISOString(),
    enabled: path.basename(resolvedFilePath) === 'SKILL.md',
    systemDisabled: directoryPath.includes('skills-disabled') || directoryPath.endsWith('.disabled'),
    rawContent,
    markdownBody: parsed.content,
    frontmatter: getFrontmatterEntries(parsed.data),
    ...(marketOrigin ? { marketOrigin } : {}),
  } satisfies SkillRecord
}

async function scanSource(source: SkillSource) {
  const matches = await fg(
    SKILL_FILE_NAMES.map((fileName) => `**/${fileName}`),
    {
      absolute: true,
      cwd: source.path,
      dot: true,
      followSymbolicLinks: false,
      ignore: GLOB_IGNORES,
      onlyFiles: true,
      unique: true,
    },
  )

  const records = await Promise.all(
    matches.map(async (match) => {
      try {
        return await buildSkillRecord(source, match)
      } catch {
        return null
      }
    }),
  )

  return records.filter((record): record is SkillRecord => record !== null)
}

function resolveSourceForFile(sources: SkillSource[], filePath: string) {
  const normalized = normalizeSourcePath(filePath)
  const matchingSources = sources.filter((source) => normalized.startsWith(source.path))

  return matchingSources.sort((left, right) => right.path.length - left.path.length)[0] ?? null
}

export async function getSnapshot() {
  const sources = await ensureSources()
  const scanned = await Promise.all(sources.map((source) => scanSource(source)))
  const deduped = new Map<string, SkillRecord>()

  for (const skill of scanned.flat()) {
    if (!deduped.has(skill.filePath)) {
      deduped.set(skill.filePath, skill)
    }
  }

  return {
    sources,
    skills: [...deduped.values()].sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1
      }
      return right.updatedAt.localeCompare(left.updatedAt)
    }),
    lastRefreshedAt: new Date().toISOString(),
  } satisfies AppSnapshot
}

export async function addSourceFromDialog(browserWindow: BrowserWindow | null) {
  const selection = browserWindow
    ? await dialog.showOpenDialog(browserWindow, {
      properties: ['openDirectory'],
      title: 'Add a skill source folder',
    })
    : await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Add a skill source folder',
    })

  if (selection.canceled || selection.filePaths.length === 0) {
    return getSnapshot()
  }

  const resolvedPath = normalizeSourcePath(await realpath(selection.filePaths[0]))
  const sourceLabel = path.basename(resolvedPath) || resolvedPath
  const nextSource: SkillSource = {
    id: createCustomSourceId(resolvedPath),
    kind: 'custom',
    label: sourceLabel,
    path: resolvedPath,
    system: false,
  }

  const current = await ensureSources()
  await writeStateFile(mergeSources(current, [nextSource]))
  return getSnapshot()
}

export async function removeSource(sourceId: string) {
  const current = await ensureSources()
  const nextSources = current.filter((source) => source.id !== sourceId || source.system)
  await writeStateFile(nextSources)
  return getSnapshot()
}

export async function saveSkill(payload: SaveSkillPayload) {
  const sources = await ensureSources()
  const resolvedPath = normalizeSourcePath(await realpath(payload.filePath))
  await writeFile(resolvedPath, payload.rawContent, 'utf8')

  const source = resolveSourceForFile(sources, resolvedPath)
  if (!source) {
    throw new Error('Unable to resolve skill source for the edited file.')
  }

  return buildSkillRecord(source, resolvedPath)
}

export async function toggleSkill(payload: ToggleSkillPayload) {
  const sources = await ensureSources()
  const resolvedPath = normalizeSourcePath(await realpath(payload.filePath))
  const currentName = path.basename(resolvedPath)
  const nextName = payload.enable ? 'SKILL.md' : 'SKILL.disabled.md'

  if (currentName === nextName) {
    const source = resolveSourceForFile(sources, resolvedPath)
    if (!source) {
      throw new Error('Unable to resolve skill source for the selected skill.')
    }
    return buildSkillRecord(source, resolvedPath)
  }

  const renamedPath = path.join(path.dirname(resolvedPath), nextName)
  await rename(resolvedPath, renamedPath)

  const source = resolveSourceForFile(sources, renamedPath)
  if (!source) {
    throw new Error('Unable to resolve skill source after toggling state.')
  }

  return buildSkillRecord(source, renamedPath)
}

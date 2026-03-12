import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { SkillSource } from '../src/shared/contracts'

export interface PersistedMarketRegistry {
  enabled: boolean
  id: string
  label: string
  manifestUrl: string
  system: boolean
}

export interface PersistedState {
  marketRegistries: PersistedMarketRegistry[]
  sources: SkillSource[]
}

export function getStatePath() {
  return path.join(app.getPath('userData'), 'state.json')
}

async function ensureStateDir() {
  await mkdir(path.dirname(getStatePath()), { recursive: true })
}

export async function readAppState() {
  try {
    const raw = await readFile(getStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      marketRegistries: parsed.marketRegistries ?? [],
      sources: parsed.sources ?? [],
    } satisfies PersistedState
  } catch {
    return {
      marketRegistries: [],
      sources: [],
    } satisfies PersistedState
  }
}

export async function writeAppState(state: PersistedState) {
  await ensureStateDir()
  await writeFile(getStatePath(), JSON.stringify(state, null, 2), 'utf8')
}

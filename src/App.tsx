import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'

import {
  ArrowLeft,
  ChevronDown,
  CircleOff,
  Download,
  Eye,
  FileCode2,
  Filter,
  FolderPlus,
  FolderSearch2,
  Folders,
  Languages,
  Moon,
  Monitor,
  PanelRight,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  formatAppDate,
  getSystemLocale,
  resolveAppLocale,
  translate,
  type LanguagePreference,
  type SupportedLocale,
  type TranslationKey,
} from './i18n'
import type {
  AppSnapshot,
  AppTab,
  DetailMode,
  MarketRegistry,
  MarketSkill,
  MarketSnapshot,
  SkillRecord,
  SkillUpdateStatus,
  SkillSource,
  SourceKind,
} from './shared/contracts'

interface ToastMessage {
  id: number
  message: string
  tone: 'error' | 'info' | 'success'
}

const ALL_SOURCES_ID = 'all'
const MARKET_PAGE_SIZE = 18

function getKindLabel(kind: SourceKind, t: (key: TranslationKey, params?: Record<string, number | string>) => string) {
  if (kind === 'global') {
    return t('kind.global')
  }

  if (kind === 'application') {
    return t('kind.application')
  }

  return t('kind.custom')
}

function getRegistryStatusLabel(
  status: MarketRegistry['status'],
  t: (key: TranslationKey, params?: Record<string, number | string>) => string,
) {
  if (status === 'ready') {
    return t('common.ready')
  }

  if (status === 'disabled') {
    return t('common.disabled')
  }

  return t('common.error')
}

function isExternalUrl(value: string | null | undefined) {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function sortSkills(skills: SkillRecord[]) {
  return [...skills].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1
    }

    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

function mergeMarketSkillPages(current: MarketSkill[], incoming: MarketSkill[]) {
  const merged = new Map(current.map((skill) => [skill.id, skill]))
  for (const skill of incoming) {
    if (!merged.has(skill.id)) {
      merged.set(skill.id, skill)
    }
  }
  return [...merged.values()]
}

function getLocalizedErrorMessage(error: unknown, locale: SupportedLocale) {
  if (!(error instanceof Error)) {
    return translate(locale, 'app.error.generic')
  }

  const message = error.message
  const registryStatusMatch = message.match(/Registry request failed with status (\d+)\./)
  if (registryStatusMatch) {
    return translate(locale, 'error.registryRequestFailed', { status: registryStatusMatch[1] })
  }

  const downloadStatusMatch = message.match(/Download failed with status (\d+)\./)
  if (downloadStatusMatch) {
    return translate(locale, 'error.downloadFailed', { status: downloadStatusMatch[1] })
  }

  const archivePathMatch = message.match(/^Archive not found at (.+)\.$/)
  if (archivePathMatch) {
    return translate(locale, 'error.archiveNotFound', { path: archivePathMatch[1] })
  }

  const exactMap: Record<string, TranslationKey> = {
    'Only http and https URLs can be opened in the browser.': 'error.browserUrlProtocol',
    'Registry manifest URL is required.': 'error.registryUrlRequired',
    'SkillsMP requires an API key. Authenticated registries are not supported yet.': 'error.authenticatedRegistryUnsupported',
    'Market skill payload is incomplete.': 'error.marketSkillIncomplete',
    'This skill is not managed by Market.': 'error.marketSkillNotManaged',
    'Unable to find the latest Market version for this skill.': 'error.latestVersionNotFound',
    'Unable to resolve skill source for the edited file.': 'error.skillSourceEditedNotFound',
    'Unable to resolve skill source after toggling state.': 'error.skillSourceToggledNotFound',
    'Unable to resolve skill source for the selected skill.': 'error.skillSourceToggleSelectionNotFound',
  }

  const translationKey = exactMap[message]
  if (translationKey) {
    return translate(locale, translationKey)
  }

  return message
}

function getSelection(skills: SkillRecord[], currentSelection: string | null) {
  if (currentSelection && skills.some((skill) => skill.id === currentSelection)) {
    return currentSelection
  }

  return skills[0]?.id ?? null
}

function parseMarkdownSource(rawContent: string) {
  const normalized = rawContent.replace(/\r\n/g, '\n')

  if (!normalized.startsWith('---\n')) {
    return {
      body: normalized,
      frontmatter: [],
    }
  }

  const closingIndex = normalized.indexOf('\n---\n', 4)
  if (closingIndex === -1) {
    return {
      body: normalized,
      frontmatter: [],
    }
  }

  const rawFrontmatter = normalized.slice(4, closingIndex)
  const body = normalized.slice(closingIndex + 5)
  const frontmatter = rawFrontmatter
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && line.includes(':'))
    .map((line) => {
      const [key, ...rest] = line.split(':')
      return {
        key: key.trim(),
        value: rest.join(':').trim(),
      }
    })

  return {
    body,
    frontmatter,
  }
}

function ToastStack({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.tone}`} key={toast.id}>
          {toast.message}
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  compact,
  description,
  title,
}: {
  compact?: boolean
  description: string
  title: string
}) {
  return (
    <div className={`empty-state ${compact ? 'is-compact' : ''}`}>
      <Sparkles size={16} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}

function SourceItem({
  active,
  count,
  label,
  meta,
  onClick,
  onRemove,
  removable,
}: {
  active: boolean
  count: number
  label: string
  meta: string
  onClick: () => void
  onRemove?: () => void
  removable?: boolean
}) {
  return (
    <div className={`source-item ${active ? 'is-active' : ''}`}>
      <button className="source-main" onClick={onClick} type="button">
        <div className="source-main-copy">
          <strong>{label}</strong>
          <span>{meta}</span>
        </div>
      </button>

      <div className="source-side">
        <span className="source-counter">{count}</span>
        {removable ? (
          <button
            aria-label={`Remove ${label}`}
            className="source-remove"
            onClick={(event) => {
              event.stopPropagation()
              onRemove?.()
            }}
            type="button"
          >
            <Trash2 size={13} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function SkillCard({
  active,
  formattedUpdatedAt,
  latestVersion,
  onClick,
  onDoubleClick,
  onContextMenu,
  skill,
  statusDisabledLabel,
  statusEnabledLabel,
  statusSystemDisabledLabel,
  updateAvailable,
  updateLabel,
  updateTitle,
}: {
  active: boolean
  formattedUpdatedAt: string
  latestVersion?: string
  onClick: () => void
  onDoubleClick?: () => void
  onContextMenu?: (x: number, y: number) => void
  skill: SkillRecord
  statusDisabledLabel: string
  statusEnabledLabel: string
  statusSystemDisabledLabel: string
  updateAvailable?: boolean
  updateLabel: string
  updateTitle: string
}) {
  return (
    <button
      className={`skill-card ${active ? 'is-active' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu?.(e.clientX, e.clientY)
      }}
      type="button"
    >
      <div className="skill-card-name">
        <div className="skill-card-title">
          <strong>{skill.name}</strong>
          {updateAvailable ? (
            <span className="skill-update-badge" title={latestVersion ? updateTitle : updateLabel}>
              {updateLabel}
            </span>
          ) : null}
        </div>
        <span>{skill.sourceLabel}</span>
      </div>
      <div className="skill-card-summary">{skill.description}</div>
      <div className="skill-card-footer">
        <div className="skill-card-updated">{formattedUpdatedAt}</div>
        <div className="skill-card-status">
          {skill.systemDisabled ? (
            <span className="status-pill is-disabled" title={statusSystemDisabledLabel}>{statusSystemDisabledLabel}</span>
          ) : (
            <span className={`status-pill ${skill.enabled ? 'is-enabled' : 'is-disabled'}`}>
              {skill.enabled ? statusEnabledLabel : statusDisabledLabel}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

function MarketCard({
  active,
  installLabel,
  installing,
  installingLabel,
  installed,
  installedLabel,
  onClick,
  onInstall,
  skill,
  versionPrefix,
}: {
  active: boolean
  installLabel: string
  installing: boolean
  installingLabel: string
  installed: boolean
  installedLabel: string
  onClick: () => void
  onInstall: () => void
  skill: MarketSkill
  versionPrefix: string
}) {
  return (
    <article
      className={`market-card ${active ? 'is-active' : ''}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="market-card-header">
        <div className="market-card-copy">
          <strong>{skill.name}</strong>
          <span>{skill.registryLabel} · {versionPrefix}{skill.version}</span>
        </div>

        <button
          className={`market-action ${installed ? 'is-installed' : ''}`}
          disabled={installing || installed}
          onClick={(event) => {
            event.stopPropagation()
          onInstall()
        }}
          type="button"
        >
          {installed ? installedLabel : installing ? installingLabel : (
            <>
              <Download size={13} />
              {installLabel}
            </>
          )}
        </button>
      </div>

      <p className="market-card-description">{skill.description}</p>

      <div className="market-card-footer">
        <div className="market-card-tags">
          {skill.tags.slice(0, 3).map((tag) => (
            <span className="market-tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>

        <span className="market-card-author">{skill.author}</span>
      </div>
    </article>
  )
}

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    return (localStorage.getItem('skillviewer-active-tab') as AppTab) || 'library'
  })
  const [selectedSourceId, setSelectedSourceId] = useState<string>(ALL_SOURCES_ID)
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null)
  const [marketSkills, setMarketSkills] = useState<MarketSkill[]>([])
  const [marketCursor, setMarketCursor] = useState<string | null>(null)
  const [marketHasMore, setMarketHasMore] = useState(false)
  const [selectedMarketRegistryId, setSelectedMarketRegistryId] = useState<string>('all')
  const [selectedMarketSkillId, setSelectedMarketSkillId] = useState<string | null>(null)
  const [marketQuery, setMarketQuery] = useState('')
  const [marketInstallId, setMarketInstallId] = useState<string | null>(null)
  const [marketBusyAction, setMarketBusyAction] = useState<'load-more' | 'refresh' | 'registry' | null>(null)
  const [skillUpdateMap, setSkillUpdateMap] = useState<Record<string, SkillUpdateStatus>>({})
  const [updateBusyFilePath, setUpdateBusyFilePath] = useState<string | null>(null)
  const [isAddRegistryDialogOpen, setIsAddRegistryDialogOpen] = useState(false)
  const [newRegistryLabel, setNewRegistryLabel] = useState('')
  const [newRegistryUrl, setNewRegistryUrl] = useState('')
  const [detailMode, setDetailMode] = useState<DetailMode>('preview')
  const [searchValue, setSearchValue] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<'add' | 'refresh' | 'save' | 'toggle' | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filterMode, setFilterMode] = useState<'all' | 'enabled' | 'disabled'>(() => {
    return (localStorage.getItem('eagle-filter-mode') as 'all' | 'enabled' | 'disabled') || 'all'
  })
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'skill'>('grid')
  const [fontSize, setFontSize] = useState<number>(13)
  const [showPreview, setShowPreview] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, skillId: string } | null>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const [themePreference, setThemePreference] = useState<'dark' | 'light' | 'system'>(() => {
    return (localStorage.getItem('eagle-theme-preference') as 'dark' | 'light' | 'system') || 'system'
  })
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(() => {
    const stored = localStorage.getItem('skillviewer-language-preference')
    if (stored === 'system' || stored === 'zh-CN' || stored === 'en-US' || stored === 'ja-JP') {
      return stored
    }
    return 'system'
  })

  const deferredSearch = useDeferredValue(searchValue)
  const deferredMarketQuery = useDeferredValue(marketQuery)
  const desktopApi = typeof window !== 'undefined' ? window.skillviewer : undefined
  const locale = languagePreference === 'system' ? getSystemLocale() : resolveAppLocale(languagePreference)
  const t = (key: TranslationKey, params?: Record<string, number | string>) => translate(locale, key, params)

  function formatDate(dateValue: string) {
    return formatAppDate(locale, dateValue)
  }

  useEffect(() => {
    localStorage.setItem('skillviewer-active-tab', activeTab)
  }, [activeTab])

  useEffect(() => {
    localStorage.setItem('skillviewer-language-preference', languagePreference)
  }, [languagePreference])

  useEffect(() => {
    if (activeTab !== 'market' && isAddRegistryDialogOpen) {
      setIsAddRegistryDialogOpen(false)
    }
  }, [activeTab, isAddRegistryDialogOpen])

  useEffect(() => {
    const root = window.document.documentElement
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    function applyTheme() {
      if (themePreference === 'system') {
        const systemTheme = mediaQuery.matches ? 'dark' : 'light'
        root.setAttribute('data-theme', systemTheme)
      } else {
        root.setAttribute('data-theme', themePreference)
      }
    }

    applyTheme()
    mediaQuery.addEventListener('change', applyTheme)
    localStorage.setItem('eagle-theme-preference', themePreference)

    return () => {
      mediaQuery.removeEventListener('change', applyTheme)
    }
  }, [themePreference])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  useEffect(() => {
    function hideMenu() {
      setContextMenu(null)
    }
    document.addEventListener('click', hideMenu)
    return () => document.removeEventListener('click', hideMenu)
  }, [])

  useEffect(() => {
    if (!isAddRegistryDialogOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsAddRegistryDialogOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isAddRegistryDialogOpen])

  function pushToast(tone: ToastMessage['tone'], message: string) {
    const id = Date.now() + Math.round(Math.random() * 1000)
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 2400)
  }

  async function refreshSnapshot(successMessage?: string) {
    if (!desktopApi) {
      return
    }

    setBusyAction('refresh')
    setErrorMessage(null)

    try {
      const nextSnapshot = await desktopApi.getSnapshot()
      startTransition(() => {
        setSnapshot(nextSnapshot)
        setSelectedSkillId((current) => getSelection(nextSnapshot.skills, current))
      })

      if (successMessage) {
        pushToast('success', successMessage)
      }
    } catch (error) {
      const message = getLocalizedErrorMessage(error, locale)
      setErrorMessage(message)
      pushToast('error', message)
    } finally {
      setBusyAction((current) => (current === 'refresh' ? null : current))
    }
  }

  async function refreshMarketSnapshot(
    successMessage?: string,
    options?: { query?: string; registryId?: string },
  ) {
    if (!desktopApi) {
      return
    }

    const nextQuery = options?.query ?? deferredMarketQuery
    const nextRegistryId = options?.registryId ?? selectedMarketRegistryId
    setMarketBusyAction('refresh')

    try {
      const [nextSnapshot, nextPage] = await Promise.all([
        desktopApi.getMarketSnapshot(),
        desktopApi.browseMarketSkills({
          cursor: null,
          limit: MARKET_PAGE_SIZE,
          query: nextQuery,
          registryId: nextRegistryId,
        }),
      ])

      startTransition(() => {
        setMarketSnapshot(nextSnapshot)
        setMarketSkills(nextPage.skills)
        setMarketCursor(nextPage.cursor)
        setMarketHasMore(nextPage.hasMore)
        setSelectedMarketSkillId((current) => {
          if (current && nextPage.skills.some((skill) => skill.id === current)) {
            return current
          }
          return nextPage.skills[0]?.id ?? null
        })
      })

      if (successMessage) {
        pushToast('success', successMessage)
      }
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    } finally {
      setMarketBusyAction((current) => (current === 'refresh' ? null : current))
    }
  }

  async function loadMoreMarketSkills() {
    if (!desktopApi || !marketHasMore || !marketCursor) {
      return
    }

    setMarketBusyAction('load-more')

    try {
      const nextPage = await desktopApi.browseMarketSkills({
        cursor: marketCursor,
        limit: MARKET_PAGE_SIZE,
        query: deferredMarketQuery,
        registryId: selectedMarketRegistryId,
      })

      startTransition(() => {
        setMarketSkills((current) => mergeMarketSkillPages(current, nextPage.skills))
        setMarketCursor(nextPage.cursor)
        setMarketHasMore(nextPage.hasMore)
        setSelectedMarketSkillId((current) => {
          if (current) {
            return current
          }
          return nextPage.skills[0]?.id ?? null
        })
      })
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    } finally {
      setMarketBusyAction((current) => (current === 'load-more' ? null : current))
    }
  }

  useEffect(() => {
    if (!desktopApi) {
      return
    }

    const api = desktopApi
    let isMounted = true

    async function loadSnapshot() {
      setBusyAction('refresh')
      setErrorMessage(null)

      try {
        const nextSnapshot = await api.getSnapshot()
        if (!isMounted) {
          return
        }

        startTransition(() => {
          setSnapshot(nextSnapshot)
          setSelectedSkillId((current) => getSelection(nextSnapshot.skills, current))
        })
      } catch (error) {
        if (!isMounted) {
          return
        }

        const message = getLocalizedErrorMessage(error, locale)
        setErrorMessage(message)
        pushToast('error', message)
      } finally {
        if (isMounted) {
          setBusyAction((current) => (current === 'refresh' ? null : current))
        }
      }
    }

    void loadSnapshot()

    return () => {
      isMounted = false
    }
  }, [desktopApi, locale])

  useEffect(() => {
    if (!desktopApi || activeTab !== 'market') {
      return
    }

    const api = desktopApi
    let isMounted = true

    async function loadMarket() {
      setMarketBusyAction('refresh')

      try {
        const nextSnapshot = await api.getMarketSnapshot()
        if (!isMounted) {
          return
        }

        startTransition(() => {
          setMarketSnapshot(nextSnapshot)
        })
      } catch (error) {
        if (isMounted) {
          pushToast('error', getLocalizedErrorMessage(error, locale))
        }
      } finally {
        if (isMounted) {
          setMarketBusyAction((current) => (current === 'refresh' ? null : current))
        }
      }
    }

    void loadMarket()

    return () => {
      isMounted = false
    }
  }, [activeTab, desktopApi, locale])

  useEffect(() => {
    if (!desktopApi || activeTab !== 'market') {
      return
    }

    const api = desktopApi
    let isMounted = true

    async function loadMarketPage() {
      setMarketBusyAction('refresh')

      try {
        const nextPage = await api.browseMarketSkills({
          cursor: null,
          limit: MARKET_PAGE_SIZE,
          query: deferredMarketQuery,
          registryId: selectedMarketRegistryId,
        })

        if (!isMounted) {
          return
        }

        startTransition(() => {
          setMarketSkills(nextPage.skills)
          setMarketCursor(nextPage.cursor)
          setMarketHasMore(nextPage.hasMore)
          setSelectedMarketSkillId((current) => {
            if (current && nextPage.skills.some((skill) => skill.id === current)) {
              return current
            }
            return nextPage.skills[0]?.id ?? null
          })
        })
      } catch (error) {
        if (isMounted) {
          pushToast('error', getLocalizedErrorMessage(error, locale))
        }
      } finally {
        if (isMounted) {
          setMarketBusyAction((current) => (current === 'refresh' ? null : current))
        }
      }
    }

    void loadMarketPage()

    return () => {
      isMounted = false
    }
  }, [activeTab, deferredMarketQuery, desktopApi, locale, selectedMarketRegistryId])

  useEffect(() => {
    if (!desktopApi || !snapshot) {
      return
    }

    const marketManagedSkills = snapshot.skills.filter((skill) => skill.marketOrigin)
    if (marketManagedSkills.length === 0) {
      setSkillUpdateMap({})
      return
    }

    const api = desktopApi
    let isMounted = true

    async function loadSkillUpdates() {
      try {
        const updates = await api.checkSkillUpdates()
        if (!isMounted) {
          return
        }

        startTransition(() => {
          setSkillUpdateMap(
            Object.fromEntries(updates.map((update) => [update.filePath, update])),
          )
        })
      } catch {
        if (isMounted) {
          setSkillUpdateMap({})
        }
      }
    }

    void loadSkillUpdates()

    return () => {
      isMounted = false
    }
  }, [desktopApi, snapshot])

  const skills = snapshot?.skills ?? []
  const visibleSkills = skills.filter((skill) => {
    const matchesSource = selectedSourceId === ALL_SOURCES_ID || skill.sourceId === selectedSourceId
    if (!matchesSource) {
      return false
    }

    if (filterMode === 'enabled' && (!skill.enabled || skill.systemDisabled)) {
      return false
    }

    if (filterMode === 'disabled' && (skill.enabled && !skill.systemDisabled)) {
      return false
    }

    const normalizedQuery = deferredSearch.trim().toLowerCase()
    if (!normalizedQuery) {
      return true
    }

    return [skill.name, skill.description, skill.sourceLabel, skill.relativePath].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    )
  })

  const visibleMarketSkills = marketSkills

  useEffect(() => {
    if (visibleSkills.length === 0) {
      if (selectedSkillId !== null) {
        setSelectedSkillId(null)
      }
      return
    }

    const isSelectedStillVisible =
      selectedSkillId !== null && visibleSkills.some((skill) => skill.id === selectedSkillId)

    if (!isSelectedStillVisible) {
      setSelectedSkillId(visibleSkills[0].id)
    }
  }, [selectedSkillId, visibleSkills])

  useEffect(() => {
    if (visibleMarketSkills.length === 0) {
      if (selectedMarketSkillId !== null) {
        setSelectedMarketSkillId(null)
      }
      return
    }

    const isSelectedStillVisible =
      selectedMarketSkillId !== null &&
      visibleMarketSkills.some((skill) => skill.id === selectedMarketSkillId)

    if (!isSelectedStillVisible) {
      setSelectedMarketSkillId(visibleMarketSkills[0].id)
    }
  }, [selectedMarketSkillId, visibleMarketSkills])

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (Object.keys(drafts).length > 0) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [drafts])

  const selectedSkill =
    visibleSkills.find((skill) => skill.id === selectedSkillId) ??
    skills.find((skill) => skill.id === selectedSkillId) ??
    null
  const selectedSkillUpdate = selectedSkill ? skillUpdateMap[selectedSkill.filePath] ?? null : null
  const selectedMarketSkill =
    visibleMarketSkills.find((skill) => skill.id === selectedMarketSkillId) ??
    marketSkills.find((skill) => skill.id === selectedMarketSkillId) ??
    null

  const selectedSource = snapshot?.sources.find((source) => source.id === selectedSourceId) ?? null
  const marketRegistries = marketSnapshot?.registries ?? []
  const selectedMarketRegistry =
    marketRegistries.find((registry) => registry.id === selectedMarketRegistryId) ?? null
  const draftContent = selectedSkill ? drafts[selectedSkill.id] ?? selectedSkill.rawContent : ''
  const hasUnsavedChanges = selectedSkill ? draftContent !== selectedSkill.rawContent : false
  const previewSource = parseMarkdownSource(selectedSkill ? selectedSkill.rawContent : '')
  const draftPreviewSource = parseMarkdownSource(draftContent)
  const systemSources = (snapshot?.sources ?? []).filter((source) => source.system)
  const customSources = (snapshot?.sources ?? []).filter((source) => !source.system)
  const visibleEnabledCount = visibleSkills.filter((skill) => skill.enabled && !skill.systemDisabled).length
  const visibleDisabledCount = visibleSkills.length - visibleEnabledCount
  const installedSkillNameSet = new Set(skills.map((skill) => skill.name.trim().toLowerCase()))
  const visibleInstalledMarketCount = visibleMarketSkills.filter((skill) =>
    installedSkillNameSet.has(skill.name.trim().toLowerCase()),
  ).length
  const selectedMarketSkillInstalled = selectedMarketSkill
    ? installedSkillNameSet.has(selectedMarketSkill.name.trim().toLowerCase())
    : false
  const marketSkillCounts = new Map<string, number>()
  for (const skill of marketSkills) {
    marketSkillCounts.set(skill.registryId, (marketSkillCounts.get(skill.registryId) ?? 0) + 1)
  }
  const readyRegistryCount = marketRegistries.filter((registry) => registry.status === 'ready').length
  const remoteReadyRegistryCount = marketRegistries.filter(
    (registry) => registry.status === 'ready' && /^https?:\/\//i.test(registry.manifestUrl),
  ).length

  function replaceSkill(nextSkill: SkillRecord, previousId: string) {
    startTransition(() => {
      setSnapshot((current) => {
        if (!current) {
          return current
        }

        const nextSkills = current.skills.some((skill) => skill.id === previousId)
          ? current.skills.map((skill) => (skill.id === previousId ? nextSkill : skill))
          : [nextSkill, ...current.skills]

        return {
          ...current,
          skills: sortSkills(nextSkills),
          lastRefreshedAt: new Date().toISOString(),
        }
      })
      setSelectedSkillId(nextSkill.id)
    })
  }

  async function handleAddSource() {
    if (!desktopApi) {
      return
    }

    setBusyAction('add')

    try {
      const nextSnapshot = await desktopApi.addSource()
      startTransition(() => {
        setSnapshot(nextSnapshot)
        setSelectedSkillId((current) => getSelection(nextSnapshot.skills, current))
      })
      pushToast('success', t('library.toast.addSource'))
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    } finally {
      setBusyAction((current) => (current === 'add' ? null : current))
    }
  }

  async function handleRemoveSource(source: SkillSource) {
    if (!desktopApi || source.system) {
      return
    }

    try {
      const nextSnapshot = await desktopApi.removeSource(source.id)
      startTransition(() => {
        setSnapshot(nextSnapshot)
        setSelectedSourceId((current) => (current === source.id ? ALL_SOURCES_ID : current))
        setSelectedSkillId((current) => getSelection(nextSnapshot.skills, current))
      })
      pushToast('info', t('library.toast.removeSource', { label: source.label }))
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    }
  }

  async function handleSave() {
    if (!desktopApi || !selectedSkill) {
      return
    }

    setBusyAction('save')

    try {
      const nextSkill = await desktopApi.saveSkill({
        filePath: selectedSkill.filePath,
        rawContent: draftContent,
      })

      replaceSkill(nextSkill, selectedSkill.id)
      setDrafts((current) => {
        const nextDrafts = { ...current }
        delete nextDrafts[selectedSkill.id]
        return nextDrafts
      })
      pushToast('success', t('library.toast.save'))
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    } finally {
      setBusyAction((current) => (current === 'save' ? null : current))
    }
  }

  async function handleToggle() {
    if (!desktopApi || !selectedSkill) {
      return
    }

    setBusyAction('toggle')

    try {
      const nextSkill = await desktopApi.toggleSkill({
        enable: !selectedSkill.enabled,
        filePath: selectedSkill.filePath,
      })

      replaceSkill(nextSkill, selectedSkill.id)
      setDrafts((current) => {
        const nextDrafts = { ...current }
        const existingDraft = current[selectedSkill.id]
        delete nextDrafts[selectedSkill.id]
        if (existingDraft) {
          nextDrafts[nextSkill.id] = existingDraft
        }
        return nextDrafts
      })
      pushToast('success', nextSkill.enabled ? t('library.toast.toggleEnabled') : t('library.toast.toggleDisabled'))
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    } finally {
      setBusyAction((current) => (current === 'toggle' ? null : current))
    }
  }

  async function handleReveal() {
    if (!desktopApi || !selectedSkill) {
      return
    }

    try {
      await desktopApi.revealSkill(selectedSkill.filePath)
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    }
  }

  async function handleOpenExternal(url: string) {
    if (!desktopApi || !isExternalUrl(url)) {
      return
    }

    try {
      await desktopApi.openExternal(url)
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    }
  }

  async function handleUpdateInstalledSkill(skill: SkillRecord) {
    if (!desktopApi || !skill.marketOrigin) {
      return
    }

    setUpdateBusyFilePath(skill.filePath)

    try {
      await desktopApi.updateInstalledSkill({ filePath: skill.filePath })
      await refreshSnapshot(t('library.toast.update'))
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    } finally {
      setUpdateBusyFilePath((current) => (current === skill.filePath ? null : current))
    }
  }

  async function handleInstallMarketSkill(skill: MarketSkill) {
    if (!desktopApi) {
      return
    }

    setMarketInstallId(skill.id)

    try {
      const result = await desktopApi.installMarketSkill({ skill })
      await refreshSnapshot()
      await refreshMarketSnapshot()
      pushToast('success', t('market.toast.installSuccess', { path: result.installedPath }))
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    } finally {
      setMarketInstallId((current) => (current === skill.id ? null : current))
    }
  }

  async function handleAddMarketRegistry() {
    if (!desktopApi || !newRegistryUrl.trim()) {
      return
    }

    setMarketBusyAction('registry')

    try {
      await desktopApi.addMarketRegistry({
        label: newRegistryLabel.trim(),
        manifestUrl: newRegistryUrl.trim(),
      })
      setSelectedMarketRegistryId('all')
      setNewRegistryLabel('')
      setNewRegistryUrl('')
      setIsAddRegistryDialogOpen(false)
      await refreshMarketSnapshot(undefined, { query: deferredMarketQuery, registryId: 'all' })
      pushToast('success', t('market.toast.addRegistry'))
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    } finally {
      setMarketBusyAction((current) => (current === 'registry' ? null : current))
    }
  }

  async function handleRemoveMarketRegistry(registryId: string) {
    if (!desktopApi) {
      return
    }

    setMarketBusyAction('registry')

    try {
      const nextRegistryId = selectedMarketRegistryId === registryId ? 'all' : selectedMarketRegistryId
      setSelectedMarketRegistryId(nextRegistryId)
      await desktopApi.removeMarketRegistry(registryId)
      await refreshMarketSnapshot(undefined, {
        query: deferredMarketQuery,
        registryId: nextRegistryId,
      })
      pushToast('info', t('market.toast.registryRemoved'))
    } catch (error) {
      pushToast('error', getLocalizedErrorMessage(error, locale))
    } finally {
      setMarketBusyAction((current) => (current === 'registry' ? null : current))
    }
  }

  const handleSaveShortcut = useEffectEvent(() => {
    if (detailMode === 'edit' && hasUnsavedChanges && busyAction !== 'save') {
      void handleSave()
    }
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleSaveShortcut()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (!desktopApi) {
    return (
      <div className="desktop-fallback">
        <EmptyState
          description={t('app.desktopFallbackDescription')}
          title={t('app.desktopFallbackTitle')}
        />
      </div>
    )
  }

  const sourceCounts = new Map<string, number>()
  for (const skill of skills) {
    sourceCounts.set(skill.sourceId, (sourceCounts.get(skill.sourceId) ?? 0) + 1)
  }

  const selectedSourceTitle = selectedSource ? selectedSource.label : t('library.titleAll')
  const selectedSourceSubtitle = selectedSource
    ? t('library.selectedSourceSubtitle', {
        kind: getKindLabel(selectedSource.kind, t),
        path: selectedSource.path,
      })
    : t('library.selectedSourceSubtitleAll')
  const selectedMarketTitle = selectedMarketRegistry ? selectedMarketRegistry.label : t('common.market')
  const selectedMarketSubtitle = selectedMarketRegistry
    ? t('market.selectedRegistrySubtitle')
    : t('market.aggregateDescription')
  const selectedMarketRegistryLoadedCount = selectedMarketRegistry
    ? (marketSkillCounts.get(selectedMarketRegistry.id) ?? 0)
    : 0

  return (
    <div className="desktop-shell">
      <header className="chrome-bar">
        <div className="chrome-brand-group">
          <div className="chrome-brand">
            <img alt="SkillViewer Logo" className="chrome-brand-logo" src="./logo.webp" />
            <div className="chrome-brand-copy">
              <strong>SkillViewer</strong>
              <span>{t('app.brandTagline')}</span>
            </div>
          </div>

          <div className="workspace-switch">
            <button
              className={activeTab === 'library' ? 'is-active' : ''}
              onClick={() => setActiveTab('library')}
              type="button"
            >
              <Folders size={14} />
              {t('common.library')}
            </button>
            <button
              className={activeTab === 'market' ? 'is-active' : ''}
              onClick={() => setActiveTab('market')}
              type="button"
            >
              <Store size={14} />
              {t('common.market')}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {activeTab === 'library' ? (
            <>
              <div style={{ position: 'relative' }} ref={filterRef}>
                <button
                  className="chrome-button"
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  type="button"
                >
                  <Filter size={15} />
                  <ChevronDown size={12} />
                </button>

                {isFilterOpen && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: '8px',
                    background: 'var(--panel-bg)', border: '1px solid var(--line)',
                    borderRadius: '8px', padding: '16px', boxShadow: 'var(--shadow-lg)',
                    zIndex: 100, width: '200px', display: 'flex', flexDirection: 'column', gap: '16px'
                  }}>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-soft)', marginBottom: '8px', textTransform: 'uppercase' }}>{t('filter.captionSource')}</div>
                      <select
                        style={{ width: '100%', padding: '6px', fontSize: '12px', background: 'var(--button-bg)', border: '1px solid var(--line)', borderRadius: '4px', color: 'var(--text)', outline: 'none' }}
                        value={selectedSourceId}
                        onChange={(e) => setSelectedSourceId(e.target.value)}
                      >
                        <option value={ALL_SOURCES_ID}>{t('filter.allSources')}</option>
                        {snapshot?.sources.map((src) => (
                          <option key={src.id} value={src.id}>{src.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-soft)', marginBottom: '8px', textTransform: 'uppercase' }}>{t('filter.captionStatus')}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                        <label style={{ display: 'flex', gap: '6px', cursor: 'pointer', alignItems: 'center' }}>
                          <input type="radio" checked={filterMode === 'all'} onChange={() => { setFilterMode('all'); localStorage.setItem('eagle-filter-mode', 'all') }} />
                          {t('filter.allStatuses')}
                        </label>
                        <label style={{ display: 'flex', gap: '6px', cursor: 'pointer', alignItems: 'center' }}>
                          <input type="radio" checked={filterMode === 'enabled'} onChange={() => { setFilterMode('enabled'); localStorage.setItem('eagle-filter-mode', 'enabled') }} />
                          {t('filter.enabledOnly')}
                        </label>
                        <label style={{ display: 'flex', gap: '6px', cursor: 'pointer', alignItems: 'center' }}>
                          <input type="radio" checked={filterMode === 'disabled'} onChange={() => { setFilterMode('disabled'); localStorage.setItem('eagle-filter-mode', 'disabled') }} />
                          {t('filter.disabledOnly')}
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <label className="global-search">
                <Search size={15} />
                <input
                  onChange={(event) => {
                    setSearchValue(event.target.value)
                  }}
                  placeholder={t('library.searchPlaceholder')}
                  type="search"
                  value={searchValue}
                />
              </label>
            </>
          ) : (
            <label className="global-search">
              <Search size={15} />
              <input
                onChange={(event) => {
                  setMarketQuery(event.target.value)
                }}
                placeholder={t('market.searchPlaceholder')}
                type="search"
                value={marketQuery}
              />
            </label>
          )}
        </div>

        <div className="chrome-actions">
          <label className="language-select" title={t('language.label')}>
            <Languages size={14} />
            <select
              aria-label={t('language.label')}
              onChange={(event) => {
                setLanguagePreference(event.target.value as LanguagePreference)
              }}
              value={languagePreference}
            >
              <option value="system">{t('language.system')}</option>
              <option value="zh-CN">{t('language.zh')}</option>
              <option value="en-US">{t('language.english')}</option>
              <option value="ja-JP">{t('language.japanese')}</option>
            </select>
          </label>

          <button
            className="chrome-button"
            onClick={() => {
              const next = themePreference === 'system' ? 'light' : themePreference === 'light' ? 'dark' : 'system'
              setThemePreference(next)
            }}
            title={t('app.theme.title', {
              theme:
                themePreference === 'system'
                  ? t('app.theme.system')
                  : themePreference === 'light'
                    ? t('app.theme.light')
                    : t('app.theme.dark'),
            })}
            type="button"
          >
            {themePreference === 'system' ? <Monitor size={15} /> : themePreference === 'light' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <button
            className="chrome-button"
            onClick={() => {
              if (activeTab === 'library') {
                void refreshSnapshot(t('library.refreshSuccess'))
              } else {
                void refreshMarketSnapshot(t('market.refreshSuccess'))
              }
            }}
            type="button"
          >
            <RefreshCw className={(busyAction === 'refresh' || marketBusyAction === 'refresh') ? 'is-spinning' : ''} size={15} />
            {t('common.refresh')}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="nav-pane">
          {activeTab === 'library' ? (
            <>
              <div className="nav-block">
                <div className="nav-caption">{t('common.library')}</div>
                <SourceItem
                  active={selectedSourceId === ALL_SOURCES_ID}
                  count={skills.length}
                  label={t('common.allSkills')}
                  meta={t('library.selectedSourceSubtitleAll')}
                  onClick={() => {
                    setSelectedSourceId(ALL_SOURCES_ID)
                  }}
                />
              </div>

              <div className="nav-block">
                <div className="nav-caption">{t('library.sourcePrompt')}</div>
                {systemSources.map((source) => (
                  <SourceItem
                    active={selectedSourceId === source.id}
                    count={sourceCounts.get(source.id) ?? 0}
                    key={source.id}
                    label={source.label}
                    meta={`${getKindLabel(source.kind, t)} · ${source.path}`}
                    onClick={() => {
                      setSelectedSourceId(source.id)
                    }}
                  />
                ))}
              </div>

              <div className="nav-block">
                <div className="nav-caption" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: '12px' }}>
                  <span>{t('kind.custom')}</span>
                  <button
                    className="source-remove"
                    onClick={(e) => { e.stopPropagation(); void handleAddSource() }}
                    title={t('library.sourceDialogTitle')}
                    type="button"
                    style={{ opacity: 0.6, cursor: 'pointer' }}
                  >
                    <FolderPlus size={13} />
                  </button>
                </div>
                {customSources.length === 0 ? (
                  <EmptyState
                    compact
                    description={t('library.emptyDescription')}
                    title={t('common.none')}
                  />
                ) : (
                  customSources.map((source) => (
                    <SourceItem
                      active={selectedSourceId === source.id}
                      count={sourceCounts.get(source.id) ?? 0}
                      key={source.id}
                      label={source.label}
                      meta={`${getKindLabel(source.kind, t)} · ${source.path}`}
                      onClick={() => {
                        setSelectedSourceId(source.id)
                      }}
                      onRemove={() => {
                        void handleRemoveSource(source)
                      }}
                      removable
                    />
                  ))
                )}
              </div>

              <div className="nav-summary">
                <div className="summary-card">
                  <span>{t('nav.totalSkills')}</span>
                  <strong>{skills.length}</strong>
                </div>
                <div className="summary-card">
                  <span>{t('common.sourcePlural')}</span>
                  <strong>{snapshot?.sources.length ?? 0}</strong>
                </div>
                <div className="summary-card">
                  <span>{t('nav.recentRefresh')}</span>
                  <strong>{snapshot ? formatDate(snapshot.lastRefreshedAt) : '--'}</strong>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="nav-block">
                <div className="nav-caption">{t('nav.marketplace')}</div>
                <SourceItem
                  active={selectedMarketRegistryId === 'all'}
                  count={marketSkills.length}
                  label={t('common.allRegistries')}
                  meta={t('market.aggregateDescription')}
                  onClick={() => {
                    setSelectedMarketRegistryId('all')
                  }}
                />
              </div>

              <div className="nav-block">
                <div className="nav-caption">{t('market.registryList')}</div>
                {(marketSnapshot?.registries ?? []).map((registry) => (
                  <div className={`source-item ${selectedMarketRegistryId === registry.id ? 'is-active' : ''}`} key={registry.id}>
                    <button
                      className="source-main"
                      onClick={() => {
                        setSelectedMarketRegistryId(registry.id)
                      }}
                      type="button"
                    >
                      <div className="source-main-copy">
                        <strong>{registry.label}</strong>
                        <span>{getRegistryStatusLabel(registry.status, t)}</span>
                      </div>
                    </button>

                    <div className="source-side">
                      <span className={`registry-status registry-${registry.status}`} />
                      {!registry.system ? (
                        <button
                          className="source-remove"
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleRemoveMarketRegistry(registry.id)
                          }}
                          title={t('common.remove')}
                          type="button"
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

            </>
          )}
        </aside>

        <main className="library-pane">
          {activeTab === 'library' ? (
            viewMode === 'grid' ? (
              <>
                <div className="pane-header">
                  <div className="pane-header-copy">
                    <span className="pane-kicker">{t('library.paneTitle')}</span>
                    <h1>{selectedSourceTitle}</h1>
                    <p>{selectedSourceSubtitle}</p>
                  </div>

                  <div className="pane-metrics">
                    <div className="metric-card">
                      <span>{t('library.count.visible')}</span>
                      <strong>{visibleSkills.length}</strong>
                    </div>
                    <div className="metric-card">
                      <span>{t('library.count.enabled')}</span>
                      <strong>{visibleEnabledCount}</strong>
                    </div>
                    <div className="metric-card">
                      <span>{t('library.count.disabled')}</span>
                      <strong>{visibleDisabledCount}</strong>
                    </div>
                  </div>
                </div>

                {errorMessage ? <div className="banner error-banner">{errorMessage}</div> : null}

                <div className="table-shell">
                  <div className="table-body">
                    {!snapshot ? (
                      <EmptyState
                        description={t('library.scanLoadingDescription')}
                        title={t('library.scanLoadingTitle')}
                      />
                    ) : visibleSkills.length === 0 ? (
                      <EmptyState
                        description={t('library.emptyDescription')}
                        title={t('library.emptyTitle')}
                      />
                    ) : (
                      visibleSkills.map((skill) => (
                        <SkillCard
                          active={selectedSkillId === skill.id}
                          formattedUpdatedAt={formatDate(skill.updatedAt)}
                          key={skill.id}
                          latestVersion={skillUpdateMap[skill.filePath]?.latestVersion}
                          onClick={() => {
                            setSelectedSkillId(skill.id)
                          }}
                          onDoubleClick={() => {
                            setSelectedSkillId(skill.id)
                            setViewMode('skill')
                          }}
                          onContextMenu={(x, y) => {
                            setContextMenu({ x, y, skillId: skill.id })
                          }}
                          statusDisabledLabel={t('library.skillInternalDisabled')}
                          statusEnabledLabel={t('common.enabled')}
                          statusSystemDisabledLabel={t('common.systemDisabled')}
                          updateAvailable={skillUpdateMap[skill.filePath]?.updateAvailable}
                          updateLabel={t('market.updateBadge')}
                          updateTitle={t('library.updateAvailable')}
                          skill={skill}
                        />
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : !selectedSkill ? (
              <EmptyState description={t('library.noContent')} title={t('library.noContentTitle')} />
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  background: 'var(--main-bg)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 20px',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <button
                    onClick={() => {
                      if (hasUnsavedChanges) {
                        if (window.confirm(t('library.skillMode.discardConfirm'))) {
                          setDrafts((prev) => {
                            const next = { ...prev }
                            if (selectedSkill) delete next[selectedSkill.id]
                            return next
                          })
                          setViewMode('grid')
                        }
                      } else {
                        setViewMode('grid')
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-soft)',
                      padding: '6px 0',
                      fontSize: '13px',
                      fontWeight: 500,
                    }}
                  >
                    <ArrowLeft size={16} /> {t('library.skillMode.back')}
                  </button>

                  <div
                    className="mode-switch"
                    style={{ margin: 0, padding: 0, border: 'none', background: 'var(--button-bg)' }}
                  >
                    {[
                      { icon: Eye, id: 'preview', label: t('library.skillMode.previewTab') },
                      { icon: FileCode2, id: 'source', label: t('library.skillMode.sourceTab') },
                      { icon: PencilLine, id: 'edit', label: t('library.skillMode.editTab') },
                    ].map((item) => (
                      <button
                        className={detailMode === item.id ? 'is-active' : ''}
                        key={item.id}
                        onClick={() => setDetailMode(item.id as DetailMode)}
                        type="button"
                      >
                        <item.icon size={15} />
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      onClick={() => setFontSize((current) => Math.max(10, current - 1))}
                      style={{
                        background: 'var(--button-bg)',
                        border: '1px solid var(--line)',
                        borderRadius: '4px',
                        width: '28px',
                        height: '28px',
                        cursor: 'pointer',
                        color: 'var(--text)',
                      }}
                    >
                      A-
                    </button>
                    <span
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-soft)',
                        width: '24px',
                        textAlign: 'center',
                      }}
                    >
                      {fontSize}
                    </span>
                    <button
                      onClick={() => setFontSize((current) => Math.min(24, current + 1))}
                      style={{
                        background: 'var(--button-bg)',
                        border: '1px solid var(--line)',
                        borderRadius: '4px',
                        width: '28px',
                        height: '28px',
                        cursor: 'pointer',
                        color: 'var(--text)',
                      }}
                    >
                      A+
                    </button>
                    {detailMode === 'edit' ? (
                      <button
                        onClick={() => setShowPreview(!showPreview)}
                        style={{
                          marginLeft: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: showPreview ? 'var(--canvas-hover)' : 'var(--button-bg)',
                          border: '1px solid var(--line)',
                          borderRadius: '4px',
                          width: '28px',
                          height: '28px',
                          cursor: 'pointer',
                          color: showPreview ? 'var(--accent)' : 'var(--text-soft)',
                        }}
                        title={showPreview ? t('library.skillMode.toggleLivePreviewOff') : t('library.skillMode.toggleLivePreviewOn')}
                      >
                        <PanelRight size={15} />
                      </button>
                    ) : null}
                    <button
                      disabled={!hasUnsavedChanges || busyAction === 'save'}
                      onClick={() => void handleSave()}
                      style={{
                        marginLeft: '8px',
                        padding: '0 12px',
                        height: '28px',
                        fontSize: '12px',
                        fontWeight: 500,
                        background:
                          !hasUnsavedChanges || busyAction === 'save'
                            ? 'var(--button-bg)'
                            : 'var(--accent)',
                        color:
                          !hasUnsavedChanges || busyAction === 'save'
                            ? 'var(--text-soft)'
                            : 'white',
                        border: '1px solid var(--line)',
                        borderRadius: '4px',
                        cursor:
                          !hasUnsavedChanges || busyAction === 'save'
                            ? 'not-allowed'
                            : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Save size={14} />
                      {busyAction === 'save' ? t('library.skillMode.saveBusy') : t('library.skillMode.saveChanges')}
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1, overflow: 'auto', fontSize: `${fontSize}px` }}>
                  <div
                    className="detail-surface"
                    style={{
                      minHeight: '100%',
                      border: 'none',
                      borderRadius: 0,
                      overflow: 'visible',
                      margin: 0,
                      fontSize: '1em',
                    }}
                  >
                    {detailMode === 'preview' ? (
                      <article className="document-surface markdown-surface" style={{ fontSize: '1em' }}>
                        <div className="document-frontmatter">
                          {previewSource.frontmatter.slice(0, 10).map((entry) => (
                            <span
                              className="frontmatter-chip"
                              key={entry.key}
                              style={{ fontSize: '0.85em' }}
                            >
                              {entry.key}: {entry.value}
                            </span>
                          ))}
                        </div>

                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {previewSource.body || t('library.skillMode.noBody')}
                        </ReactMarkdown>
                      </article>
                    ) : null}

                    {detailMode === 'source' ? (
                      <pre className="document-surface source-surface" style={{ fontSize: '1em' }}>
                        {selectedSkill.rawContent}
                      </pre>
                    ) : null}

                    {detailMode === 'edit' ? (
                      <div className="editor-shell" style={{ fontSize: '1em' }}>
                        <div className="editor-panel">
                          <div className="editor-panel-head">
                            <span>{t('library.skillMode.sourceTitle')}</span>
                            <strong>{hasUnsavedChanges ? t('library.skillMode.unsaved') : t('library.skillMode.synced')}</strong>
                          </div>
                          <textarea
                            className="skill-editor"
                            onChange={(event) => {
                              if (!selectedSkill) {
                                return
                              }
                              const nextRaw = event.target.value
                              setDrafts((current) => ({
                                ...current,
                                [selectedSkill.id]: nextRaw,
                              }))
                            }}
                            spellCheck={false}
                            value={draftContent}
                            style={{ fontSize: '1em' }}
                          />
                        </div>

                        {showPreview ? (
                          <div className="editor-panel" style={{ background: 'var(--main-bg)' }}>
                            <div className="editor-panel-head">
                              <span>{t('library.skillMode.livePreview')}</span>
                              <strong>{t('status.frontmatterCount', { count: draftPreviewSource.frontmatter.length })}</strong>
                            </div>
                            <article
                              className="document-surface markdown-surface is-editor-preview"
                              style={{ fontSize: '1em', height: '100%', overflowY: 'auto' }}
                            >
                              <div className="document-frontmatter">
                                {draftPreviewSource.frontmatter.slice(0, 10).map((entry) => (
                                  <span
                                    className="frontmatter-chip"
                                    key={entry.key}
                                    style={{ fontSize: '0.85em' }}
                                  >
                                    {entry.key}: {entry.value}
                                  </span>
                                ))}
                              </div>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {draftPreviewSource.body || t('library.skillMode.noBody')}
                              </ReactMarkdown>
                            </article>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div
                  className="detail-statusbar"
                  style={{
                    borderTop: '1px solid var(--line)',
                    padding: '12px 20px',
                    background: 'var(--panel-bg)',
                  }}
                >
                  <div className="statusbar-note">
                    <ShieldCheck size={14} />
                    <span>{hasUnsavedChanges ? t('library.unsavedChanges') : t('status.synced')}</span>
                  </div>
                  <div className="statusbar-actions">
                    <span className="shortcut-hint">{t('context.shortcutSave')}</span>
                  </div>
                </div>
              </div>
            )
          ) : (
            <>
              <div className="pane-header">
                <div className="pane-header-copy">
                  <span className="pane-kicker">{t('nav.marketplace')}</span>
                  <h1>{selectedMarketTitle}</h1>
                  <p>{selectedMarketSubtitle}</p>
                  <div className="pane-header-meta">
                    {selectedMarketRegistry ? (
                      <>
                        <span className={`registry-badge registry-${selectedMarketRegistry.status}`}>
                          {getRegistryStatusLabel(selectedMarketRegistry.status, t)}
                        </span>
                        <span className="pane-meta-pill">
                          {t('market.loadedRegistryCount', { count: selectedMarketRegistryLoadedCount })}
                        </span>
                        <span className="pane-meta-pill">
                          {selectedMarketRegistry.system ? t('market.registrySystem') : t('market.registryCustom')}
                        </span>
                        {isExternalUrl(selectedMarketRegistry.manifestUrl) ? (
                          <button
                            className="pane-meta-pill pane-meta-link pane-meta-url"
                            onClick={() => {
                              void handleOpenExternal(selectedMarketRegistry.manifestUrl)
                            }}
                            title={t('common.openExternal', { url: selectedMarketRegistry.manifestUrl })}
                            type="button"
                          >
                            {selectedMarketRegistry.manifestUrl}
                          </button>
                        ) : (
                          <span
                            className="pane-meta-pill pane-meta-url"
                            title={selectedMarketRegistry.manifestUrl}
                          >
                            {selectedMarketRegistry.manifestUrl}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="pane-meta-pill">
                          {t('market.aggregateMetaRegistryCount', { count: marketRegistries.length })}
                        </span>
                        <span className="pane-meta-pill">
                          {t('market.aggregateMetaRemoteReady', { count: remoteReadyRegistryCount })}
                        </span>
                        <span className="pane-meta-pill">
                          {t('market.aggregateMetaLoaded', { count: visibleMarketSkills.length })}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="pane-header-actions">
                  <button
                    className="chrome-button"
                    onClick={() => setIsAddRegistryDialogOpen(true)}
                    type="button"
                  >
                    <FolderPlus size={15} />
                    {t('common.addRegistry')}
                  </button>

                  <div className="pane-metrics">
                    <div className="metric-card">
                      <span>{t('market.loaded')}</span>
                      <strong>{visibleMarketSkills.length}</strong>
                    </div>
                    <div className="metric-card">
                      <span>{t('market.typeInstalled')}</span>
                      <strong>{visibleInstalledMarketCount}</strong>
                    </div>
                    <div className="metric-card">
                      <span>{t('market.remoteCount')}</span>
                      <strong>{remoteReadyRegistryCount}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {selectedMarketRegistry?.status === 'error' && selectedMarketRegistry.error ? (
                <div className="banner error-banner">{selectedMarketRegistry.error}</div>
              ) : null}

              <div className="table-shell">
                <div className="table-body market-table-body">
                  {!marketSnapshot ? (
                    <EmptyState
                      description={t('market.emptyLoadingDescription')}
                      title={t('market.emptyLoadingTitle')}
                    />
                  ) : visibleMarketSkills.length === 0 ? (
                    <EmptyState
                      description={t('market.emptyDescription')}
                      title={t('market.emptyTitle')}
                    />
                  ) : (
                    visibleMarketSkills.map((skill) => (
                      <MarketCard
                        active={selectedMarketSkillId === skill.id}
                        installLabel={t('common.download')}
                        installed={installedSkillNameSet.has(skill.name.trim().toLowerCase())}
                        installing={marketInstallId === skill.id}
                        installingLabel={t('common.installing')}
                        installedLabel={t('common.installed')}
                        key={skill.id}
                        onClick={() => {
                          setSelectedMarketSkillId(skill.id)
                        }}
                        onInstall={() => {
                          void handleInstallMarketSkill(skill)
                        }}
                        skill={skill}
                        versionPrefix="v"
                      />
                    ))
                  )}
                </div>

                {visibleMarketSkills.length > 0 ? (
                  <div className="market-loadmore-strip">
                    <span className="market-loadmore-note">
                      {t('market.loadedCount', { count: visibleMarketSkills.length })}
                      {marketHasMore ? `, ${t('market.loadMoreReady')}` : `, ${t('market.loadMoreDone')}`}
                    </span>

                    {marketHasMore ? (
                      <button
                        className="chrome-button"
                        disabled={marketBusyAction === 'load-more'}
                        onClick={() => {
                          void loadMoreMarketSkills()
                        }}
                        type="button"
                      >
                        <RefreshCw
                          className={marketBusyAction === 'load-more' ? 'is-spinning' : ''}
                          size={15}
                        />
                        {marketBusyAction === 'load-more' ? t('market.loadMoreBusy') : t('market.loadMore')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </main>

        <section className="detail-pane">
          {activeTab === 'library' ? (
            !selectedSkill ? (
              <EmptyState
                description={t('library.inspectorEmptyDescription')}
                title={t('library.inspectorEmptyTitle')}
              />
            ) : (
              <>
                <div className="detail-header">
                  <div className="detail-header-copy">
                    <span className="pane-kicker">{t('library.inspectorEmptyTitle')}</span>
                    <h2>{selectedSkill.name}</h2>
                    <p>{selectedSkill.description}</p>
                  </div>

                  <div className="detail-actions">
                    {selectedSkillUpdate?.updateAvailable ? (
                      <button
                        className="detail-button is-accent"
                        disabled={updateBusyFilePath === selectedSkill.filePath}
                        onClick={() => {
                          void handleUpdateInstalledSkill(selectedSkill)
                        }}
                        type="button"
                      >
                        <RefreshCw className={updateBusyFilePath === selectedSkill.filePath ? 'is-spinning' : ''} size={15} />
                        {updateBusyFilePath === selectedSkill.filePath ? t('library.updateButtonBusy') : t('library.updateButton')}
                      </button>
                    ) : null}

                    <button
                      className="detail-button"
                      onClick={() => {
                        void handleReveal()
                      }}
                      type="button"
                    >
                      <FolderSearch2 size={15} />
                      {t('common.finder')}
                    </button>

                    <button
                      className={`detail-button ${selectedSkill.enabled ? 'is-danger' : ''}`}
                      onClick={() => {
                        void handleToggle()
                      }}
                      type="button"
                    >
                      <CircleOff size={15} />
                      {selectedSkill.enabled ? t('common.disable') : t('common.enable')}
                    </button>
                  </div>
                </div>

                <div className="detail-properties">
                  <div className="detail-prop-row">
                    <div className="detail-prop-label">{t('common.status')}</div>
                    <div className="detail-prop-value">
                      <span
                        className={`status-pill ${selectedSkill.enabled ? 'is-enabled' : 'is-disabled'}`}
                      >
                        {selectedSkill.enabled ? t('common.enabled') : t('common.disabled')}
                      </span>
                    </div>
                  </div>
                  <div className="detail-prop-row">
                    <div className="detail-prop-label">{t('common.source')}</div>
                    <div className="detail-prop-value">{selectedSkill.sourceLabel}</div>
                  </div>
                  {selectedSkill.marketOrigin ? (
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('library.marketOrigin')}</div>
                      <div className="detail-prop-value">
                        {selectedSkill.marketOrigin.registryLabel}
                      </div>
                    </div>
                  ) : null}
                  {selectedSkill.marketOrigin ? (
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('common.version')}</div>
                      <div className="detail-prop-value">
                        <span className="context-chip">{t('library.versionNow', { version: selectedSkill.marketOrigin.version })}</span>
                        {selectedSkillUpdate?.updateAvailable ? (
                          <span className="context-chip">
                            {t('library.versionLatest', { version: selectedSkillUpdate.latestVersion })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {selectedSkillUpdate?.updateAvailable ? (
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('common.update')}</div>
                      <div className="detail-prop-value">
                        <span className="skill-update-badge">
                          {t('library.marketVersionUpdate', { version: selectedSkillUpdate.latestVersion })}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <div className="detail-prop-row">
                    <div className="detail-prop-label">{t('common.path')}</div>
                    <div className="detail-prop-value">
                      <span className="context-chip">
                        {selectedSkill.relativePath === '.' ? '' : `${selectedSkill.relativePath}/`}
                        {selectedSkill.fileName}
                      </span>
                    </div>
                  </div>
                  <div className="detail-prop-row">
                    <div className="detail-prop-label">{t('common.addedAt')}</div>
                    <div className="detail-prop-value">{formatDate(selectedSkill.addedAt)}</div>
                  </div>
                  <div className="detail-prop-row">
                    <div className="detail-prop-label">{t('common.updatedAt')}</div>
                    <div className="detail-prop-value">{formatDate(selectedSkill.updatedAt)}</div>
                  </div>
                  <div className="detail-prop-row">
                    <div className="detail-prop-label">{t('common.frontmatter')}</div>
                    <div className="detail-prop-value">{selectedSkill.frontmatter.length}</div>
                  </div>
                </div>
              </>
            )
          ) : (
            <>
              <div className="detail-header">
                <div className="detail-header-copy">
                  <span className="pane-kicker">{t('market.inspectorTitle')}</span>
                  <h2>
                    {selectedMarketSkill?.name ??
                      selectedMarketRegistry?.label ??
                      t('market.overviewTitle')}
                  </h2>
                  <p>
                    {selectedMarketSkill?.description ??
                      (selectedMarketRegistry
                        ? t('market.inspectorRegistryDescription')
                        : null) ??
                      t('market.inspectorDescription')}
                  </p>
                </div>

                {selectedMarketSkill ? (
                  <div className="detail-actions">
                    <button
                      className="detail-button"
                      disabled={selectedMarketSkillInstalled || marketInstallId === selectedMarketSkill.id}
                      onClick={() => {
                        void handleInstallMarketSkill(selectedMarketSkill)
                      }}
                      type="button"
                    >
                      <Download size={15} />
                      {selectedMarketSkillInstalled
                        ? t('common.installed')
                        : marketInstallId === selectedMarketSkill.id
                          ? t('common.installing')
                          : t('market.installButton')}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="detail-properties">
                {selectedMarketSkill ? (
                  <>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('common.status')}</div>
                      <div className="detail-prop-value">
                        <span
                          className={`status-pill ${
                            selectedMarketSkillInstalled ? 'is-enabled' : 'is-disabled'
                          }`}
                        >
                          {selectedMarketSkillInstalled ? t('market.skillInstalledStatus') : t('market.skillNotInstalledStatus')}
                        </span>
                      </div>
                    </div>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('common.version')}</div>
                      <div className="detail-prop-value">v{selectedMarketSkill.version}</div>
                    </div>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('common.author')}</div>
                      <div className="detail-prop-value">{selectedMarketSkill.author}</div>
                    </div>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('common.source')}</div>
                      <div className="detail-prop-value">{selectedMarketSkill.registryLabel}</div>
                    </div>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('common.tags')}</div>
                      <div className="detail-prop-value">
                        {selectedMarketSkill.tags.length > 0 ? (
                          selectedMarketSkill.tags.map((tag) => (
                            <span className="market-tag" key={tag}>
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="detail-section-note">{t('market.tagsEmpty')}</span>
                        )}
                      </div>
                    </div>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('market.installSource')}</div>
                      <div className="detail-prop-value">
                        {isExternalUrl(selectedMarketSkill.downloadUrl) ? (
                          <button
                            className="inline-link market-path"
                            onClick={() => {
                              void handleOpenExternal(selectedMarketSkill.downloadUrl)
                            }}
                            title={t('common.openExternal', { url: selectedMarketSkill.downloadUrl })}
                            type="button"
                          >
                            {selectedMarketSkill.downloadUrl}
                          </button>
                        ) : (
                          <span className="market-path">{selectedMarketSkill.downloadUrl}</span>
                        )}
                      </div>
                    </div>
                    {selectedMarketSkill.homepageUrl ? (
                      <div className="detail-prop-row">
                        <div className="detail-prop-label">{t('common.homepage')}</div>
                        <div className="detail-prop-value">
                          {isExternalUrl(selectedMarketSkill.homepageUrl) ? (
                            <button
                              className="inline-link market-path"
                              onClick={() => {
                                void handleOpenExternal(selectedMarketSkill.homepageUrl as string)
                              }}
                              title={t('common.openExternal', { url: selectedMarketSkill.homepageUrl })}
                              type="button"
                            >
                              {selectedMarketSkill.homepageUrl}
                            </button>
                          ) : (
                            <span className="market-path">{selectedMarketSkill.homepageUrl}</span>
                          )}
                        </div>
                      </div>
                    ) : null}
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('market.installLocation')}</div>
                      <div className="detail-prop-value">
                        <span className="context-chip">
                          {marketSnapshot?.installBaseDir ?? '~/.Agents/skills'}/{selectedMarketSkill.slug}
                        </span>
                      </div>
                    </div>
                  </>
                ) : selectedMarketRegistry ? (
                  <>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('common.status')}</div>
                      <div className="detail-prop-value">
                        <span className={`registry-badge registry-${selectedMarketRegistry.status}`}>
                          {getRegistryStatusLabel(selectedMarketRegistry.status, t)}
                        </span>
                      </div>
                    </div>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('market.registryLoaded')}</div>
                      <div className="detail-prop-value">
                        {marketSkillCounts.get(selectedMarketRegistry.id) ?? 0}
                      </div>
                    </div>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('common.manifest')}</div>
                      <div className="detail-prop-value">
                        {isExternalUrl(selectedMarketRegistry.manifestUrl) ? (
                          <button
                            className="inline-link market-path"
                            onClick={() => {
                              void handleOpenExternal(selectedMarketRegistry.manifestUrl)
                            }}
                            title={t('common.openExternal', { url: selectedMarketRegistry.manifestUrl })}
                            type="button"
                          >
                            {selectedMarketRegistry.manifestUrl}
                          </button>
                        ) : (
                          <span className="market-path">{selectedMarketRegistry.manifestUrl}</span>
                        )}
                      </div>
                    </div>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('market.installLocation')}</div>
                      <div className="detail-prop-value">
                        <span className="context-chip">
                          {marketSnapshot?.installBaseDir ?? '~/.Agents/skills'}
                        </span>
                      </div>
                    </div>
                    {selectedMarketRegistry.error ? (
                      <div className="detail-prop-row">
                        <div className="detail-prop-label">{t('common.error')}</div>
                        <div className="detail-prop-value registry-error-text">
                          {selectedMarketRegistry.error}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('common.registry')}</div>
                      <div className="detail-prop-value">{marketRegistries.length}</div>
                    </div>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('market.remoteCount')}</div>
                      <div className="detail-prop-value">{remoteReadyRegistryCount}</div>
                    </div>
                    <div className="detail-prop-row">
                      <div className="detail-prop-label">{t('market.installLocation')}</div>
                      <div className="detail-prop-value">
                        <span className="context-chip">
                          {marketSnapshot?.installBaseDir ?? '~/.Agents/skills'}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>

            </>
          )}
        </section>
      </div>

      <footer className="status-strip">
        {activeTab === 'library' ? (
          <>
            <div className="status-strip-item">
              <Folders size={14} />
              <span>{t('status.librarySources', { count: snapshot?.sources.length ?? 0 })}</span>
            </div>
            <div className="status-strip-item">
              <ShieldCheck size={14} />
              <span>{t('status.libraryEnabledSkills', { count: skills.filter((skill) => skill.enabled && !skill.systemDisabled).length })}</span>
            </div>
            <div className="status-strip-item">
              <span>{t('status.lastRefresh', { date: snapshot ? formatDate(snapshot.lastRefreshedAt) : '--' })}</span>
            </div>
          </>
        ) : (
          <>
            <div className="status-strip-item">
              <Store size={14} />
              <span>
                {t('status.marketRemoteSummary', {
                  remote: remoteReadyRegistryCount,
                  ready: readyRegistryCount,
                  total: marketRegistries.length || 0,
                })}
              </span>
            </div>
            <div className="status-strip-item">
              <Download size={14} />
              <span>
                {t('status.marketLoadedSummary', {
                  loaded: visibleMarketSkills.length,
                  installed: visibleInstalledMarketCount,
                })}
              </span>
            </div>
            <div className="status-strip-item">
              <span>{marketSnapshot?.installBaseDir ?? '~/.Agents/skills'}</span>
            </div>
          </>
        )}
      </footer>

      {isAddRegistryDialogOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => setIsAddRegistryDialogOpen(false)}
          role="presentation"
        >
          <div
            aria-labelledby="add-registry-title"
            aria-modal="true"
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-head">
              <div className="modal-head-copy">
                <h2 id="add-registry-title">{t('dialog.addRegistryTitle')}</h2>
                <p>{t('dialog.registrySupportNote')}</p>
              </div>

              <button
                className="source-remove modal-close"
                onClick={() => setIsAddRegistryDialogOpen(false)}
                type="button"
              >
                <X size={15} />
              </button>
            </div>

            <div className="modal-body">
              <label className="modal-field">
                <span>{t('dialog.registryLabel')}</span>
                <input
                  className="market-input"
                  onChange={(event) => setNewRegistryLabel(event.target.value)}
                  placeholder={t('dialog.registryLabelPlaceholder')}
                  value={newRegistryLabel}
                />
              </label>

              <label className="modal-field">
                <span>{t('dialog.registryUrl')}</span>
                <input
                  autoFocus
                  className="market-input"
                  onChange={(event) => setNewRegistryUrl(event.target.value)}
                  placeholder={t('dialog.registryUrlPlaceholder')}
                  value={newRegistryUrl}
                />
              </label>

              <div className="modal-note">
                <span>{t('dialog.registryExamples')}</span>
                <code>https://claude-plugins.dev/api/skills?limit=50</code>
                <code>https://skillsllm.com/api/skills?limit=50</code>
              </div>
            </div>

            <div className="modal-foot">
              <button
                className="chrome-button"
                onClick={() => setIsAddRegistryDialogOpen(false)}
                type="button"
              >
                {t('dialog.cancel')}
              </button>
              <button
                className="chrome-button is-primary"
                disabled={!newRegistryUrl.trim() || marketBusyAction === 'registry'}
                onClick={() => {
                  void handleAddMarketRegistry()
                }}
                type="button"
              >
                <FolderPlus size={15} />
                {marketBusyAction === 'registry' ? t('dialog.submitRegistryBusy') : t('dialog.submitRegistry')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ToastStack toasts={toasts} />

      {
        contextMenu && (
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999,
            background: 'var(--main-bg)', border: '1px solid var(--line)', borderRadius: '8px',
            boxShadow: 'var(--shadow-lg)', padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px', width: '140px'
          }}>
            {[
              { id: 'preview', label: t('library.skillMode.previewTab'), icon: Eye },
              { id: 'source', label: t('library.skillMode.sourceTab'), icon: FileCode2 },
              { id: 'edit', label: t('library.skillMode.editTab'), icon: PencilLine }
            ].map(item => (
              <button
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px',
                  background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '4px', color: 'var(--text)',
                  textAlign: 'left', fontSize: '13px', fontWeight: 500
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel-bg)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                onClick={() => {
                  setSelectedSkillId(contextMenu.skillId)
                  setDetailMode(item.id as DetailMode)
                  setViewMode('skill')
                }}
              >
                <item.icon size={15} /> {item.label}
              </button>
            ))}
          </div>
        )
      }
    </div >
  )
}

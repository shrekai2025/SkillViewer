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
  Eye,
  FileCode2,
  Filter,
  FolderPlus,
  FolderSearch2,
  Folders,
  Moon,
  Monitor,
  PanelRight,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { AppSnapshot, DetailMode, SkillRecord, SkillSource, SourceKind } from './shared/contracts'

interface ToastMessage {
  id: number
  message: string
  tone: 'error' | 'info' | 'success'
}

const ALL_SOURCES_ID = 'all'

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Something went wrong.'
}

function formatDate(dateValue: string) {
  return dateFormatter.format(new Date(dateValue))
}

function getKindLabel(kind: SourceKind) {
  if (kind === 'global') {
    return '全局'
  }

  if (kind === 'application') {
    return '应用'
  }

  return '自定义'
}

function sortSkills(skills: SkillRecord[]) {
  return [...skills].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1
    }

    return right.updatedAt.localeCompare(left.updatedAt)
  })
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
  onClick,
  onDoubleClick,
  onContextMenu,
  skill,
}: {
  active: boolean
  onClick: () => void
  onDoubleClick?: () => void
  onContextMenu?: (x: number, y: number) => void
  skill: SkillRecord
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
        <strong>{skill.name}</strong>
        <span>{skill.sourceLabel}</span>
      </div>
      <div className="skill-card-summary">{skill.description}</div>
      <div className="skill-card-footer">
        <div className="skill-card-updated">{formatDate(skill.updatedAt)}</div>
        <div className="skill-card-status">
          {skill.systemDisabled ? (
            <span className="status-pill is-disabled" title="在底层系统中被标记为停用">系统停用</span>
          ) : (
            <span className={`status-pill ${skill.enabled ? 'is-enabled' : 'is-disabled'}`}>
              {skill.enabled ? '启用' : '内部停用'}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState<string>(ALL_SOURCES_ID)
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
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

  const deferredSearch = useDeferredValue(searchValue)
  const desktopApi = typeof window !== 'undefined' ? window.skillviewer : undefined

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
      const message = getErrorMessage(error)
      setErrorMessage(message)
      pushToast('error', message)
    } finally {
      setBusyAction((current) => (current === 'refresh' ? null : current))
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

        const message = getErrorMessage(error)
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
  }, [desktopApi])

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

  const selectedSource = snapshot?.sources.find((source) => source.id === selectedSourceId) ?? null
  const draftContent = selectedSkill ? drafts[selectedSkill.id] ?? selectedSkill.rawContent : ''
  const hasUnsavedChanges = selectedSkill ? draftContent !== selectedSkill.rawContent : false
  const previewSource = parseMarkdownSource(selectedSkill ? selectedSkill.rawContent : '')
  const draftPreviewSource = parseMarkdownSource(draftContent)
  const systemSources = (snapshot?.sources ?? []).filter((source) => source.system)
  const customSources = (snapshot?.sources ?? []).filter((source) => !source.system)
  const visibleEnabledCount = visibleSkills.filter((skill) => skill.enabled && !skill.systemDisabled).length
  const visibleDisabledCount = visibleSkills.length - visibleEnabledCount

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
      pushToast('success', '已添加新的 skill 文件夹。')
    } catch (error) {
      pushToast('error', getErrorMessage(error))
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
      pushToast('info', `已移除来源「${source.label}」。`)
    } catch (error) {
      pushToast('error', getErrorMessage(error))
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
      pushToast('success', '内容已同步到本地文件。')
    } catch (error) {
      pushToast('error', getErrorMessage(error))
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
      pushToast('success', nextSkill.enabled ? 'Skill 已重新启用。' : 'Skill 已停用。')
    } catch (error) {
      pushToast('error', getErrorMessage(error))
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
      pushToast('error', getErrorMessage(error))
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
          description="这个界面依赖本地文件系统桥接，直接在浏览器里打开时不会连接到桌面能力。"
          title="请通过 Electron 启动 SkillViewer"
        />
      </div>
    )
  }

  const sourceCounts = new Map<string, number>()
  for (const skill of skills) {
    sourceCounts.set(skill.sourceId, (sourceCounts.get(skill.sourceId) ?? 0) + 1)
  }

  const selectedSourceTitle = selectedSource ? selectedSource.label : 'All Skills'
  const selectedSourceSubtitle = selectedSource
    ? `${getKindLabel(selectedSource.kind)} 来源 · ${selectedSource.path}`
    : '跨所有来源聚合浏览'

  return (
    <div className="desktop-shell">
      <header className="chrome-bar">
        <div className="chrome-brand">
          <img alt="SkillViewer Logo" className="chrome-brand-logo" src="/logo.webp" />
          <div className="chrome-brand-copy">
            <strong>SkillViewer</strong>
            <span>Local skill library for macOS</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-soft)', marginBottom: '8px', textTransform: 'uppercase' }}>来源 (Source)</div>
                  <select
                    style={{ width: '100%', padding: '6px', fontSize: '12px', background: 'var(--button-bg)', border: '1px solid var(--line)', borderRadius: '4px', color: 'var(--text)', outline: 'none' }}
                    value={selectedSourceId}
                    onChange={(e) => setSelectedSourceId(e.target.value)}
                  >
                    <option value={ALL_SOURCES_ID}>所有来源</option>
                    {snapshot?.sources.map((src) => (
                      <option key={src.id} value={src.id}>{src.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-soft)', marginBottom: '8px', textTransform: 'uppercase' }}>状态 (Status)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                    <label style={{ display: 'flex', gap: '6px', cursor: 'pointer', alignItems: 'center' }}>
                      <input type="radio" checked={filterMode === 'all'} onChange={() => { setFilterMode('all'); localStorage.setItem('eagle-filter-mode', 'all') }} />
                      所有状态
                    </label>
                    <label style={{ display: 'flex', gap: '6px', cursor: 'pointer', alignItems: 'center' }}>
                      <input type="radio" checked={filterMode === 'enabled'} onChange={() => { setFilterMode('enabled'); localStorage.setItem('eagle-filter-mode', 'enabled') }} />
                      仅显示启用
                    </label>
                    <label style={{ display: 'flex', gap: '6px', cursor: 'pointer', alignItems: 'center' }}>
                      <input type="radio" checked={filterMode === 'disabled'} onChange={() => { setFilterMode('disabled'); localStorage.setItem('eagle-filter-mode', 'disabled') }} />
                      仅显示停用
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
              placeholder="搜索名称、描述、来源、路径"
              type="search"
              value={searchValue}
            />
          </label>
        </div>

        <div className="chrome-actions">
          <button
            className="chrome-button"
            onClick={() => {
              const next = themePreference === 'system' ? 'light' : themePreference === 'light' ? 'dark' : 'system'
              setThemePreference(next)
            }}
            title={`当前主题：${themePreference === 'system' ? '跟随系统' : themePreference === 'light' ? '浅色' : '深色'} (点击切换)`}
            type="button"
          >
            {themePreference === 'system' ? <Monitor size={15} /> : themePreference === 'light' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <button
            className="chrome-button"
            onClick={() => {
              void refreshSnapshot('列表已刷新。')
            }}
            type="button"
          >
            <RefreshCw className={busyAction === 'refresh' ? 'is-spinning' : ''} size={15} />
            刷新
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="nav-pane">
          <div className="nav-block">
            <div className="nav-caption">Library</div>
            <SourceItem
              active={selectedSourceId === ALL_SOURCES_ID}
              count={skills.length}
              label="All Skills"
              meta="跨来源聚合"
              onClick={() => {
                setSelectedSourceId(ALL_SOURCES_ID)
              }}
            />
          </div>

          <div className="nav-block">
            <div className="nav-caption">系统来源</div>
            {systemSources.map((source) => (
              <SourceItem
                active={selectedSourceId === source.id}
                count={sourceCounts.get(source.id) ?? 0}
                key={source.id}
                label={source.label}
                meta={`${getKindLabel(source.kind)} · ${source.path}`}
                onClick={() => {
                  setSelectedSourceId(source.id)
                }}
              />
            ))}
          </div>

          <div className="nav-block">
            <div className="nav-caption" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: '12px' }}>
              <span>自定义来源</span>
              <button
                className="source-remove"
                onClick={(e) => { e.stopPropagation(); void handleAddSource() }}
                title="添加自定义来源"
                type="button"
                style={{ opacity: 0.6, cursor: 'pointer' }}
              >
                <FolderPlus size={13} />
              </button>
            </div>
            {customSources.length === 0 ? (
              <EmptyState
                compact
                description="还没有接入自定义 skill 文件夹。"
                title="空来源"
              />
            ) : (
              customSources.map((source) => (
                <SourceItem
                  active={selectedSourceId === source.id}
                  count={sourceCounts.get(source.id) ?? 0}
                  key={source.id}
                  label={source.label}
                  meta={`${getKindLabel(source.kind)} · ${source.path}`}
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
              <span>总 Skill</span>
              <strong>{skills.length}</strong>
            </div>
            <div className="summary-card">
              <span>来源数</span>
              <strong>{snapshot?.sources.length ?? 0}</strong>
            </div>
            <div className="summary-card">
              <span>最近刷新</span>
              <strong>{snapshot ? formatDate(snapshot.lastRefreshedAt) : '--'}</strong>
            </div>
          </div>
        </aside>

        <main className="library-pane">
          {viewMode === 'grid' ? (
            <>
              <div className="pane-header">
                <div className="pane-header-copy">
                  <span className="pane-kicker">Skill Library</span>
                  <h1>{selectedSourceTitle}</h1>
                  <p>{selectedSourceSubtitle}</p>
                </div>

                <div className="pane-metrics">
                  <div className="metric-card">
                    <span>可见</span>
                    <strong>{visibleSkills.length}</strong>
                  </div>
                  <div className="metric-card">
                    <span>启用</span>
                    <strong>{visibleEnabledCount}</strong>
                  </div>
                  <div className="metric-card">
                    <span>停用</span>
                    <strong>{visibleDisabledCount}</strong>
                  </div>
                </div>
              </div>

              {errorMessage ? <div className="banner error-banner">{errorMessage}</div> : null}

              <div className="table-shell">
                <div className="table-body">
                  {!snapshot ? (
                    <EmptyState
                      description="首次扫描会读取你接入的目录，并提取 frontmatter、描述和时间信息。"
                      title="正在载入本地 skill"
                    />
                  ) : visibleSkills.length === 0 ? (
                    <EmptyState
                      description="试试切换来源、清空搜索，或者添加一个包含 `SKILL.md` 的目录。"
                      title="没有匹配结果"
                    />
                  ) : (
                    visibleSkills.map((skill) => (
                      <SkillCard
                        active={selectedSkillId === skill.id}
                        key={skill.id}
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
                        skill={skill}
                      />
                    ))
                  )}
                </div>
              </div>
            </>
          ) : !selectedSkill ? (
            <EmptyState description="此模式下需要选中一个Skill" title="无内容" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--main-bg)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--line)' }}>
                <button
                  onClick={() => {
                    if (hasUnsavedChanges) {
                      if (window.confirm('有未保存内容，是否丢弃？')) {
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
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-soft)', padding: '6px 0', fontSize: '13px', fontWeight: 500 }}
                >
                  <ArrowLeft size={16} /> 返回列表
                </button>

                <div className="mode-switch" style={{ margin: 0, padding: 0, border: 'none', background: 'var(--button-bg)' }}>
                  {[
                    { icon: Eye, id: 'preview', label: '预览' },
                    { icon: FileCode2, id: 'source', label: '原文' },
                    { icon: PencilLine, id: 'edit', label: '编辑' },
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
                  <button onClick={() => setFontSize(f => Math.max(10, f - 1))} style={{ background: 'var(--button-bg)', border: '1px solid var(--line)', borderRadius: '4px', width: '28px', height: '28px', cursor: 'pointer', color: 'var(--text)' }}>A-</button>
                  <span style={{ fontSize: '12px', color: 'var(--text-soft)', width: '24px', textAlign: 'center' }}>{fontSize}</span>
                  <button onClick={() => setFontSize(f => Math.min(24, f + 1))} style={{ background: 'var(--button-bg)', border: '1px solid var(--line)', borderRadius: '4px', width: '28px', height: '28px', cursor: 'pointer', color: 'var(--text)' }}>A+</button>
                  {detailMode === 'edit' && (
                    <button
                      onClick={() => setShowPreview(!showPreview)}
                      style={{ marginLeft: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: showPreview ? 'var(--canvas-hover)' : 'var(--button-bg)', border: '1px solid var(--line)', borderRadius: '4px', width: '28px', height: '28px', cursor: 'pointer', color: showPreview ? 'var(--accent)' : 'var(--text-soft)' }}
                      title={showPreview ? "关闭实时预览" : "开启侧边实时预览"}
                    >
                      <PanelRight size={15} />
                    </button>
                  )}
                  <button
                    disabled={!hasUnsavedChanges || busyAction === 'save'}
                    onClick={() => void handleSave()}
                    style={{
                      marginLeft: '8px', padding: '0 12px', height: '28px', fontSize: '12px', fontWeight: 500,
                      background: (!hasUnsavedChanges || busyAction === 'save') ? 'var(--button-bg)' : 'var(--accent)',
                      color: (!hasUnsavedChanges || busyAction === 'save') ? 'var(--text-soft)' : 'white',
                      border: '1px solid var(--line)', borderRadius: '4px',
                      cursor: (!hasUnsavedChanges || busyAction === 'save') ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: '6px'
                    }}
                  >
                    <Save size={14} />
                    {busyAction === 'save' ? '保存中...' : '保存修改'}
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, overflow: 'auto', fontSize: `${fontSize}px` }}>
                <div className="detail-surface" style={{ minHeight: '100%', border: 'none', borderRadius: 0, overflow: 'visible', margin: 0, fontSize: '1em' }}>
                  {detailMode === 'preview' ? (
                    <article className="document-surface markdown-surface" style={{ fontSize: '1em' }}>
                      <div className="document-frontmatter">
                        {previewSource.frontmatter.slice(0, 10).map((entry) => (
                          <span className="frontmatter-chip" key={entry.key} style={{ fontSize: '0.85em' }}>
                            {entry.key}: {entry.value}
                          </span>
                        ))}
                      </div>

                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {previewSource.body || '这份 skill 目前没有正文内容。'}
                      </ReactMarkdown>
                    </article>
                  ) : null}

                  {detailMode === 'source' ? (
                    <pre className="document-surface source-surface" style={{ fontSize: '1em' }}>{selectedSkill.rawContent}</pre>
                  ) : null}

                  {detailMode === 'edit' ? (
                    <div className="editor-shell" style={{ fontSize: '1em' }}>
                      <div className="editor-panel">
                        <div className="editor-panel-head">
                          <span>Markdown Source</span>
                          <strong>{hasUnsavedChanges ? '未保存改动' : '与磁盘同步'}</strong>
                        </div>
                        <textarea
                          className="skill-editor"
                          onChange={(event) => {
                            if (!selectedSkill) return
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

                      {showPreview && (
                        <div className="editor-panel" style={{ background: 'var(--main-bg)' }}>
                          <div className="editor-panel-head">
                            <span>Live Preview</span>
                            <strong>{draftPreviewSource.frontmatter.length} 项 frontmatter</strong>
                          </div>
                          <article className="document-surface markdown-surface is-editor-preview" style={{ fontSize: '1em', height: '100%', overflowY: 'auto' }}>
                            <div className="document-frontmatter">
                              {draftPreviewSource.frontmatter.slice(0, 10).map((entry) => (
                                <span className="frontmatter-chip" key={entry.key} style={{ fontSize: '0.85em' }}>
                                  {entry.key}: {entry.value}
                                </span>
                              ))}
                            </div>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {draftPreviewSource.body || '这份 skill 目前没有正文内容。'}
                            </ReactMarkdown>
                          </article>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="detail-statusbar" style={{ borderTop: '1px solid var(--line)', padding: '12px 20px', background: 'var(--panel-bg)' }}>
                <div className="statusbar-note">
                  <ShieldCheck size={14} />
                  <span>{hasUnsavedChanges ? '有未保存改动' : '内容已同步到本地文件'}</span>
                </div>
                <div className="statusbar-actions">
                  <span className="shortcut-hint">Cmd/Ctrl + S 保存</span>
                </div>
              </div>
            </div>
          )}
        </main>

        <section className="detail-pane">
          {!selectedSkill ? (
            <EmptyState
              description="选择一个 skill 后，这里会进入阅读、编辑和启停操作工作台。"
              title="右侧详情面板"
            />
          ) : (
            <>
              <div className="detail-header">
                <div className="detail-header-copy">
                  <span className="pane-kicker">Inspector</span>
                  <h2>{selectedSkill.name}</h2>
                  <p>{selectedSkill.description}</p>
                </div>

                <div className="detail-actions">
                  <button
                    className="detail-button"
                    onClick={() => {
                      void handleReveal()
                    }}
                    type="button"
                  >
                    <FolderSearch2 size={15} />
                    Finder
                  </button>

                  <button
                    className={`detail-button ${selectedSkill.enabled ? 'is-danger' : ''}`}
                    onClick={() => {
                      void handleToggle()
                    }}
                    type="button"
                  >
                    <CircleOff size={15} />
                    {selectedSkill.enabled ? '停用' : '启用'}
                  </button>
                </div>
              </div>

              <div className="detail-properties">
                <div className="detail-prop-row">
                  <div className="detail-prop-label">状态</div>
                  <div className="detail-prop-value">
                    <span className={`status-pill ${selectedSkill.enabled ? 'is-enabled' : 'is-disabled'}`}>
                      {selectedSkill.enabled ? '已启用' : '已停用'}
                    </span>
                  </div>
                </div>
                <div className="detail-prop-row">
                  <div className="detail-prop-label">来源</div>
                  <div className="detail-prop-value">{selectedSkill.sourceLabel}</div>
                </div>
                <div className="detail-prop-row">
                  <div className="detail-prop-label">路径</div>
                  <div className="detail-prop-value">
                    <span className="context-chip">
                      {selectedSkill.relativePath === '.' ? '' : `${selectedSkill.relativePath}/`}
                      {selectedSkill.fileName}
                    </span>
                  </div>
                </div>
                <div className="detail-prop-row">
                  <div className="detail-prop-label">添加时间</div>
                  <div className="detail-prop-value">{formatDate(selectedSkill.addedAt)}</div>
                </div>
                <div className="detail-prop-row">
                  <div className="detail-prop-label">更新时间</div>
                  <div className="detail-prop-value">{formatDate(selectedSkill.updatedAt)}</div>
                </div>
                <div className="detail-prop-row">
                  <div className="detail-prop-label">Frontmatter</div>
                  <div className="detail-prop-value">{selectedSkill.frontmatter.length} 项</div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <footer className="status-strip">
        <div className="status-strip-item">
          <Folders size={14} />
          <span>{snapshot?.sources.length ?? 0} 个来源</span>
        </div>
        <div className="status-strip-item">
          <ShieldCheck size={14} />
          <span>{skills.filter((skill) => skill.enabled && !skill.systemDisabled).length} 个已启用 skill</span>
        </div>
        <div className="status-strip-item">
          <span>最近刷新 {snapshot ? formatDate(snapshot.lastRefreshedAt) : '--'}</span>
        </div>
      </footer>

      <ToastStack toasts={toasts} />

      {
        contextMenu && (
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999,
            background: 'var(--main-bg)', border: '1px solid var(--line)', borderRadius: '8px',
            boxShadow: 'var(--shadow-lg)', padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px', width: '140px'
          }}>
            {[
              { id: 'preview', label: '预览视图', icon: Eye },
              { id: 'source', label: '查看源码', icon: FileCode2 },
              { id: 'edit', label: '编辑内容', icon: PencilLine }
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

import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconCloseOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { createSessionImportStore } from './session-import-store.js'
import type { DesktopSessionImportApi } from './session-import-api.js'
import type { ExternalSessionSource, ExternalSessionSummary } from '../session-import/types.js'
import { pickCurrentSessionCwd } from './workflow-run-params.js'

export type SessionImportOverlayProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createSessionImportStore>>
  & PropsLocale<'dsh-plugin-desktop/session-import'>
  & {
    api: DesktopSessionImportApi
    openImportedSession: (sessionId: SessionId) => void
  }

const SOURCES: readonly ExternalSessionSource[] = ['claude', 'codex', 'opencode']

function sourceLabel(
  source: ExternalSessionSource,
  t: SessionImportOverlayProps['t'],
): string {
  if (source === 'claude') return t('sourceClaude')
  if (source === 'codex') return t('sourceCodex')
  return t('sourceOpencode')
}

function rowKey(item: ExternalSessionSummary): string {
  return `${item.source}:${item.id}:${item.sourcePath}`
}

/**
 * Centered overlay: filter harness sources, search, multi-select, and import
 * selected sessions into DSH.
 */
export function SessionImportOverlay({
  useStore,
  actions,
  api,
  t,
  useSessions,
  openImportedSession,
}: SessionImportOverlayProps) {
  const open = useStore(state => state.panelOpen)
  const fallbackCwd = useSessions(state => pickCurrentSessionCwd(state))
  const [sources, setSources] = useState<ExternalSessionSource[]>([...SOURCES])
  const [query, setQuery] = useState('')
  const [contentSearch, setContentSearch] = useState(false)
  const [items, setItems] = useState<ExternalSessionSummary[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const selectedItems = useMemo(
    () => items.filter(item => selected.has(rowKey(item))),
    [items, selected],
  )

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') actions.setPanelOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, actions])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const handle = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      const run = query.trim()
        ? api.search({ query, sources, content: contentSearch })
        : api.list(sources)
      void run.then((next) => {
        if (cancelled) return
        setItems(next)
        setLoading(false)
      }, (err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('error'))
        setLoading(false)
      })
    }, query.trim() ? 250 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [open, query, sources, contentSearch, api, t])

  if (!open) return null

  const toggleSource = (source: ExternalSessionSource): void => {
    setSources((current) => {
      if (current.includes(source)) {
        const next = current.filter(entry => entry !== source)
        return next.length > 0 ? next : current
      }
      return [...current, source]
    })
  }

  const toggleRow = (item: ExternalSessionSummary): void => {
    const key = rowKey(item)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const importSelected = async (): Promise<void> => {
    if (selectedItems.length === 0 || importing) return
    setImporting(true)
    setStatus(null)
    setError(null)
    const notes: string[] = []
    let lastId: string | null = null
    try {
      for (const item of selectedItems) {
        const result = await api.importSession({
          source: item.source,
          id: item.id,
          sourcePath: item.sourcePath,
          ...(fallbackCwd ? { fallbackCwd } : {}),
        })
        lastId = result.sessionId
        notes.push(`${t('imported')}: ${result.title} (${result.turnCount})`)
        if (result.warnings.length > 0) {
          notes.push(`${t('warnings')}: ${result.warnings.join('; ')}`)
        }
      }
      setStatus(notes.join(' · '))
      setSelected(new Set())
      if (lastId) {
        openImportedSession(lastId as SessionId)
        actions.setPanelOpen(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="dshSessionImportOverlay" role="presentation">
      <div
        className="dshSessionImportDialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
      >
        <header className="dshSessionImportHeader">
          <h2 className="dshSessionImportTitle">{t('title')}</h2>
          <Button
            variant="ghost"
            aria-label={t('close')}
            icon={<IconCloseOutline16 />}
            onClick={() => actions.setPanelOpen(false)}
          />
        </header>

        <div className="dshSessionImportToolbar">
          <input
            className="dshSessionImportSearch"
            value={query}
            placeholder={t('searchPlaceholder')}
            onChange={event => setQuery(event.target.value)}
          />
          <div className="dshSessionImportSources">
            {SOURCES.map(source => (
              <label key={source}>
                <input
                  type="checkbox"
                  checked={sources.includes(source)}
                  onChange={() => toggleSource(source)}
                />
                {sourceLabel(source, t)}
              </label>
            ))}
            <label>
              <input
                type="checkbox"
                checked={contentSearch}
                onChange={event => setContentSearch(event.target.checked)}
              />
              {t('searchContent')}
            </label>
          </div>
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => {
              setQuery(current => current)
              setSources(current => [...current])
            }}
          >
            {t('refresh')}
          </Button>
        </div>

        <p className="dshSessionImportHint">{t('selectHint')}</p>

        <div className="dshSessionImportList">
          {loading && <div className="dshSessionImportEmpty">{t('loading')}</div>}
          {!loading && error !== null && (
            <div className="dshSessionImportError">{error}</div>
          )}
          {!loading && error === null && items.length === 0 && (
            <div className="dshSessionImportEmpty">{t('empty')}</div>
          )}
          {!loading && items.map(item => {
            const key = rowKey(item)
            return (
              <label key={key} className="dshSessionImportRow">
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggleRow(item)}
                />
                <span>
                  <div className="dshSessionImportRowTitle">{item.title}</div>
                  <div className="dshSessionImportRowMeta">
                    {sourceLabel(item.source, t)}
                    {item.cwd ? ` · ${item.cwd}` : ''}
                    {` · ${new Date(item.mtimeMs).toLocaleString()}`}
                  </div>
                  {item.preview && (
                    <div className="dshSessionImportRowPreview">{item.preview}</div>
                  )}
                </span>
              </label>
            )
          })}
        </div>

        <footer className="dshSessionImportFooter">
          <div className="dshSessionImportStatus">{status}</div>
          <Button
            variant="primary"
            disabled={importing || selectedItems.length === 0}
            onClick={() => void importSelected()}
          >
            {importing ? t('importing') : `${t('importSelected')} (${selectedItems.length})`}
          </Button>
        </footer>
      </div>
    </div>
  )
}

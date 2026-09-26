import { useEffect, useMemo, useState } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { WorkflowStep } from './workflow-store.js'
import type {
  DesktopWorkflowApi,
  WorkflowLlmProviderPrefView,
  WorkflowProviderGroupView,
  WorkflowStepType,
  CollabPeerView,
} from './desktop-workflow-api.js'

type StepPatch = { [K in keyof WorkflowStep]?: WorkflowStep[K] | undefined }

interface WorkflowStepInspectorProps {
  step: WorkflowStep | null
  t: (key: WorkflowLocaleKey) => string
  onChange: (stepId: string, patch: StepPatch) => void
  onRename: (oldId: string, newId: string) => void
  onDelete: (stepId: string) => void
  /** When set, LLM model field can pick from workflow prefs + DSH catalog. */
  api?: DesktopWorkflowApi
}

/** Build selectable `provider/model` routes for an LLM step. */
export function collectLlmModelRoutes(
  prefs: readonly WorkflowLlmProviderPrefView[],
  catalog: readonly WorkflowProviderGroupView[],
  current?: string,
): {
  prefs: readonly { value: string; label: string }[]
  catalog: readonly { value: string; label: string }[]
  orphan: string | null
} {
  const seen = new Set<string>()
  const prefOptions: { value: string; label: string }[] = []
  for (const entry of prefs) {
    const route = entry.model.trim()
    if (!route.includes('/') || seen.has(route)) continue
    seen.add(route)
    prefOptions.push({
      value: route,
      label: entry.id.trim() ? `${entry.id} — ${route}` : route,
    })
  }
  const catalogOptions: { value: string; label: string }[] = []
  for (const group of catalog) {
    for (const model of group.models) {
      const route = `${group.id}/${model.id}`
      if (!model.id || seen.has(route)) continue
      seen.add(route)
      catalogOptions.push({
        value: route,
        label: `${group.name || group.id} / ${model.name || model.id}`,
      })
    }
  }
  const orphan = current && current.trim().length > 0 && !seen.has(current) ? current : null
  return { prefs: prefOptions, catalog: catalogOptions, orphan }
}

/** Right-side property panel for the selected canvas node. */
export function WorkflowStepInspector({
  step,
  t,
  onChange,
  onRename,
  onDelete,
  api,
}: WorkflowStepInspectorProps) {
  const [idDraft, setIdDraft] = useState(step?.id ?? '')
  const [llmPrefs, setLlmPrefs] = useState<WorkflowLlmProviderPrefView[]>([])
  const [llmCatalog, setLlmCatalog] = useState<WorkflowProviderGroupView[]>([])
  const [llmRoutesLoading, setLlmRoutesLoading] = useState(false)

  useEffect(() => {
    setIdDraft(step?.id ?? '')
  }, [step?.id])

  useEffect(() => {
    if (!api) return
    let cancelled = false
    setLlmRoutesLoading(true)
    void (async () => {
      try {
        const [settings, catalog] = await Promise.all([
          api.getSettings(),
          api.listModelCatalog(),
        ])
        if (cancelled) return
        setLlmPrefs(settings.providers)
        setLlmCatalog(catalog.providers)
      } catch {
        if (!cancelled) {
          setLlmPrefs([])
          setLlmCatalog([])
        }
      } finally {
        if (!cancelled) setLlmRoutesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api])

  const llmRoutes = useMemo(
    () => collectLlmModelRoutes(llmPrefs, llmCatalog, step?.model),
    [llmPrefs, llmCatalog, step?.model],
  )

  if (!step) {
    return (
      <aside
        className="workflow-canvas-inspector"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h4>{t('canvasInspector')}</h4>
        <p className="workflow-canvas-inspector-empty">{t('canvasInspectorEmpty')}</p>
      </aside>
    )
  }

  const patch = (partial: StepPatch) => onChange(step.id, partial)

  return (
    <aside
      className="workflow-canvas-inspector"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="workflow-canvas-inspector-header">
        <h4>{t('canvasInspector')}</h4>
        <button
          type="button"
          className="workflow-btn small danger"
          onClick={() => onDelete(step.id)}
        >
          {t('delete')}
        </button>
      </div>

      <label className="workflow-form-group">
        <span>{t('canvasStepId')}</span>
        <input
          type="text"
          className="nodrag nopan nowheel"
          value={idDraft}
          onChange={(event) => setIdDraft(event.target.value)}
          onBlur={() => {
            const next = idDraft.trim()
            if (next && next !== step.id) onRename(step.id, next)
            else setIdDraft(step.id)
          }}
        />
      </label>

      <label className="workflow-form-group">
        <span>{t('canvasStepType')}</span>
        <select className="nodrag nopan nowheel"
          value={step.type}
          onChange={(event) => patch({ type: event.target.value as WorkflowStepType })}
        >
          <option value="script">{t('stepScript')}</option>
          <option value="task">{t('stepTask')}</option>
          <option value="llm">{t('stepLlm')}</option>
          <option value="approval">{t('stepApproval')}</option>
          <option value="collab_peer">{t('stepCollabPeer')}</option>
          <option value="sub_workflow">{t('stepSubWorkflow')}</option>
        </select>
      </label>

      {step.type === 'script' && (
        <label className="workflow-form-group">
          <span>{t('commandPlaceholder')}</span>
          <input className="nodrag nopan nowheel"
            type="text"
            value={step.run || ''}
            onChange={(event) => patch({ run: event.target.value })}
          />
        </label>
      )}

      {step.type === 'llm' && (
        <>
          <label className="workflow-form-group">
            <span>{t('promptPlaceholder')}</span>
            <textarea className="nodrag nopan nowheel"
              rows={4}
              value={step.prompt || ''}
              onChange={(event) => patch({ prompt: event.target.value })}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('stepRole')}</span>
            <input className="nodrag nopan nowheel"
              type="text"
              value={step.role || ''}
              onChange={(event) => {
                const value = event.target.value.trim()
                patch({ role: value.length > 0 ? value : undefined })
              }}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('stepModel')}</span>
            {api ? (
              <>
                <select className="nodrag nopan nowheel"
                  value={step.model || ''}
                  disabled={llmRoutesLoading}
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    patch({ model: value.length > 0 ? value : undefined })
                  }}
                >
                  <option value="">{t('stepModelAuto')}</option>
                  {llmRoutes.orphan && (
                    <option value={llmRoutes.orphan}>
                      {t('stepModelUnknown')} ({llmRoutes.orphan})
                    </option>
                  )}
                  {llmRoutes.prefs.length > 0 && (
                    <optgroup label={t('stepModelWorkflowRoutes')}>
                      {llmRoutes.prefs.map((option) => (
                        <option key={`pref:${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {llmRoutes.catalog.length > 0 && (
                    <optgroup label={t('stepModelCatalog')}>
                      {llmRoutes.catalog.map((option) => (
                        <option key={`catalog:${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {llmRoutes.prefs.length === 0 && llmRoutes.catalog.length === 0 && !llmRoutesLoading && (
                  <p className="workflow-canvas-inspector-empty">{t('stepModelEmptyHint')}</p>
                )}
              </>
            ) : (
              <input className="nodrag nopan nowheel"
                type="text"
                value={step.model || ''}
                placeholder="provider/model"
                onChange={(event) => {
                  const value = event.target.value.trim()
                  patch({ model: value.length > 0 ? value : undefined })
                }}
              />
            )}
          </label>
        </>
      )}

      {step.type === 'task' && (
        <>
          <label className="workflow-form-group">
            <span>{t('stepRole')}</span>
            <input className="nodrag nopan nowheel"
              type="text"
              value={step.role || ''}
              onChange={(event) => {
                const value = event.target.value.trim()
                patch({ role: value.length > 0 ? value : undefined })
              }}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('stepInputsJson')}</span>
            <textarea className="nodrag nopan nowheel"
              rows={3}
              value={step.inputs ? JSON.stringify(step.inputs, null, 2) : ''}
              onChange={(event) => {
                const raw = event.target.value.trim()
                if (!raw) {
                  patch({ inputs: undefined })
                  return
                }
                try {
                  const parsed = JSON.parse(raw) as unknown
                  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    patch({ inputs: parsed as Record<string, unknown> })
                  }
                } catch {
                  // Keep typing until JSON is valid.
                }
              }}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('stepOutputs')}</span>
            <input className="nodrag nopan nowheel"
              type="text"
              value={(step.outputs ?? []).join(', ')}
              onChange={(event) => patch({
                outputs: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
              })}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('stepAcceptance')}</span>
            <textarea className="nodrag nopan nowheel"
              rows={2}
              value={(step.acceptance ?? []).join('\n')}
              onChange={(event) => patch({
                acceptance: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean),
              })}
            />
          </label>
        </>
      )}

      {(step.type === 'script' || step.type === 'task') && (
        <label className="workflow-form-group">
          <span>{t('stepEnv')}</span>
          <textarea className="nodrag nopan nowheel"
            rows={2}
            value={Object.entries(step.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n')}
            onChange={(event) => {
              const env: Record<string, string> = {}
              for (const line of event.target.value.split('\n')) {
                const trimmed = line.trim()
                if (!trimmed) continue
                const eq = trimmed.indexOf('=')
                if (eq <= 0) continue
                env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1)
              }
              patch({ env: Object.keys(env).length > 0 ? env : undefined })
            }}
          />
        </label>
      )}

      {(step.type === 'task' || step.type === 'llm') && (
        <label className="workflow-form-group">
          <span>{t('stepHarness')}</span>
          <input className="nodrag nopan nowheel"
            type="text"
            value={step.harness || ''}
            onChange={(event) => {
              const value = event.target.value.trim()
              patch({ harness: value.length > 0 ? value : undefined })
            }}
            placeholder={t('stepHarnessPlaceholder')}
          />
        </label>
      )}

      <label className="workflow-form-group">
        <span>{t('stepTimeout')}</span>
        <input className="nodrag nopan nowheel"
          type="number"
          min={1}
          value={step.timeout ?? ''}
          placeholder={t('stepTimeoutPlaceholder')}
          onChange={(event) => {
            const raw = event.target.value.trim()
            patch({
              timeout: raw === '' ? undefined : Math.max(1, Number(raw) || 1),
            })
          }}
        />
      </label>

      {step.type === 'approval' && (
        <>
          <label className="workflow-form-group">
            <span>{t('questionPlaceholder')}</span>
            <input className="nodrag nopan nowheel"
              type="text"
              value={step.question || ''}
              onChange={(event) => patch({ question: event.target.value })}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('stepOptions')}</span>
            <input className="nodrag nopan nowheel"
              type="text"
              value={(step.options ?? ['approved', 'rejected']).join(', ')}
              onChange={(event) => patch({
                options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
              })}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('stepPass')}</span>
            <input className="nodrag nopan nowheel"
              type="text"
              value={(step.pass ?? ['approved']).join(', ')}
              onChange={(event) => patch({
                pass: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
              })}
            />
          </label>
          <p className="workflow-canvas-inspector-empty">{t('stepPassHint')}</p>
        </>
      )}

      {step.type === 'collab_peer' && (
        <>
          <label className="workflow-form-group">
            <span>{t('collabPeerKind')}</span>
            <select className="nodrag nopan nowheel"
              value={step.peer?.kind ?? 'agent'}
              onChange={(event) => {
                const kind = event.target.value as CollabPeerView['kind']
                patch({
                  peer: {
                    kind,
                    open: step.peer?.open ?? true,
                    slot: step.peer?.slot ?? 'slot-1',
                    role: step.peer?.role ?? 'peer',
                    ...(step.peer?.jid ? { jid: step.peer.jid } : {}),
                    ...(typeof step.peer?.quorum === 'number' ? { quorum: step.peer.quorum } : {}),
                  },
                })
              }}
            >
              <option value="session">session</option>
              <option value="agent">agent</option>
              <option value="workflow">workflow</option>
            </select>
          </label>
          <label className="workflow-form-group">
            <span>{t('collabPeerOpen')}</span>
            <input className="nodrag nopan nowheel"
              type="checkbox"
              checked={step.peer?.open !== false}
              onChange={(event) => patch({
                peer: {
                  kind: step.peer?.kind ?? 'agent',
                  open: event.target.checked,
                  slot: step.peer?.slot ?? 'slot-1',
                  role: step.peer?.role ?? 'peer',
                  ...(step.peer?.jid ? { jid: step.peer.jid } : {}),
                  ...(typeof step.peer?.quorum === 'number' ? { quorum: step.peer.quorum } : {}),
                },
              })}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('collabPeerSlot')}</span>
            <input className="nodrag nopan nowheel"
              type="text"
              value={step.peer?.slot ?? ''}
              onChange={(event) => {
                const slot = event.target.value.trim()
                patch({
                  peer: {
                    kind: step.peer?.kind ?? 'agent',
                    open: step.peer?.open !== false,
                    role: step.peer?.role ?? 'peer',
                    ...(slot ? { slot } : {}),
                    ...(step.peer?.jid ? { jid: step.peer.jid } : {}),
                    ...(typeof step.peer?.quorum === 'number' ? { quorum: step.peer.quorum } : {}),
                  },
                })
              }}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('collabPeerRole')}</span>
            <input className="nodrag nopan nowheel"
              type="text"
              value={step.peer?.role ?? ''}
              onChange={(event) => {
                const role = event.target.value.trim()
                patch({
                  peer: {
                    kind: step.peer?.kind ?? 'agent',
                    open: step.peer?.open !== false,
                    slot: step.peer?.slot ?? 'slot-1',
                    ...(role ? { role } : {}),
                    ...(step.peer?.jid ? { jid: step.peer.jid } : {}),
                    ...(typeof step.peer?.quorum === 'number' ? { quorum: step.peer.quorum } : {}),
                  },
                })
              }}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('collabPeerJid')}</span>
            <input className="nodrag nopan nowheel"
              type="text"
              value={step.peer?.jid ?? ''}
              placeholder="session@desktop.local/ses-1"
              onChange={(event) => {
                const jid = event.target.value.trim()
                patch({
                  peer: {
                    kind: step.peer?.kind ?? 'agent',
                    open: step.peer?.open !== false,
                    slot: step.peer?.slot ?? 'slot-1',
                    role: step.peer?.role ?? 'peer',
                    ...(jid ? { jid } : {}),
                    ...(typeof step.peer?.quorum === 'number' ? { quorum: step.peer.quorum } : {}),
                  },
                })
              }}
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('collabPeerQuorum')}</span>
            <input className="nodrag nopan nowheel"
              type="number"
              min={1}
              value={step.peer?.quorum ?? ''}
              placeholder="1"
              onChange={(event) => {
                const raw = event.target.value.trim()
                const base: CollabPeerView = {
                  kind: step.peer?.kind ?? 'agent',
                  open: step.peer?.open !== false,
                  slot: step.peer?.slot ?? 'slot-1',
                  role: step.peer?.role ?? 'peer',
                  ...(step.peer?.jid ? { jid: step.peer.jid } : {}),
                }
                patch({
                  peer: raw === ''
                    ? base
                    : { ...base, quorum: Math.max(1, Number(raw) || 1) },
                })
              }}
            />
          </label>
        </>
      )}

      {step.type === 'sub_workflow' && (
        <>
          <p className="workflow-canvas-inspector-empty">{t('subWorkflowHint')}</p>
          <label className="workflow-form-group">
            <span>{t('refPlaceholder')}</span>
            <input className="nodrag nopan nowheel"
              type="text"
              value={step.ref || ''}
              onChange={(event) => patch({ ref: event.target.value })}
            />
          </label>
        </>
      )}

      <label className="workflow-form-group">
        <span>{t('stepRetries')}</span>
        <input className="nodrag nopan nowheel"
          type="number"
          min={0}
          value={step.retries ?? ''}
          placeholder={t('stepRetriesPlaceholder')}
          onChange={(event) => {
            const raw = event.target.value.trim()
            patch({
              retries: raw === '' ? undefined : Math.max(0, Number(raw) || 0),
            })
          }}
        />
      </label>

      <label className="workflow-form-group">
        <span>{t('stepOnFailure')}</span>
        <select className="nodrag nopan nowheel"
          value={step.onFailure ?? ''}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'fail' || value === 'skip' || value === 'compensate') {
              patch({ onFailure: value })
              return
            }
            patch({ onFailure: undefined })
          }}
        >
          <option value="">{t('stepOnFailureDefault')}</option>
          <option value="fail">{t('stepOnFailureFail')}</option>
          <option value="skip">{t('stepOnFailureSkip')}</option>
          <option value="compensate">{t('stepOnFailureCompensate')}</option>
        </select>
      </label>

      {(step.onFailure === 'compensate' || step.compensation) && (
        <label className="workflow-form-group">
          <span>{t('stepCompensationPlaceholder')}</span>
          <input className="nodrag nopan nowheel"
            type="text"
            value={step.compensation?.run || ''}
            onChange={(event) => {
              const run = event.target.value.trim()
              if (!run) {
                patch({ compensation: undefined })
                return
              }
              patch({
                compensation: {
                  run,
                  ...(step.compensation?.env ? { env: step.compensation.env } : {}),
                },
              })
            }}
          />
        </label>
      )}

      <div className="workflow-form-group">
        <span>{t('canvasStepDeps')}</span>
        <code className="workflow-canvas-deps">
          {(step.deps && step.deps.length > 0) ? step.deps.join(', ') : '—'}
        </code>
      </div>
    </aside>
  )
}

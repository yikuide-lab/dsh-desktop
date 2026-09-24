import { useCallback, useEffect, useState } from 'react'
import type {
  DesktopWorkflowApi,
  WorkflowTemplateView,
  WorkflowView,
} from './desktop-workflow-api.js'
import type { WorkflowLocaleKey } from './locales-workflow.js'

type Props = {
  api: DesktopWorkflowApi
  t: (key: WorkflowLocaleKey) => string
}

/** Where the baseline YAML comes from before it lands in the editable box. */
type BaselineSource = 'manual' | 'workflow' | 'template'

type RsiProblem = {
  id: number
  title: string
  domain: string
  maxIterations: number
  status: string
  scenarioCount: number
}

type RsiIteration = {
  id: number
  iterationNumber: number
  reviewScore: number
  reviewFeedback: string
  status: string
  durationMs: number
}

export function RsiPanel({ api, t }: Props) {
  const [problems, setProblems] = useState<RsiProblem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [iterations, setIterations] = useState<RsiIteration[]>([])
  const [fTitle, setFTitle] = useState('')
  const [fDomain, setFDomain] = useState('summarization')
  const [fMaxIter, setFMaxIter] = useState(5)
  const [fCriteria, setFCriteria] = useState('')
  const [fBaseYaml, setFBaseYaml] = useState('')
  const [fSource, setFSource] = useState<BaselineSource>('manual')
  const [fWorkflowName, setFWorkflowName] = useState('')
  const [fTemplateId, setFTemplateId] = useState('')
  const [workflows, setWorkflows] = useState<WorkflowView[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplateView[]>([])
  const [baselineBusy, setBaselineBusy] = useState(false)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    setProblems(await api.rsiListProblems())
  }, [api])

  const loadIterations = useCallback(async (problemId: number) => {
    setIterations(await api.rsiGetIterations(problemId))
  }, [api])

  useEffect(() => { void load().catch(() => {}) }, [load])
  useEffect(() => {
    void (async () => {
      try {
        const [wf, tpl] = await Promise.all([api.listWorkflows(), api.listTemplates()])
        setWorkflows(wf)
        setTemplates(tpl)
      } catch {
        // Baseline pickers stay empty; manual entry still works.
      }
    })()
  }, [api])
  useEffect(() => { if (selectedId) void loadIterations(selectedId).catch(() => {}) }, [selectedId, loadIterations])

  /** Fill the editable baseline box from a saved workflow or a template. */
  const pickBaseline = async (source: BaselineSource, key: string) => {
    if (source === 'manual' || !key) return
    setBaselineBusy(true)
    try {
      const yaml = source === 'workflow'
        ? await api.exportWorkflowYaml(key)
        : templates.find((tpl) => tpl.id === key)?.yaml ?? ''
      if (yaml) setFBaseYaml(yaml)
    } catch {
      // Leave the box as-is; the operator can paste manually.
    } finally {
      setBaselineBusy(false)
    }
  }

  const createProblem = async () => {
    if (!fTitle.trim()) return
    await api.rsiCreateProblem({
      title: fTitle,
      domain: fDomain,
      maxIterations: fMaxIter,
      improvementCriteria: fCriteria,
      baseYaml: fBaseYaml,
    })
    setFTitle('')
    await load()
  }

  const runRSI = async (problemId: number) => {
    setRunning(true)
    try {
      await api.rsiRunIteration(problemId)
      await loadIterations(problemId)
      await load()
    } finally {
      setRunning(false)
    }
  }

  const deleteProblem = async (problemId: number) => {
    await api.rsiDeleteProblem(problemId)
    if (selectedId === problemId) setSelectedId(null)
    await load()
  }

  return (
    <div className="rsi-panel">
      <div className="rsi-header">
        <h3>{t('rsiTitle')}</h3>
        <p className="rsi-subtitle">{t('rsiSubtitle')}</p>
      </div>

      <div className="rsi-create">
        <h4>{t('rsiCreateProblem')}</h4>
        <div className="rsi-form">
          <input
            className="rsi-input"
            placeholder={t('rsiProblemTitle')}
            value={fTitle}
            onChange={(e) => setFTitle(e.target.value)}
          />
          <select className="rsi-select" value={fDomain} onChange={(e) => setFDomain(e.target.value)}>
            <option value="summarization">summarization</option>
            <option value="translation">translation</option>
            <option value="code_gen">code_gen</option>
            <option value="qa">qa</option>
            <option value="sentiment">sentiment</option>
          </select>
          <input
            className="rsi-input rsi-input-sm"
            type="number"
            min={1}
            max={20}
            value={fMaxIter}
            onChange={(e) => setFMaxIter(Number(e.target.value))}
          />
          <input
            className="rsi-input"
            placeholder={t('rsiImprovementCriteria')}
            value={fCriteria}
            onChange={(e) => setFCriteria(e.target.value)}
          />
          <textarea
            className="rsi-textarea"
            placeholder={t('rsiBaseYaml')}
            rows={4}
            value={fBaseYaml}
            onChange={(e) => setFBaseYaml(e.target.value)}
          />
          <div className="rsi-baseline">
            <select
              className="rsi-select"
              aria-label={t('rsiBaseline')}
              value={fSource}
              onChange={(e) => {
                const next = e.target.value as BaselineSource
                setFSource(next)
                setFWorkflowName('')
                setFTemplateId('')
              }}
            >
              <option value="manual">{t('rsiBaselineManual')}</option>
              <option value="workflow">{t('rsiBaselineWorkflow')}</option>
              <option value="template">{t('rsiBaselineTemplate')}</option>
            </select>
            {fSource === 'workflow' && (
              <select
                className="rsi-select"
                value={fWorkflowName}
                disabled={baselineBusy}
                onChange={(e) => {
                  setFWorkflowName(e.target.value)
                  void pickBaseline('workflow', e.target.value)
                }}
              >
                <option value="">{baselineBusy ? t('loading') : t('rsiBaselinePick')}</option>
                {workflows.map((wf) => (
                  <option key={wf.name} value={wf.name}>{wf.title || wf.name}</option>
                ))}
              </select>
            )}
            {fSource === 'template' && (
              <select
                className="rsi-select"
                value={fTemplateId}
                disabled={baselineBusy}
                onChange={(e) => {
                  setFTemplateId(e.target.value)
                  void pickBaseline('template', e.target.value)
                }}
              >
                <option value="">{baselineBusy ? t('loading') : t('rsiBaselinePick')}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                ))}
              </select>
            )}
          </div>
          <button type="button" className="rsi-btn" onClick={() => void createProblem()} disabled={!fTitle.trim()}>
            {t('rsiCreateProblem')}
          </button>
        </div>
      </div>

      <div className="rsi-body">
        <div className="rsi-problems">
          <h4>{t('rsiProblems')}</h4>
          {problems.length === 0 && <p className="rsi-empty">{t('rsiNoProblems')}</p>}
          {problems.map((p) => (
            <div
              key={p.id}
              className={`rsi-card ${selectedId === p.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(p.id)}
            >
              <div className="rsi-card-header">
                <span className="rsi-card-title">{p.title}</span>
                <span className={`rsi-badge rsi-badge-${p.status}`}>{p.status}</span>
              </div>
              <div className="rsi-card-meta">
                {p.domain} · {p.scenarioCount} · {t('rsiMaxIterations')}: {p.maxIterations}
              </div>
              <div className="rsi-card-actions">
                <button type="button" className="rsi-btn-sm" onClick={(e) => { e.stopPropagation(); void runRSI(p.id) }} disabled={running}>
                  {running ? t('rsiRunning') : t('rsiRun')}
                </button>
                <button type="button" className="rsi-btn-sm rsi-btn-danger" onClick={(e) => { e.stopPropagation(); void deleteProblem(p.id) }}>
                  {t('rsiDeleteConfirm')}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="rsi-iterations">
          <h4>{t('rsiIterations')}</h4>
          {!selectedId && <p className="rsi-empty">{t('rsiNoProblems')}</p>}
          {selectedId && iterations.length === 0 && <p className="rsi-empty">{t('rsiNoIterations')}</p>}
          {iterations.map((it) => (
            <div key={it.id} className="rsi-card">
              <div className="rsi-card-header">
                <span className="rsi-card-title">#{it.iterationNumber}</span>
                <span className="rsi-score">{it.reviewScore.toFixed(0)}/100</span>
              </div>
              <div className="rsi-card-meta">{it.reviewFeedback}</div>
              <div className="rsi-card-meta">{t('rsiDuration')}: {(it.durationMs / 1000).toFixed(1)}s</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import type { DesktopWorkflowApi } from './desktop-workflow-api.js'

type Props = {
  api: DesktopWorkflowApi
  t: (key: string) => string
}

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
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    setProblems(await api.rsiListProblems())
  }, [api])

  const loadIterations = useCallback(async (problemId: number) => {
    setIterations(await api.rsiGetIterations(problemId))
  }, [api])

  useEffect(() => { void load().catch(() => {}) }, [load])
  useEffect(() => { if (selectedId) void loadIterations(selectedId).catch(() => {}) }, [selectedId, loadIterations])

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

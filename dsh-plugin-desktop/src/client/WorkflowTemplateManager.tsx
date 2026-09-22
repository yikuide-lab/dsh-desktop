import { useState, useEffect, useCallback } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { WorkflowTemplate } from './workflow-store.js'
import type { DesktopWorkflowApi } from './desktop-workflow-api.js'
import { cloneTemplateYaml } from './workflow-template-clone.js'
import { WorkflowPreview } from './WorkflowPreview.js'

interface WorkflowTemplateManagerProps {
  api: DesktopWorkflowApi
  /** Open the editor with cloned YAML ready for visual or code redesign. */
  onUseTemplate: (yaml: string) => void
  t: (key: WorkflowLocaleKey) => string
}

export function WorkflowTemplateManager({ api, onUseTemplate, t }: WorkflowTemplateManagerProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const list = await api.listTemplates()
      setTemplates(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setIsLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.yaml,.yml'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (event) => {
        const yaml = event.target?.result as string
        void (async () => {
          setError(null)
          try {
            const saved = await api.saveTemplate({
              yaml,
              name: file.name.replace(/\.(yaml|yml)$/i, ''),
              description: t('templateImported'),
              category: 'custom',
            })
            await loadTemplates()
            setSelectedTemplate(saved)
          } catch (err) {
            setError(err instanceof Error ? err.message : t('error'))
          }
        })()
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const handleExport = (template: WorkflowTemplate) => {
    const blob = new Blob([template.yaml], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${template.name}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDelete = async (template: WorkflowTemplate) => {
    if (template.builtin === true) return
    if (!confirm(t('templateDeleteConfirm').replace('{name}', template.name))) return
    setBusyId(template.id)
    setError(null)
    try {
      await api.deleteTemplate(template.id)
      if (selectedTemplate?.id === template.id) setSelectedTemplate(null)
      await loadTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyId(null)
    }
  }

  const handleCopyRedesign = async (template: WorkflowTemplate) => {
    setBusyId(template.id)
    setError(null)
    try {
      const existing = await api.listWorkflows()
      const cloned = cloneTemplateYaml(
        template.yaml,
        existing.map((workflow) => workflow.name),
      )
      onUseTemplate(cloned.yaml)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('templateCloneFailed'))
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading) {
    return <div className="workflow-loading">{t('loading')}</div>
  }

  return (
    <div className="workflow-templates">
      {error && <div className="workflow-error">{error}</div>}
      <div className="workflow-templates-header">
        <h3>{t('templateTitle')}</h3>
        <div className="workflow-templates-actions">
          <button className="workflow-btn" onClick={handleImport}>
            {t('templateImport')}
          </button>
        </div>
      </div>
      <p className="workflow-templates-hint">{t('templateCopyHint')}</p>

      {templates.length === 0 ? (
        <div className="workflow-empty">
          <p>{t('templateNoTemplates')}</p>
        </div>
      ) : (
        <div className="workflow-template-grid">
          {templates.map((template) => (
            <div
              key={template.id}
              className={`workflow-template-card ${selectedTemplate?.id === template.id ? 'selected' : ''}`}
              onClick={() => setSelectedTemplate(template)}
            >
              <div className="workflow-template-header">
                <h4>{template.name}</h4>
                <span className="workflow-template-category">
                  {template.builtin === true ? t('templateBuiltin') : t('templateUser')}
                  {' · '}
                  {template.category}
                </span>
              </div>
              <p className="workflow-template-description">{template.description}</p>
              <div className="workflow-template-actions">
                <button
                  className="workflow-btn small"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleExport(template)
                  }}
                >
                  {t('templateExport')}
                </button>
                <button
                  className="workflow-btn small primary"
                  disabled={busyId === template.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleCopyRedesign(template)
                  }}
                >
                  {busyId === template.id ? t('loading') : t('templateCopyRedesign')}
                </button>
                {template.builtin !== true && (
                  <button
                    className="workflow-btn small danger"
                    disabled={busyId === template.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDelete(template)
                    }}
                  >
                    {t('delete')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedTemplate && (
        <div className="workflow-template-preview">
          <WorkflowPreview
            key={selectedTemplate.id}
            yaml={selectedTemplate.yaml}
            title={selectedTemplate.name}
            t={t}
            defaultMode="visual"
          />
        </div>
      )}
    </div>
  )
}

import { XYFLOW_STYLES } from './xyflow-styles.js'

const WORKFLOW_STYLES = `
/* Floating workflow surface (Cordis-style; escapes sidebar overflow clip).
   Geometry mirrors MarketLauncher so the footer entry stays visible when the
   sidebar is wide (slot wrappers use display:contents; a row foot clips a
   100%-width sibling). */
.dshWorkflowLauncherLayer {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  width: 100%;
  height: 42px;
  margin: 8px 0 0;
}
.dshWorkflowLauncherLayer[data-wide='false'] {
  width: 36px;
  height: 36px;
  margin: 0;
}
.dshWorkflowLauncher {
  flex: none;
  box-sizing: border-box;
  width: calc(100% + 4px);
  height: 42px;
  margin: 4px -2px;
  padding: 0 10px 0 8px;
  gap: 8px;
  justify-content: flex-start;
  overflow: hidden;
  border-radius: 12px;
  white-space: nowrap;
}
.dshWorkflowLauncher[data-wide='false'] {
  width: 36px;
  height: 36px;
  margin: 8px 0 10px;
  justify-content: center;
  gap: 0;
  padding: 0;
  border-radius: 50%;
}
.dshWorkflowLauncher[data-active] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
/* Slot anchors use display:contents; without a column foot the wide Market
   button (width ~100%) parks later footer actions outside the sidebar clip.
   Keep this unscoped to mode so compatibility (and any shell that skips body
   mode markers) still stacks Market / Workflow / … vertically. */
[class*="footerActions"] {
  display: flex !important;
  flex-direction: column !important;
  align-items: stretch;
  width: 100%;
  min-width: 0;
}
[data-slot="sidebar.footer.action"] {
  display: flex !important;
  flex-direction: column !important;
  gap: 6px;
  min-width: 0;
  width: 100%;
  max-height: min(40vh, 240px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
[data-slot="sidebar.footer.action"] > * {
  flex: none;
  min-width: 0;
  width: 100%;
}
.dshWorkflowPanelIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 18px;
  min-height: 18px;
}

/* Centered workflow workbench (shell.overlay; Market-style). */
.dshWorkflowOverlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  pointer-events: auto;
}
.dshWorkflowOverlayMask {
  position: absolute;
  inset: 0;
  border: 0;
  background: var(--dsw-alias-bg-mask-1, rgba(15, 23, 42, 0.45));
  backdrop-filter: var(--dsw-mask-blur, blur(6px));
  cursor: pointer;
}
.dshWorkflowOverlayPanel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  /* Default is one-third larger than the previous 1180×900 fixed size. */
  width: min(1573px, calc(100vw - 56px));
  height: min(1200px, calc(100vh - 56px));
  min-width: 720px;
  min-height: 480px;
  max-width: calc(100vw - 56px);
  max-height: calc(100vh - 56px);
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
  border-radius: 20px;
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, #fff));
  box-shadow: var(--dsw-shadow-lv3, 0 24px 64px rgba(0, 0, 0, 0.22));
}
.dshWorkflowOverlay[data-resizing] {
  user-select: none;
  cursor: nwse-resize;
}
.dshWorkflowOverlay[data-resizing] .dshWorkflowOverlayMask {
  cursor: inherit;
}
.dshWorkflowOverlayResize {
  position: absolute;
  z-index: 2;
  touch-action: none;
  -webkit-app-region: no-drag;
}
.dshWorkflowOverlayResize-e {
  top: 20px;
  right: 0;
  bottom: 20px;
  width: 8px;
  cursor: ew-resize;
}
.dshWorkflowOverlayResize-s {
  left: 20px;
  right: 20px;
  bottom: 0;
  height: 8px;
  cursor: ns-resize;
}
.dshWorkflowOverlayResize-se {
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
}
.dshWorkflowOverlayResize-se::after {
  content: '';
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--dsw-alias-label-secondary, #94a3b8);
  border-bottom: 2px solid var(--dsw-alias-label-secondary, #94a3b8);
  border-radius: 0 0 2px 0;
  opacity: 0.85;
  pointer-events: none;
}
.dshWorkflowOverlayHeader {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 22px 16px 28px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
}
.dshWorkflowOverlayHeader > div {
  min-width: 0;
}
.dshWorkflowOverlayHeader h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--dsw-alias-label-primary, inherit);
}
.dshWorkflowOverlayHeader p {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--dsw-alias-label-secondary, #6b7280);
}
.dshWorkflowOverlayBody {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.dshWorkflowOverlayBody .workflow-panel {
  flex: 1;
  min-height: 0;
  height: auto;
  padding: 18px 28px 24px;
}
.dshWorkflowOverlayBody .workflow-panel[data-embedded='true'] {
  padding-top: 14px;
}
.dshWorkflowOverlayBody .workflow-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.dshWorkflowOverlayBody .workflow-editor {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
@media (max-width: 720px) {
  .dshWorkflowOverlay {
    padding: 0;
  }
  .dshWorkflowOverlayPanel {
    width: 100% !important;
    height: 100% !important;
    min-width: 0;
    min-height: 0;
    max-width: none;
    max-height: none;
    border-radius: 0;
  }
  .dshWorkflowOverlayResize {
    display: none;
  }
}

/* Composer recommend chip (conversation.input.right). */
.dshWorkflowRecommend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: min(420px, 100%);
}
.dshWorkflowRecommend--model {
  padding: 0;
}
.dshWorkflowRecommend--armed {
  gap: 6px;
  padding: 2px 4px 2px 2px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-text-brand, #0b57d0) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-text-brand, #0b57d0) 10%, transparent);
}
.dshWorkflowModeIdleBadge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-text-secondary, #6b7280);
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  border: 1px solid var(--dsw-alias-border-subtle, rgba(0, 0, 0, 0.08));
  flex: none;
}
.dshWorkflowModeIdleBadge--workflow {
  color: #fff;
  background: var(--dsw-alias-text-brand, #0b57d0);
  border-color: color-mix(in srgb, var(--dsw-alias-text-brand, #0b57d0) 70%, transparent);
}
.dshWorkflowRecommendTrigger {
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  gap: 4px;
  font-size: 12px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshWorkflowRecommendTrigger[data-active],
.dshWorkflowRecommendTrigger[data-mode="workflow"] {
  background: color-mix(in srgb, var(--dsw-alias-text-brand, #0b57d0) 14%, transparent);
  color: var(--dsw-alias-text-brand, #0b57d0);
  font-weight: 600;
}
.dshWorkflowRecommendClear {
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--dsw-alias-text-secondary, #6b7280);
  flex: none;
}
.dshWorkflowRecommendClear:hover {
  color: var(--dsw-alias-text-primary, #111827);
}
.dshWorkflowRecommendSend {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--dsw-alias-text-brand, #0b57d0);
  border-radius: 999px;
  flex: none;
}
.dshWorkflowRecommendSend:hover:not(:disabled) {
  filter: brightness(1.05);
}
.dshWorkflowRecommendSend:disabled {
  opacity: 0.45;
  color: #fff;
}
.dshWorkflowRecommendItem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dshWorkflowRecommendTitle {
  font-size: 13px;
  line-height: 1.3;
}
.dshWorkflowRecommendMeta {
  font-size: 11px;
  color: var(--dsw-alias-text-secondary, #6b7280);
}

/* Soft composer outline while workflow mode is armed. */
[data-composer-card][data-workflow-armed="true"] {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--dsw-alias-text-brand, #0b57d0) 55%, transparent),
    0 0 0 4px color-mix(in srgb, var(--dsw-alias-text-brand, #0b57d0) 12%, transparent);
}

/* Workflow Panel */
.workflow-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1f2937);
}

.workflow-header {
  margin-bottom: 16px;
}

.workflow-header h2 {
  margin: 0 0 4px 0;
  font-size: 20px;
  font-weight: 600;
}

.workflow-header p {
  margin: 0;
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
}

/* Tabs */
.workflow-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  padding-bottom: 8px;
}

.workflow-tab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.workflow-tab:hover {
  background: var(--bg-hover, #f3f4f6);
}

.workflow-tab.active {
  background: var(--bg-active, #e5e7eb);
  color: var(--text-primary, #1f2937);
}

/* Content */
.workflow-content {
  flex: 1;
  overflow-y: auto;
}

/* Buttons */
.workflow-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color, #d1d5db);
  background: var(--bg-secondary, #fff);
  color: var(--text-primary, #1f2937);
  cursor: pointer;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.workflow-btn:hover {
  background: var(--bg-hover, #f3f4f6);
}

.workflow-btn.primary {
  background: var(--primary-color, #3b82f6);
  color: white;
  border-color: var(--primary-color, #3b82f6);
}

.workflow-btn.primary:hover {
  background: var(--primary-hover, #2563eb);
}

.workflow-btn.danger {
  color: var(--danger-color, #ef4444);
  border-color: var(--danger-color, #ef4444);
}

.workflow-btn.danger:hover {
  background: var(--danger-bg, #fef2f2);
}

.workflow-btn.small {
  padding: 4px 8px;
  font-size: 12px;
}

.workflow-btn.active {
  background: var(--bg-active, #e5e7eb);
}

/* Loading & Error */
.workflow-loading,
.workflow-error {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--text-secondary, #6b7280);
}

.workflow-error {
  color: var(--danger-color, #ef4444);
}

/* Empty State */
.workflow-empty {
  text-align: center;
  padding: 48px 16px;
  color: var(--text-secondary, #6b7280);
}

.workflow-empty h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
}

.workflow-empty p {
  margin: 0;
  font-size: 14px;
}

/* Workflow List */
.workflow-list-header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: flex-start;
  margin-bottom: 16px;
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.workflow-card {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 16px;
  background: var(--bg-secondary, #fff);
  transition: box-shadow 0.2s;
}

.workflow-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.workflow-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.workflow-card-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.workflow-card-name {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  background: var(--bg-hover, #f3f4f6);
  padding: 2px 6px;
  border-radius: 4px;
}

.workflow-card-description {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: var(--text-secondary, #6b7280);
  line-height: 1.5;
}

.workflow-card-meta {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.workflow-card-actions {
  display: flex;
  gap: 8px;
}

/* Editor */
.workflow-editor {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  gap: 12px;
}

.workflow-editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex: none;
  margin-bottom: 0;
  position: relative;
  z-index: 8;
  gap: 12px;
}

.workflow-editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: none;
  margin-bottom: 0;
  position: relative;
  z-index: 8;
}

.workflow-yaml-editor {
  flex: 1;
  min-height: 0;
  display: flex;
}
.workflow-yaml-editor textarea {
  width: 100%;
  flex: 1;
  min-height: 360px;
  font-family: monospace;
  font-size: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 10px;
  resize: none;
}

.workflow-visual-editor {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.workflow-form {
  margin-bottom: 0;
  flex: none;
}

.workflow-form-group {
  margin-bottom: 0;
}

.workflow-form-meta .workflow-form-group {
  margin-bottom: 0;
}

.workflow-form-group label {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
  font-weight: 500;
}

.workflow-form-group input,
.workflow-form-group textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px;
  font-size: 14px;
}

.workflow-steps h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
}

.workflow-step {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--bg-secondary, #fff);
}

.workflow-step-header {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.workflow-step-header input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 4px;
  font-size: 14px;
}

.workflow-step-header select {
  padding: 6px 10px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 4px;
  font-size: 14px;
}

.workflow-step-run,
.workflow-step-prompt,
.workflow-step-question {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 4px;
  font-size: 14px;
}

/* Validation */
.workflow-validation {
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 14px;
}

.workflow-validation.valid {
  background: var(--success-bg, #f0fdf4);
  color: var(--success-color, #22c55e);
  border: 1px solid var(--success-color, #22c55e);
}

.workflow-validation.invalid {
  background: var(--danger-bg, #fef2f2);
  color: var(--danger-color, #ef4444);
  border: 1px solid var(--danger-color, #ef4444);
}

.workflow-validation ul {
  margin: 8px 0 0 0;
  padding-left: 20px;
}

/* Runs */
.workflow-runs {
  display: flex;
  gap: 16px;
  height: 100%;
}

.workflow-runs-list {
  flex: 1;
  overflow-y: auto;
}

.workflow-runs-list h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
}

.workflow-run-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.workflow-run-card {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.workflow-run-card:hover {
  background: var(--bg-hover, #f3f4f6);
}

.workflow-run-card.selected {
  border-color: var(--primary-color, #3b82f6);
  background: var(--primary-bg, #eff6ff);
}

.workflow-run-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.workflow-run-name {
  font-weight: 500;
}

.workflow-run-status {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  color: white;
  font-weight: 500;
}

.workflow-run-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.workflow-run-detail {
  flex: 1;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 16px;
  overflow-y: auto;
}

.workflow-run-detail h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
}

.workflow-run-detail h4 {
  margin: 16px 0 8px 0;
  font-size: 14px;
}

.workflow-run-info {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.workflow-run-info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.workflow-run-info-item label {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.workflow-run-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.workflow-run-step {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  padding: 12px;
}

.workflow-run-step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.workflow-run-step-id {
  font-weight: 500;
}

.workflow-run-step-status {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  color: white;
}

.workflow-run-step-output,
.workflow-run-step-error {
  font-family: monospace;
  font-size: 12px;
  padding: 8px;
  background: var(--bg-hover, #f3f4f6);
  border-radius: 4px;
  margin-top: 8px;
}

.workflow-run-step-error {
  color: var(--danger-color, #ef4444);
}

.workflow-run-transcript {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(40vh, 360px);
  overflow: auto;
  padding: 4px 0;
}

.workflow-run-transcript-event {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-secondary, #f9fafb);
}

.workflow-run-transcript-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  margin-bottom: 4px;
}

/* Templates */
.workflow-templates {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.workflow-templates-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.workflow-templates-hint {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--muted-color, #6b7280);
  line-height: 1.4;
}

.workflow-editor-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--muted-color, #6b7280);
  line-height: 1.4;
}

.workflow-templates-header h3 {
  margin: 0;
  font-size: 16px;
}

.workflow-templates-actions {
  display: flex;
  gap: 8px;
}

.workflow-template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.workflow-template-card {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.workflow-template-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.workflow-template-card.selected {
  border-color: var(--primary-color, #3b82f6);
}

.workflow-template-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.workflow-template-header h4 {
  margin: 0;
  font-size: 14px;
}

.workflow-template-category {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  background: var(--bg-hover, #f3f4f6);
  padding: 2px 6px;
  border-radius: 4px;
}

.workflow-template-description {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.workflow-template-actions {
  display: flex;
  gap: 8px;
}

.workflow-template-preview {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 16px;
}

.workflow-template-preview h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
}

.workflow-template-yaml {
  font-family: monospace;
  font-size: 13px;
  background: var(--bg-hover, #f3f4f6);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  white-space: pre-wrap;
  margin: 0;
  max-height: min(48vh, 420px);
}

.workflow-list-preview {
  margin-top: 16px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 16px;
}

.workflow-editor-header h2 {
  margin: 0;
  font-size: 20px;
  min-width: 0;
}

.workflow-editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: none;
}

.workflow-preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.workflow-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  flex: none;
}

.workflow-preview-header h4 {
  margin: 0;
  font-size: 14px;
}

.workflow-preview-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--bg-secondary, #f3f4f6);
}

.workflow-preview-tab {
  border: none;
  background: transparent;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--muted-color, #6b7280);
}

.workflow-preview-tab.active {
  background: var(--bg-primary, #fff);
  color: var(--text-color, #111827);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.workflow-preview-tab:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.workflow-preview.is-fill {
  flex: 1 1 0;
  height: 100%;
}

.workflow-preview.is-fill .workflow-preview-canvas {
  flex: 1 1 0;
  height: auto;
  min-height: 240px;
  display: flex;
  flex-direction: column;
}

.workflow-preview.is-fill .workflow-preview-canvas .workflow-canvas-shell {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
}

.workflow-preview.is-fill .workflow-template-yaml {
  flex: 1 1 0;
  max-height: none;
  overflow: auto;
}

.workflow-preview-canvas {
  height: min(52vh, 460px);
  min-height: 280px;
}

.workflow-ai-design {
  position: relative;
  z-index: 7;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  flex: none;
  width: 100%;
  min-width: 0;
  min-height: 0;
  pointer-events: auto;
}

.workflow-ai-design.has-preview {
  flex: 1 1 0;
}

.workflow-ai-design-chrome {
  flex: none;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  background: var(--bg-secondary, #f8fafc);
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: auto;
  -webkit-user-select: text;
  user-select: text;
}

.workflow-ai-design-chrome textarea {
  resize: vertical;
  min-height: 72px;
  max-height: 160px;
  pointer-events: auto;
  -webkit-user-select: text;
  user-select: text;
}

.workflow-ai-design-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.workflow-ai-design-header h3 {
  margin: 0 0 4px;
  font-size: 14px;
}

.workflow-ai-design-header p {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
}

.workflow-ai-design-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
}

.workflow-ai-design-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.workflow-ai-design-check-hint {
  margin: -4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary, #64748b);
}

.workflow-ai-design-model-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 0.8fr);
  gap: 10px 12px;
}

.workflow-ai-design-model-row .workflow-form-group {
  margin: 0;
}

.workflow-ai-design-model-row select {
  width: 100%;
}

@media (max-width: 720px) {
  .workflow-ai-design-model-row {
    grid-template-columns: 1fr;
  }
}

.workflow-ai-design-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.workflow-ai-design-workspace {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  background: var(--bg-primary, #fff);
  overflow: hidden;
}

.workflow-ai-design-workspace-header {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px 0;
  font-size: 12px;
}

.workflow-ai-design-workspace-header span {
  color: var(--text-secondary, #64748b);
}

.workflow-ai-design-workspace .workflow-validation {
  flex: none;
  margin: 0 12px;
}

.workflow-ai-design-workspace-body {
  flex: 1 1 0;
  min-height: 0;
  padding: 0 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.workflow-ai-design-workspace-foot {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--border-color, #e5e7eb);
  background: var(--bg-secondary, #f8fafc);
  position: relative;
  z-index: 2;
}

.workflow-ai-design-history {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
}

.workflow-ai-design-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
}

.workflow-ai-design-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 96px;
  overflow: auto;
}

.workflow-ai-design-history-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}

.workflow-ai-design-history-item:hover {
  background: var(--bg-secondary, #f1f5f9);
}

.workflow-ai-design-history-item.active {
  border-color: var(--accent, #2563eb);
  background: color-mix(in srgb, var(--accent, #2563eb) 12%, transparent);
}

.workflow-ai-design-history-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #0f172a);
}

.workflow-ai-design-history-time {
  flex: none;
  color: var(--text-secondary, #94a3b8);
  font-variant-numeric: tabular-nums;
}

.workflow-preview-empty {
  margin: 0;
  padding: 16px;
  color: var(--muted-color, #6b7280);
  font-size: 13px;
}

.workflow-preview-step-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}

.workflow-preview-step-meta > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.workflow-preview-step-meta dt {
  font-size: 11px;
  color: var(--muted-color, #6b7280);
}

.workflow-preview-step-meta dd {
  margin: 0;
  font-size: 13px;
  word-break: break-word;
}

.workflow-preview-step-detail {
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.workflow-binding-banner {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-left: auto;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.workflow-bound-badge {
  color: #166534;
  background: #dcfce7;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
}

.workflow-gates {
  margin: 16px 0;
  padding: 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  background: var(--bg-hover, #f9fafb);
}

.workflow-gate-card {
  margin-top: 8px;
}

.workflow-gate-question {
  margin: 0 0 4px 0;
  font-weight: 600;
}

.workflow-gate-step {
  margin: 0 0 8px 0;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.workflow-gate-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.workflow-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: none;
  width: 100%;
}
.workflow-settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px 20px;
}
.workflow-settings-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.workflow-settings-field input,
.workflow-settings-field select,
.workflow-settings-field textarea,
.workflow-settings-provider-row input {
  padding: 8px 10px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 8px;
  font-size: 13px;
}
.workflow-settings-field textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  resize: vertical;
  min-height: 64px;
}
.workflow-step-failure {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  align-items: flex-end;
}
.workflow-step-failure label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  min-width: 140px;
}
.workflow-step-failure input,
.workflow-step-failure select {
  padding: 6px 8px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px;
  font-size: 13px;
}
.workflow-settings-providers {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.workflow-settings-providers-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.workflow-settings-provider-actions {
  display: flex;
  gap: 8px;
}
.workflow-settings-lead {
  margin: 0 0 4px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--muted-color, #6b7280);
}
.workflow-settings-empty {
  margin: 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--bg-secondary, #f9fafb);
  color: var(--muted-color, #6b7280);
  font-size: 13px;
}
.workflow-settings-picker {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) auto;
  gap: 12px;
  align-items: end;
  padding: 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 10px;
  background: var(--bg-secondary, #f9fafb);
}
.workflow-settings-custom {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px dashed var(--border-color, #d1d5db);
  border-radius: 10px;
}
.workflow-settings-custom h4 {
  margin: 0;
  font-size: 14px;
}
.workflow-settings-provider-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 10px;
}
.workflow-settings-provider-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.workflow-settings-provider-card-foot code {
  font-size: 12px;
  color: var(--muted-color, #6b7280);
}
.workflow-settings-provider-row {
  display: grid;
  grid-template-columns: 1fr 1.4fr 1.4fr auto;
  gap: 8px;
  align-items: center;
}
.workflow-settings-field select {
  padding: 8px 10px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 8px;
  font-size: 13px;
  background: var(--bg-primary, #fff);
}
.workflow-success {
  color: #166534;
  background: #dcfce7;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}

.workflow-visual-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

.workflow-form-meta {
  display: grid;
  grid-template-columns: 1fr 1fr 1.4fr;
  gap: 12px;
}

.workflow-canvas-shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 300px;
  /* Definite row so the stage/React Flow can stretch with the overlay. */
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
  flex: 1 1 0;
  min-height: 0;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-primary, #fff);
}

.workflow-canvas-shell.is-readonly {
  grid-template-columns: minmax(0, 1fr);
}

.workflow-canvas-shell.is-readonly:has(.workflow-canvas-inspector-readonly) {
  grid-template-columns: minmax(0, 1fr) 280px;
}

.workflow-canvas-palette,
.workflow-canvas-inspector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--bg-secondary, #f9fafb);
  border-right: 1px solid var(--border-color, #e5e7eb);
  overflow: auto;
}

.workflow-canvas-inspector {
  border-right: none;
  border-left: 1px solid var(--border-color, #e5e7eb);
}

.workflow-canvas-palette h4,
.workflow-canvas-inspector h4 {
  margin: 0;
  font-size: 13px;
}

.workflow-canvas-palette-hint,
.workflow-canvas-inspector-empty {
  margin: 0;
  font-size: 12px;
  color: var(--muted-color, #6b7280);
  line-height: 1.4;
}

.workflow-canvas-palette-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.workflow-canvas-palette-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
  cursor: grab;
  text-align: left;
  font-size: 13px;
}

.workflow-canvas-palette-item:active {
  cursor: grabbing;
}

.workflow-canvas-palette-type {
  font-size: 11px;
  color: var(--muted-color, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.workflow-canvas-stage {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.workflow-canvas-stage .react-flow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.workflow-flow-node {
  min-width: 140px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 2px solid #94a3b8;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
  font-size: 12px;
}

.workflow-flow-node.selected {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
}

.workflow-flow-node.type-script { border-color: #8b5cf6; }
.workflow-flow-node.type-task { border-color: #3b82f6; }
.workflow-flow-node.type-llm { border-color: #10b981; }
.workflow-flow-node.type-approval { border-color: #f59e0b; }
.workflow-flow-node.type-sub_workflow { border-color: #ec4899; }

.workflow-flow-node.unsupported {
  opacity: 0.85;
  border-style: dashed;
}

.workflow-flow-node-type {
  font-size: 10px;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 2px;
}

.workflow-flow-node-id {
  font-weight: 600;
  color: #0f172a;
}

.workflow-flow-node-detail {
  margin-top: 2px;
  font-size: 10px;
  color: #64748b;
  word-break: break-all;
}

.workflow-flow-handle {
  width: 8px !important;
  height: 8px !important;
  background: #64748b !important;
  border: 2px solid #fff !important;
}

.workflow-canvas-inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.workflow-canvas-deps {
  display: block;
  font-size: 12px;
  padding: 6px 8px;
  background: var(--bg-primary, #fff);
  border-radius: 4px;
  border: 1px solid var(--border-color, #e5e7eb);
  word-break: break-all;
}

.workflow-canvas-inspector .workflow-form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.workflow-canvas-inspector .workflow-form-group input,
.workflow-canvas-inspector .workflow-form-group select,
.workflow-canvas-inspector .workflow-form-group textarea {
  padding: 6px 8px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary, #0f172a);
  background: var(--bg-primary, #fff);
}

.workflow-canvas-inspector .workflow-form-group > span {
  color: var(--text-secondary, #64748b);
}

.workflow-unsaved-dialog {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-1, rgba(15, 23, 42, 0.45));
  pointer-events: auto;
}

.workflow-unsaved-dialog-card {
  width: min(420px, 100%);
  padding: 20px 22px;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: var(--dsw-shadow-lv3, 0 18px 48px rgba(0, 0, 0, 0.22));
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.workflow-unsaved-dialog-card h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.workflow-unsaved-dialog-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #64748b);
}

.workflow-unsaved-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 6px;
}

.workflow-stats-chip {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.workflow-stats {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  height: 100%;
}

.workflow-stats-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.workflow-stats-layout {
  display: grid;
  grid-template-columns: minmax(240px, 320px) 1fr;
  gap: 16px;
  min-height: 0;
  flex: 1;
}

@media (max-width: 860px) {
  .workflow-stats-layout {
    grid-template-columns: 1fr;
  }
}

.workflow-stats-list,
.workflow-stats-detail {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 12px;
  background: var(--bg-elevated, #fff);
}

.workflow-stats-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.workflow-stats-list-header h3 {
  margin: 0;
  font-size: 14px;
}

.workflow-stats-card {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: transparent;
  cursor: pointer;
  color: inherit;
}

.workflow-stats-card:hover {
  border-color: var(--accent-color, #2563eb);
}

.workflow-stats-card.selected {
  border-color: var(--accent-color, #2563eb);
  background: var(--bg-hover, #f3f4f6);
}

.workflow-stats-card-title {
  font-weight: 600;
  font-size: 14px;
}

.workflow-stats-card-name {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  margin: 2px 0 6px;
}

.workflow-stats-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.workflow-stats-detail-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 12px;
}

.workflow-stats-detail-header h3 {
  margin: 0;
  font-size: 16px;
}

.workflow-stats-summary-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  margin-bottom: 16px;
}

.workflow-stats-summary-bar > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 72px;
}

.workflow-stats-summary-bar strong {
  font-size: 16px;
}

.workflow-stats-summary-bar span {
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
}

.workflow-stats-section {
  margin-top: 12px;
}

.workflow-stats-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
}

.workflow-stats-muted {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.workflow-stats-byday {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.workflow-stats-day-row {
  display: grid;
  grid-template-columns: 96px 1fr minmax(140px, auto);
  gap: 8px;
  align-items: center;
  font-size: 12px;
}

.workflow-stats-day-date {
  font-variant-numeric: tabular-nums;
}

.workflow-stats-day-bar-track {
  height: 8px;
  border-radius: 4px;
  background: var(--bg-hover, #f3f4f6);
  overflow: hidden;
}

.workflow-stats-day-bar {
  height: 100%;
  border-radius: 4px;
  background: var(--accent-color, #2563eb);
}

.workflow-stats-day-counts {
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
}

.workflow-stats-recent {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.workflow-stats-recent-item {
  display: grid;
  grid-template-columns: 72px 88px 1fr auto;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  padding: 8px 10px;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-size: 12px;
}

.workflow-stats-recent-item:hover {
  border-color: var(--accent-color, #2563eb);
}

.workflow-stats-recent-id {
  font-family: monospace;
}

.workflow-stats-recent-error {
  margin: 4px 0 0 4px;
  font-size: 12px;
  color: var(--danger-color, #dc2626);
}

.workflow-settings-openai {
  margin: 0 0 16px;
  padding: 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
}

.workflow-settings-openai h4 {
  margin: 0 0 8px;
  font-size: 14px;
}

.workflow-settings-openai-key {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-hover, #f3f4f6);
  font-size: 12px;
}

.workflow-settings-openai-key code {
  word-break: break-all;
  font-family: monospace;
}
`

let stylesInstalled = false

export function installWorkflowStyles(): () => void {
  if (stylesInstalled) return () => {}
  const style = document.createElement('style')
  style.textContent = `${XYFLOW_STYLES}\n${WORKFLOW_STYLES}`
  document.head.appendChild(style)
  stylesInstalled = true
  return () => {
    style.remove()
    stylesInstalled = false
  }
}

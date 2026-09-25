/** Styles for the harness session-import overlay. */

const SESSION_IMPORT_STYLES = `
.dshSessionImportLauncherLayer {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  width: 100%;
  height: 42px;
  margin: 8px 0 0;
}
.dshSessionImportLauncherLayer[data-wide='false'] {
  width: 36px;
  height: 36px;
  margin: 0;
}
.dshSessionImportOverlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #0b1220 45%, transparent);
}
.dshSessionImportDialog {
  display: flex;
  flex-direction: column;
  width: min(920px, calc(100vw - 48px));
  height: min(720px, calc(100vh - 48px));
  border-radius: 12px;
  background: var(--bg-primary, #fff);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.dshSessionImportHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}
.dshSessionImportTitle {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.dshSessionImportToolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}
.dshSessionImportSearch {
  flex: 1 1 220px;
  min-width: 160px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 8px;
  background: var(--bg-secondary, #fff);
  color: var(--text-primary, #111);
}
.dshSessionImportSources {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}
.dshSessionImportSources label {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  cursor: pointer;
}
.dshSessionImportHint {
  padding: 8px 16px 0;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}
.dshSessionImportList {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dshSessionImportRow {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  gap: 10px;
  align-items: start;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 10px;
  background: var(--bg-secondary, #fafafa);
}
.dshSessionImportRowTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #111);
}
.dshSessionImportRowMeta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
  word-break: break-all;
}
.dshSessionImportRowPreview {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-primary, #374151);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dshSessionImportFooter {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color, #e5e7eb);
}
.dshSessionImportStatus {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  min-width: 0;
}
.dshSessionImportEmpty,
.dshSessionImportError {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}
.dshSessionImportError {
  color: #b91c1c;
}
`

let installed = false

export function installSessionImportStyles(): () => void {
  if (installed || typeof document === 'undefined') return () => undefined
  const style = document.createElement('style')
  style.setAttribute('data-dsh-session-import', 'true')
  style.textContent = SESSION_IMPORT_STYLES
  document.head.appendChild(style)
  installed = true
  return () => {
    style.remove()
    installed = false
  }
}

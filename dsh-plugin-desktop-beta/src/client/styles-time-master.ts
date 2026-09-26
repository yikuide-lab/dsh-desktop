/** Styles for the Time Master overlay. */

const TIME_MASTER_STYLES = `
.dshTimeMasterLauncherLayer {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  width: 100%;
  height: 42px;
  margin: 8px 0 0;
}
.dshTimeMasterLauncherLayer[data-wide='false'] {
  width: 36px;
  height: 36px;
  margin: 0;
}
.dshTimeMasterOverlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #0b1220 45%, transparent);
}
.dshTimeMasterDialog {
  display: flex;
  flex-direction: column;
  width: min(880px, calc(100vw - 48px));
  height: min(700px, calc(100vh - 48px));
  border-radius: 12px;
  background: var(--bg-primary, #fff);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.dshTimeMasterHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}
.dshTimeMasterTitle {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.dshTimeMasterTabs {
  display: flex;
  gap: 4px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}
.dshTimeMasterTab {
  padding: 8px 12px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-secondary, #6b7280);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.dshTimeMasterTab[data-active='true'] {
  color: var(--text-primary, #111);
  border-bottom-color: #2563eb;
}
.dshTimeMasterHint {
  padding: 8px 16px 0;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}
.dshTimeMasterToolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}
.dshTimeMasterToolbar input {
  flex: 1 1 180px;
  min-width: 140px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 8px;
  background: var(--bg-secondary, #fff);
  color: var(--text-primary, #111);
}
.dshTimeMasterBody {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  overflow: hidden;
}
.dshTimeMasterList {
  min-height: 0;
  overflow: auto;
  padding: 8px 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-right: 1px solid var(--border-color, #e5e7eb);
}
.dshTimeMasterRow {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 10px;
  background: var(--bg-secondary, #fafafa);
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
}
.dshTimeMasterRow[data-active='true'] {
  border-color: color-mix(in srgb, #2563eb 55%, var(--border-color, #e5e7eb));
  background: color-mix(in srgb, #2563eb 8%, var(--bg-secondary, #fafafa));
}
.dshTimeMasterRow[data-urgency='expired'] {
  border-color: color-mix(in srgb, #b91c1c 50%, var(--border-color, #e5e7eb));
}
.dshTimeMasterRow[data-urgency='soon'] {
  border-color: color-mix(in srgb, #d97706 50%, var(--border-color, #e5e7eb));
}
.dshTimeMasterRowTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #111);
}
.dshTimeMasterRowMeta {
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
}
.dshTimeMasterBadge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  background: #e5e7eb;
  color: #374151;
}
.dshTimeMasterBadge[data-urgency='expired'] {
  background: #fee2e2;
  color: #991b1b;
}
.dshTimeMasterBadge[data-urgency='soon'] {
  background: #ffedd5;
  color: #9a3412;
}
.dshTimeMasterForm {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dshTimeMasterFormFields {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dshTimeMasterForm h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}
.dshTimeMasterFieldRow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.dshTimeMasterField {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  min-width: 0;
}
.dshTimeMasterField input,
.dshTimeMasterField select,
.dshTimeMasterField textarea {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 8px;
  background: var(--bg-secondary, #fff);
  color: var(--text-primary, #111);
  font: inherit;
}
.dshTimeMasterField textarea {
  height: auto;
  min-height: 56px;
  max-height: 120px;
  padding: 8px 10px;
  resize: vertical;
}
.dshTimeMasterFormActions {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--border-color, #e5e7eb);
  background: var(--bg-primary, #fff);
}
.dshTimeMasterJsonArea {
  min-height: 120px !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px !important;
}
.dshTimeMasterCoordPane {
  grid-column: 1 / -1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dshTimeMasterCoordToolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dshTimeMasterCoordList {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dshTimeMasterCoordItem {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 10px;
  background: var(--bg-secondary, #fafafa);
  font-size: 12px;
}
.dshTimeMasterJsonPreview {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-secondary, #f3f4f6);
  font-size: 11px;
  overflow: auto;
  max-height: 200px;
}
.dshTimeMasterStatusBar {
  padding: 0 16px 8px;
}
.dshTimeMasterStatus {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}
.dshTimeMasterEmpty,
.dshTimeMasterError {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}
.dshTimeMasterFormFields > .dshTimeMasterError {
  padding: 0;
  text-align: left;
}
.dshTimeMasterError {
  color: #b91c1c;
}
@media (max-width: 720px) {
  .dshTimeMasterBody {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(140px, 36%) minmax(0, 1fr);
  }
  .dshTimeMasterList {
    border-right: none;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
    max-height: none;
  }
  .dshTimeMasterFieldRow {
    grid-template-columns: 1fr;
  }
}
`

let installed = false

export function installTimeMasterStyles(): () => void {
  if (installed || typeof document === 'undefined') return () => undefined
  const style = document.createElement('style')
  style.setAttribute('data-dsh-time-master', 'true')
  style.textContent = TIME_MASTER_STYLES
  document.head.appendChild(style)
  installed = true
  return () => {
    style.remove()
    installed = false
  }
}

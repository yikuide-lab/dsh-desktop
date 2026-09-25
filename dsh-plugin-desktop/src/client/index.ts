import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only service and SlotMap convergence for the Desktop settings section.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import { startRendererBootReporter } from './boot-health.ts'
import { applyDesktopSettings } from './desktop-settings.ts'
import { installDesktopDirectoryPickerBridge } from './directory-picker.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
import { applyWorkflowClient } from './workflow-client.tsx'
import { applySessionImportClient } from './session-import-client.tsx'
import { desktopWindowService, provideDesktopWindow } from './window-service.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export { applyDesktopSettings } from './desktop-settings.ts'
export { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
export { applyWorkflowClient } from './workflow-client.tsx'
export { applySessionImportClient } from './session-import-client.tsx'
export {
  createDesktopSettingsApi,
  desktopSettingsPaths,
  parseDesktopActionAcceptance,
  parseDesktopRestartAcceptance,
  parseDesktopSettingsView,
} from './desktop-settings-api.ts'
export type {
  DesktopMarketProvider,
  DesktopMarketView,
  DesktopProfileView,
  DesktopRestartAcceptance,
  DesktopSettingsApi,
  DesktopSettingsView,
} from './desktop-settings-api.ts'
export {
  createDesktopWorkflowApi,
  desktopWorkflowPaths,
  mapEngineRun,
  mapEngineWorkflow,
  workflowViewToYaml,
} from './desktop-workflow-api.ts'
export {
  allocateCloneName,
  cloneTemplateYaml,
  parseWorkflowYaml,
} from './workflow-template-clone.ts'
export type {
  DesktopWorkflowApi,
  PendingGateView,
  ValidationView,
  WorkflowRunView,
  WorkflowStepView,
  WorkflowTemplateView,
  WorkflowView,
  WorkspaceBindingView,
} from './desktop-workflow-api.ts'
export { DesktopSettingsSection } from './DesktopSettingsSection.tsx'
export { DesktopTerminalSettingsAction } from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopTerminalSettingsActionInjected,
  DesktopTerminalSettingsActionProps,
} from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopNotificationSettings,
  DesktopSettingsSectionInjected,
  DesktopSettingsSectionProps,
  DesktopShellSettings,
} from './DesktopSettingsSection.tsx'
export {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from './boot-health.ts'
export type { RendererBootLoader, RendererBootReport } from './boot-health.ts'
export { parseDesktopClientEnvironment } from './environment.ts'
export type {
  DesktopClientEnvironment,
  DesktopClientMaterial,
  DesktopClientMode,
  DesktopClientPlatform,
} from './environment.ts'
export { desktopWindowService, provideDesktopWindow } from './window-service.ts'
export type {
  DesktopWindowDragRegion,
  DesktopWindowInsets,
  DesktopWindowService,
} from './contracts.ts'

/** Services required by Desktop settings and Desktop-owned presentations. */
export const inject = [
  'slots',
  'locale',
  'connection',
  'remote',
  // ModelDirectoryResolver (composer seat → directoryFor) also needs the
  // nested remote.session face; without it the seat factory crashes under the
  // strict-access guard and the stock ModelSelect silently wins the slot.
  'remote.session',
  'settingsScope',
  'sessions',
  'theme',
  'uiRenderer',
]

/** Register desktop-owned client surfaces for the current BrowserWindow mode. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  console.log('[dsh-plugin-desktop] client apply called')
  const environment = parseDesktopClientEnvironment(window.location.search)
  if (!environment) return
  ctx.effect(
    () => provideDesktopWindow(ctx, desktopWindowService(environment)),
    'dsh-plugin-desktop: native window geometry service',
  )
  const desktopSettings = applyDesktopSettings(ctx, environment)
  ctx.effect(
    () => startRendererBootReporter(ctx.loader),
    'dsh-plugin-desktop: renderer boot health report',
  )
  if (environment.platform === 'win32') {
    ctx.effect(
      () => installDesktopDirectoryPickerBridge(),
      'dsh-plugin-desktop: native directory picker bridge',
    )
  }
  if (environment.mode === 'advanced') {
    applyAdvancedShell(ctx, environment)
  }
  if (environment.mode === 'extended') {
    applyExtendedShell(ctx, environment, desktopSettings)
  }
  if (environment.mode === 'compatibility') {
    // Compatibility keeps the upstream root; only the independent Desktop
    // frame styles/body markers are owned here (same seam as extended).
    applyFramedShell(ctx, environment, desktopSettings)
  }
  // Register after Desktop-owned shells so `main` is already declared when possible.
  if (environment.mode === 'advanced' || environment.mode === 'compatibility' || environment.mode === 'extended') {
    applyWorkflowClient(ctx)
    applySessionImportClient(ctx)
  }
}

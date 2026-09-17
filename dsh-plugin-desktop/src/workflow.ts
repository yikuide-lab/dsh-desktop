/**
 * Desktop Workflow Plugin
 * Cordis wrapper for dsh-plugin-workflow with a private HTTP bridge for the UI.
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { WorkflowPlugin, type WorkflowPluginConfig } from 'dsh-plugin-workflow'
import { DESKTOP_WORKFLOW_PATH } from './desktop-workflow-contract.ts'
import {
  createDesktopWorkflowHostHooks,
  hostServicesFromContext,
} from './desktop-workflow-executor.ts'
import { handleDesktopWorkflowRequest } from './desktop-workflow-route.ts'
import { formatWorkflowError } from './desktop-workflow-errors.ts'
import { createWorkflowOpenAiApiController } from './desktop-workflow-openai-controller.ts'
import { createAwfBridge } from './desktop-awf-bridge.ts'
import type {} from './runtime.ts'

export interface DesktopWorkflow {
  /** The underlying workflow plugin instance. */
  readonly plugin: WorkflowPlugin
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopWorkflow: DesktopWorkflow
  }
}

export const name = 'desktop-workflow'

export const inject = ['desktopRuntime', 'webServer', 'connection'] as const

export interface Config extends WorkflowPluginConfig {}

export class DesktopWorkflowService extends Service implements DesktopWorkflow {
  readonly plugin: WorkflowPlugin

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'desktopWorkflow')
    const resolved = config ?? {}
    const stateDir = resolved.stateDir ?? join(homedir(), '.dsh', 'workflow')
    this.plugin = new WorkflowPlugin({
      ...resolved,
      stateDir,
      triggersEnabled: resolved.triggersEnabled ?? true,
      scriptPolicy: resolved.scriptPolicy ?? 'workspace-only',
    })

    const openAiApi = createWorkflowOpenAiApiController({
      plugin: this.plugin,
      stateDir,
      log: (message) => ctx.logger.info(message),
    })

    // AWF 平台连接器（同步/预检/连接检查）；凭据走 ~/.dsh/awf.json（0600）或 AWF_API_TOKEN
    const awfBridge = createAwfBridge({
      plugin: this.plugin,
      stateDir,
      log: (message) => ctx.logger.info(message),
    })

    ctx.effect(
      () => {
        void this.plugin.init().catch((err) => {
          console.error('[desktop-workflow] failed to initialize:', err)
        })
        return () => {
          void openAiApi.stop()
          this.plugin.stop()
          void this.plugin.whenStopped()
        }
      },
      'dsh-plugin-desktop: workflow plugin lifetime',
    )

    // Prefer Host-bound LLM/agent execution when those services are present.
    ctx.inject(['llm'], (llmCtx) => {
      llmCtx.effect(() => {
        const services = hostServicesFromContext(llmCtx) ?? {
          llm: llmCtx.llm as never,
          agents: llmCtx.get('agents') as never,
          agentDefaultModel: llmCtx.get('agentDefaultModel') as never,
        }
        services.getWorkflowSettings = () => this.plugin.getSettingsSync()
        this.plugin.setHostHooks(createDesktopWorkflowHostHooks(services))
        return () => {
          this.plugin.setHostHooks()
        }
      }, 'dsh-plugin-desktop: workflow host executor')
    })

    ctx.effect(() => {
      const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
      const unregister = ctx.webServer.register({
        kind: 'exact',
        path: DESKTOP_WORKFLOW_PATH,
        handler: (req, res) => {
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
          return handleDesktopWorkflowRequest(
            req,
            res,
            rendererOrigin,
            this.plugin,
            (operation, cause) => {
              ctx.logger.error(
                `dsh-plugin-desktop: failed to ${operation}: ${formatWorkflowError(cause)}`,
              )
            },
            ctx,
            openAiApi,
            awfBridge,
          )
        },
      })
      return () => { unregister() }
    }, 'dsh-plugin-desktop: workflow HTTP bridge')
  }
}

export function apply(ctx: Context, config: Config): void {
  void ctx.plugin(DesktopWorkflowService, config)
}

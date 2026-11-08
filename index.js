/**
 * dsh-session-migration — Host half.
 *
 * Mounted by the bundle patch as one row. It exposes the migration engine over a
 * same-origin JSON route (`/dsh-session-migration/api`) that the browser half
 * calls, and applies queued workspace-accounting writes once the workspace
 * registry Service is up (the running registry indexes session headers at
 * startup, so membership written after a header rewrite is finalized on the next
 * start).
 *
 * @module dsh-session-migration
 */

import { Engine } from './lib/engine.js'

export const name = 'session-migration'

/**
 * Activate the plugin.
 * @param {object} ctx Cordis plugin context.
 * @param {object} [config] row config from `cordis.patch.yml`.
 */
export function apply(ctx, config = {}) {
  const engine = new Engine(ctx, config)

  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () =>
        httpCtx.webServer.register({
          kind: 'exact',
          path: '/dsh-session-migration/api',
          handler: (req, res) => engine.handle(req, res),
        }),
      'session-migration: /dsh-session-migration/api route',
    )
  })

  ctx.inject(['workspaceRegistry'], (wsCtx) => {
    wsCtx.effect(() => {
      const delay = Number.isFinite(engine.config.pendingApplyDelayMs) ? engine.config.pendingApplyDelayMs : 2500
      const timer = setTimeout(() => {
        engine
          .applyPending()
          .then((result) => {
            if (result.applied.length > 0) {
              ctx.logger?.info?.(
                `session-migration: wrote workspace membership for ${result.applied.length} migrated session(s)`,
              )
            }
            if (result.remaining.length > 0) {
              ctx.logger?.warn?.(
                `session-migration: ${result.remaining.length} migrated session(s) still await workspace membership: ${result.remaining
                  .map((entry) => `${entry.id} → ${entry.toPath} (${entry.lastError ?? 'unknown error'})`)
                  .join('; ')}`,
              )
            }
          })
          .catch((error) => {
            ctx.logger?.warn?.(`session-migration: pending apply failed: ${error instanceof Error ? error.message : String(error)}`)
          })
      }, delay)
      return () => clearTimeout(timer)
    }, 'session-migration: deferred workspace membership')
  })
}

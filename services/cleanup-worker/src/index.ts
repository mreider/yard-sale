interface Env {
  DB: D1Database;
}

const DAY = 86400;
const SESSION_STALE_DAYS = 7;
const SOFT_DELETE_GRACE_DAYS = 30;

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCleanup(env, new Date(controller.scheduledTime)));
  },

  // Manually runnable for local `wrangler dev --test-scheduled` and one-off ops.
  async fetch(req, env) {
    if (new URL(req.url).pathname !== '/run') {
      return new Response('cleanup-worker: POST /run to trigger manually', { status: 404 });
    }
    const results = await runCleanup(env, new Date());
    return Response.json(results);
  },
} satisfies ExportedHandler<Env>;

async function runCleanup(env: Env, at: Date) {
  const now = Math.floor(at.getTime() / 1000);
  const sessionCutoff = now - SESSION_STALE_DAYS * DAY;
  const saleHardCutoff = now - SOFT_DELETE_GRACE_DAYS * DAY;

  const results = await env.DB.batch([
    env.DB.prepare(`DELETE FROM email_confirmations WHERE expires_at < ?`).bind(now),
    env.DB.prepare(`DELETE FROM password_resets WHERE expires_at < ?`).bind(now),
    env.DB.prepare(
      `DELETE FROM sessions
         WHERE expires_at < ?
            OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
    ).bind(now, sessionCutoff),
    env.DB.prepare(`DELETE FROM sales WHERE deleted_at IS NOT NULL AND deleted_at < ?`).bind(
      saleHardCutoff,
    ),
    env.DB.prepare(`DELETE FROM rate_limit_events WHERE occurred_at < ?`).bind(now - DAY),
  ]);

  const changes = (i: number) => results[i]?.meta.changes ?? 0;
  const summary = {
    runAt: at.toISOString(),
    purged: {
      email_confirmations: changes(0),
      password_resets: changes(1),
      sessions: changes(2),
      sales_hard: changes(3),
      rate_limit_events: changes(4),
    },
  };
  console.log(JSON.stringify({ level: 'info', service: 'cleanup', ...summary }));
  return summary;
}

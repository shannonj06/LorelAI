import { Router } from 'express';

/**
 * GET /api/health — for uptime checks and load balancers.
 * 200 when the database answers ("degraded" if the pipeline isn't ready, since
 * accounts and history still work); 503 when the database doesn't.
 */
export function healthRouter({ db, rag }) {
  const router = Router();
  const startedAt = Date.now();

  router.get('/', async (req, res) => {
    let database = 'ok';
    try {
      await db.ping();
    } catch {
      database = 'error';
    }
    const pipeline = rag.status();
    const status = database !== 'ok' ? 'error' : pipeline.state === 'ready' ? 'ok' : 'degraded';
    res.status(database === 'ok' ? 200 : 503).json({
      status,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      database,
      // Which model answers is public (the UI shows it); whether its key is set is not
      pipeline: { state: pipeline.state, model: pipeline.llm?.model ?? null },
    });
  });

  return router;
}

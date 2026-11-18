import { timestamp } from '../db/index.js';

/** Record one question's outcome. No question or answer text is stored. */
export function record(db, event) {
  return db.run(
    `INSERT INTO ask_events (user_id, channel, status, error_code, citations, books_cited, passages_retrieved,
       input_tokens, output_tokens, model, cached, saved, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.userId ?? null,
      event.channel,
      event.status,
      event.errorCode ?? null,
      event.citations ?? 0,
      event.booksCited ?? 0,
      event.passagesRetrieved ?? null,
      event.inputTokens ?? 0,
      event.outputTokens ?? 0,
      event.model ?? null,
      Boolean(event.cached),
      Boolean(event.saved),
      event.latencyMs,
      timestamp(),
    ],
  );
}

export async function countForUser(db, userId) {
  const row = await db.get('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM ask_events WHERE user_id = ?', [userId]);
  return { total: row.n, lastAskedAt: row.last };
}

export async function recent(db, { userId, channel, status, limit, offset }) {
  const where = [];
  const params = [];
  if (userId !== undefined) {
    where.push('e.user_id = ?');
    params.push(userId);
  }
  if (channel) {
    where.push('e.channel = ?');
    params.push(channel);
  }
  if (status) {
    where.push('e.status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.all(
    `SELECT e.*, u.email AS user_email FROM ask_events e LEFT JOIN users u ON u.id = e.user_id
     ${whereSql} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const { total } = await db.get(`SELECT COUNT(*) AS total FROM ask_events e ${whereSql}`, params);
  return {
    items: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userEmail: row.user_email,
      channel: row.channel,
      status: row.status,
      errorCode: row.error_code,
      citations: row.citations,
      booksCited: row.books_cited,
      passagesRetrieved: row.passages_retrieved,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      model: row.model,
      cached: Boolean(row.cached),
      saved: Boolean(row.saved),
      latencyMs: row.latency_ms,
      createdAt: row.created_at,
    })),
    total,
  };
}

export async function stats(db) {
  const since = timestamp(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const totals = await db.get(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS last24h,
            COALESCE(SUM(CASE WHEN channel = 'trial' THEN 1 ELSE 0 END), 0) AS trial,
            COALESCE(SUM(cached), 0) AS cached,
            COALESCE(SUM(saved), 0) AS saved,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            AVG(CASE WHEN status <> 'error' AND cached = 0 THEN latency_ms END) AS avg_latency
     FROM ask_events`,
    [since],
  );
  const byStatus = { answered: 0, partial: 0, insufficient: 0, error: 0 };
  for (const row of await db.all('SELECT status, COUNT(*) AS n FROM ask_events GROUP BY status')) {
    byStatus[row.status] = row.n;
  }
  const errorsByCode = {};
  for (const row of await db.all(
    "SELECT error_code, COUNT(*) AS n FROM ask_events WHERE status = 'error' GROUP BY error_code",
  )) {
    errorsByCode[row.error_code ?? 'unknown'] = row.n;
  }
  const byModel = {};
  for (const row of await db.all(
    'SELECT model, COUNT(*) AS n FROM ask_events WHERE model IS NOT NULL GROUP BY model ORDER BY n DESC',
  )) {
    byModel[row.model] = row.n;
  }
  const ratio = (n) => (totals.total ? Number((n / totals.total).toFixed(3)) : 0);
  return {
    total: totals.total,
    last24h: totals.last24h,
    byChannel: { app: totals.total - totals.trial, trial: totals.trial },
    byStatus,
    errorsByCode,
    byModel,
    errorRate: ratio(byStatus.error),
    cacheHitRate: ratio(totals.cached),
    savedRate: ratio(totals.saved),
    tokens: { input: totals.input_tokens, output: totals.output_tokens },
    avgAnswerLatencyMs: totals.avg_latency === null ? null : Math.round(totals.avg_latency),
  };
}

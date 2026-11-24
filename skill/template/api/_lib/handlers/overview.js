// GET /api?action=overview_data
// Wraps getDashboardData twice (current + prior period) and computes deltas.
// Pipeline data is "now", there is no historical pipeline snapshot.

const { getDashboardData } = require('./dashboard');

async function getOverviewData(query = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const endStr = (query.end ? String(query.end) : '').slice(0, 10) || today;
  const startDefault = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const startStr = (query.start ? String(query.start) : '').slice(0, 10) || startDefault;

  const startMs = Date.parse(startStr);
  const endMs   = Date.parse(endStr);
  const lengthMs = Math.max(86400000, endMs - startMs + 86400000);
  const priorEnd   = new Date(startMs - 86400000).toISOString().slice(0, 10);
  const priorStart = new Date(startMs - lengthMs).toISOString().slice(0, 10);

  const passthrough = (q) => ({
    start: q.start, end: q.end,
    source: query.source || '', closer: query.closer || '', setter: query.setter || '',
  });

  const [current, prior] = await Promise.all([
    getDashboardData(passthrough({ start: startStr, end: endStr })),
    getDashboardData(passthrough({ start: priorStart, end: priorEnd })),
  ]);

  const delta = (now, prev) => {
    const n = Number(now || 0), p = Number(prev || 0);
    if (!p) return { abs: n, pct: null };
    return { abs: +(n - p).toFixed(2), pct: +((n - p) / p * 100).toFixed(1) };
  };

  const t = current.totals || {}, tp = prior.totals || {};
  const kpis = {
    booked:     { value: t.booked || 0,     delta: delta(t.booked, tp.booked) },
    showed:     { value: t.showed || 0,     delta: delta(t.showed, tp.showed) },
    closed:     { value: t.closed || 0,     delta: delta(t.closed, tp.closed) },
    revenue:    { value: t.revenue || 0,    delta: delta(t.revenue, tp.revenue) },
    show_rate:  { value: t.show_rate || 0,  delta: delta(t.show_rate, tp.show_rate) },
    close_rate: { value: t.close_rate || 0, delta: delta(t.close_rate, tp.close_rate) },
  };

  const topN = (obj, n = 5, sortKey = 'revenue') =>
    Object.entries(obj || {})
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0))
      .slice(0, n);

  const totalRev = Object.values(current.by_source || {}).reduce((a, s) => a + (s.revenue || 0), 0);
  const totalBk  = Object.values(current.by_source || {}).reduce((a, s) => a + (s.booked  || 0), 0);
  const source_mix = Object.entries(current.by_source || {}).map(([name, v]) => ({
    name,
    booked: v.booked || 0, revenue: v.revenue || 0, closed: v.closed || 0,
    revenue_share: totalRev ? +(((v.revenue || 0) / totalRev) * 100).toFixed(1) : 0,
    booking_share: totalBk  ? +(((v.booked  || 0) / totalBk)  * 100).toFixed(1) : 0,
  }));

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    date_range: { start: startStr, end: endStr },
    prior_range: { start: priorStart, end: priorEnd },
    source_filter: query.source || null,
    closer_filter: query.closer || null,
    setter_filter: query.setter || null,
    kpis,
    source_mix,
    top_closers: topN(current.by_closer, 5, 'revenue'),
    top_setters: topN(current.by_setter, 5, 'booked'),
    pipeline: current.pipeline,
    closers: current.closers,
    setters: current.setters,
  };
}

module.exports = { getOverviewData };

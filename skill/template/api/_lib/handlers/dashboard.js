// GET /api?action=dashboard_data
// Query: start, end (YYYY-MM-DD), source, closer, setter
//
// Aggregates CLOSER OUTCOMES + SETTER ACTIVITY + live CRM pipeline (if any)
// into a single normalized JSON shape consumed by /eod and /overview.

const { config, closerLeadSources } = require('../config');
const {
  CLOSER_COL, SETTER_COL,
  ensureCloserTab, ensureSetterTab,
  readRange,
} = require('../sheets');
const { getCRMPipelineNormalized } = require('../crm-adapter');

const blankAgg = () => ({ booked: 0, showed: 0, closed: 0, lost: 0, no_shows: 0, follow_ups: 0, revenue: 0 });

function classifyOutcome(o) {
  const x = (o || '').toLowerCase().replace(/[\s\-_]+/g, '');
  return {
    won: x === 'closedwon' || x === 'won' || x === 'closed',
    lost: x === 'closedlost' || x === 'lost',
    noShow: x === 'noshow',
    followUp: x === 'needsfollowup' || x === 'followup' || x === 'rescheduled',
  };
}

async function getDashboardData(query = {}) {
  await ensureCloserTab();
  await ensureSetterTab();

  const today = new Date().toISOString().slice(0, 10);
  const endStr = (query.end ? String(query.end) : '').slice(0, 10) || today;
  const startDefault = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const startStr = (query.start ? String(query.start) : '').slice(0, 10) || startDefault;
  const inRange = (d) => {
    if (!d) return false;
    const ds = String(d).slice(0, 10);
    return ds >= startStr && ds <= endStr;
  };

  const CLOSER_SOURCES = closerLeadSources();
  const sourceFilter = CLOSER_SOURCES.includes(query.source) ? query.source : null;
  const closerFilter = (query.closer ? String(query.closer) : '').trim().toLowerCase() || null;
  const setterFilter = (query.setter ? String(query.setter) : '').trim().toLowerCase() || null;
  const matchCloser = (n) => !closerFilter || (n || '').trim().toLowerCase() === closerFilter;
  const matchSetter = (n) => !setterFilter || (n || '').trim().toLowerCase() === setterFilter;

  const closerRows = await readRange(config.sheet.tabs.closer_outcomes, 'A2:T');
  const setterRows = await readRange(config.sheet.tabs.setter_activity, 'A2:Z');

  const totals = { ...blankAgg(), calls_logged: 0 };
  const by_source = {};
  for (const s of CLOSER_SOURCES) by_source[s] = blankAgg();
  const by_setter = {};
  const by_closer = {};

  // ── 1. CLOSER OUTCOMES, showed/closed/lost/no_show/revenue + booked count ─
  // Booked count comes from this sheet too, every call outcome implies a
  // booking happened. (If your funnel records bookings elsewhere, layer in a
  // separate booked-count source here.)
  const recent = [];
  for (const r of closerRows) {
    const date = r[CLOSER_COL.date] || (r[CLOSER_COL.ts] || '').slice(0, 10);
    if (!inRange(date)) continue;
    const src = CLOSER_SOURCES.includes(r[CLOSER_COL.lead_source]) ? r[CLOSER_COL.lead_source] : config.lead_sources[0] || 'Webinar';
    if (sourceFilter && src !== sourceFilter) continue;
    const closer = r[CLOSER_COL.closer] || 'Unknown';
    const setter = (r[CLOSER_COL.setter] || '').trim();
    const dialler = (r[CLOSER_COL.dialler] || '').trim();
    if (!matchCloser(closer)) continue;
    // a call a dialler set counts for them under the setter filter too
    if (!matchSetter(setter) && !(dialler && matchSetter(dialler))) continue;

    const outcome = (r[CLOSER_COL.outcome] || '').toString();
    const cls = classifyOutcome(outcome);
    const rev = parseFloat(r[CLOSER_COL.ticket]) || 0;
    const bucket = by_source[src] || (by_source[src] = blankAgg());

    bucket.booked += 1; totals.booked += 1;
    if (!cls.noShow) { bucket.showed += 1; totals.showed += 1; }
    if (cls.won)     { bucket.closed += 1; bucket.revenue += rev; totals.closed += 1; totals.revenue += rev; }
    if (cls.lost)    { bucket.lost += 1; totals.lost += 1; }
    if (cls.noShow)  { bucket.no_shows += 1; totals.no_shows += 1; }
    if (cls.followUp){ bucket.follow_ups += 1; totals.follow_ups += 1; }
    totals.calls_logged += 1;

    if (!by_closer[closer]) by_closer[closer] = blankAgg();
    by_closer[closer].booked += 1;
    if (!cls.noShow) by_closer[closer].showed += 1;
    if (cls.won)     { by_closer[closer].closed += 1; by_closer[closer].revenue += rev; }
    if (cls.lost)    by_closer[closer].lost += 1;
    if (cls.noShow)  by_closer[closer].no_shows += 1;
    if (cls.followUp)by_closer[closer].follow_ups += 1;

    if (setter) {
      if (!by_setter[setter]) by_setter[setter] = blankAgg();
      by_setter[setter].booked += 1;
      if (!cls.noShow) by_setter[setter].showed += 1;
      if (cls.won)     { by_setter[setter].closed += 1; by_setter[setter].revenue += rev; }
      if (cls.lost)    by_setter[setter].lost += 1;
      if (cls.noShow)  by_setter[setter].no_shows += 1;
    }

    recent.push({
      ts: r[CLOSER_COL.ts] || '', date, closer, source: src, detail: r[CLOSER_COL.lead_source_detail] || '', setter,
      prospect_name: r[CLOSER_COL.prospect_name] || '', prospect_email: r[CLOSER_COL.prospect_email] || '',
      outcome, package: r[CLOSER_COL.package] || '', ticket: rev || 0,
      notes: (r[CLOSER_COL.notes] || '').slice(0, 240),
      crm_contact_id: r[CLOSER_COL.crm_contact_id] || '',
    });
  }

  // ── 2. SETTER ACTIVITY, activity counts (messages_sent, outbounds, etc.) ─
  for (const r of setterRows) {
    const date = r[SETTER_COL.date] || (r[SETTER_COL.ts] || '').slice(0, 10);
    if (!inRange(date)) continue;
    const src = config.lead_sources.includes(r[SETTER_COL.lead_source]) ? r[SETTER_COL.lead_source] : config.lead_sources[0] || 'Webinar';
    if (sourceFilter && src !== sourceFilter) continue;
    const setter = (r[SETTER_COL.setter] || '').trim() || 'Unknown';
    if (!matchSetter(setter)) continue;
    if (closerFilter) continue;
    if (!by_setter[setter]) by_setter[setter] = blankAgg();
    by_setter[setter].messages_sent = (by_setter[setter].messages_sent || 0) + (parseInt(r[SETTER_COL.messages_sent], 10) || 0);
    by_setter[setter].outbounds     = (by_setter[setter].outbounds     || 0) + (parseInt(r[SETTER_COL.outbounds], 10)     || 0);
  }

  const close_rate = (b) => b.showed > 0 ? +(b.closed / b.showed).toFixed(3) : 0;
  const show_rate  = (b) => b.booked > 0 ? +(b.showed / b.booked).toFixed(3) : 0;
  const decorate = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { ...v, close_rate: close_rate(v), show_rate: show_rate(v) }]));

  // ── 3. CRM pipeline (live from adapter, if configured) ─────────────────────
  const crm = await getCRMPipelineNormalized();

  // ── 4. Contacts list, union of (pipeline contacts) ∪ (recent outcomes) ───
  const contactsByKey = {};
  const keyOf = (c) => (c.email || '').trim().toLowerCase() || `name:${(c.name || '').trim().toLowerCase()}`;

  if (crm.available) {
    for (const stage of crm.stages) {
      for (const c of stage.contacts) {
        const key = keyOf(c);
        if (!key) continue;
        contactsByKey[key] = {
          name: c.name, email: c.email, phone: c.phone || '',
          source: '', setter: '', closer: '',
          stage_key: c.stage_key, stage_label: c.stage_label,
          outcome: '', ticket: c.value || 0, notes: '',
          last_activity: c.updated_at || '',
          crm_contact_id: c.crm_contact_id, crm_url: c.crm_url,
        };
      }
    }
  }

  for (const r of recent) {
    const c = { name: r.prospect_name, email: r.prospect_email };
    const key = keyOf(c);
    if (!key) continue;
    const prev = contactsByKey[key] || {};
    contactsByKey[key] = {
      name: r.prospect_name || prev.name || '',
      email: r.prospect_email || prev.email || '',
      phone: prev.phone || '',
      source: r.source || prev.source || '',
      setter: r.setter || prev.setter || '',
      closer: r.closer || prev.closer || '',
      stage_key: prev.stage_key || '',
      stage_label: prev.stage_label || '',
      outcome: r.outcome || '',
      ticket: r.ticket || prev.ticket || 0,
      notes: r.notes || '',
      last_activity: r.ts || prev.last_activity || '',
      crm_contact_id: r.crm_contact_id || prev.crm_contact_id || '',
      crm_url: prev.crm_url || null,
    };
  }

  let contacts = Object.values(contactsByKey);
  const filterApplied = !!(closerFilter || setterFilter || sourceFilter);
  if (filterApplied) {
    contacts = contacts.filter(c => {
      if (closerFilter && (c.closer || '').trim().toLowerCase() !== closerFilter) return false;
      if (setterFilter && (c.setter || '').trim().toLowerCase() !== setterFilter) return false;
      if (sourceFilter && c.source && c.source !== sourceFilter) return false;
      return true;
    });
  }
  contacts.sort((a, b) => (b.last_activity || '').localeCompare(a.last_activity || ''));

  const pipelineForResponse = crm.available ? {
    available: true,
    provider: crm.provider,
    stages: crm.stages.map(s => ({
      key: s.key, label: s.label, count: s.count, value: s.value,
      contacts: s.contacts.slice(0, 10),
    })),
    total_count: crm.stages.reduce((a, s) => a + s.count, 0),
    total_value: crm.stages.reduce((a, s) => a + s.value, 0),
  } : { available: false, provider: crm.provider || config.crm.provider, stages: [] };

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    date_range: { start: startStr, end: endStr },
    source_filter: sourceFilter,
    closer_filter: closerFilter,
    setter_filter: setterFilter,
    totals: { ...totals, close_rate: close_rate(totals), show_rate: show_rate(totals) },
    by_source: decorate(by_source),
    by_setter: decorate(by_setter),
    by_closer: decorate(by_closer),
    closers: Object.keys(by_closer).sort(),
    setters: Object.keys(by_setter).sort(),
    pipeline: pipelineForResponse,
    contacts,
    recent_outcomes: recent.sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 25),
  };
}

module.exports = { getDashboardData };

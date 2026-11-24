// Daily scorecard, everything each person reported for one day, on one page.
//
//   GET /api?action=scorecard_data&range=7d          → JSON for /scorecard (see getScorecard)
//   GET /api?action=scorecard_post                   → post it to the scorecard channel
//                                                      (cron, CRON_SECRET; &force=1 &dry=1 &date=)
//
// Built from the same sheet tabs the reports write to, so it needs no extra setup.
// Only roles in REPORT_ROLES appear. Anyone on the roster with no report for the day is
// listed under "not filed".

const { config } = require('../config');
const { CLOSER_COL, SETTER_COL, DIALLER_COL, readRange } = require('../sheets');
const { notifyScorecard, providers } = require('../notify');
const { localNow } = require('./nudge');
const { firstRun } = require('../settings-store');

const N = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const key = (name) => String(name || '').trim().toLowerCase();
const onDay = (row, col, date) => String(row[col.date] || row[col.ts] || '').slice(0, 10) === date;
const list = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

function outcomeKind(o) {
  const x = String(o || '').toLowerCase().replace(/[\s\-_]+/g, '');
  if (x === 'closedwon' || x === 'won' || x === 'closed') return 'won';
  if (x === 'closedlost' || x === 'lost') return 'lost';
  if (x === 'noshow') return 'no_show';
  if (x === 'rescheduled') return 'rescheduled';
  if (x === 'needsfollowup' || x === 'followup') return 'follow_up';
  return 'other';
}

function shiftDate(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// A setter who files twice in a day (two lead sources) is one line: numbers summed,
// text joined.
function setterCards(rows, date) {
  const by = new Map();
  for (const r of rows || []) {
    if (!onDay(r, SETTER_COL, date)) continue;
    const name = String(r[SETTER_COL.setter] || 'Unknown').trim();
    const c = by.get(key(name)) || {
      name, ts: '', reports: 0, messages: 0, outbounds: 0, inbounds: 0, followups: 0, links: 0,
      calls_proposed: 0, calls_booked: 0, no_shows: 0, cancellations: 0, new_followers: 0, qualified: 0,
      lead_quality: '', hit_kpis: '', hottest_lead: '', sources: [], notes: [],
    };
    c.reports++;
    if (String(r[SETTER_COL.ts] || '') > c.ts) c.ts = String(r[SETTER_COL.ts]);
    c.messages += N(r[SETTER_COL.messages_sent]);   c.outbounds += N(r[SETTER_COL.outbounds]);
    c.inbounds += N(r[SETTER_COL.inbounds]);        c.followups += N(r[SETTER_COL.followups]);
    c.links += N(r[SETTER_COL.links_sent]);
    c.calls_proposed += N(r[SETTER_COL.calls_proposed]); c.calls_booked += N(r[SETTER_COL.calls_booked]);
    c.no_shows += N(r[SETTER_COL.no_shows]);        c.cancellations += N(r[SETTER_COL.cancellations]);
    c.new_followers += N(r[SETTER_COL.new_followers]); c.qualified += N(r[SETTER_COL.qualified_followers]);
    c.lead_quality = r[SETTER_COL.lead_quality] || c.lead_quality;
    c.hit_kpis = r[SETTER_COL.hit_kpis] || c.hit_kpis;
    c.hottest_lead = r[SETTER_COL.hottest_lead] || c.hottest_lead;
    if (r[SETTER_COL.lead_source] && !c.sources.includes(r[SETTER_COL.lead_source])) c.sources.push(r[SETTER_COL.lead_source]);
    if (r[SETTER_COL.notes]) c.notes.push(r[SETTER_COL.notes]);
    by.set(key(name), c);
  }
  return [...by.values()].map(c => ({ ...c, notes: c.notes.join(' · ') }));
}

// The latest dialler report for the day wins, a re-file is a correction, not extra dials.
function diallerCards(rows, date) {
  const by = new Map();
  for (const r of rows || []) {
    if (!onDay(r, DIALLER_COL, date)) continue;
    const name = String(r[DIALLER_COL.dialler] || 'Unknown').trim();
    const blank = (v) => (v === '' || v == null ? null : N(v));
    by.set(key(name), {
      name, ts: String(r[DIALLER_COL.ts] || ''),
      dials: N(r[DIALLER_COL.dials]), conversations: N(r[DIALLER_COL.conversations]),
      speed_to_lead: blank(r[DIALLER_COL.speed_to_lead]),
      leads_triaged: N(r[DIALLER_COL.leads_triaged]), all_notes: r[DIALLER_COL.all_triaged_notes] || '',
      set_due: N(r[DIALLER_COL.set_due]), set_showed: N(r[DIALLER_COL.set_showed]), set_show_rate: blank(r[DIALLER_COL.set_show_rate]),
      triaged_due: N(r[DIALLER_COL.triaged_due]), triaged_showed: N(r[DIALLER_COL.triaged_showed]), triaged_show_rate: blank(r[DIALLER_COL.triaged_show_rate]),
      set_booked: N(r[DIALLER_COL.set_booked]), triaged_booked: N(r[DIALLER_COL.triaged_booked]),
      booked_to: r[DIALLER_COL.booked_to_closer] || '',
      kpis_hit: list(r[DIALLER_COL.kpis_hit]), kpis_missed: list(r[DIALLER_COL.kpis_missed]),
      notes: r[DIALLER_COL.notes] || '',
    });
  }
  return [...by.values()];
}

function closerCards(callRows, noCallRows, date) {
  const by = new Map();
  const card = (name) => by.get(key(name)) || {
    name, ts: '', zero_call: false, calls: 0, showed: 0, won: 0, lost: 0, follow_up: 0, no_show: 0, rescheduled: 0,
    revenue: 0, close_rate: null, call_list: [], notes: '',
  };
  for (const r of callRows || []) {
    if (!onDay(r, CLOSER_COL, date)) continue;
    const name = String(r[CLOSER_COL.closer] || 'Unknown').trim();
    const c = card(name);
    const kind = outcomeKind(r[CLOSER_COL.outcome]);
    const ticket = N(r[CLOSER_COL.ticket]);
    c.calls++;
    if (String(r[CLOSER_COL.ts] || '') > c.ts) c.ts = String(r[CLOSER_COL.ts]);
    if (kind === 'won') { c.won++; c.revenue += ticket; }
    else if (kind === 'lost') c.lost++;
    else if (kind === 'follow_up') c.follow_up++;
    else if (kind === 'no_show') c.no_show++;
    else if (kind === 'rescheduled') c.rescheduled++;
    if (kind !== 'no_show' && kind !== 'rescheduled') c.showed++;
    c.call_list.push({
      prospect: r[CLOSER_COL.prospect_name] || r[CLOSER_COL.prospect_email] || 'Unknown',
      outcome: r[CLOSER_COL.outcome] || '', kind, ticket: kind === 'won' ? ticket : 0,
      source: r[CLOSER_COL.lead_source] || '', setter: r[CLOSER_COL.setter] || '', dialler: r[CLOSER_COL.dialler] || '',
      lost_reason: r[CLOSER_COL.lost_reason] || '', follow_up_date: r[CLOSER_COL.followup_date] || '',
      notes: r[CLOSER_COL.notes] || '',
    });
    by.set(key(name), c);
  }
  // A zero-call filing only stands if that closer logged no calls the same day.
  for (const r of noCallRows || []) {
    if (String(r[1] || '').slice(0, 10) !== date) continue;
    const name = String(r[2] || 'Unknown').trim();
    if (by.has(key(name))) continue;
    by.set(key(name), { ...card(name), ts: String(r[0] || ''), zero_call: true, notes: r[3] || '' });
  }
  return [...by.values()].map(c => ({ ...c, close_rate: pct(c.won, c.showed) }));
}

// ── KPI scoring ─────────────────────────────────────────────────────────────
// Each person's card is a list of metric rows. A row is one number, its target, how it
// did, and how it moved against the previous period of the same length.
//
//   ok   = on target                        (green,  "ON TARGET")
//   warn = at least 70% of the way there    (amber,  "BELOW")
//   crit = further off than that            (red,    "CRITICAL")
//   na   = no target set, or nothing to measure
//
// Targets are per day, so counts are shown as a per-day average over the days filed.
// `fill` is the meter width: it runs 0 → 2× target, so the target tick sits mid-bar.
const WARN_AT = 0.7;
const round = (n, dp = 1) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const perDay = (total, days) => (days > 0 ? round(total / days) : null);

function show(value, unit) {
  if (value == null) return 'n/a';
  if (unit === 'money') return `${config.brand.currency_symbol}${Math.round(value).toLocaleString('en-US')}`;
  if (unit === 'pct') return `${value}%`;
  if (unit === 'min') return `${value} min`;
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

// How a value moved against the previous period: rates in points, everything else in %.
function delta(value, prev, unit, lower) {
  if (value == null || prev == null) return null;
  let txt, dir;
  if (unit === 'pct') {
    const pts = value - prev;
    if (Math.abs(pts) < 0.05) return { txt: '0 pts', dir: 0, good: null };
    txt = `${round(Math.abs(pts), Math.abs(pts) < 10 ? 1 : 0)} pts`; dir = pts > 0 ? 1 : -1;
  } else if (prev === 0) {
    if (value === 0) return { txt: '0', dir: 0, good: null };
    txt = 'from 0'; dir = value > 0 ? 1 : -1;
  } else {
    const pc = ((value - prev) / Math.abs(prev)) * 100;
    if (Math.abs(pc) < 0.5) return { txt: '0%', dir: 0, good: null };
    txt = Math.abs(pc) > 999 ? '>999%' : `${round(Math.abs(pc), Math.abs(pc) < 10 ? 1 : 0)}%`; dir = pc > 0 ? 1 : -1;
  }
  return { txt, dir, good: lower ? dir < 0 : dir > 0 };
}

// row: { key, label, value, target, unit, lower }  →  the finished metric
function finish(row, prev) {
  const { value, unit = 'num', lower = false } = row;
  const target = row.target || null;
  const m = {
    key: row.key, label: row.label, value, target, unit, lower,
    display: show(value, unit),
    target_display: target ? `target ${lower ? '≤' : '≥'} ${show(target, unit)}` : 'no target',
    status: 'na', fill: 0,
    delta: delta(value, prev, unit, lower),
  };
  if (!target || value == null) return m;
  const ratio = lower ? (value > 0 ? target / value : 2) : value / target;
  m.status = ratio >= 1 ? 'ok' : ratio >= WARN_AT ? 'warn' : 'crit';
  m.fill = Math.max(0, Math.min(100, round(ratio * 50)));
  return m;
}

// The rows on each role's card. `c` is one person's numbers for the period (or one day),
// `n` the number of days they filed.
const ROWS = {
  setter(c, n) {
    const T = config.setter_targets;
    return [
      { key: 'messages',  label: 'Messages / day',   value: perDay(c.messages, n),     target: T.messages },
      { key: 'outbounds', label: 'Outbounds / day',  value: perDay(c.outbounds, n),    target: T.outbounds },
      { key: 'followups', label: 'Follow-ups / day', value: perDay(c.followups, n),    target: T.followups },
      { key: 'bookings',  label: 'Bookings / day',   value: perDay(c.calls_booked, n), target: T.calls_booked },
      { key: 'booking_rate', label: 'Booked ÷ proposed', value: pct(c.calls_booked, c.calls_proposed), unit: 'pct' },
    ];
  },
  dialler(c, n) {
    const T = config.dialler_targets;
    return [
      { key: 'dials',         label: 'Dials / day',         value: perDay(c.dials, n),         target: T.dials },
      { key: 'conversations', label: 'Conversations / day', value: perDay(c.conversations, n), target: T.conversations },
      { key: 'connect_rate',  label: 'Connect rate',        value: pct(c.conversations, c.dials), unit: 'pct' },
      { key: 'speed',         label: 'Speed to lead',       value: c.speed_to_lead, target: T.speed_to_lead_min, unit: 'min', lower: true },
      { key: 'calls_set',     label: 'Calls set / day',     value: perDay(c.set_booked + c.triaged_booked, n) },
      { key: 'set_show',      label: 'Show rate on set calls',     value: c.set_due ? c.set_show_rate : null,         target: T.set_show_rate,     unit: 'pct' },
      { key: 'triaged_show',  label: 'Show rate on triaged calls', value: c.triaged_due ? c.triaged_show_rate : null, target: T.triaged_show_rate, unit: 'pct' },
    ];
  },
  closer(c, n) {
    const T = config.closer_targets;
    return [
      { key: 'calls',      label: 'Calls taken / day',  value: perDay(c.calls, n),        target: T.calls },
      { key: 'show_rate',  label: 'Show rate',          value: pct(c.showed, c.calls),    target: T.show_rate,  unit: 'pct' },
      { key: 'close_rate', label: 'Close rate on shows', value: pct(c.won, c.showed),     target: T.close_rate, unit: 'pct' },
      { key: 'revenue',    label: 'Revenue / day',      value: perDay(c.revenue, n),      target: T.revenue, unit: 'money' },
      { key: 'collected',  label: 'Gross collected',    value: c.revenue, unit: 'money' },
      { key: 'aov',        label: 'Average order value', value: c.won ? Math.round(c.revenue / c.won) : null, unit: 'money' },
      { key: 'per_call',   label: 'Cash per call taken', value: c.calls ? Math.round(c.revenue / c.calls) : null, unit: 'money' },
    ];
  },
};

// prev: the same person's merged numbers for the previous period (or null).
function scoreCard(role, c, n, prev, prevN) {
  const before = prev ? Object.fromEntries(ROWS[role](prev, prevN).map(r => [r.key, r.value])) : {};
  const metrics = ROWS[role](c, n).map(r => finish(r, r.key in before ? before[r.key] : null));
  const scored = metrics.filter(m => m.status !== 'na');
  return { metrics, kpis_total: scored.length, kpis_hit: scored.filter(m => m.status === 'ok').length };
}

// ── Several days rolled into one card per person ────────────────────────────
const add = (list, k) => list.reduce((a, c) => a + (c[k] || 0), 0);
const last = (list, k) => { for (let i = list.length - 1; i >= 0; i--) if (list[i][k]) return list[i][k]; return ''; };
const round1 = (n) => Math.round(n * 10) / 10;
// Notes across days, newest first, each tagged with its date.
const datedNotes = (list) => list.filter(c => c.notes).slice(-5).reverse().map(c => `${c.date}: ${c.notes}`).join('\n');

function mergeSetter(days) {
  if (days.length === 1) return days[0];
  const SUM = ['reports', 'messages', 'outbounds', 'inbounds', 'followups', 'links', 'calls_proposed', 'calls_booked', 'no_shows', 'cancellations', 'new_followers', 'qualified'];
  const quality = days.map(c => parseFloat(c.lead_quality)).filter(Number.isFinite);
  return {
    name: days[days.length - 1].name,
    ...Object.fromEntries(SUM.map(k => [k, add(days, k)])),
    lead_quality: quality.length ? String(round1(quality.reduce((a, b) => a + b, 0) / quality.length)) : '',
    hit_kpis: '', hottest_lead: last(days, 'hottest_lead'),
    sources: [...new Set(days.flatMap(c => c.sources))],
    notes: datedNotes(days),
  };
}

function mergeDialler(days) {
  if (days.length === 1) return days[0];
  const SUM = ['dials', 'conversations', 'leads_triaged', 'set_due', 'set_showed', 'triaged_due', 'triaged_showed', 'set_booked', 'triaged_booked'];
  const out = { name: days[days.length - 1].name, ...Object.fromEntries(SUM.map(k => [k, add(days, k)])) };
  const speeds = days.map(c => c.speed_to_lead).filter(v => v != null);
  const answered = days.map(c => String(c.all_notes).toLowerCase()).filter(Boolean);
  return {
    ...out,
    speed_to_lead: speeds.length ? round1(speeds.reduce((a, b) => a + b, 0) / speeds.length) : null,
    set_show_rate: pct(out.set_showed, out.set_due), triaged_show_rate: pct(out.triaged_showed, out.triaged_due),
    all_notes: !answered.length ? '' : answered.every(v => v === 'yes') ? 'Yes' : 'No',
    booked_to: [...new Set(days.map(c => c.booked_to).filter(Boolean))].join(', '),
    kpis_hit: [], kpis_missed: [], notes: datedNotes(days),
  };
}

function mergeCloser(days) {
  if (days.length === 1) return days[0];
  const SUM = ['calls', 'showed', 'won', 'lost', 'follow_up', 'no_show', 'rescheduled', 'revenue'];
  const out = { name: days[days.length - 1].name, ...Object.fromEntries(SUM.map(k => [k, add(days, k)])) };
  return {
    ...out,
    zero_call: out.calls === 0,                      // every day in the period was a zero-call day
    zero_call_days: days.filter(c => c.zero_call).length,
    close_rate: pct(out.won, out.showed),
    call_list: days.flatMap(c => c.call_list.map(call => ({ ...call, date: c.date }))).reverse(),
    notes: datedNotes(days),
  };
}

const ROLE = {
  setter:  { list: 'setters',  merge: mergeSetter },
  dialler: { list: 'diallers', merge: mergeDialler },
  closer:  { list: 'closers',  merge: mergeCloser },
};
const ROLE_PLURAL = { setter: 'Setters', dialler: 'Diallers', closer: 'Closers' };
const MAX_RANGE_DAYS = 92;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

// Query: range=today|yesterday|7d|30d  ·  or date=YYYY-MM-DD  ·  or start= & end=
//        role=setter|dialler|closer  ·  person=<name>
async function getScorecard(query = {}) {
  const today = localNow(config.brand.timezone || 'UTC').date;
  // range=today|yesterday|7d|30d is worked out here so "today" is the business's today,
  // not the browser's.
  const preset = { today: [today, today], yesterday: [shiftDate(today, -1), shiftDate(today, -1)],
    '7d': [shiftDate(today, -6), today], '30d': [shiftDate(today, -29), today] }[query.range];
  let start = preset ? preset[0] : isDate(query.start) ? query.start : isDate(query.date) ? query.date : today;
  let end = preset ? preset[1] : isDate(query.end) ? query.end : isDate(query.date) ? query.date : isDate(query.start) ? today : start;
  if (end < start) [start, end] = [end, start];
  if (shiftDate(start, MAX_RANGE_DAYS - 1) < end) start = shiftDate(end, -(MAX_RANGE_DAYS - 1));
  const dates = [];
  for (let d = start; d <= end; d = shiftDate(d, 1)) dates.push(d);

  const allRoles = config.report_roles;
  const roleFilter = allRoles.includes(query.role) ? query.role : '';
  const personFilter = key(query.person);
  const roles = roleFilter ? [roleFilter] : allRoles;
  const tabs = config.sheet.tabs;

  const [setterRows, diallerRows, closerRows, noCallRows] = await Promise.all([
    allRoles.includes('setter')  ? readRange(tabs.setter_activity,  'A2:Z') : [],
    allRoles.includes('dialler') ? readRange(tabs.dialler_activity, 'A2:Z') : [],
    allRoles.includes('closer')  ? readRange(tabs.closer_outcomes,  'A2:T') : [],
    allRoles.includes('closer')  ? readRange(tabs.closer_no_calls,  'A2:D') : [],
  ]);

  // person → their card for each day they filed, oldest first
  const collect = (days) => {
    const got = { setter: new Map(), dialler: new Map(), closer: new Map() };
    const remember = (role, cards, date) => {
      for (const c of cards) {
        const k = key(c.name);
        if (!got[role].has(k)) got[role].set(k, []);
        got[role].get(k).push({ ...c, date });
      }
    };
    for (const date of days) {
      remember('setter', setterCards(setterRows, date), date);
      remember('dialler', diallerCards(diallerRows, date), date);
      remember('closer', closerCards(closerRows, noCallRows, date), date);
    }
    return got;
  };
  const perDay = collect(dates);
  // The period just before this one, same length, what the ▲▼ arrows compare against.
  const prevDates = dates.map((_, i) => shiftDate(start, -(dates.length - i)));
  const perDayPrev = collect(prevDates);

  // Everyone who could be picked in the filters: the roster plus anyone who filed.
  const people = {};
  for (const role of allRoles) {
    const names = new Map((config.roster[role] || []).map(p => [key(p.name), p.name]));
    for (const [k, days] of perDay[role]) if (!names.has(k)) names.set(k, days[0].name);
    people[role] = [...names.values()].sort((a, b) => a.localeCompare(b));
  }

  // Days a report was expected: the role's reminder days, never in the future.
  const expectedDates = (role, within = dates) => {
    const wanted = config.nudge.days_by_role[role] || config.nudge.days;
    return within.filter(d => d <= today && wanted.includes(weekday(d)));
  };
  // "EOD filed": days filed out of days expected, as a metric row like any other.
  const filedRow = (filed, expected, prevFiled, prevExpected) => finish(
    { key: 'filed', label: 'EOD filed', value: expected ? Math.min(100, pct(filed, expected)) : null, target: 100, unit: 'pct' },
    prevExpected ? Math.min(100, pct(prevFiled, prevExpected)) : null);

  const out = { setters: [], diallers: [], closers: [] };
  const not_filed = {};
  for (const role of roles) {
    const { list, merge } = ROLE[role];
    const expected = expectedDates(role);
    const prevExpected = expectedDates(role, prevDates);
    for (const [k, days] of perDay[role]) {
      if (personFilter && k !== personFilter) continue;
      const filedDates = new Set(days.map(d => d.date));
      const before = perDayPrev[role].get(k);
      const merged = merge(days);
      const scored = scoreCard(role, merged, days.length, before ? merge(before) : null, before ? before.length : 0);
      // a report on a day off still counts, so never show "6 of 5"
      const expectedCount = Math.max(expected.length, days.length);
      out[list].push({
        ...merged, role, ...scored,
        days_filed: days.length,
        days_expected: expectedCount,
        days_missed: expected.filter(d => !filedDates.has(d)),
        last_filed: days.reduce((a, d) => (d.ts > a ? d.ts : a), ''),
        filed: filedRow(days.length, expectedCount, before ? before.length : 0, prevExpected.length),
        // one scored row per filed day, the drill-down table
        by_day: days.map(d => ({ date: d.date, zero_call: Boolean(d.zero_call), ...scoreCard(role, d, 1, null, 0) })).reverse(),
      });
    }
    out[list].sort((a, b) => a.name.localeCompare(b.name));
    // Roster members with nothing filed in the whole period, only when a report was
    // actually expected in it (nobody is "missing" on a day off).
    not_filed[role] = !expected.length ? [] : (config.roster[role] || []).map(p => p.name)
      .filter(n => !perDay[role].has(key(n)) && (!personFilter || key(n) === personFilter));
    out[`${role}_expected`] = expected.length;
  }

  // ── Team KPIs: the same targets, multiplied up ────────────────────────────
  // A count target is per person per day, so the team's is target × people × days.
  // People = the roster for that role (or whoever filed, if there's no roster);
  // days = the days a report was expected. Rates keep their plain target.
  const prevCards = (role) => [...perDayPrev[role]].filter(([k]) => !personFilter || k === personFilter).map(([, days]) => ROLE[role].merge(days));
  const headcount = (role) => (personFilter ? 1 : Math.max((config.roster[role] || []).length, out[ROLE[role].list].length));
  const team_kpis = [];
  const teamRow = (role, key, label, pick, perPersonDay, opts = {}) => {
    const cards = out[ROLE[role].list], before = prevCards(role);
    const people = headcount(role), days = out[`${role}_expected`] || (cards.length ? dates.length : 0);
    const scale = opts.rate ? 1 : people * days;
    const m = finish({ key, label, value: cards.length ? pick(cards) : null, target: perPersonDay ? perPersonDay * scale : 0, unit: opts.unit },
      before.length ? pick(before) : null);
    m.role = role;
    m.note = !m.target ? '' : opts.rate ? `${ROLE_PLURAL[role]} target`
      : `${show(perPersonDay, opts.unit)} × ${people} ${people === 1 ? role : ROLE_PLURAL[role].toLowerCase()} × ${days} day${days === 1 ? '' : 's'}`;
    team_kpis.push(m);
  };
  const total = (k) => (cards) => add(cards, k);
  if (roles.includes('closer')) {
    const T = config.closer_targets;
    teamRow('closer', 'revenue', 'Revenue', total('revenue'), T.revenue, { unit: 'money' });
    teamRow('closer', 'calls', 'Calls taken', total('calls'), T.calls);
    teamRow('closer', 'show_rate', 'Show rate', (c) => pct(add(c, 'showed'), add(c, 'calls')), T.show_rate, { unit: 'pct', rate: true });
    teamRow('closer', 'close_rate', 'Close rate', (c) => pct(add(c, 'won'), add(c, 'showed')), T.close_rate, { unit: 'pct', rate: true });
  }
  if (roles.includes('setter')) {
    const T = config.setter_targets;
    teamRow('setter', 'bookings', 'Calls booked', total('calls_booked'), T.calls_booked);
    teamRow('setter', 'messages', 'Messages', total('messages'), T.messages);
    teamRow('setter', 'outbounds', 'Outbounds', total('outbounds'), T.outbounds);
    teamRow('setter', 'followups', 'Follow-ups', total('followups'), T.followups);
  }
  if (roles.includes('dialler')) {
    const T = config.dialler_targets;
    teamRow('dialler', 'dials', 'Dials', total('dials'), T.dials);
    teamRow('dialler', 'conversations', 'Conversations', total('conversations'), T.conversations);
    teamRow('dialler', 'calls_set', 'Calls set by diallers', (c) => add(c, 'set_booked') + add(c, 'triaged_booked'), 0);
  }

  const { setters, diallers, closers } = out;
  const calls = add(closers, 'calls'), showed = add(closers, 'showed'), won = add(closers, 'won');
  const team = {
    calls_booked: add(setters, 'calls_booked') + add(diallers, 'set_booked') + add(diallers, 'triaged_booked'),
    calls_taken: calls, showed, won, lost: add(closers, 'lost'),
    no_shows: add(closers, 'no_show'),
    revenue: add(closers, 'revenue'),
    show_rate: pct(showed, calls), close_rate: pct(won, showed),
    messages: add(setters, 'messages'), dials: add(diallers, 'dials'), conversations: add(diallers, 'conversations'),
    reports_filed: add(setters, 'days_filed') + add(diallers, 'days_filed') + add(closers, 'days_filed'),
    // one day: people who haven't filed. a period: every expected report that is missing.
    reports_missing: [...setters, ...diallers, ...closers].reduce((a, c) => a + c.days_missed.length, 0)
      + roles.reduce((a, r) => a + not_filed[r].length * expectedDates(r).length, 0),
  };

  const reportsExpected = team.reports_filed + team.reports_missing;
  const filedKpi = finish({ key: 'reports', label: 'Reports filed', value: team.reports_filed, target: reportsExpected }, null);
  filedKpi.note = reportsExpected ? `${team.reports_missing} missing` : '';
  team_kpis.push(filedKpi);

  return {
    status: 'ok', start, end, date: end, today, days: dates.length, single_day: dates.length === 1,
    range: preset ? query.range : '',
    roles, all_roles: allRoles, people, filter: { role: roleFilter, person: query.person ? String(query.person) : '' },
    team, team_kpis, setters, diallers, closers, not_filed,
    expected_days: Object.fromEntries(roles.map(r => [r, out[`${r}_expected`]])),
    previous: { start: prevDates[0], end: prevDates[prevDates.length - 1] },
    targets: { setter: { ...config.setter_targets }, dialler: { ...config.dialler_targets }, closer: { ...config.closer_targets } },
    currency_symbol: config.brand.currency_symbol,
  };
}

// ── Channel post ────────────────────────────────────────────────────────────
function scorecardEmbed(s, baseUrl) {
  const money = (n) => `${s.currency_symbol}${Math.round(n).toLocaleString('en-US')}`;
  const rate = (r) => (r == null ? 'n/a' : `${r}%`);
  const t = s.team;
  const fields = [];
  const clip = (lines) => lines.join('\n').slice(0, 1024) || 'n/a';

  if (s.roles.includes('setter')) {
    fields.push({ name: `💬 Setters (${s.setters.length} filed)`, inline: false, value: clip(s.setters.map(c =>
      `**${c.name}**: ${c.messages} msgs · ${c.outbounds} out · ${c.inbounds} in · ${c.links} links · ${c.calls_booked} booked`
      + (c.hit_kpis ? ` · KPIs: ${c.hit_kpis}` : ''))) });
  }
  if (s.roles.includes('dialler')) {
    fields.push({ name: `📞 Diallers (${s.diallers.length} filed)`, inline: false, value: clip(s.diallers.map(c =>
      `**${c.name}**: ${c.dials} dials · ${c.conversations} convos · ${c.set_booked + c.triaged_booked} booked · `
      + `show ${rate(c.set_show_rate)} set / ${rate(c.triaged_show_rate)} triaged`
      + (c.kpis_missed.length ? ` · ❌ ${c.kpis_missed.join(', ')}` : ' · ✅ no KPIs missed'))) });
  }
  if (s.roles.includes('closer')) {
    fields.push({ name: `🎯 Closers (${s.closers.length} filed)`, inline: false, value: clip(s.closers.map(c =>
      c.zero_call
        ? `**${c.name}**: no calls today`
        : `**${c.name}**: ${c.calls} calls · ${c.won} won · ${c.lost} lost · ${c.no_show} no-show · ${money(c.revenue)} · close ${rate(c.close_rate)}`)) });
  }
  const missing = s.roles.flatMap(r => s.not_filed[r].map(n => `${n} (${r})`));
  if (missing.length) fields.push({ name: '⚠️ Not filed', value: missing.join(', ').slice(0, 1024), inline: false });

  const headline = [
    s.roles.includes('closer') ? `💰 **${money(t.revenue)}** · ${t.won} won from ${t.calls_taken} calls · show ${rate(t.show_rate)} · close ${rate(t.close_rate)}` : '',
    `📅 ${t.calls_booked} calls booked · ${t.reports_filed} report${t.reports_filed === 1 ? '' : 's'} filed`,
    baseUrl ? `${baseUrl}/scorecard?date=${s.date}` : '',
  ].filter(Boolean).join('\n');

  return {
    title: `📊 Daily Scorecard: ${config.brand.name}, ${s.date}`,
    description: headline,
    color: missing.length ? 0xE67E22 : 0x2ECC71,
    fields,
  };
}

async function runScorecardPost(query = {}, baseUrl = '') {
  const now = localNow(config.brand.timezone || 'UTC');
  const at = config.scorecard.hour;
  const force = query.force === '1', dry = query.dry === '1';
  if (!force && !config.scorecard.enabled) return { status: 'skipped', reason: 'the scorecard post is switched off' };
  if (!force && now.hour !== at) return { status: 'skipped', reason: `local hour is ${now.hour}, scorecard hour is ${at}` };
  if (!providers('scorecard').length) return { status: 'skipped', reason: 'no scorecard channel connected' };

  // A morning post recaps yesterday; an afternoon/evening post covers today.
  const date = query.date || (at < 12 ? shiftDate(now.date, -1) : now.date);
  const s = await getScorecard({ date });
  if (!force && s.team.reports_filed === 0 && !s.roles.some(r => s.not_filed[r].length)) {
    return { status: 'skipped', reason: 'nothing filed and no roster, nothing to post', date };
  }
  if (!force && !dry && !(await firstRun(`scorecard:${date}`))) return { status: 'skipped', reason: 'already posted', date };
  const embed = scorecardEmbed(s, baseUrl);
  return { status: 'ok', date, dry, embed: dry ? embed : undefined, posted: dry ? undefined : await notifyScorecard(embed) };
}

module.exports = { getScorecard, scorecardEmbed, runScorecardPost };

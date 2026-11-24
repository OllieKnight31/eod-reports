// Closer call outcomes.
//   POST /api?source=closer_outcome  → single call (back-compat; used by webhooks)
//   POST /api?source=closer_eod      → full EOD: { closer, date, calls: [ {...}, ... ] }
//                                       or a zero-call day: { closer, date, no_calls: true, notes }
//                                       each call → its own sheet row + GHL upsert,
//                                       then ONE consolidated Discord EOD report.
//
// Per-call keys (loose): lead_source, setter, dialler, prospect_email, prospect_name,
// outcome (closed_won|closed_lost|no_show|follow_up|rescheduled|live_no_close),
// ticket, package, payment_type, payment_received, lost_reason, follow_up_date,
// objections, notes, recording_url, crm_contact_id.

const { config, canonicalName } = require('../config');
const { ensureCloserTab, ensureCloserNoCallsTab, appendRow } = require('../sheets');
const { notifyCloser } = require('../notify');
const { pushCloserOutcomeToGHL } = require('../ghl-write');

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
const money = (n) => `${config.brand.currency_symbol}${n.toLocaleString('en-US')}`;
// "Setter: X · Dialler: Y", whoever booked the call, one or both.
const bookedBy = (p) => [p.setter && `Setter: ${p.setter}`, p.dialler && `Dialler: ${p.dialler}`].filter(Boolean).join(' · ');

const COLORS = {
  closed_won: 0x2ECC71, closed_lost: 0xE74C3C,
  no_show: 0xE67E22, follow_up: 0xF1C40F, default: 0x95A5A6,
};
const emojiFor = (k) =>
  k === 'closed_won' ? '✅' : k === 'closed_lost' ? '❌' : k === 'no_show' ? '🟠' :
  k === 'follow_up' ? '🟡' : k === 'rescheduled' ? '🔁' : '📋';

function crmSyncText(g) {
  if (!g) return 'n/a';
  if (g.status === 'ok')      return `✓ ${g.stage}/${g.opp_status}${g.created ? ' (new)' : ''}`;
  if (g.status === 'skipped') return `skipped (${g.reason})`;
  return `⚠️ ${g.status}${g.detail ? ` (${g.detail})` : ''}`;
}

// Process ONE call: GHL upsert + sheet row. Returns the normalized details.
async function processCloserCall(closer, date, call = {}) {
  const ts = new Date().toISOString();
  const lead_source = (call.lead_source || call.source || 'Webinar').toString().trim();
  const setter = canonicalName('setter', (call.setter || call.setter_name || '').toString().trim());
  const dialler = canonicalName('dialler', (call.dialler || call.dialler_name || '').toString().trim());
  const outcome = (call.outcome || '').toString().trim();
  const outcomeKey = outcome.toLowerCase().replace(/[\s\-]+/g, '_');
  const ticketNum = num(call.ticket || call.ticket_price);

  // GHL first so the resolved contact id can be stored on the sheet row.
  const ghlResult = await pushCloserOutcomeToGHL(call, outcomeKey);
  const crmContactId = (call.crm_contact_id || ghlResult.contactId || '').toString();

  const row = [
    ts, date, closer, lead_source, call.lead_source_detail || '', setter,
    call.prospect_email || '', call.prospect_name || '',
    outcome, call.package || '', ticketNum, call.payment_type || '', call.payment_received || '',
    call.lost_reason || '', call.follow_up_date || '', call.objections || '', (call.notes || '').toString().slice(0, 2000),
    crmContactId, call.recording_url || '', dialler,
  ];
  const ok = await appendRow(config.sheet.tabs.closer_outcomes, row);

  return {
    ts, lead_source, setter, dialler, outcome, outcomeKey, ticketNum, ghlResult, ok,
    prospect_name: call.prospect_name || '', prospect_email: call.prospect_email || '', call,
  };
}

// Full per-call field breakdown (single-call notification).
function callFields(p) {
  const F = (name, value, inline = true) => ({ name, value: String(value), inline });
  const c = p.call;
  return [
    F('Outcome', p.outcome || 'n/a'),
    ...(p.prospect_email ? [F('Prospect Email', p.prospect_email)] : []),
    ...(p.setter ? [F('Setter', p.setter)] : []),
    ...(p.dialler ? [F('Dialler', p.dialler)] : []),
    ...(c.lead_source_detail ? [F('Lead Detail', c.lead_source_detail)] : []),
    ...(c.package ? [F('Package', c.package)] : []),
    ...(p.ticketNum ? [F('Ticket', money(p.ticketNum))] : []),
    ...(c.payment_type ? [F('Payment Type', c.payment_type)] : []),
    ...(c.payment_received ? [F('Payment Received', c.payment_received)] : []),
    ...(c.lost_reason ? [F('Lost Reason', String(c.lost_reason).slice(0, 256))] : []),
    ...(c.follow_up_date ? [F('Follow-up Date', c.follow_up_date)] : []),
    ...(c.objections ? [F('Objections', String(c.objections).slice(0, 1024), false)] : []),
    ...(c.recording_url ? [F('Recording', String(c.recording_url).slice(0, 1024), false)] : []),
    ...(c.notes ? [F('Notes', String(c.notes).slice(0, 1024), false)] : []),
    F('CRM Sync', crmSyncText(p.ghlResult), false),
  ];
}

// ── Single call (webhook back-compat) ───────────────────────────────────────
async function handleCloserOutcome(body = {}) {
  const date = (body.date || new Date().toISOString().slice(0, 10)).toString();
  const closer = canonicalName('closer', (body.closer || body.closer_name || 'Unknown').toString().trim());
  await ensureCloserTab();

  const p = await processCloserCall(closer, date, body);
  const notifyResult = await notifyCloser({
    title: `${emojiFor(p.outcomeKey)} ${p.outcome || 'Call Outcome'}: ${p.prospect_name || p.prospect_email || 'Unknown'}`,
    description: `**Closer:** ${closer} · **Source:** ${p.lead_source}${p.setter ? ` · **Setter:** ${p.setter}` : ''}${p.dialler ? ` · **Dialler:** ${p.dialler}` : ''} · **Date:** ${date}`,
    color: COLORS[p.outcomeKey] || COLORS.default,
    fields: callFields(p),
    timestamp: p.ts,
  });

  return {
    status: 'received', source: 'closer_outcome',
    closer, prospect_name: p.prospect_name, outcome: p.outcome,
    sheet_write: p.ok ? 'logged' : 'failed',
    crm_push: p.ghlResult, notifications: notifyResult, timestamp: p.ts,
  };
}

// ── Full EOD: many calls in one report ──────────────────────────────────────
async function handleCloserEOD(body = {}) {
  const ts = new Date().toISOString();
  const date = (body.date || ts.slice(0, 10)).toString();
  const closer = canonicalName('closer', (body.closer || body.closer_name || 'Unknown').toString().trim());

  let calls = Array.isArray(body.calls) ? body.calls : [];
  if (!calls.length && (body.prospect_name || body.prospect_email || body.outcome)) calls = [body]; // tolerate single
  calls = calls.filter(c => c && (c.prospect_name || c.prospect_email || c.outcome));
  if (!calls.length) {
    if (body.no_calls === true || body.no_calls === 'true') return handleCloserNoCalls(closer, date, body.notes, ts);
    return { status: 'error', source: 'closer_eod', message: 'no calls provided', timestamp: ts };
  }

  await ensureCloserTab();
  // Parallel across calls (each call's GHL+sheet run in sequence internally) so a
  // long EOD stays well under the 30s function budget. Order is preserved.
  const processed = await Promise.all(calls.map(c => processCloserCall(closer, date, c)));

  const totals = { calls: processed.length, won: 0, lost: 0, follow_up: 0, no_show: 0, revenue: 0, sheet_ok: 0, crm_ok: 0 };
  for (const p of processed) {
    if (p.outcomeKey === 'closed_won') { totals.won++; totals.revenue += p.ticketNum; }
    else if (p.outcomeKey === 'closed_lost') totals.lost++;
    else if (p.outcomeKey === 'follow_up' || p.outcomeKey === 'rescheduled') totals.follow_up++;
    else if (p.outcomeKey === 'no_show') totals.no_show++;
    if (p.ok) totals.sheet_ok++;
    if (p.ghlResult?.status === 'ok') totals.crm_ok++;
  }

  // One consolidated EOD report: a field per call with its full breakdown.
  const MAXF = 24;
  const fields = processed.slice(0, MAXF).map((p, i) => {
    const c = p.call, lines = [];
    lines.push([`Source: ${p.lead_source}`, bookedBy(p)].filter(Boolean).join(' · '));
    const deal = [];
    if (p.ticketNum) deal.push(money(p.ticketNum));
    if (c.package) deal.push(c.package);
    if (c.payment_type) deal.push(c.payment_type);
    if (c.payment_received) deal.push(`paid: ${c.payment_received}`);
    if (deal.length) lines.push(deal.join(' · '));
    if (c.lost_reason) lines.push(`Lost: ${c.lost_reason}`);
    if (c.follow_up_date) lines.push(`Follow-up: ${c.follow_up_date}`);
    if (c.objections) lines.push(`Objections: ${String(c.objections).slice(0, 200)}`);
    if (c.recording_url) lines.push(`Rec: ${c.recording_url}`);
    if (c.notes) lines.push(`📝 ${String(c.notes).slice(0, 300)}`);
    lines.push(`CRM: ${crmSyncText(p.ghlResult)}`);
    return {
      name: `${i + 1}. ${emojiFor(p.outcomeKey)} ${p.prospect_name || p.prospect_email || 'Unknown'}: ${p.outcome || 'n/a'}`.slice(0, 256),
      value: lines.join('\n').slice(0, 1024),
      inline: false,
    };
  });
  if (processed.length > MAXF) {
    fields.push({ name: `+ ${processed.length - MAXF} more calls`, value: 'See the EOD dashboard for the full list.', inline: false });
  }

  const desc =
    `**Closer:** ${closer} · **Date:** ${date}\n` +
    `**${totals.calls} call${totals.calls === 1 ? '' : 's'}** · ✅ ${totals.won} won · ❌ ${totals.lost} lost · ` +
    `🟡 ${totals.follow_up} follow-up · 🟠 ${totals.no_show} no-show · 💰 ${money(totals.revenue)}`;
  const color = totals.won > 0 ? COLORS.closed_won : totals.lost > 0 ? COLORS.closed_lost : COLORS.default;

  const notifyResult = await notifyCloser({
    title: `📋 Closer EOD: ${closer} (${totals.calls} call${totals.calls === 1 ? '' : 's'})`,
    description: desc, color, fields, timestamp: ts,
  });

  return {
    status: 'received', source: 'closer_eod', closer, date,
    calls_count: totals.calls, totals,
    results: processed.map(p => ({
      prospect_name: p.prospect_name, outcome: p.outcome,
      sheet_write: p.ok ? 'logged' : 'failed', crm_push: p.ghlResult,
    })),
    notifications: notifyResult, timestamp: ts,
  };
}

// ── Zero-call day ───────────────────────────────────────────────────────────
// A closer still files an EOD when no calls ran. It goes to its own tab, never CLOSER
// OUTCOMES: every row there is read as a call by the dashboards.
async function handleCloserNoCalls(closer, date, notes, ts) {
  const note = (notes || '').toString().trim().slice(0, 2000);
  await ensureCloserNoCallsTab();
  const ok = await appendRow(config.sheet.tabs.closer_no_calls, [ts, date, closer, note]);
  const notifyResult = await notifyCloser({
    title: `📋 Closer EOD: ${closer} (0 calls)`,
    description: `**Closer:** ${closer} · **Date:** ${date}\n**No calls taken today.**`,
    color: COLORS.default,
    fields: note ? [{ name: 'Notes', value: note.slice(0, 1024), inline: false }] : [],
    timestamp: ts,
  });
  return {
    status: 'received', source: 'closer_eod', closer, date, calls_count: 0,
    totals: { calls: 0, won: 0, lost: 0, follow_up: 0, no_show: 0, revenue: 0 },
    sheet_write: ok ? 'logged' : 'failed', notifications: notifyResult, timestamp: ts,
  };
}

module.exports = { handleCloserOutcome, handleCloserEOD };

// POST /api?source=dialler_eod
//
// The dialler's end-of-day. Six KPIs, each measured against a target from
// config.dialler_targets (KPI_*, editable on /settings):
//
//   dials · conversations · speed to lead · all leads triaged with notes ·
//   show rate on set calls · show rate on triaged calls
//
// Everything is self-reported. Only name + date are required: a KPI with nothing to
// measure (no leads today, no calls due) is marked ⚪ and counts as neither a hit nor
// a miss, so a quiet day can always be filed and never inflates or dents the hit rate.
//
// Show rate is reported for calls that were DUE TODAY, not calls booked today
// a dialler cannot know at 6pm whether a call they booked for next Tuesday showed.
// "Booked today" is captured separately as forward-looking pipeline.

const { config, canonicalName } = require('../config');
const { ensureDiallerTab, appendRow } = require('../sheets');
const { notifyDialler } = require('../notify');

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function pct(part, whole) { return whole > 0 ? Math.round((part / whole) * 100) : null; }
function yes(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === 'y' || s === '1' || s === 'on';
}

async function handleDiallerEOD(body = {}) {
  const ts = new Date().toISOString();
  const date = (body.date || ts.slice(0, 10)).toString();
  const dialler = canonicalName('dialler', (body.dialler || body.dialler_name || body.name || 'Unknown').toString().trim());
  const T = config.dialler_targets;

  const dials         = num(body.dials);
  const conversations = num(body.conversations);
  const leadsTriaged  = num(body.leads_triaged);
  const allNotes      = yes(body.all_triaged_with_notes ?? body.all_triaged_notes);
  // Blank speed = no new leads came in today, which is not a miss.
  const speed = body.speed_to_lead === '' || body.speed_to_lead == null ? null : num(body.speed_to_lead);

  const setDue      = num(body.set_calls_due);
  const setShowed   = num(body.set_calls_showed);
  const triagedDue  = num(body.triaged_calls_due);
  const triagedShow = num(body.triaged_calls_showed);
  const setRate     = pct(setShowed, setDue);
  const triagedRate = pct(triagedShow, triagedDue);

  const setBooked     = num(body.set_calls_booked);
  const triagedBooked = num(body.triaged_calls_booked);
  const bookedTo      = canonicalName('closer', (body.booked_to_closer || '').toString().trim());
  const notes         = (body.notes || '').toString().slice(0, 2000);

  // Each KPI: [label, hit?, display]. null = nothing to measure today.
  const kpis = [
    ['Dials',          dials >= T.dials,                 `${dials}/${T.dials}`],
    ['Conversations',  conversations >= T.conversations, `${conversations}/${T.conversations}`],
    ['Speed to lead',  speed == null ? null : speed <= T.speed_to_lead_min,
                       speed == null ? 'no new leads today' : `${speed} min (target ≤${T.speed_to_lead_min})`],
    ['Triaged w/ notes', leadsTriaged === 0 ? null : allNotes,
                       leadsTriaged === 0 ? 'no leads triaged today' : allNotes ? `all ${leadsTriaged} have notes` : 'incomplete'],
    ['Set show rate',  setRate == null ? null : setRate >= T.set_show_rate,
                       setRate == null ? 'none due' : `${setRate}% (target ${T.set_show_rate}%)`],
    ['Triaged show rate', triagedRate == null ? null : triagedRate >= T.triaged_show_rate,
                       triagedRate == null ? 'none due' : `${triagedRate}% (target ${T.triaged_show_rate}%)`],
  ];
  const hit    = kpis.filter(k => k[1] === true).map(k => k[0]);
  const missed = kpis.filter(k => k[1] === false).map(k => k[0]);

  await ensureDiallerTab();
  const row = [
    ts, date, dialler,
    dials, conversations, leadsTriaged, leadsTriaged === 0 ? '' : allNotes ? 'Yes' : 'No',
    speed == null ? '' : speed,
    setDue, setShowed, setRate == null ? '' : setRate,
    triagedDue, triagedShow, triagedRate == null ? '' : triagedRate,
    setBooked, triagedBooked, bookedTo,
    hit.join(', '), missed.join(', '), notes,
  ];
  const ok = await appendRow(config.sheet.tabs.dialler_activity, row);

  const mark = v => (v === true ? '✅' : v === false ? '❌' : '⚪');
  const lines = kpis.map(([label, h, disp]) => `${mark(h)} **${label}**: ${disp}`).join('\n');
  const headline = missed.length === 0
    ? 'All KPIs hit'
    : `${missed.length} KPI${missed.length > 1 ? 's' : ''} missed: ${missed.join(', ')}`;

  const notification = await notifyDialler({
    title: `📞 Dialler EOD: ${dialler}`,
    description: `**${date}** · ${headline}\n\n${lines}`,
    color: missed.length === 0 ? 0x2ECC71 : 0xE67E22,
    fields: [
      { name: 'Leads triaged', value: String(leadsTriaged), inline: true },
      { name: 'Booked today',  value: `${setBooked} set · ${triagedBooked} triaged`, inline: true },
      ...(bookedTo ? [{ name: 'Booked to', value: bookedTo, inline: true }] : []),
      ...(notes ? [{ name: 'Notes', value: notes.slice(0, 900), inline: false }] : []),
    ],
    timestamp: ts,
  });

  return {
    status: 'received', source: 'dialler_eod', dialler, date,
    sheet_write: ok ? 'logged' : 'failed',
    kpis: { hit, missed, set_show_rate: setRate, triaged_show_rate: triagedRate },
    notifications: notification, timestamp: ts,
  };
}

module.exports = { handleDiallerEOD };

// POST /api?source=setter_eod
// Body: see SETTER_ACTIVITY_HEADERS in lib/sheets.js, keys are loose; we map by
// best-effort. Required: setter (or setter_name). Everything else is optional.

const { config, canonicalName } = require('../config');
const { ensureSetterTab, appendRow } = require('../sheets');
const { notifySetter } = require('../notify');

function num(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }

async function handleSetterEOD(body = {}) {
  const ts = new Date().toISOString();
  const date = (body.date || ts.slice(0, 10)).toString();
  const setter = canonicalName('setter', (body.setter || body.setter_name || body.name || 'Unknown').toString().trim());
  const lead_source = (body.lead_source || body.source || 'Webinar').toString().trim();
  // Links are counted by type; Links Sent is their total unless a caller sends it directly.
  const bookingLinks = num(body.booking_links), communityInvites = num(body.community_invites), resourceLinks = num(body.resource_links);
  const linksSent = body.links_sent != null && body.links_sent !== '' ? num(body.links_sent) : bookingLinks + communityInvites + resourceLinks;

  await ensureSetterTab();

  const row = [
    ts, date, setter, lead_source, body.lead_source_detail || '',
    num(body.profile_visits), num(body.new_followers), num(body.total_followers), num(body.qualified_followers),
    num(body.messages_sent || body.dms_sent), num(body.outbounds || body.new_outbounds), num(body.inbounds || body.new_inbound_conversations_received), num(body.followups || body.followups_sent_today),
    linksSent, num(body.calls_proposed || body.calls_proposedsuggested), num(body.calls_booked || body.calls_booked_on_calendar),
    num(body.no_shows), num(body.cancellations),
    body.hottest_lead || '', body.lead_quality || body.quality_of_inbox_today || '', body.hit_kpis || body.did_you_hit_your_kpis || '',
    (body.notes || body.additional_notes || '').toString().slice(0, 2000),
    bookingLinks, communityInvites, resourceLinks,
  ];

  const ok = await appendRow(config.sheet.tabs.setter_activity, row);

  // Full breakdown, every metric captured on the setter form, not just a few.
  const F = (name, value, inline = true) => ({ name, value: String(value), inline });
  const detail = (body.lead_source_detail || '').toString().trim();
  const hottest = (body.hottest_lead || '').toString().trim();
  const quality = (body.lead_quality || body.quality_of_inbox_today || '').toString().trim();
  const hitKpis = (body.hit_kpis || body.did_you_hit_your_kpis || '').toString().trim();
  const setterNotes = (body.notes || body.additional_notes || '').toString().trim();

  const fields = [
    F('Profile Visits', num(body.profile_visits)),
    F('New Followers', num(body.new_followers)),
    F('Total Followers', num(body.total_followers)),
    F('Qualified (ICP)', num(body.qualified_followers)),
    F('Messages Sent', num(body.messages_sent || body.dms_sent)),
    F('Outbounds', num(body.outbounds || body.new_outbounds)),
    F('Inbounds', num(body.inbounds || body.new_inbound_conversations_received)),
    F('Follow-ups', num(body.followups || body.followups_sent_today)),
    F('Links Sent', `${linksSent}  (📅 ${bookingLinks} booking · 👥 ${communityInvites} community · 📄 ${resourceLinks} resource/VSL)`),
    F('Calls Proposed', num(body.calls_proposed || body.calls_proposedsuggested)),
    F('Calls Booked', num(body.calls_booked || body.calls_booked_on_calendar)),
    F('No Shows', num(body.no_shows)),
    F('Cancellations', num(body.cancellations)),
    F('Hit KPIs', hitKpis || 'n/a'),
    F('Lead Quality', /^[1-5]$/.test(quality) ? `${quality} / 5` : (quality || 'n/a')),
    ...(detail ? [F('Lead Detail', detail)] : []),
    ...(hottest ? [F('🔥 Hottest Lead', hottest, false)] : []),
    ...(setterNotes ? [F('Notes', setterNotes.slice(0, 1000), false)] : []),
  ];

  const notifyResult = await notifySetter({
    title: `📋 Setter EOD: ${setter}`,
    description: `**Setter:** ${setter} · **Source:** ${lead_source} · **Date:** ${date}`,
    color: 0x3498DB,
    fields,
    timestamp: ts,
  });

  return {
    status: 'received',
    source: 'setter_eod',
    setter, date, lead_source,
    sheet_write: ok ? 'logged' : 'failed',
    // Setter EOD is aggregate activity (DMs, outbounds, calls booked) with no single
    // prospect, so there's no contact-level object to write to GHL. It lands in the
    // sheet + dashboard + Discord. (Booked-call prospects sync to GHL via the closer flow.)
    crm_push: { status: 'skipped', reason: 'setter EOD is aggregate activity, no prospect to sync to GHL' },
    notifications: notifyResult,
    timestamp: ts,
  };
}

module.exports = { handleSetterEOD };

// GHL write-back. On a closer outcome, upsert the prospect contact and
// upsert their opportunity in the configured pipeline, moving it to the stage
// + status that matches the call outcome. Idempotent (opportunities/upsert keys
// on contact+pipeline, so re-submits update the same opp, never duplicate).
//
// Never throws, returns a { status } result the handler folds into its response.

const { config } = require('./config');

const GHL_BASE = 'https://services.leadconnectorhq.com';

// Call outcome → which dashboard column the opportunity should move to, and its GHL status.
// The column keys are the ones the stage picker on /settings maps to real GHL stages
// (callBooked, callCompleted, proposalSent, closedWon, closedLost, noShow). Each outcome
// lists columns in order of preference; the first one that is mapped to a stage is used.
// If none is mapped, the status still updates and the stage is left where it is.
const OUTCOME_MAP = {
  closed_won:    { stages: ['closedWon'],                     status: 'won'  },
  closed_lost:   { stages: ['closedLost'],                    status: 'lost' },
  follow_up:     { stages: ['proposalSent', 'callCompleted'], status: 'open' },
  live_no_close: { stages: ['callCompleted', 'proposalSent'], status: 'open' },
  rescheduled:   { stages: ['callBooked'],                    status: 'open' },
  no_show:       { stages: ['noShow', 'callBooked'],          status: 'open' },
};
const DEFAULT_MAP = { stages: ['callCompleted'], status: 'open' };

function ghlEnabled() {
  const g = config.crm.ghl;
  return config.crm.provider === 'ghl' && Boolean(g.api_key && g.location_id && g.pipeline_id);
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${config.crm.ghl.api_key}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function ghlFetch(method, path, body) {
  const resp = await fetch(GHL_BASE + path, {
    method,
    headers: ghlHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  let json = {};
  try { json = await resp.json(); } catch { /* empty body */ }
  return { ok: resp.ok, status: resp.status, json };
}

// Push a closer outcome into GHL. `outcomeKey` is the normalized outcome string.
async function pushCloserOutcomeToGHL(body = {}, outcomeKey = '') {
  if (!ghlEnabled()) return { status: 'skipped', reason: 'no CRM write-back for this setup (GoHighLevel only)' };

  const { location_id, pipeline_id, stages } = config.crm.ghl;
  const email = (body.prospect_email || '').toString().trim();
  let contactId = (body.crm_contact_id || '').toString().trim();

  if (!email && !contactId) {
    return { status: 'skipped', reason: 'no prospect email or CRM contact id, nothing to sync' };
  }

  try {
    // 1) Resolve the contact (upsert keys on email, so existing prospects update in place).
    if (!contactId) {
      const name = (body.prospect_name || '').toString().trim();
      const parts = name.split(/\s+/).filter(Boolean);
      const up = await ghlFetch('POST', '/contacts/upsert', {
        locationId: location_id,
        email,
        name: name || undefined,
        firstName: parts[0] || undefined,
        lastName: parts.slice(1).join(' ') || undefined,
      });
      if (!up.ok) {
        return { status: 'error', step: 'contact_upsert', http: up.status, detail: up.json?.message || '' };
      }
      contactId = (up.json.contact || {}).id || up.json.id || '';
    }
    if (!contactId) return { status: 'error', step: 'contact_upsert', reason: 'no contactId returned' };

    // 2) Upsert the opportunity to the stage/status that matches the outcome.
    const map = OUTCOME_MAP[outcomeKey] || DEFAULT_MAP;
    const stageKey = map.stages.find(k => stages[k]) || '';
    const stageId = stageKey ? stages[stageKey] : '';
    const oppBody = {
      pipelineId: pipeline_id,
      locationId: location_id,
      contactId,
      name: (body.prospect_name || body.prospect_email || 'EOD Opportunity').toString(),
      status: map.status,
    };
    if (stageId) oppBody.pipelineStageId = stageId;
    const ticket = parseFloat(body.ticket || body.ticket_price);
    if (Number.isFinite(ticket) && ticket > 0) oppBody.monetaryValue = ticket;

    const opp = await ghlFetch('POST', '/opportunities/upsert', oppBody);
    if (!opp.ok) {
      return { status: 'error', step: 'opportunity_upsert', http: opp.status, contactId, detail: opp.json?.message || '' };
    }
    const o = opp.json.opportunity || opp.json || {};
    return {
      status: 'ok',
      contactId,
      opportunityId: o.id || '',
      stage: stageKey || 'unchanged (no matching column mapped)',
      opp_status: map.status,
      created: opp.json.new === true,
    };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

module.exports = { pushCloserOutcomeToGHL, ghlEnabled };

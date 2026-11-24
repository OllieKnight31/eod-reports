// CRM adapter. Returns a normalized pipeline shape regardless of provider.
//
//   { available, provider, stages: [{key,label,count,value,contacts:[]}],
//     contactsByEmail: { <email>: contact } }
//
// To add a provider: implement an async function that returns the same shape,
// and route to it from getCRMPipelineNormalized() based on config.crm.provider.

const { config } = require('./config');

function buildCRMContactUrl(provider, contactId) {
  if (!contactId) return null;
  if (provider === 'ghl') {
    const loc = config.crm.ghl.location_id;
    if (!loc) return null;
    return `https://app.gohighlevel.com/v2/location/${loc}/contacts/detail/${contactId}`;
  }
  if (provider === 'close') return `https://app.close.com/lead/${contactId}/`;
  return null;
}

// ── GHL provider ────────────────────────────────────────────────────────────
async function ghlFetchAllOpportunities() {
  const { api_key, location_id, pipeline_id } = config.crm.ghl;
  if (!api_key || !location_id || !pipeline_id) return [];
  const headers = {
    'Authorization': `Bearer ${api_key}`,
    'Version': '2021-07-28',
    'Accept': 'application/json',
  };
  const all = [];
  let startAfter = null, startAfterId = null;
  for (let page = 0; page < 40; page++) {
    const qs = new URLSearchParams({ location_id, pipeline_id, limit: '100' });
    if (startAfter) qs.set('startAfter', String(startAfter));
    if (startAfterId) qs.set('startAfterId', String(startAfterId));
    let data;
    try {
      const resp = await fetch(`https://services.leadconnectorhq.com/opportunities/search?${qs.toString()}`, {
        headers, signal: AbortSignal.timeout(15000),
      });
      data = await resp.json();
    } catch (e) {
      console.error('[crm-adapter:ghl] fetch error:', e.message);
      break;
    }
    const opps = data.opportunities || [];
    if (!opps.length) break;
    all.push(...opps);
    const meta = data.meta || {};
    if (!meta.nextPageUrl) break;
    startAfter = meta.startAfter || null;
    startAfterId = meta.startAfterId || null;
    if (!startAfter || !startAfterId) break;
  }
  return all;
}

async function ghlPipeline() {
  const { stages } = config.crm.ghl;
  if (!Object.keys(stages).length) {
    return { available: false, provider: 'ghl', error: 'GHL_STAGES_JSON not configured', stages: [], contactsByEmail: {} };
  }

  let opps;
  try { opps = await ghlFetchAllOpportunities(); }
  catch (e) { return { available: false, provider: 'ghl', error: e.message, stages: [], contactsByEmail: {} }; }

  const stageById = {};
  for (const [key, id] of Object.entries(stages)) stageById[id] = key;

  const buckets = {};
  for (const k of config.closer_stage_order) {
    buckets[k] = { key: k, label: config.closer_stage_labels[k] || k, count: 0, value: 0, contacts: [] };
  }

  const contactsByEmail = {};
  for (const opp of opps) {
    const stageKey = stageById[opp.pipelineStageId || opp.stageId];
    if (!stageKey || !buckets[stageKey]) continue;
    const value = parseFloat(opp.monetaryValue) || 0;
    const c = opp.contact || {};
    const email = (c.email || '').trim().toLowerCase();
    const entry = {
      crm_contact_id: opp.contactId || c.id || '',
      crm_url: buildCRMContactUrl('ghl', opp.contactId || c.id || ''),
      name: c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || '',
      email: c.email || '',
      phone: c.phone || '',
      tags: c.tags || [],
      value, stage_key: stageKey, stage_label: buckets[stageKey].label,
      updated_at: opp.updatedAt || opp.dateUpdated || '',
    };
    buckets[stageKey].count += 1;
    buckets[stageKey].value += value;
    buckets[stageKey].contacts.push(entry);
    if (email) contactsByEmail[email] = entry;
  }

  for (const k of config.closer_stage_order) {
    buckets[k].contacts.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  }

  return {
    available: true,
    provider: 'ghl',
    stages: config.closer_stage_order.map(k => buckets[k]),
    contactsByEmail,
  };
}

// ── Close provider (read-only) ──────────────────────────────────────────────
// Close groups opportunities by STATUS; each mapped stage key points at a status id.
// Auth is HTTP Basic with the API key as the username and an empty password.
const CLOSE_BASE = 'https://api.close.com/api/v1';
function closeHeaders(apiKey) {
  return { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`, Accept: 'application/json' };
}

// Only the mapped statuses and the fields the dashboard shows are requested, and pages
// after the first load together, so a CRM with thousands of opportunities stays quick.
const CLOSE_OPP_FIELDS = 'id,status_id,lead_id,lead_name,contact_name,value,date_updated';
async function closeFetchOpportunities(apiKey, statusIds) {
  const page = async (n) => {
    const qs = `status_id__in=${statusIds.map(encodeURIComponent).join(',')}&_fields=${CLOSE_OPP_FIELDS}&_limit=100&_skip=${n * 100}`;
    const resp = await fetch(`${CLOSE_BASE}/opportunity/?${qs}`, { headers: closeHeaders(apiKey), signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`Close API ${resp.status}`);
    return resp.json();
  };
  const first = await page(0);
  const all = [...(first.data || [])];
  const pages = Math.min(30, Math.ceil((Number(first.total_results) || 0) / 100));
  for (let n = 1; n < pages; n += 5) {
    const batch = await Promise.all(Array.from({ length: Math.min(5, pages - n) }, (_, i) => page(n + i)));
    for (const data of batch) all.push(...(data.data || []));
  }
  return all;
}

async function closePipeline() {
  const { api_key, stages } = config.crm.close;
  if (!api_key || !Object.keys(stages).length) {
    return { available: false, provider: 'close', error: 'Close is not fully configured', stages: [], contactsByEmail: {} };
  }
  let opps;
  try { opps = await closeFetchOpportunities(api_key, [...new Set(Object.values(stages).filter(Boolean))]); }
  catch (e) {
    console.error('[crm-adapter:close] fetch error:', e.message);
    return { available: false, provider: 'close', error: e.message, stages: [], contactsByEmail: {} };
  }

  const stageById = {};
  for (const [key, id] of Object.entries(stages)) stageById[id] = key;
  const buckets = {};
  for (const k of config.closer_stage_order) {
    buckets[k] = { key: k, label: config.closer_stage_labels[k] || k, count: 0, value: 0, contacts: [] };
  }

  for (const opp of opps) {
    const stageKey = stageById[opp.status_id];
    if (!stageKey || !buckets[stageKey]) continue;
    const value = (Number(opp.value) || 0) / 100;      // Close stores money in cents
    buckets[stageKey].count += 1;
    buckets[stageKey].value += value;
    buckets[stageKey].contacts.push({
      crm_contact_id: opp.lead_id || '',
      crm_url: buildCRMContactUrl('close', opp.lead_id || ''),
      name: opp.contact_name || opp.lead_name || '',
      // The opportunity list carries no email/phone; the card links straight to the lead.
      email: '', phone: '', tags: [],
      value, stage_key: stageKey, stage_label: buckets[stageKey].label,
      updated_at: opp.date_updated || '',
    });
  }
  for (const k of config.closer_stage_order) {
    buckets[k].contacts.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  }
  return { available: true, provider: 'close', stages: config.closer_stage_order.map(k => buckets[k]), contactsByEmail: {} };
}

// ── 'none' provider, pipeline disabled ─────────────────────────────────────
function nonePipeline() {
  return { available: false, provider: 'none', stages: [], contactsByEmail: {} };
}

// ── Public entrypoint ───────────────────────────────────────────────────────
async function getCRMPipelineNormalized() {
  switch (config.crm.provider) {
    case 'ghl':  return ghlPipeline();
    case 'close': return closePipeline();
    case 'none': return nonePipeline();
    default:
      console.warn('[crm-adapter] unknown provider:', config.crm.provider, 'falling back to none');
      return nonePipeline();
  }
}

module.exports = { getCRMPipelineNormalized, buildCRMContactUrl, CLOSE_BASE, closeHeaders };

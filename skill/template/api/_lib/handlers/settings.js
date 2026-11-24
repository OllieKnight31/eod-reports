// Settings handlers, backs the /settings page.
//   GET  /api?action=settings        → current settings (secrets masked)
//   POST /api?source=settings        → save { values, clear }
//   POST /api?source=settings_test   → check a connection { target }
// All three are owner-only; api/index.js checks the login before calling in here.

const { google } = require('googleapis');
const { config, applySettings } = require('../config');
const { notify, SLACK_API, DISCORD_API } = require('../notify');
const { CLOSE_BASE, closeHeaders } = require('../crm-adapter');
const {
  STAGE_KEYS, backend,
  loadSettings, saveSettings, describe,
} = require('../settings-store');

const GHL_BASE = 'https://services.leadconnectorhq.com';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// What is actually in force for every non-secret setting, defaults included, so the
// page shows the real state instead of an empty box that silently means "default".
function effective() {
  const c = config, t = c.dialler_targets, s = c.setter_targets, k = c.closer_targets;
  return {
    BRAND_NAME: c.brand.name, BRAND_COLOR: c.brand.color, TIMEZONE: c.brand.timezone, CURRENCY_SYMBOL: c.brand.currency_symbol,
    LEAD_SOURCES: c.lead_sources.join(','), CLOSER_EXTRA_SOURCES: c.closer_extra_sources.join(','),
    REPORT_ROLES: c.report_roles.join(','),
    KPI_SETTER_MESSAGES: s.messages, KPI_SETTER_OUTBOUNDS: s.outbounds, KPI_SETTER_FOLLOWUPS: s.followups, KPI_SETTER_CALLS_BOOKED: s.calls_booked,
    KPI_DIALS: t.dials, KPI_CONVERSATIONS: t.conversations, KPI_SPEED_TO_LEAD_MIN: t.speed_to_lead_min,
    KPI_SET_SHOW_RATE: t.set_show_rate, KPI_TRIAGED_SHOW_RATE: t.triaged_show_rate,
    KPI_CLOSER_CALLS: k.calls, KPI_CLOSER_SHOW_RATE: k.show_rate, KPI_CLOSER_CLOSE_RATE: k.close_rate, KPI_CLOSER_REVENUE: k.revenue,
    REMINDERS: c.nudge.enabled ? 'on' : 'off', NUDGE_HOUR: c.nudge.hour, NUDGE_DAYS: c.nudge.days.join(','), NUDGE_ROLES: c.nudge.roles.join(','),
    SCORECARD_POST: c.scorecard.enabled ? 'on' : 'off', SCORECARD_HOUR: c.scorecard.hour,
    CRM_PROVIDER: c.crm.provider,
  };
}

function view(saved) {
  applySettings(saved);
  const eff = effective();
  return {
    effective: Object.fromEntries(Object.entries(eff).map(([k, v]) => [k, String(v)])),
    status: 'ok',
    storage: backend(),
    report_roles: config.report_roles,
    stage_keys: STAGE_KEYS,
    stage_labels: Object.fromEntries(STAGE_KEYS.map(k => [k, config.closer_stage_labels[k] || k])),
    fields: describe(saved),
  };
}

async function getSettings() {
  return view(await loadSettings({ fresh: true }));
}

async function postSettings(body) {
  if (backend() === 'none') {
    return { code: 503, body: { status: 'error', reason: 'no_storage',
      message: 'No storage connected. Attach the Upstash Redis integration to this Vercel project, then redeploy.' } };
  }
  try {
    const saved = await saveSettings({
      values: body.values && typeof body.values === 'object' ? body.values : {},
      clear: Array.isArray(body.clear) ? body.clear : [],
    });
    applySettings(saved);
    return { code: 200, body: view(saved) };
  } catch (e) {
    if (e.fields) return { code: 400, body: { status: 'invalid', message: e.message, fields: e.fields } };
    throw e;
  }
}

// ── Connection tests, run against what is currently saved ──────────────────
async function testSheets() {
  const { spreadsheet_id, service_account_key } = config.sheet;
  if (!spreadsheet_id || !service_account_key) return { ok: false, message: 'Save the sheet and the service account key first.' };
  const creds = JSON.parse(service_account_key);
  let auth;
  if (creds.type === 'service_account') {
    auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  } else {
    auth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
    auth.setCredentials({ refresh_token: creds.refresh_token });
  }
  try {
    const resp = await google.sheets({ version: 'v4', auth }).spreadsheets.get({
      spreadsheetId: spreadsheet_id, fields: 'properties.title',
    });
    return { ok: true, message: `Connected to “${resp.data.properties.title}”.` };
  } catch (e) {
    const code = e.code || (e.response && e.response.status);
    if (code === 403) return { ok: false, message: `Access denied. Share the sheet with ${creds.client_email || 'the service account'} as Editor.` };
    if (code === 404) return { ok: false, message: 'Sheet not found. Check the sheet URL.' };
    return { ok: false, message: `Google rejected the key: ${e.message}` };
  }
}

// Also returns the location's pipelines + stages so the page can offer dropdowns
// instead of asking anyone to paste stage UUIDs.
async function testGHL() {
  const { api_key, location_id } = config.crm.ghl;
  if (!api_key || !location_id) return { ok: false, message: 'Save the GHL token and location ID first.' };
  let resp, data;
  try {
    resp = await fetch(`${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(location_id)}`, {
      headers: { Authorization: `Bearer ${api_key}`, Version: '2021-07-28', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    data = await resp.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, message: `Could not reach GoHighLevel: ${e.message}` };
  }
  if (resp.status === 401) return { ok: false, message: 'GHL rejected the token. Check it was copied in full.' };
  if (resp.status === 403) return { ok: false, message: 'Token works but lacks access. Check its scopes and the location ID.' };
  if (!resp.ok) return { ok: false, message: `GHL error ${resp.status}: ${data.message || 'unknown'}` };
  const pipelines = (data.pipelines || []).map(p => ({
    id: p.id, name: p.name,
    stages: (p.stages || []).map(s => ({ id: s.id, name: s.name })),
  }));
  return { ok: true, message: `Connected. ${pipelines.length} pipeline${pipelines.length === 1 ? '' : 's'} found.`, pipelines };
}

// ── Slack / Discord ─────────────────────────────────────────────────────────
// "Connect" validates the bot token and returns the channel list so the page can
// offer dropdowns instead of asking anyone to hunt for channel IDs.
async function testSlack() {
  const token = config.notify.slack_bot_token;
  if (!token) return { ok: false, message: 'Save the Slack bot token first.' };
  const call = async (method, qs = '') => {
    const resp = await fetch(`${SLACK_API}/${method}${qs}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    return resp.json();
  };
  try {
    const auth = await call('auth.test');
    if (!auth.ok) return { ok: false, message: `Slack rejected the token (${auth.error}).` };
    const channels = [];
    let cursor = '';
    for (let page = 0; page < 5; page++) {
      const data = await call('conversations.list', `?types=public_channel,private_channel&exclude_archived=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!data.ok) {
        return { ok: false, message: data.error === 'missing_scope'
          ? `Connected to ${auth.team}, but the app needs the channels:read and groups:read scopes to list channels. Add them, reinstall the app, and try again.`
          : `Connected to ${auth.team}, but could not list channels (${data.error}).` };
      }
      for (const c of data.channels || []) channels.push({ id: c.id, name: `#${c.name}${c.is_private ? ' (private)' : ''}` });
      cursor = data.response_metadata && data.response_metadata.next_cursor;
      if (!cursor) break;
    }
    channels.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, message: `Connected to ${auth.team}. ${channels.length} channels found. Pick one for each report.`, channels };
  } catch (e) {
    return { ok: false, message: `Could not reach Slack: ${e.message}` };
  }
}

async function testDiscord() {
  const token = config.notify.discord_bot_token;
  if (!token) return { ok: false, message: 'Save the Discord bot token first.' };
  const call = async (path) => {
    const resp = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(10000) });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  };
  try {
    const me = await call('/users/@me');
    if (me.status === 401) return { ok: false, message: 'Discord rejected the token. Reset it in the developer portal and paste the new one.' };
    if (me.status !== 200) return { ok: false, message: `Discord error ${me.status}.` };
    const guilds = await call('/users/@me/guilds');
    if (!Array.isArray(guilds.data) || !guilds.data.length) {
      return { ok: false, message: `Token works (${me.data.username}), but the bot is not in any server yet. Invite it to your server, then try again.` };
    }
    const channels = [];
    for (const g of guilds.data.slice(0, 5)) {
      const list = await call(`/guilds/${g.id}/channels`);
      // 0 = text channel, 5 = announcement channel
      for (const c of Array.isArray(list.data) ? list.data : []) {
        if (c.type === 0 || c.type === 5) channels.push({ id: c.id, name: `#${c.name}${guilds.data.length > 1 ? ` · ${g.name}` : ''}` });
      }
    }
    channels.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, message: `Connected as ${me.data.username}. ${channels.length} channels found. Pick one for each report.`, channels };
  } catch (e) {
    return { ok: false, message: `Could not reach Discord: ${e.message}` };
  }
}

// Close: validates the key and returns pipelines + their statuses for the stage picker.
async function testClose() {
  const { api_key } = config.crm.close;
  if (!api_key) return { ok: false, message: 'Save the Close API key first.' };
  let resp, data;
  try {
    resp = await fetch(`${CLOSE_BASE}/pipeline/`, { headers: closeHeaders(api_key), signal: AbortSignal.timeout(15000) });
    data = await resp.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, message: `Could not reach Close: ${e.message}` };
  }
  if (resp.status === 401) return { ok: false, message: 'Close rejected the API key. Check it was copied in full.' };
  if (!resp.ok) return { ok: false, message: `Close error ${resp.status}.` };
  const pipelines = (data.data || []).map(p => ({
    id: p.id, name: p.name,
    stages: (p.statuses || []).map(s => ({ id: s.id, name: s.label })),
  }));
  return { ok: true, message: `Connected. ${pipelines.length} pipeline${pipelines.length === 1 ? '' : 's'} found.`, pipelines };
}

const SLACK_HINTS = {
  not_in_channel: 'invite the app to the channel (/invite @your-app) or add the chat:write.public scope',
  channel_not_found: 'channel not found (pick it again from the list)',
  invalid_auth: 'the bot token is wrong or revoked',
  missing_scope: 'the app is missing the chat:write scope',
};

// Sends a real test post to every channel this provider is connected to, so the
// business sees exactly where each report will land.
async function sendTest(provider) {
  const label = provider === 'slack' ? 'Slack' : 'Discord';
  const names = [...config.report_roles, 'scorecard'];
  const lines = [];
  let sent = 0, failed = 0;
  for (const name of names) {
    const what = name === 'scorecard' ? 'the daily scorecard' : `${name} reports`;
    const out = await notify(name, {
      title: `✅ ${config.brand.name} is connected`,
      description: `This channel will receive **${what}**.`,
      color: 0x2ECC71,
    }, provider);
    if (out.status === 'skipped') continue;
    for (const r of out.results) {
      if (r.status === 'ok') { sent++; continue; }
      failed++;
      const why = SLACK_HINTS[r.error] || r.error || (r.http ? `http ${r.http}` : 'unknown error');
      lines.push(`${name}: ${why}`);
    }
  }
  if (!sent && !failed) return { ok: false, message: `No ${label} channels are connected yet. Pick a channel (or paste a webhook) and save.` };
  if (failed) return { ok: false, message: `${sent} sent, ${failed} failed: ${lines.join('; ')}.` };
  return { ok: true, message: `Test message sent to ${sent} ${label} channel${sent === 1 ? '' : 's'}. Check ${sent === 1 ? 'it' : 'them'}.` };
}

const TESTS = {
  sheets: testSheets,
  ghl: testGHL,
  close: testClose,
  slack: testSlack,
  discord: testDiscord,
  slack_send: () => sendTest('slack'),
  discord_send: () => sendTest('discord'),
};

async function postSettingsTest(body) {
  const run = TESTS[body.target];
  if (!run) return { code: 400, body: { status: 'error', message: `Unknown test target: ${body.target}` } };
  // Pick up a save made on another warm instance before testing.
  applySettings(await loadSettings({ fresh: true }));
  return { code: 200, body: { status: 'ok', target: body.target, ...(await run()) } };
}

module.exports = { getSettings, postSettings, postSettingsTest };

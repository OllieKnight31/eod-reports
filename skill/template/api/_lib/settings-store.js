// Settings store, lets the client enter API keys on the /settings page instead
// of in Vercel env vars.
//
// Saved values are keyed by the same names as the env vars they replace, are
// AES-256-GCM encrypted at rest, and win over process.env. Two things still have
// to exist as real env vars, because they protect everything else:
//   ADMIN_PASSWORD: gate for the /settings page (also the encryption secret,
//                      unless SETTINGS_SECRET is set separately)
//   KV_REST_API_URL + KV_REST_API_TOKEN, Upstash Redis, injected automatically
//                      when you attach the Upstash integration in Vercel.
// Off Vercel (local dev) the store falls back to a gitignored .data/settings.json.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Stage keys the GHL mapping needs, mirrors the default closer_stage_order.
const STAGE_KEYS = ['callBooked', 'callCompleted', 'proposalSent', 'closedWon', 'closedLost', 'noShow'];

const DISCORD_RE = /^https:\/\/(?:discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+\/?$/;
const SLACK_RE = /^https:\/\/hooks\.slack\.com\/(?:services|triggers|workflows)\/[\w/-]+$/;

function discordUrl(v) {
  if (!DISCORD_RE.test(v)) throw new Error('must be a Discord webhook URL (https://discord.com/api/webhooks/…)');
  return v;
}
function slackUrl(v) {
  if (!SLACK_RE.test(v)) throw new Error('must be a Slack webhook URL (https://hooks.slack.com/…)');
  return v;
}

// Every field the page can set. `secret` values are never sent back to the browser.
// `clean` normalises + validates and throws a human-readable Error on bad input.
const positive = (max) => (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > max) throw new Error(`must be a number between 1 and ${max}`);
  return String(n);
};
const dayList = (v) => {
  const days = v.split(',').map(s => s.trim()).filter(Boolean);
  if (!days.length || days.some(d => !/^[0-6]$/.test(d))) throw new Error('must be day numbers 0-6 separated by commas (0 = Sunday)');
  return [...new Set(days)].join(',');
};
const onOff = (v) => { const x = v.toLowerCase(); if (x !== 'on' && x !== 'off') throw new Error('must be on or off'); return x; };
const roleList = (v) => {
  const roles = v.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!roles.length || roles.some(r => !['setter', 'dialler', 'closer'].includes(r))) throw new Error('can only contain setter, dialler, closer');
  return [...new Set(roles)].join(',');
};
const slackChannel = (v) => { if (!/^[CGD][A-Z0-9]{8,}$/.test(v)) throw new Error('must be a Slack channel ID (starts with C, e.g. C01ABCD2345)'); return v; };
const discordChannel = (v) => { if (!/^\d{15,22}$/.test(v)) throw new Error('must be a Discord channel ID (a long number)'); return v; };
const hour = (v) => { if (!/^([01]?\d|2[0-3])$/.test(v)) throw new Error('must be a whole hour from 0 to 23'); return String(Number(v)); };
// A daily target. 0 means "no target".
const targetNumber = (max) => (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`must be a number from 0 to ${max}`);
  return String(n);
};
function stageMap(v) {
  let j;
  try { j = JSON.parse(v); } catch { throw new Error('is not valid JSON'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('must be a JSON object of stage key → stage ID');
  for (const [k, id] of Object.entries(j)) {
    if (typeof id !== 'string' || !id) throw new Error(`has an empty stage ID for "${k}"`);
  }
  return JSON.stringify(j);
}
const SLACK_ID_RE = /^[UW][A-Z0-9]{6,}$/;
const DISCORD_ID_RE = /^\d{15,22}$/;

// {"dialler":[…],"setter":[…],"closer":[…]}, each entry {name, slack?, discord?, nudge?}.
function rosterJSON(v) {
  let j;
  try { j = JSON.parse(v); } catch { throw new Error('is not valid JSON'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('must be an object with dialler / setter / closer lists');
  const out = {};
  for (const role of ['dialler', 'setter', 'closer']) {
    const list = j[role] == null ? [] : j[role];
    if (!Array.isArray(list)) throw new Error(`"${role}" must be a list`);
    out[role] = list.map((p) => {
      const e = typeof p === 'string' ? { name: p } : (p || {});
      const name = String(e.name || '').trim();
      if (!name || name.length > 80) throw new Error(`has a ${role} with a missing or over-long name`);
      const entry = { name };
      if (e.slack) { if (!SLACK_ID_RE.test(e.slack)) throw new Error(`has an invalid Slack member ID for ${name} (looks like U01ABC234)`); entry.slack = e.slack; }
      if (e.discord) { if (!DISCORD_ID_RE.test(e.discord)) throw new Error(`has an invalid Discord user ID for ${name} (a long number)`); entry.discord = e.discord; }
      if (e.nudge === false) entry.nudge = false;
      return entry;
    });
  }
  return JSON.stringify(out);
}

// Every field the page can set. `secret` values are never sent back to the browser.
// `clean` normalises + validates and throws a human-readable Error on bad input.
//   group: which card on /settings        sub    , sub-heading inside the card
//   role: hidden when that role is off   provider, shown only for that CRM
//   widget: a friendlier control on the page (the stored value is still a string)
//   advanced, tucked under the card's fold-out
const hook = (provider, key, label, role, advanced) => ({
  key: `${provider}_${key}_WEBHOOK`, group: provider.toLowerCase(), label, role, advanced, secret: true,
  placeholder: provider === 'SLACK' ? 'https://hooks.slack.com/services/…' : 'https://discord.com/api/webhooks/…',
  clean: provider === 'SLACK' ? slackUrl : discordUrl,
});
const chan = (provider, key, label, role, advanced) => ({
  key: `${provider}_${key}_CHANNEL`, group: provider.toLowerCase(), label, role, advanced,
  picker: provider.toLowerCase(), clean: provider === 'SLACK' ? slackChannel : discordChannel,
});
// unit: what the number is, 'day' (a count per day), 'pct', 'min' or 'money'
const kpi = (key, sub, role, label, placeholder, max, unit = 'day', help = '') => ({
  key, group: 'targets', sub, role, label, unit, placeholder: String(placeholder), help, clean: targetNumber(max),
});

const FIELDS = [
  { key: 'SPREADSHEET_ID', group: 'sheets', label: 'Google Sheet link', placeholder: 'https://docs.google.com/spreadsheets/d/…',
    help: 'Open your sheet and copy the address from the browser bar. The whole link is fine.',
    clean: (v) => {
      const m = v.match(/\/d\/([\w-]+)/);
      const id = m ? m[1] : v;
      if (!/^[\w-]{20,}$/.test(id)) throw new Error('does not look like a Google Sheet link');
      return id;
    } },
  { key: 'GOOGLE_SERVICE_ACCOUNT_KEY', group: 'sheets', label: 'Service account key', secret: true, multiline: true,
    placeholder: '{ "type": "service_account", … }',
    help: 'The contents of the .json file Google downloads in step 5 below. Open the file in a text editor, select all, copy, paste here.',
    clean: (v) => {
      let j;
      try { j = JSON.parse(v); } catch { throw new Error('is not the whole file. Open the .json file, select everything and paste it'); }
      const ok = (j.type === 'service_account' && j.client_email && j.private_key)
        || (j.type === 'authorized_user' && j.client_id && j.client_secret && j.refresh_token);
      if (!ok) throw new Error('is missing fields. It must be a service account key file');
      return JSON.stringify(j);
    },
    hint: (v) => { try { return JSON.parse(v).client_email || 'OAuth user credentials'; } catch { return 'saved'; } } },

  // Slack, a bot token + a channel per report is the main route; webhooks are the fold-out.
  { key: 'SLACK_BOT_TOKEN', group: 'slack', label: 'Bot token', secret: true, placeholder: 'xoxb-…',
    help: 'Starts with xoxb-. It lets this system post as your Slack app.',
    clean: (v) => { if (!/^xox[bp]-[\w-]{20,}$/.test(v)) throw new Error('should start with xoxb-'); return v; } },
  chan('SLACK', 'SETTER', 'Setter reports go to', 'setter'),
  chan('SLACK', 'DIALLER', 'Dialler reports go to', 'dialler'),
  chan('SLACK', 'CLOSER', 'Closer reports go to', 'closer'),
  chan('SLACK', 'SCORECARD', 'Daily scorecard goes to'),
  hook('SLACK', 'SETTER', 'Setter reports webhook', 'setter', true),
  hook('SLACK', 'DIALLER', 'Dialler reports webhook', 'dialler', true),
  hook('SLACK', 'CLOSER', 'Closer reports webhook', 'closer', true),
  hook('SLACK', 'SCORECARD', 'Daily scorecard webhook', '', true),

  // Discord, webhooks are the simple route there; the bot is the fold-out.
  hook('DISCORD', 'SETTER', 'Setter reports webhook', 'setter'),
  hook('DISCORD', 'DIALLER', 'Dialler reports webhook', 'dialler'),
  hook('DISCORD', 'CLOSER', 'Closer reports webhook', 'closer'),
  hook('DISCORD', 'SCORECARD', 'Daily scorecard webhook', ''),
  { key: 'DISCORD_BOT_TOKEN', group: 'discord', advanced: true, label: 'Bot token', secret: true,
    help: 'From the Bot page of your Discord application.',
    clean: (v) => { if (!/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(v)) throw new Error('does not look like a Discord bot token'); return v; } },
  chan('DISCORD', 'SETTER', 'Setter reports go to', 'setter', true),
  chan('DISCORD', 'DIALLER', 'Dialler reports go to', 'dialler', true),
  chan('DISCORD', 'CLOSER', 'Closer reports go to', 'closer', true),
  chan('DISCORD', 'SCORECARD', 'Daily scorecard goes to', '', true),

  { key: 'REPORT_ROLES', group: 'team', widget: 'roles', label: 'Which roles does your team have?',
    help: 'Switch a role off and its report, channel, targets and scorecard section disappear.', clean: roleList },
  { key: 'ROSTER_JSON', group: 'team', widget: 'roster', label: 'People', clean: rosterJSON },

  kpi('KPI_SETTER_MESSAGES', 'Setters', 'setter', 'Messages sent', 50, 100000),
  kpi('KPI_SETTER_OUTBOUNDS', 'Setters', 'setter', 'Outbounds', 30, 100000),
  kpi('KPI_SETTER_FOLLOWUPS', 'Setters', 'setter', 'Follow-ups', 20, 100000),
  kpi('KPI_SETTER_CALLS_BOOKED', 'Setters', 'setter', 'Calls booked', 3, 10000),
  kpi('KPI_DIALS', 'Diallers', 'dialler', 'Dials', 300, 100000),
  kpi('KPI_CONVERSATIONS', 'Diallers', 'dialler', 'Conversations', 20, 100000),
  kpi('KPI_SPEED_TO_LEAD_MIN', 'Diallers', 'dialler', 'Speed to lead', 5, 10000, 'min', 'or faster'),
  kpi('KPI_SET_SHOW_RATE', 'Diallers', 'dialler', 'Show rate', 60, 100, 'pct', 'set calls'),
  kpi('KPI_TRIAGED_SHOW_RATE', 'Diallers', 'dialler', 'Show rate', 80, 100, 'pct', 'triaged calls'),
  kpi('KPI_CLOSER_CALLS', 'Closers', 'closer', 'Calls taken', 5, 10000),
  kpi('KPI_CLOSER_SHOW_RATE', 'Closers', 'closer', 'Show rate', 70, 100, 'pct'),
  kpi('KPI_CLOSER_CLOSE_RATE', 'Closers', 'closer', 'Close rate', 25, 100, 'pct'),
  kpi('KPI_CLOSER_REVENUE', 'Closers', 'closer', 'Revenue', 0, 100000000, 'money', '0 = none'),

  { key: 'REMINDERS', group: 'reminders', sub: 'Remind people who haven’t filed', widget: 'toggle', label: 'Send reminders', clean: onOff },
  { key: 'NUDGE_HOUR', group: 'reminders', sub: 'Remind people who haven’t filed', widget: 'hour', label: 'At', placeholder: '21',
    clean: hour },
  { key: 'NUDGE_DAYS', group: 'reminders', sub: 'Remind people who haven’t filed', widget: 'days', label: 'On these days', placeholder: '1,2,3,4,5', clean: dayList },
  { key: 'NUDGE_ROLES', group: 'reminders', sub: 'Remind people who haven’t filed', widget: 'roles', label: 'Remind these roles', clean: roleList },
  { key: 'SCORECARD_POST', group: 'reminders', sub: 'Post the team scorecard', widget: 'toggle', label: 'Post the scorecard', clean: onOff },
  { key: 'SCORECARD_HOUR', group: 'reminders', sub: 'Post the team scorecard', widget: 'hour', label: 'At', placeholder: '8',
    help: 'A morning time sums up yesterday. Midday or later sums up today.', clean: hour },

  { key: 'CRM_PROVIDER', group: 'crm', label: 'Which CRM do you use?', options: ['none', 'ghl', 'close'],
    clean: (v) => { const p = v.toLowerCase(); if (!['none', 'ghl', 'close'].includes(p)) throw new Error('must be none, ghl or close'); return p; } },
  { key: 'GHL_API_KEY', group: 'crm', provider: 'ghl', label: 'GoHighLevel private integration token', secret: true, placeholder: 'pit-…',
    help: 'Starts with pit-.' },
  { key: 'GHL_LOCATION_ID', group: 'crm', provider: 'ghl', label: 'GoHighLevel location ID', placeholder: 'e.g. aBcD1234EfGh5678',
    help: 'Open your sub-account and look at the address bar: app.gohighlevel.com/v2/location/THIS-PART/dashboard',
    clean: (v) => { const m = v.match(/location\/([\w-]{6,})/); const id = m ? m[1] : v; if (!/^[\w-]{6,}$/.test(id)) throw new Error('should be the ID from the address bar'); return id; } },
  { key: 'GHL_PIPELINE_ID', group: 'crm', provider: 'ghl', advanced: true, label: 'GoHighLevel pipeline ID',
    clean: (v) => { if (!/^[\w-]{6,}$/.test(v)) throw new Error('should be the ID only'); return v; } },
  { key: 'GHL_STAGES_JSON', group: 'crm', provider: 'ghl', advanced: true, label: 'GoHighLevel stage mapping', clean: stageMap },
  { key: 'CLOSE_API_KEY', group: 'crm', provider: 'close', label: 'Close API key', secret: true, placeholder: 'api_…',
    help: 'Starts with api_.',
    clean: (v) => { if (!/^api_[\w.]{10,}$/.test(v)) throw new Error('should start with api_'); return v; } },
  { key: 'CLOSE_PIPELINE_ID', group: 'crm', provider: 'close', advanced: true, label: 'Close pipeline ID',
    clean: (v) => { if (!/^[\w-]{6,}$/.test(v)) throw new Error('should be the ID only'); return v; } },
  { key: 'CLOSE_STAGES_JSON', group: 'crm', provider: 'close', advanced: true, label: 'Close stage mapping', clean: stageMap },

  { key: 'BRAND_NAME', group: 'brand', label: 'Business name', placeholder: 'Acme Coaching', help: 'Shown at the top of every page and in every channel post.' },
  { key: 'BRAND_COLOR', group: 'brand', widget: 'color', label: 'Brand colour', placeholder: '#EF4444',
    help: 'Click the swatch to pick, or type a hex code.',
    clean: (v) => { if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error('must be a hex colour like #EF4444'); return v.toUpperCase(); } },
  { key: 'CURRENCY_SYMBOL', group: 'brand', label: 'Currency', options: ['$', '£', '€'],
    help: 'Used for revenue everywhere: dashboards, scorecard, reports and channel posts.',
    clean: (v) => { if (v.length > 4) throw new Error('must be 4 characters or fewer'); return v; } },
  { key: 'TIMEZONE', group: 'brand', widget: 'timezone', label: 'Timezone', placeholder: 'Europe/London',
    help: 'Decides what counts as “today” and when reminders and the scorecard go out.',
    clean: (v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); } catch { throw new Error('is not a valid timezone (e.g. Europe/London)'); } return v; } },

  { key: 'LEAD_SOURCES', group: 'mechanisms', widget: 'chips', label: 'Mechanisms', placeholder: 'Webinar,DM,Lead Magnet,VSL,Community',
    help: 'How leads reach you. These are the options on the reports and the breakdown on the dashboards.' },
  { key: 'CLOSER_EXTRA_SOURCES', group: 'mechanisms', widget: 'chips', label: 'Closer-only mechanisms',
    help: 'Optional. Offered on the closer report only, for calls that didn’t come through a setter, e.g. “Old leads”.' },
];

const FIELD_BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));
const MAX_VALUE_LENGTH = 8000;

// ── Auth ────────────────────────────────────────────────────────────────────
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function checkAdmin(req) {
  if (!adminConfigured()) return false;
  const header = String((req.headers && req.headers.authorization) || '');
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  return crypto.timingSafeEqual(digest(given), digest(process.env.ADMIN_PASSWORD));
}

// ── Encryption ──────────────────────────────────────────────────────────────
function cryptoKey() {
  const secret = process.env.SETTINGS_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error('ADMIN_PASSWORD is not set');
  return crypto.scryptSync(secret, 'eod-system-settings-v1', 32);
}

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cryptoKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

function decrypt(blob) {
  const [version, iv, tag, body] = String(blob).split(':');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('unrecognised settings format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', cryptoKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  try {
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8'));
  } catch {
    // GCM auth failure = the secret changed since these were saved.
    throw new Error('Saved settings could not be decrypted. ADMIN_PASSWORD (or SETTINGS_SECRET) has changed since they were saved.');
  }
}

// ── Backends ────────────────────────────────────────────────────────────────
const KV_KEY = process.env.SETTINGS_KV_KEY || 'eod-system:settings';
const FILE_PATH = path.join(process.cwd(), '.data', 'settings.json');

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

// 'kv' on Vercel with Upstash attached, 'file' for local dev, 'none' when a
// deployed instance has nowhere durable to write.
function backend() {
  if (kvCreds()) return 'kv';
  if (!process.env.VERCEL) return 'file';
  return 'none';
}

async function kvCommand(command) {
  const { url, token } = kvCreds();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) throw new Error(`settings store error: ${data.error || resp.status}`);
  return data.result;
}

async function readBlob() {
  const b = backend();
  if (b === 'kv') return kvCommand(['GET', KV_KEY]);
  if (b === 'file') {
    try { return fs.readFileSync(FILE_PATH, 'utf8').trim() || null; } catch { return null; }
  }
  return null;
}

async function writeBlob(blob) {
  const b = backend();
  if (b === 'kv') return kvCommand(['SET', KV_KEY, blob]);
  if (b === 'file') {
    fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
    fs.writeFileSync(FILE_PATH, blob, { mode: 0o600 });
    return;
  }
  throw new Error('No settings storage connected');
}

// ── Other encrypted documents (e.g. the login accounts) ─────────────────────
// Same storage and encryption as the settings, under their own name.
const docFile = (name) => path.join(process.cwd(), '.data', `${name}.json`);
async function readDoc(name) {
  const b = backend();
  let blob = null;
  if (b === 'kv') blob = await kvCommand(['GET', `${KV_KEY}:${name}`]);
  else if (b === 'file') { try { blob = fs.readFileSync(docFile(name), 'utf8').trim() || null; } catch { blob = null; } }
  return blob ? decrypt(blob) : null;
}
async function writeDoc(name, obj) {
  const b = backend();
  const blob = encrypt(obj);
  if (b === 'kv') return kvCommand(['SET', `${KV_KEY}:${name}`, blob]);
  if (b === 'file') {
    fs.mkdirSync(path.dirname(docFile(name)), { recursive: true });
    fs.writeFileSync(docFile(name), blob, { mode: 0o600 });
    return;
  }
  throw new Error('No storage connected');
}

// ── Once-a-day marker for scheduled jobs ────────────────────────────────────
// The schedule calls in every hour, and a host may fire a call a little early or late,
// so two calls can land in the same local hour. First caller for a key wins.
// With no storage connected there is nothing to remember, so the job just runs.
const RUNS_FILE = path.join(process.cwd(), '.data', 'runs.json');
async function firstRun(key) {
  try {
    const b = backend();
    if (b === 'kv') return (await kvCommand(['SET', `${KV_KEY}:run:${key}`, '1', 'NX', 'EX', '172800'])) === 'OK';
    if (b === 'file') {
      let runs = {};
      try { runs = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8')); } catch { /* first run */ }
      if (runs[key]) return false;
      const cutoff = Date.now() - 172800000;
      for (const k of Object.keys(runs)) if (runs[k] < cutoff) delete runs[k];
      runs[key] = Date.now();
      fs.mkdirSync(path.dirname(RUNS_FILE), { recursive: true });
      fs.writeFileSync(RUNS_FILE, JSON.stringify(runs));
    }
    return true;
  } catch (e) {
    console.error('[settings-store] firstRun failed, running anyway:', e.message);
    return true;
  }
}

// ── Load / save ─────────────────────────────────────────────────────────────
// Warm instances reuse the last read for a short while so normal traffic doesn't
// pay a store round-trip per request. A save on one instance reaches the others
// within CACHE_MS.
const CACHE_MS = 30000;
let cache = null;       // { values, at }

async function loadSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.values;
  let values = {};
  if (adminConfigured() && backend() !== 'none') {
    const blob = await readBlob();
    if (blob) values = decrypt(blob);
  }
  cache = { values, at: Date.now() };
  return values;
}

// values: { KEY: 'new value' }  (blank strings are ignored, "leave as is")
// clear:  [ 'KEY', … ]          (remove the saved value, falling back to env/default)
// Throws an Error carrying .fields = { KEY: message } when validation fails.
async function saveSettings({ values = {}, clear = [] }) {
  const errors = {};
  const next = { ...(await loadSettings({ fresh: true })) };

  for (const key of clear) {
    if (FIELD_BY_KEY[key]) delete next[key];
  }
  for (const [key, raw] of Object.entries(values)) {
    const field = FIELD_BY_KEY[key];
    if (!field || typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    if (value.length > MAX_VALUE_LENGTH) { errors[key] = `${field.label} is too long`; continue; }
    try { next[key] = field.clean ? field.clean(value) : value; }
    catch (e) { errors[key] = `${field.label} ${e.message}`; }
  }

  if (Object.keys(errors).length) {
    const err = new Error('Some fields need fixing');
    err.fields = errors;
    throw err;
  }
  await writeBlob(encrypt(next));
  cache = { values: next, at: Date.now() };
  return next;
}

// ── What the page is allowed to see ─────────────────────────────────────────
function maskTail(v) {
  const s = String(v);
  return s.length > 8 ? `••••${s.slice(-4)}` : '••••';
}

function describe(saved) {
  return FIELDS.map((f) => {
    const fromSaved = saved[f.key];
    const fromEnv = process.env[f.key];
    const value = fromSaved || fromEnv || '';
    const out = {
      key: f.key, group: f.group, label: f.label,
      placeholder: f.placeholder || '', help: f.help || '',
      secret: Boolean(f.secret), multiline: Boolean(f.multiline), options: f.options || null,
      advanced: Boolean(f.advanced), role: f.role || '', picker: f.picker || '',
      sub: f.sub || '', widget: f.widget || '', provider: f.provider || '', unit: f.unit || '',
      source: fromSaved ? 'saved' : fromEnv ? 'env' : 'unset',
    };
    if (f.secret) out.hint = value ? (f.hint ? f.hint(value) : maskTail(value)) : '';
    else out.value = value;
    return out;
  });
}

module.exports = {
  FIELDS, STAGE_KEYS,
  adminConfigured, checkAdmin, backend,
  loadSettings, saveSettings, describe, firstRun, readDoc, writeDoc,
};

// One command that shapes the system to a business. Writes client.env and the schedule.
//
//   node scripts/configure.js \
//     --name "Acme Coaching" --tz Europe/London --currency "£" --color "#3498DB" \
//     --setters "Sam Jones, Jo Lee" --diallers 0 --closers "Charlie Reed:U01ABC2345" \
//     --sources "Webinar,DM,Referral" --reminder-hour 21 --scorecard-hour 8 \
//     --set SLACK_BOT_TOKEN=xoxb-… --set GHL_API_KEY=pit-…
//
// Each role takes: names ("Sam, Jo") · a head-count (3, role on, free-text names) ·
// 0 or none (role off: no tab, no channel, no scorecard section, no reminders).
// A name can carry a mention ID for reminders: "Name:U01ABC2345" (Slack) or
// "Name:123456789012345678" (Discord).
//
// Safe to re-run: it merges into the existing client.env, so `--closers "A, B, C"` on
// its own just updates the closers. Secrets it generates are kept once made: ADMIN_PASSWORD
// (the SETUP CODE the owner uses once to create their login) and CRON_SECRET. Anything not given here can be entered later on /settings.

const crypto = require('crypto');
const envFile = require('./lib/env-file');
const { setCrons } = require('./set-cron');
const { FIELDS } = require('../api/_lib/settings-store');

const ROLES = ['setter', 'dialler', 'closer'];
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

const env = envFile.read();

// ── Team ────────────────────────────────────────────────────────────────────
let roster = {};
try { roster = JSON.parse(env.ROSTER_JSON || '{}'); } catch { roster = {}; }
let roles = (env.REPORT_ROLES || ROLES.join(',')).split(',').map(s => s.trim()).filter(r => ROLES.includes(r));

for (const role of ROLES) {
  const raw = arg(`${role}s`);
  if (raw === undefined) continue;
  const v = raw.trim();
  if (v === '' || v === '0' || /^(none|no)$/i.test(v)) {            // role off
    roles = roles.filter(r => r !== role);
    roster[role] = [];
    continue;
  }
  if (!roles.includes(role)) roles.push(role);
  if (/^\d+$/.test(v)) { roster[role] = []; continue; }             // head-count only
  roster[role] = v.split(',').map(s => s.trim()).filter(Boolean).map((entry) => {
    const [name, id] = entry.split(':').map(s => s.trim());
    const person = { name };
    if (id) {
      if (/^[UW][A-Z0-9]{6,}$/.test(id)) person.slack = id;
      else if (/^\d{15,22}$/.test(id)) person.discord = id;
      else die(`"${id}" after ${name} is not a Slack member ID (U…) or a Discord user ID (a long number).`);
    }
    return person;
  });
}
roles = ROLES.filter(r => roles.includes(r));
if (!roles.length) die('At least one of --setters / --diallers / --closers must be on.');

const next = { ...env };
next.REPORT_ROLES = roles.join(',');
const anyone = ROLES.some(r => (roster[r] || []).length);
if (anyone) next.ROSTER_JSON = JSON.stringify(Object.fromEntries(ROLES.map(r => [r, roster[r] || []])));
else delete next.ROSTER_JSON;

// ── Business details ────────────────────────────────────────────────────────
const direct = { name: 'BRAND_NAME', color: 'BRAND_COLOR', tz: 'TIMEZONE', currency: 'CURRENCY_SYMBOL', sources: 'LEAD_SOURCES' };
for (const [flag, key] of Object.entries(direct)) if (arg(flag) !== undefined) next[key] = arg(flag);
if (arg('reminder-hour') !== undefined) next.NUDGE_HOUR = arg('reminder-hour');
if (arg('scorecard-hour') !== undefined) next.SCORECARD_HOUR = arg('scorecard-hour');

// --set KEY=VALUE (repeatable), channel tokens, webhooks, CRM keys, KPI targets…
args.forEach((a, i) => {
  if (a !== '--set') return;
  const pair = args[i + 1] || '';
  const eq = pair.indexOf('=');
  if (eq < 1) die(`--set needs KEY=VALUE (got "${pair}")`);
  const key = pair.slice(0, eq).trim(), value = pair.slice(eq + 1);
  if (value === '') delete next[key]; else next[key] = value;
});

// Same validation the /settings page applies, so a typo fails here and not in production.
const errors = [];
for (const f of FIELDS) {
  if (next[f.key] == null || next[f.key] === '' || !f.clean) continue;
  try { next[f.key] = f.clean(String(next[f.key]).trim()); }
  catch (e) { errors.push(`${f.key}: ${f.label} ${e.message}`); }
}
if (errors.length) die(`Fix these and run again:\n  ${errors.join('\n  ')}`);

// ── Secrets the deployment needs ────────────────────────────────────────────
const generated = {};
if (!next.ADMIN_PASSWORD) {
  next.ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
  generated.ADMIN_PASSWORD = true;
}
if (!next.CRON_SECRET) next.CRON_SECRET = crypto.randomBytes(24).toString('base64url');

// ── Schedule ────────────────────────────────────────────────────────────────
const tz = next.TIMEZONE || 'UTC';
// --no-reminders / --no-scorecard stick across re-runs; --reminders / --scorecard undo them.
if (has('no-reminders')) next.REMINDERS = 'off'; else if (has('reminders')) delete next.REMINDERS;
if (has('no-scorecard')) next.SCORECARD_POST = 'off'; else if (has('scorecard')) delete next.SCORECARD_POST;
const reminders = next.REMINDERS !== 'off';
const scorecard = next.SCORECARD_POST !== 'off';
// The schedule checks in every hour and is always written: whether each job runs, and at
// what hour, lives in settings, so both can be changed on /settings with no redeploy.
setCrons({ on: true });
envFile.write(next);

// ── Summary ─────────────────────────────────────────────────────────────────
const connected = (provider) => Boolean(next[`${provider}_BOT_TOKEN`]) || Object.keys(next).some(k => k.startsWith(`${provider}_`) && k.endsWith('_WEBHOOK'));
const line = (label, value) => console.log(`  ${label.padEnd(18)} ${value}`);
console.log(`\n✓ client.env written for ${next.BRAND_NAME || 'this business'}\n`);
for (const role of ROLES) {
  const names = (roster[role] || []).map(p => p.name);
  line(`${role[0].toUpperCase()}${role.slice(1)}s`, !roles.includes(role) ? 'off' : names.length ? names.join(', ') : 'on (free-text names)');
}
line('Timezone', tz);
line('Reminders', reminders ? `${next.NUDGE_HOUR || 21}:00 local` : 'off');
line('Daily scorecard', scorecard ? `${next.SCORECARD_HOUR || 8}:00 local` : 'off');
line('Slack', connected('SLACK') ? 'connected' : 'not yet (add on /settings)');
line('Discord', connected('DISCORD') ? 'connected' : 'not yet (add on /settings)');
line('Google Sheet', next.SPREADSHEET_ID && next.GOOGLE_SERVICE_ACCOUNT_KEY ? 'connected' : 'not yet (add on /settings)');
line('Setup code', generated.ADMIN_PASSWORD ? `${next.ADMIN_PASSWORD}   (new: the owner enters it once, on first visit, to create their login)` : 'unchanged (ADMIN_PASSWORD in client.env)');
console.log('\nNext: npm run dev  (preview)  →  vercel link && node scripts/push-env.js && vercel --prod');

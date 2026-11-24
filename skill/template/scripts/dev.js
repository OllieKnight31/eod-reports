// Local preview server, serves public/ with the vercel.json rewrites and routes
// /api to the same handler Vercel runs. No Vercel account needed.
//
//   npm run dev                 → http://localhost:3210   (first visit: create the owner; setup code "draft")
//   PORT=4000 npm run dev
//   npm run dev -- --live       use the real Google Sheet and channels saved on /settings
//                               (no sample data, nothing kept in memory)
//
// Reads client.env (written by scripts/configure.js), so the preview is this business's
// own team, branding and channels. Settings saved on /settings go to .data/settings.json
// (encrypted, gitignored).
//
// With no Google Sheet configured the preview keeps reports IN MEMORY and starts with two
// weeks of sample data, so every page works before anything is connected. Nothing sample
// is ever sent to Slack/Discord or written anywhere real.

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
for (const [k, v] of Object.entries(require('./lib/env-file').read())) if (process.env[k] === undefined) process.env[k] = v;
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'draft';

// ── In-memory sheet ─────────────────────────────────────────────────────────
// Patched in BEFORE the API is loaded: handlers take their sheet functions at require time.
const memory = !process.env.SPREADSHEET_ID && !process.argv.includes('--live');
if (memory) {
  const sheets = require(path.join(root, 'api', '_lib', 'sheets.js'));
  const { config } = require(path.join(root, 'api', '_lib', 'config.js'));
  const tabs = {};
  const rowsOf = (tab) => (tabs[tab] = tabs[tab] || []);
  sheets.readRange = async (tab) => rowsOf(tab).map(r => r.map(String));
  sheets.appendRow = async (tab, row) => { rowsOf(tab).push(row); return true; };
  for (const fn of ['ensureCloserTab', 'ensureSetterTab', 'ensureDiallerTab', 'ensureCloserNoCallsTab']) sheets[fn] = async () => {};
  sheets.isConfigured = () => true;
  if (!process.argv.includes('--empty')) seed(sheets, config, rowsOf);
}

function seed(sheets, config, rowsOf) {
  const { SETTER_COL, DIALLER_COL, CLOSER_COL } = sheets;
  const t = config.sheet.tabs;
  const names = (role, fallback) => { const r = (config.roster[role] || []).map(p => p.name); return r.length ? r : fallback; };
  const row = (col, values) => { const out = []; for (const [k, v] of Object.entries(values)) out[col[k]] = v; return Array.from(out, v => v ?? ''); };
  const day = (back) => new Intl.DateTimeFormat('en-CA', { timeZone: config.brand.timezone || 'UTC' }).format(new Date(Date.now() - back * 86400000));
  const src = config.lead_sources;
  const on = (role) => config.report_roles.includes(role);
  const setters = names('setter', ['Sample Setter A', 'Sample Setter B']);
  const diallers = names('dialler', ['Sample Dialler']);
  const closers = names('closer', ['Sample Closer A', 'Sample Closer B']);

  // Two weeks, weekdays only, with the numbers drifting day to day so ranges, bars and the
  // day-by-day table all have something to show.
  for (let back = 13; back >= 0; back--) {
    const date = day(back), ts = `${date}T18:00:00.000Z`;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const v = (back * 7) % 5;          // 0 to 4, different each day
    // On "today" the last person in each role hasn't filed yet, and one earlier day is
    // skipped by the first person, so "not filed" has something to show in every view.
    const filed = (list) => (back === 0 && list.length > 1 ? list.slice(0, -1) : back === 3 ? list.slice(1) : list);
    if (on('setter')) filed(setters).forEach((name, i) => rowsOf(t.setter_activity).push(row(SETTER_COL, {
      ts, date, setter: name, lead_source: src[i % src.length], profile_visits: 140 + 30 * i, new_followers: 12 + i, total_followers: 4200,
      qualified_followers: 5 + i, messages_sent: 62 - 10 * i + 8 * v, outbounds: 22 + 5 * v, inbounds: 18 + i, followups: 14 + 3 * v, links_sent: 9,
      calls_proposed: 6, calls_booked: 1 + (v % 3) + (i ? 0 : 1), no_shows: i % 2, cancellations: 0, hottest_lead: '@sample_lead', lead_quality: 4 - i % 2,
      hit_kpis: i ? 'Partial' : 'Yes', notes: 'Sample data. Replaced by real reports once a sheet is connected.',
      booking_links: 5, community_invites: 2, resource_links: 2 })));
    if (on('dialler')) filed(diallers).forEach((name, i) => {
      const T = config.dialler_targets, dials = Math.round(T.dials * (0.75 + 0.08 * v)) - 60 * i;
      rowsOf(t.dialler_activity).push(row(DIALLER_COL, {
        ts, date, dialler: name, dials, conversations: T.conversations - 4 + 2 * v, leads_triaged: 6, all_triaged_notes: 'Yes', speed_to_lead: 3 + v,
        set_due: 5, set_showed: 4, set_show_rate: 80, triaged_due: 3, triaged_showed: 2, triaged_show_rate: 67,
        set_booked: 3, triaged_booked: 2, booked_to_closer: closers[0],
        kpis_hit: ['Triaged w/ notes', 'Set show rate', ...(dials >= T.dials ? ['Dials'] : [])].join(', '),
        kpis_missed: ['Triaged show rate', ...(dials >= T.dials ? [] : ['Dials'])].join(', '), notes: 'Sample data.' }));
    });
    if (on('closer')) filed(closers).forEach((name, i) => {
      if ((i === 1 && back === 1) || (i === 0 && v === 4)) { rowsOf(t.closer_no_calls).push([ts, date, name, 'Sample: calendar was empty, worked follow-ups.']); return; }
      [['Alex Morgan', v % 2 ? 'closed_won' : 'follow_up', 3000], ['Priya Shah', 'closed_lost', 0], ['Tom Reid', v === 2 ? 'closed_won' : 'no_show', 2000], ['Dana Lee', 'follow_up', 0]].slice(0, 2 + (v % 3)).forEach(([prospect, outcome, ticket], n) =>
        rowsOf(t.closer_outcomes).push(row(CLOSER_COL, {
          ts, date, closer: name, lead_source: src[n % src.length], setter: on('setter') ? setters[n % setters.length] : '',
          dialler: on('dialler') && n === 3 ? diallers[0] : '', prospect_name: prospect, prospect_email: '', outcome, package: outcome === 'closed_won' ? 'Core programme' : '',
          ticket: outcome === 'closed_won' ? ticket : 0, pay_type: outcome === 'closed_won' ? 'Paid in Full' : '', lost_reason: outcome === 'closed_lost' ? 'Price' : '',
          followup_date: outcome === 'follow_up' ? day(-3) : '', notes: 'Sample data.' })));
    });
  }
}

const handler = require(path.join(root, 'api', 'index.js'));
const auth = require(path.join(root, 'api', '_lib', 'auth.js'));
const { config: liveConfig } = require(path.join(root, 'api', '_lib', 'config.js'));

async function previewLogin(role, url, req, res) {
  if (!auth.ROLES.includes(role)) { res.statusCode = 400; return res.end(`Unknown role. Use one of: ${auth.ROLES.join(', ')}`); }
  const { loadUsers, saveUsers, hashPassword, sessionCookie } = auth._preview;
  const users = await loadUsers({ fresh: true });
  const username = `${role}@preview.local`;
  let user = users.find(u => u.username === username);
  if (!user) {
    // reps are tied to a name on the roster (or the first sample person) so their own data shows
    const sample = { setter: 'Sample Setter A', dialler: 'Sample Dialler', closer: 'Sample Closer A' }[role];
    const person = auth.REP_ROLES.includes(role) ? (((liveConfig.roster[role] || [])[0] || {}).name || sample) : '';
    user = { id: `preview-${role}`, name: person || `Preview ${role}`, username, role, person, created: new Date().toISOString(), ...hashPassword('draft-preview') };
    await saveUsers([...users, user]);
  }
  url.searchParams.delete('as'); url.searchParams.delete('unlock');
  res.statusCode = 302;
  res.setHeader('Set-Cookie', sessionCookie(user, req));
  res.setHeader('Location', url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : ''));
  res.end();
}

const { rewrites } = require(path.join(root, 'vercel.json'));
const PORT = Number(process.env.PORT) || 3210;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api') {
    req.query = Object.fromEntries(url.searchParams);
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return res; };
    return handler(req, res);
  }

  // Preview convenience, local only: ?as=owner|manager|setter|dialler|closer signs you in
  // as a sample person in that role (creating the sample login if needed). ?unlock = ?as=owner.
  const as = url.searchParams.has('unlock') ? 'owner' : url.searchParams.get('as');
  if (as) return previewLogin(as, url, req, res);

  const rewrite = rewrites.find(r => r.source === url.pathname);
  const rel = rewrite ? rewrite.destination : (url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.join(root, 'public', path.normalize(rel));
  if (!file.startsWith(path.join(root, 'public'))) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    // Byte ranges, so a video can be scrubbed (browsers ask for "bytes=start-end").
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && Buffer.isBuffer(data)) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      res.statusCode = 206;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
      return res.end(data.subarray(start, end + 1));
    }
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Preview            → http://localhost:${PORT}`);
  console.log(`Scorecard          → http://localhost:${PORT}/scorecard`);
  console.log(`First-run sign-up  → http://localhost:${PORT}/login   (setup code: ${process.env.ADMIN_PASSWORD})`);
  console.log(`Skip sign-in       → add ?as=owner | manager | setter | dialler | closer to any address`);
  console.log(memory ? 'No Google Sheet connected. Reports are kept in memory, starting with sample data.' : 'Live mode: reports go to the real Google Sheet and channels set on /settings.');
});

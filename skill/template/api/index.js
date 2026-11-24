// Vercel serverless entry, single function, action/source-routed.
//
// Open to anyone
//   GET  ?action=ping | auth_state | me | config (brand only when signed out)
//   POST ?source=auth_setup | auth_login | auth_logout
// Signed in
//   GET  ?action=scorecard_data          reps only ever get their own
//   POST ?source=setter_eod | dialler_eod | closer_eod | closer_outcome
//                                         reps: their own report, as themselves.
//                                         Outside forms: Authorization: Bearer $INBOUND_KEY
//   POST ?source=password                change your own password
// Owner and managers
//   GET  ?action=dashboard_data | overview_data
// Owner only
//   GET  ?action=settings | users
//   POST ?source=settings | settings_test | user_save | user_delete
// Scheduler (Authorization: Bearer $CRON_SECRET)
//   GET  ?action=cron | nudge | scorecard_post

const { publicConfig, applySettings } = require('./_lib/config');
const { loadSettings } = require('./_lib/settings-store');
const settings = require('./_lib/handlers/settings');
const auth = require('./_lib/auth');
const { handleSetterEOD } = require('./_lib/handlers/setter-eod');
const { handleDiallerEOD } = require('./_lib/handlers/dialler-eod');
const { handleCloserOutcome, handleCloserEOD } = require('./_lib/handlers/closer-outcome');
const { runNudge } = require('./_lib/handlers/nudge');
const { getScorecard, runScorecardPost } = require('./_lib/handlers/scorecard');
const { getDashboardData } = require('./_lib/handlers/dashboard');
const { getOverviewData } = require('./_lib/handlers/overview');
const { isConfigured: sheetsConfigured } = require('./_lib/sheets');

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

async function readBody(req) {
  // Accessing req.body throws "Invalid JSON" on Vercel when the payload is
  // malformed JSON, guard it so a bad body degrades to {} instead of a 500.
  let parsed;
  try { parsed = req.body; } catch { return {}; }
  if (parsed && typeof parsed === 'object') return parsed;
  if (typeof parsed === 'string') {
    try { return JSON.parse(parsed); } catch { /* form-encoded fallback */ }
    const out = {};
    for (const [k, v] of new URLSearchParams(parsed)) out[k] = v;
    return out;
  }
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      if (!raw) return resolve({});
      try { return resolve(JSON.parse(raw)); } catch {
        const out = {}; for (const [k, v] of new URLSearchParams(raw)) out[k] = v; resolve(out);
      }
    });
    req.on('error', () => resolve({}));
  });
}

// The address that links in channel posts point at. Vercel's scheduler calls the site on
// the deployment's own address, which sits behind Vercel's login, so prefer the public one:
// PUBLIC_URL if set (e.g. a custom domain), else the project's production address, which
// Vercel provides; the request's own host is only the fallback (local preview).
function publicUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = String(req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https')).split(',')[0];
  return `${proto}://${host}`;
}

// Send a handler result ({ code, body, cookie? }).
function send(res, out) {
  if (out.cookie) res.setHeader('Set-Cookie', out.cookie);
  return res.status(out.code).json(out.body);
}
const denied = (res, user) => (user
  ? res.status(403).json({ status: 'forbidden', message: 'Your login doesn’t have access to this.' })
  : res.status(401).json({ status: 'unauthorized', message: 'Please sign in.' }));

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, source } = req.query || {};

  try {
    // Layer anything saved on /settings over the env config. A broken store must
    // not take the forms down, so fall back to env-only config and carry on.
    try { applySettings(await loadSettings()); }
    catch (e) { console.error('[api] settings load failed, using env only:', e.message); }

    // Who is asking. Everything below is decided from this, never from what the page claims.
    let user = null;
    try { user = await auth.currentUser(req); }
    catch (e) { console.error('[api] could not read logins:', e.message); }

    // ── Scheduled jobs: Vercel cron sends `Authorization: Bearer $CRON_SECRET`. No secret
    //    set = refuse, so a stray crawler can never page the team.
    //      cron → whichever job is due this hour · nudge → reminder only · scorecard_post → post only
    if (action === 'cron' || action === 'nudge' || action === 'scorecard_post') {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
        return res.status(401).json({ status: 'error', message: 'unauthorized' });
      }
      const base = publicUrl(req);
      if (action === 'nudge')          return res.status(200).json(await runNudge(req.query, base));
      if (action === 'scorecard_post') return res.status(200).json(await runScorecardPost(req.query, base));
      return res.status(200).json({ status: 'ok', nudge: await runNudge(req.query, base), scorecard: await runScorecardPost(req.query, base) });
    }

    if (req.method === 'GET') {
      // ── Open to anyone ──
      if (!action || action === 'ping') {
        return res.status(200).json({ status: 'ok', service: 'EOD System', sheets: sheetsConfigured() ? 'configured' : 'missing credentials', links_point_to: publicUrl(req) });
      }
      if (action === 'auth_state') return send(res, await auth.authState());
      if (action === 'me')         return send(res, auth.me(user));
      // Signed out, the only thing a page may know is how to brand the login screen.
      if (action === 'config') {
        const full = publicConfig();
        return res.status(200).json(user ? { status: 'ok', ...full } : { status: 'ok', brand: full.brand });
      }

      // ── Signed in ──
      if (!user) return denied(res, user);
      if (action === 'scorecard_data') return res.status(200).json(await getScorecard(auth.scorecardQuery(user, req.query)));

      // ── Owner and managers ──
      if (action === 'dashboard_data' || action === 'overview_data') {
        if (!auth.seesDashboards(user)) return denied(res, user);
        return res.status(200).json(action === 'dashboard_data' ? await getDashboardData(req.query) : await getOverviewData(req.query));
      }

      // ── Owner only ──
      if (action === 'settings' || action === 'users') {
        if (!auth.isOwner(user)) return denied(res, user);
        return action === 'settings' ? res.status(200).json(await settings.getSettings()) : send(res, await auth.listUsers());
      }
      return res.status(404).json({ status: 'error', message: `Unknown action: ${action}` });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);

      // ── Open to anyone ──
      if (source === 'auth_setup')  return send(res, await auth.setup(body, req));
      if (source === 'auth_login')  return send(res, await auth.login(body, req));
      if (source === 'auth_logout') return send(res, auth.logout());

      // ── Reports: a signed-in person filing their own, or an outside form holding the
      //    inbound key (INBOUND_KEY, unset means outside forms are switched off).
      const REPORTS = { setter_eod: handleSetterEOD, dialler_eod: handleDiallerEOD, closer_eod: handleCloserEOD, closer_outcome: handleCloserOutcome };
      if (REPORTS[source]) {
        const key = process.env.INBOUND_KEY;
        const machine = Boolean(key) && req.headers.authorization === `Bearer ${key}`;
        if (!machine) {
          if (!user) return denied(res, user);
          const access = auth.reportAccess(user, source, body);
          if (!access.ok) return res.status(403).json({ status: 'forbidden', message: access.message || 'You can’t file that report.' });
        }
        return res.status(200).json(await REPORTS[source](body));
      }

      if (!user) return denied(res, user);
      if (source === 'password') return send(res, await auth.changePassword(body, user));

      // ── Owner only ──
      if (['settings', 'settings_test', 'user_save', 'user_delete'].includes(source)) {
        if (!auth.isOwner(user)) return denied(res, user);
        if (source === 'user_save')   return send(res, await auth.saveUser(body, user));
        if (source === 'user_delete') return send(res, await auth.deleteUser(body, user));
        return send(res, source === 'settings' ? await settings.postSettings(body) : await settings.postSettingsTest(body));
      }
      return res.status(404).json({ status: 'error', message: `Unknown source: ${source}` });
    }

    return res.status(405).json({ status: 'error', message: `Method not allowed: ${req.method}` });
  } catch (e) {
    console.error('[api] error:', e);
    return res.status(500).json({ status: 'error', message: e.message });
  }
};

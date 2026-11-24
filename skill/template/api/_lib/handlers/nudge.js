// Missed-EOD reminder. Pings, by name, whoever on the roster has not filed today's report,
// in that role's own EOD channel (Slack and/or Discord). Silent when everyone has filed.
// Only roles in REPORT_ROLES are ever chased.
//
//   GET /api?action=nudge            fired by a Vercel cron (Authorization: Bearer $CRON_SECRET)
//   GET /api?action=nudge&dry=1      report who is missing, post nothing
//   GET /api?action=nudge&force=1    ignore the hour/day gate
//
// Timing: the schedule (scripts/set-cron.js) calls in once every hour and this handler only
// acts when the LOCAL hour is NUDGE_HOUR, so the time and timezone can be changed on
// /settings with no redeploy. A once-a-day marker stops a double send.
//
// Closers are chased too: a closer with no calls files a zero-call EOD, so silence from
// a closer is a missed report like anyone else's.

const { config } = require('../config');
const { readRange } = require('../sheets');
const { notifyText, providers } = require('../notify');
const { firstRun } = require('../settings-store');

// Every tab starts Timestamp, Date, Name, so A:C is enough to know who filed.
const REPORTS = {
  dialler: { tabs: () => [config.sheet.tabs.dialler_activity], path: '/dialler-eod', label: 'dialler EOD' },
  setter:  { tabs: () => [config.sheet.tabs.setter_activity],  path: '/setter-eod',  label: 'setter EOD' },
  closer:  { tabs: () => [config.sheet.tabs.closer_outcomes, config.sheet.tabs.closer_no_calls], path: '/closer-outcome', label: 'closer EOD' },
};

function localNow(tz) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short',
  }).formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
  };
}

async function runNudge(query = {}, baseUrl = '') {
  const { date: today, hour, dow } = localNow(config.brand.timezone || 'UTC');
  const { enabled, hour: at, days, days_by_role, roles } = config.nudge;
  const force = query.force === '1', dry = query.dry === '1';

  if (!force && !enabled) return { status: 'skipped', reason: 'reminders are switched off' };

  if (!force && hour !== at) return { status: 'skipped', reason: `local hour is ${hour}, reminder hour is ${at}` };

  if (!force && !dry && !(await firstRun(`nudge:${today}`))) return { status: 'skipped', reason: 'already sent today' };

  const out = { status: 'ok', date: today, dry, roles: {} };
  for (const role of roles) {
    const report = REPORTS[role];
    const people = (config.roster[role] || []).filter(p => p.nudge);
    if (!force && !(days_by_role[role] || days).includes(dow)) { out.roles[role] = { skipped: 'not a reminder day' }; continue; }
    if (!people.length) { out.roles[role] = { skipped: 'no roster' }; continue; }

    const filed = new Set();
    for (const tab of report.tabs()) {
      for (const r of (await readRange(tab, 'A2:C')) || []) {
        if ((r[1] || '') === today) filed.add((r[2] || '').trim().toLowerCase());
      }
    }
    const missing = people.filter(p => !filed.has(p.name.toLowerCase()));
    out.roles[role] = { filed: people.length - missing.length, missing: missing.map(p => p.name) };
    if (!missing.length || dry) continue;

    const reaches = providers(role);
    if (!reaches.length) { out.roles[role].posted = 'no channel connected'; continue; }
    const link = `${baseUrl}${report.path}`;
    const tail = `today's ${report.label} hasn't been filed yet.`;
    const why = 'takes two minutes, and the numbers only count if they\'re in.';
    // A mention only notifies with the provider's own member ID; otherwise name them in bold.
    const slackWho = missing.map(p => (p.slack ? `<@${p.slack}>` : `*${p.name}*`)).join(' ');
    const discordWho = missing.map(p => (p.discord ? `<@${p.discord}>` : `**${p.name}**`)).join(' ');
    out.roles[role].posted = await notifyText(role, {
      slack: `⏰ ${slackWho}, ${tail}\n<${link}|File it now> · ${why}`,
      discord: `⏰ ${discordWho}, ${tail}\n[File it now](${link}) · ${why}`,
    });
  }
  return out;
}

module.exports = { runNudge, localNow, REPORTS };

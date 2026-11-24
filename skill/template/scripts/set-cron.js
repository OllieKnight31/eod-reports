// Writes the schedule for the two daily jobs (missed-report reminder + scorecard post)
// into vercel.json.
//
//   node scripts/set-cron.js          switch the schedule on
//   node scripts/set-cron.js --off    remove it
//
// It adds 24 once-a-day entries, one per hour. Each calls /api?action=cron, which looks
// at the LOCAL hour (TIMEZONE) and runs whichever job is due, so the reminder time, the
// scorecard time and the timezone can all be changed on /settings without a redeploy.
// Once-a-day entries are what Vercel's free plan allows; 24 of them is well inside its
// limit of 100 per project.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'vercel.json');
const isOurs = (c) => /action=(cron|nudge|scorecard_post)/.test(String(c.path));

function setCrons({ on = true } = {}, file = FILE) {
  const vercel = JSON.parse(fs.readFileSync(file, 'utf8'));
  const others = (vercel.crons || []).filter(c => !isOurs(c));
  const ours = on ? Array.from({ length: 24 }, (_, h) => ({ path: '/api?action=cron', schedule: `0 ${h} * * *` })) : [];
  const crons = [...others, ...ours];
  if (crons.length) vercel.crons = crons; else delete vercel.crons;
  fs.writeFileSync(file, JSON.stringify(vercel, null, 2) + '\n');
  return ours.length;
}

module.exports = { setCrons };

if (require.main === module) {
  const on = !process.argv.includes('--off');
  setCrons({ on });
  console.log(on
    ? 'Schedule written: checks in every hour. Set CRON_SECRET in Vercel. The jobs refuse to run without it.'
    : 'Schedule removed.');
}

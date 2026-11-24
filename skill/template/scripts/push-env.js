// Pushes client.env to the linked Vercel project's Production environment.
//
//   vercel link                      (once)
//   node scripts/push-env.js         push everything
//   node scripts/push-env.js --only ADMIN_PASSWORD,CRON_SECRET
//   node scripts/push-env.js --dry   list what would be pushed, send nothing
//
// Values go to the Vercel CLI on stdin, never on a command line, so they don't land
// in shell history or the process list. Redeploy afterwards (vercel --prod).

const { spawnSync } = require('child_process');
const envFile = require('./lib/env-file');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? (args[onlyAt + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : null;

const env = envFile.read();
const keys = Object.keys(env).filter(k => !only || only.includes(k));
if (!keys.length) { console.error('Nothing to push. Run scripts/configure.js first.'); process.exit(1); }

if (dry) {
  for (const k of keys) console.log(`  would push ${k} (${env[k].length} chars)`);
  process.exit(0);
}

const vercel = (cmdArgs, input) => spawnSync('vercel', cmdArgs, { input, encoding: 'utf8' });
if (vercel(['--version']).error) { console.error('The Vercel CLI is not installed. Run: npm i -g vercel'); process.exit(1); }

let failed = 0;
for (const key of keys) {
  vercel(['env', 'rm', key, 'production', '--yes']);           // replace if it already exists
  const res = vercel(['env', 'add', key, 'production'], env[key]);
  if (res.status === 0) { console.log(`  ✓ ${key}`); continue; }
  failed++;
  const why = (res.stderr || res.stdout || '').trim().split('\n').pop();
  console.log(`  ✗ ${key}: ${why}`);
  if (/not linked|no project|link/i.test(why)) { console.error('\nRun `vercel link` in this folder first.'); process.exit(1); }
}
console.log(failed ? `\n${failed} failed.` : `\n${keys.length} values pushed. Redeploy to apply: vercel --prod`);
process.exit(failed ? 1 : 0);

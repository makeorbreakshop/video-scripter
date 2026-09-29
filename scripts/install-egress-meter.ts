// Put the client egress meter (lib/ops/egress-meter.ts) on every LaunchAgent that runs this repo:
// set NODE_OPTIONS=--import <repo>/lib/ops/egress-meter.ts and EGRESS_JOB=<label suffix> in the
// plist, then reload the agent between runs so launchd picks the environment up.
//
// A running job is never killed for this: the reload waits (up to --wait-seconds) until the
// agent is idle, except for the always-on extension-api server, which KeepAlive restarts at once.
// Plists are backed up first to ~/Library/LaunchAgents/video-scripter-egress-meter-backup-<date>/.
//
// Usage: npx tsx scripts/install-egress-meter.ts [--dry-run] [--wait-seconds 600]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { installedAgentLabels, OTHER_REPO_AGENTS, agentsMissingMeter, meterEnvFor } from '../lib/ops/scheduled-jobs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const waitSeconds = Number(args[args.indexOf('--wait-seconds') + 1] || 600) || 600;
const AGENTS = path.join(os.homedir(), 'Library', 'LaunchAgents');
const REPO = process.cwd();
const uid = process.getuid!();
const ALWAYS_ON = new Set(['com.mfm.video-scripter-extension-api']);

const labels = [...installedAgentLabels(AGENTS), ...OTHER_REPO_AGENTS.filter((l) => fs.existsSync(path.join(AGENTS, `${l}.plist`)))];
const todo = agentsMissingMeter(AGENTS, labels, REPO);
console.log(`${todo.length} of ${labels.length} agents need the meter${dry ? ' (dry run)' : ''}`);
if (dry || !todo.length) { for (const l of todo) console.log(`  ${l}`); process.exit(0); }

const backup = path.join(AGENTS, `video-scripter-egress-meter-backup-${new Date().toISOString().slice(0, 10)}`);
fs.mkdirSync(backup, { recursive: true });

const running = (label: string) =>
  /state = running/.test(spawnSync('launchctl', ['print', `gui/${uid}/${label}`], { encoding: 'utf8' }).stdout ?? '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function install(label: string): Promise<string> {
  const plist = path.join(AGENTS, `${label}.plist`);
  fs.copyFileSync(plist, path.join(backup, `${label}.plist`));
  const env = meterEnvFor(label, REPO);
  try { execFileSync('plutil', ['-extract', 'EnvironmentVariables', 'raw', plist], { stdio: 'ignore' }); }
  catch { execFileSync('plutil', ['-insert', 'EnvironmentVariables', '-dictionary', plist]); }
  for (const [k, v] of Object.entries(env)) execFileSync('plutil', ['-replace', `EnvironmentVariables.${k}`, '-string', v, plist]);
  execFileSync('plutil', ['-lint', plist], { stdio: 'ignore' });

  const deadline = Date.now() + waitSeconds * 1000;
  while (!ALWAYS_ON.has(label) && running(label)) {
    if (Date.now() > deadline) return `${label}: plist updated; still running after ${waitSeconds}s — reload it later`;
    await sleep(2000);
  }
  spawnSync('launchctl', ['bootout', `gui/${uid}/${label}`]);
  // bootout returns before a KeepAlive process has exited; bootstrap fails (EIO) until it has.
  let r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plist], { encoding: 'utf8' });
  for (let i = 0; r.status !== 0 && i < 10; i++) {
    await sleep(1000);
    r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plist], { encoding: 'utf8' });
  }
  return r.status === 0 ? `${label}: metered as ${env.EGRESS_JOB}` : `${label}: bootstrap FAILED ${r.stderr.trim()}`;
}

for (const line of await Promise.all(todo.map(install))) console.log(`  ${line}`);
const left = agentsMissingMeter(AGENTS, labels, REPO);
console.log(left.length ? `NOT metered: ${left.join(', ')}` : 'every agent is metered');
process.exitCode = left.length ? 1 : 0;

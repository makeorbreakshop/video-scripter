import os from 'node:os';
import path from 'node:path';
import { installBackgroundJobs } from './background-job-plist';

const check = process.argv.includes('--check');
if (!check && !process.argv.includes('--write')) {
  console.error('usage: npx tsx scripts/launchd/install-background-jobs.ts --write|--check');
  process.exit(2);
}
const differences = installBackgroundJobs({
  repoRoot: process.cwd(),
  launchAgentsDir: path.join(os.homedir(), 'Library', 'LaunchAgents'),
  check,
});
if (check && differences) process.exitCode = 1;

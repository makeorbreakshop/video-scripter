import fs from 'node:fs';
import path from 'node:path';
import { BACKGROUND_JOBS, type BackgroundJob } from './background-jobs';

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const stringNode = (value: string) => `    <string>${escapeXml(value)}</string>`;

function calendarSchedule(job: BackgroundJob): string {
  const intervalMinutes = job.intervalSeconds / 60;
  if (!Number.isInteger(intervalMinutes) || 60 % intervalMinutes !== 0) {
    throw new Error(`${job.label}: interval must divide one hour for a calendar schedule`);
  }
  const minutes: number[] = [];
  for (let minute = job.minuteOffset; minute < 60; minute += intervalMinutes) minutes.push(minute);
  return minutes.map((minute) => `    <dict>
      <key>Minute</key>
      <integer>${minute}</integer>
    </dict>`).join('\n');
}

export function renderLaunchAgent(job: BackgroundJob, repoRoot: string): string {
  const logRoot = path.join(repoRoot, 'logs');
  const argv = [
    '/opt/homebrew/bin/npx',
    'tsx',
    `scripts/${job.script}`,
    ...job.args,
    '--max-seconds',
    String(job.maxSeconds),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(job.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argv.map(stringNode).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(repoRoot)}</string>
  <key>StartCalendarInterval</key>
  <array>
${calendarSchedule(job)}
  </array>
  <key>Nice</key>
  <integer>${job.nice}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logRoot, job.stdout))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logRoot, job.stderr))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
}

export function installBackgroundJobs(options: { repoRoot: string; launchAgentsDir: string; check: boolean }): number {
  fs.mkdirSync(path.join(options.repoRoot, 'logs'), { recursive: true });
  if (!options.check) fs.mkdirSync(options.launchAgentsDir, { recursive: true });

  let differences = 0;
  for (const job of BACKGROUND_JOBS) {
    const target = path.join(options.launchAgentsDir, `${job.label}.plist`);
    const expected = renderLaunchAgent(job, options.repoRoot);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === expected) continue;
    differences++;
    if (options.check) {
      console.error(`${target} is missing or out of date`);
      continue;
    }
    const temporary = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, expected, { mode: 0o644 });
    fs.renameSync(temporary, target);
    console.log(`installed ${target}`);
  }
  return differences;
}

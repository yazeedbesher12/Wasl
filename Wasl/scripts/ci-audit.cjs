const { spawnSync } = require('node:child_process');

function audit(productionOnly) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json', ...(productionOnly ? ['--prod'] : [])],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (![0, 1].includes(result.status)) throw new Error('Dependency audit command failed');
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error('Dependency audit returned unreadable output'); }
  const counts = report.metadata?.vulnerabilities;
  const levels = ['info', 'low', 'moderate', 'high', 'critical'];
  if (report.error || !report.advisories || !levels.every(level => Number.isInteger(counts?.[level])))
    throw new Error('Dependency audit did not return advisory counts');
  const advisories = Object.values(report.advisories);
  if (result.status === 1 && !advisories.length) throw new Error('Dependency audit exited unsuccessfully without advisories');
  console.log(productionOnly ? 'Production dependency audit' : 'Full workspace dependency audit');
  console.log(levels.map(level => `${level}=${counts[level]}`).join(' '));
  for (const item of advisories) {
    console.log(`- ${item.severity} ${item.module_name} ${item.github_advisory_id}; patched: ${item.patched_versions}`);
    for (const finding of item.findings)
      console.log(`  ${finding.version}: ${finding.paths.join(', ')}`);
  }
  return counts.high + counts.critical > 0;
}

try {
  if (!process.env.npm_execpath) throw new Error('Run with pnpm ci:audit');
  const anyHighInFull = audit(false);
  const anyHighInProduction = audit(true);
  if (anyHighInFull || anyHighInProduction) {
    console.error('Dependency audit failed the high/critical threshold');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

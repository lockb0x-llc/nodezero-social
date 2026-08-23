import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

const maxTrackedFileBytes = 5 * 1024 * 1024;
const generatedPathPatterns = [
  /^scratch\//,
  /^provisioner_logs\//,
  /^provisioner-logs\//,
  /^playwright-report\//,
  /^playwright-results\//,
  /(?:^|\/)packages\/jss-provisioner\/.*\.zip$/,
  /(?:^|\/)packages\/mobile-app\/.*\.zip$/,
  /(?:^|\/)docs\/screenshots\/.*-playwright-trace\.zip$/,
  /(?:^|\/)(?:%LOG%|logs\.zip)$/,
];

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const violations = [];

for (const filePath of trackedFiles) {
  if (!existsSync(filePath)) {
    continue;
  }
  const fileSize = statSync(filePath).size;
  if (fileSize > maxTrackedFileBytes) {
    violations.push(`${filePath} (${(fileSize / 1024 / 1024).toFixed(2)} MiB)`);
  }
  if (generatedPathPatterns.some((pattern) => pattern.test(filePath))) {
    violations.push(`${filePath} (generated artifact path)`);
  }
}

if (violations.length > 0) {
  console.error('Repository hygiene validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Repository hygiene validation passed (${trackedFiles.length} tracked files checked).`);
}
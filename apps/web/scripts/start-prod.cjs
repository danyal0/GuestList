#!/usr/bin/env node
/**
 * Production web boot for Next.js `output: "standalone"`.
 * `next start` is incompatible with standalone — run the traced server instead.
 */
const { spawnSync } = require('node:child_process');
const { cpSync, existsSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');

const webRoot = path.join(__dirname, '..');
const standaloneRoot = path.join(webRoot, '.next', 'standalone');
const serverJs = path.join(standaloneRoot, 'apps', 'web', 'server.js');
const standaloneApp = path.join(standaloneRoot, 'apps', 'web');

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function syncDir(src, dest) {
  if (!existsSync(src)) return;
  rmSync(dest, { recursive: true, force: true });
  ensureDir(path.dirname(dest));
  cpSync(src, dest, { recursive: true });
}

if (!existsSync(serverJs)) {
  console.error(
    '[web] Standalone server missing at',
    serverJs,
    '\nRun `npm run build -w apps/web` first.',
  );
  process.exit(1);
}

// Static assets and public/ are not always traced into standalone.
syncDir(path.join(webRoot, '.next', 'static'), path.join(standaloneApp, '.next', 'static'));
syncDir(path.join(webRoot, 'public'), path.join(standaloneApp, 'public'));

const port = process.env.PORT || '3000';
const hostname = process.env.HOSTNAME || '0.0.0.0';

console.log(`[web] starting standalone server on ${hostname}:${port}`);

const result = spawnSync(process.execPath, [serverJs], {
  stdio: 'inherit',
  cwd: standaloneRoot,
  env: {
    ...process.env,
    PORT: String(port),
    HOSTNAME: hostname,
  },
});

process.exit(result.status ?? 1);

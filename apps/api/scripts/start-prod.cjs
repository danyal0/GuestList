#!/usr/bin/env node
/**
 * Production API boot:
 * - file/mock data: skip Prisma migrations
 * - postgres: run migrate deploy, then start
 *
 * Resolves Nest's entry both as dist/main.js (rootDir=src) and the older
 * dist/src/main.js layout if a JSON import ever pulls rootDir up again.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const apiRoot = path.join(__dirname, '..');

function useFileDataSource() {
  const mode = String(process.env.DATA_SOURCE || '').toLowerCase();
  if (mode === 'file' || mode === 'mock') return true;
  if (mode === 'postgres' || mode === 'database' || mode === 'prisma') return false;
  const url = process.env.DATABASE_URL || '';
  if (!url.trim()) return true;
  if (url.startsWith('file:')) return true;
  return false;
}

function resolveMainEntry() {
  const candidates = [
    path.join(apiRoot, 'dist', 'main.js'),
    path.join(apiRoot, 'dist', 'src', 'main.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

if (!useFileDataSource()) {
  console.log('[api] DATA_SOURCE=postgres — running prisma migrate deploy');
  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    cwd: apiRoot,
    env: process.env,
  });
  if (migrate.status !== 0) process.exit(migrate.status ?? 1);
} else {
  console.log('[api] DATA_SOURCE=file — using apps/api/data/mock-db.json (no Postgres)');
}

const mainEntry = resolveMainEntry();
if (!mainEntry) {
  console.error(
    '[api] Missing Nest build output. Expected dist/main.js (or dist/src/main.js).',
    '\nRun `npm run build -w apps/api` before start:prod.',
  );
  process.exit(1);
}

console.log(`[api] starting ${path.relative(apiRoot, mainEntry)}`);
const boot = spawnSync(process.execPath, [mainEntry], {
  stdio: 'inherit',
  cwd: apiRoot,
  env: process.env,
});
process.exit(boot.status ?? 1);

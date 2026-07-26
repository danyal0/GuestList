#!/usr/bin/env node
/**
 * Production API boot:
 * - file/mock data: skip Prisma migrations
 * - postgres: run migrate deploy, then start
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function useFileDataSource() {
  const mode = String(process.env.DATA_SOURCE || '').toLowerCase();
  if (mode === 'file' || mode === 'mock') return true;
  if (mode === 'postgres' || mode === 'database' || mode === 'prisma') return false;
  const url = process.env.DATABASE_URL || '';
  if (!url.trim()) return true;
  if (url.startsWith('file:')) return true;
  return false;
}

if (!useFileDataSource()) {
  console.log('[api] DATA_SOURCE=postgres — running prisma migrate deploy');
  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: process.env,
  });
  if (migrate.status !== 0) process.exit(migrate.status ?? 1);
} else {
  console.log('[api] DATA_SOURCE=file — using apps/api/data/mock-db.json (no Postgres)');
}

const boot = spawnSync(process.execPath, ['dist/main.js'], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env: process.env,
});
process.exit(boot.status ?? 1);

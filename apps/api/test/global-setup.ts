import { execSync } from 'child_process';

/**
 * Prepares an isolated test database. The suite must never run against the
 * development database — data is wiped between test runs.
 */
export default function globalSetup(): void {
  const base = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/gatherly?schema=public';
  const testUrl = base.replace(/\/(\w+)(\?|$)/, '/gatherly_test$2');
  process.env.DATABASE_URL = testUrl;

  const url = new URL(testUrl);
  const admin = `postgresql://${url.username}:${url.password}@${url.host}/postgres`;

  execSync(
    `psql "${admin}" -tc "SELECT 1 FROM pg_database WHERE datname='gatherly_test'" | grep -q 1 || psql "${admin}" -c "CREATE DATABASE gatherly_test"`,
    { stdio: 'inherit', shell: '/bin/bash' },
  );
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
    cwd: `${__dirname}/..`,
  });
}

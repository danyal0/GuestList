/**
 * DATA_SOURCE=file (default when DATABASE_URL is unset) serves demo data from
 * apps/api/data/mock-db.json. Set DATA_SOURCE=postgres and a Postgres
 * DATABASE_URL when you are ready for a real database.
 */
export function useFileDataSource(): boolean {
  const mode = (process.env.DATA_SOURCE ?? '').toLowerCase();
  if (mode === 'file' || mode === 'mock') return true;
  if (mode === 'postgres' || mode === 'database' || mode === 'prisma') return false;

  const url = process.env.DATABASE_URL ?? '';
  if (!url.trim()) return true;
  if (url.startsWith('file:')) return true;
  return false;
}

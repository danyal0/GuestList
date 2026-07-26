/** Public Railway URL used when env vars are not set. */
export const DEFAULT_PUBLIC_URL = 'https://mkeplays-production.up.railway.app';

export const DEFAULT_JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'mkeplays-dev-access-secret-change-me-32b';
export const DEFAULT_JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'mkeplays-dev-refresh-secret-change-me-32b';

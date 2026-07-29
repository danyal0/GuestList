import { DEFAULT_JWT_ACCESS_SECRET, DEFAULT_JWT_REFRESH_SECRET, DEFAULT_PUBLIC_URL } from './defaults';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiUrl: string;
  webUrl: string;
  database: { url: string };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  cookies: { secure: boolean; domain?: string };
  oauth: { googleClientId?: string; appleClientId?: string };
  mail: {
    host?: string;
    port: number;
    user?: string;
    pass?: string;
    from: string;
  };
  uploads: { maxBytes: number };
  /** Emails that should always receive platform ADMIN (comma-separated). */
  adminEmails: string[];
  /** Phones that should always receive platform ADMIN (comma-separated digits). */
  adminPhones: string[];
}

const publicUrl = process.env.PUBLIC_URL || process.env.WEB_URL || DEFAULT_PUBLIC_URL;

const nodeEnv = process.env.NODE_ENV ?? 'development';

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default (): AppConfig => ({
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  apiUrl: process.env.API_URL ?? publicUrl,
  webUrl: process.env.WEB_URL ?? publicUrl,
  database: { url: process.env.DATABASE_URL ?? '' },
  jwt: {
    accessSecret: DEFAULT_JWT_ACCESS_SECRET,
    refreshSecret: DEFAULT_JWT_REFRESH_SECRET,
    accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL ?? 900),
    refreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL ?? 60 * 60 * 24 * 30),
  },
  cookies: {
    secure: (process.env.COOKIE_SECURE ?? (nodeEnv === 'production' ? 'true' : 'false')) === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
  },
  oauth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,
    appleClientId: process.env.APPLE_CLIENT_ID || undefined,
  },
  mail: {
    host: process.env.SMTP_HOST || undefined,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.MAIL_FROM ?? 'MKE Plays <no-reply@mkeplays.app>',
  },
  uploads: { maxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024) },
  adminEmails: [
    'admin@mkeplays.app',
    ...splitList(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  ],
  adminPhones: [
    '14145550001',
    ...splitList(process.env.ADMIN_PHONES).map((p) => p.replace(/\D/g, '')).filter(Boolean),
  ],
});

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
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  apiUrl: process.env.API_URL ?? 'http://localhost:4000',
  webUrl: process.env.WEB_URL ?? 'http://localhost:3000',
  database: { url: process.env.DATABASE_URL ?? '' },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL ?? 900),
    refreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL ?? 60 * 60 * 24 * 30),
  },
  cookies: {
    secure: process.env.COOKIE_SECURE === 'true',
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
    from: process.env.MAIL_FROM ?? 'Gatherly <no-reply@gatherly.app>',
  },
  uploads: { maxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024) },
});

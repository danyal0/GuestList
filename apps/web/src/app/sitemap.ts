import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
  const now = new Date();
  return [
    { url: base, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/groups`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/events`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/search`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/signup`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
  ];
}

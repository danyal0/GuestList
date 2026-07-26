import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/layout/app-shell';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Gatherly — Find your people',
    template: '%s · Gatherly',
  },
  description:
    'Discover communities, join groups, and attend events near you. Gatherly is where hobbies, careers and friendships come together.',
  applicationName: 'Gatherly',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Gatherly',
  },
  openGraph: {
    type: 'website',
    siteName: 'Gatherly',
    title: 'Gatherly — Find your people',
    description: 'Discover communities, join groups, and attend events near you.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Gatherly — Find your people',
    description: 'Discover communities, join groups, and attend events near you.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

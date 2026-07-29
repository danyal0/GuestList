import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/layout/app-shell';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'),
  title: {
    default: 'MKE Plays — Find your people',
    template: '%s · MKE Plays',
  },
  description:
    'Discover communities, join groups, and attend events near you. MKE Plays is where hobbies, careers and friendships come together.',
  applicationName: 'MKE Plays',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MKE Plays',
  },
  openGraph: {
    type: 'website',
    siteName: 'MKE Plays',
    title: 'MKE Plays — Find your people',
    description: 'Discover communities, join groups, and attend events near you.',
    images: [{ url: '/brand/og.png', width: 1200, height: 630, alt: 'MKE Plays' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MKE Plays — Find your people',
    description: 'Discover communities, join groups, and attend events near you.',
    images: ['/brand/og.png'],
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

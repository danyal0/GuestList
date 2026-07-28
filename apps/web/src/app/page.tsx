import type { Metadata } from 'next';
import { HomeContent } from '@/components/home/home-content';

export const metadata: Metadata = {
  title: 'MKE Plays — Find your people',
  description:
    'Discover communities, join groups, and attend events near you. From hiking crews to ML guilds — your next favorite thing starts here.',
};

export default function HomePage() {
  return <HomeContent />;
}

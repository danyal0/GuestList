import type { GroupCategory } from '@/lib/types';

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return formatDate(iso);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export const CATEGORY_LABELS: Record<GroupCategory, string> = {
  TECHNOLOGY: 'Technology',
  SPORTS: 'Sports & Fitness',
  ARTS: 'Arts & Culture',
  MUSIC: 'Music',
  EDUCATION: 'Education',
  BUSINESS: 'Business',
  HEALTH: 'Health & Wellbeing',
  FOOD: 'Food & Drink',
  OUTDOORS: 'Outdoors & Adventure',
  GAMES: 'Games',
  LANGUAGE: 'Language',
  PHOTOGRAPHY: 'Photography',
  BOOKS: 'Books',
  FILM: 'Film & Media',
  SCIENCE: 'Science',
  COMMUNITY: 'Community',
};

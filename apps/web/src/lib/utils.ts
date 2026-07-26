import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(new Date(date));
}

export function formatTime(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(date),
  );
}

export function formatDateTime(date: string | Date): string {
  return `${formatDate(date)} · ${formatTime(date)}`;
}

export function formatRelative(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return formatDate(date, { weekday: undefined });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export const CATEGORY_LABELS: Record<string, string> = {
  TECHNOLOGY: 'Technology',
  SPORTS: 'Sports',
  ARTS: 'Arts',
  MUSIC: 'Music',
  EDUCATION: 'Education',
  BUSINESS: 'Business',
  HEALTH: 'Health',
  FOOD: 'Food & Drink',
  OUTDOORS: 'Outdoors',
  GAMES: 'Games',
  LANGUAGE: 'Language',
  PHOTOGRAPHY: 'Photography',
  BOOKS: 'Books',
  FILM: 'Film',
  SCIENCE: 'Science',
  COMMUNITY: 'Community',
};

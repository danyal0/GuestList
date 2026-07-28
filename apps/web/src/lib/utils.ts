import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  const parsed = date == null ? null : new Date(date);
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(parsed);
}

export function formatTime(date: string | Date | null | undefined): string {
  const parsed = date == null ? null : new Date(date);
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(parsed);
}

export function formatDateTime(date: string | Date | null | undefined): string {
  const day = formatDate(date);
  const time = formatTime(date);
  if (!day && !time) return '';
  if (!day) return time;
  if (!time) return day;
  return `${day} · ${time}`;
}

export function formatRelative(date: string | Date | null | undefined): string {
  const parsed = date == null ? null : new Date(date);
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  const diff = Date.now() - parsed.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return formatDate(date, { weekday: undefined });
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?';
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

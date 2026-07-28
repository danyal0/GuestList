'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  initialQuery?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** When provided, called on submit instead of navigating to /search. */
  onSearch?: (query: string) => void;
}

export function SearchBar({
  initialQuery = '',
  placeholder = 'Search communities, events, people…',
  autoFocus,
  className,
  onSearch,
}: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState(initialQuery);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    if (onSearch) onSearch(trimmed);
    else router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form role="search" onSubmit={submit} className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--color-ink-tertiary)]"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label="Search"
        enterKeyHint="search"
        className="h-12 w-full rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-[var(--color-surface)] pl-11 pr-11 text-[15px] text-[var(--color-ink)] caret-[var(--color-ink)] shadow-[var(--shadow-card)] placeholder:text-[var(--color-ink-tertiary)] focus:border-[var(--color-accent)] [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery('');
            inputRef.current?.focus();
          }}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-full bg-[var(--color-surface-3)] p-1 text-[var(--color-ink-secondary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </form>
  );
}

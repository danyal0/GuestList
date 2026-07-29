'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type SuggestOption<T> = {
  id: string;
  source: string;
  label: string;
  subtitle?: string;
  confidence: number;
  fields: T;
};

interface SuggestFieldProps<T> {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onApply: (fields: T, option: SuggestOption<T>) => void;
  loadSuggestions: (query: string) => Promise<SuggestOption<T>[]>;
  placeholder?: string;
  error?: string;
  required?: boolean;
  name?: string;
  minChars?: number;
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'event':
      return 'Past event';
    case 'group':
      return 'Existing community';
    case 'venue':
      return 'Venue';
    case 'ai':
      return 'AI';
    case 'heuristic':
      return 'Suggested';
    default:
      return source;
  }
}

export function SuggestField<T>({
  id,
  label,
  value,
  onChange,
  onApply,
  loadSuggestions,
  placeholder,
  error,
  required,
  name,
  minChars = 2,
}: SuggestFieldProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [options, setOptions] = React.useState<SuggestOption<T>[]>([]);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const reqId = React.useRef(0);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  React.useEffect(() => {
    const q = value.trim();
    if (q.length < minChars) {
      setOptions([]);
      setOpen(false);
      return;
    }
    const handle = window.setTimeout(async () => {
      const idNow = ++reqId.current;
      setLoading(true);
      try {
        const next = await loadSuggestions(q);
        if (idNow !== reqId.current) return;
        setOptions(next);
        setActive(0);
        setOpen(next.length > 0);
      } catch {
        if (idNow !== reqId.current) return;
        setOptions([]);
        setOpen(false);
      } finally {
        if (idNow === reqId.current) setLoading(false);
      }
    }, 280);
    return () => window.clearTimeout(handle);
  }, [value, loadSuggestions, minChars]);

  const apply = (option: SuggestOption<T>) => {
    onApply(option.fields, option);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => options.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || options.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => (i + 1) % options.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (i - 1 + options.length) % options.length);
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            apply(options[active]!);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        error={error}
        required={required}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-suggest-list`}
      />
      {loading && (
        <p className="mt-1.5 text-[12px] text-[var(--color-ink-tertiary)]">Looking for matches…</p>
      )}
      {open && options.length > 0 && (
        <ul
          id={`${id}-suggest-list`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-float)]"
        >
          {options.map((option, index) => (
            <li key={option.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={cn(
                  'flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors',
                  index === active
                    ? 'bg-[var(--color-accent-soft)]'
                    : 'hover:bg-[var(--color-surface-3)]',
                )}
                onMouseEnter={() => setActive(index)}
                onClick={() => apply(option)}
              >
                <span className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-ink)]">
                  {option.source === 'ai' && (
                    <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden />
                  )}
                  {option.label}
                </span>
                <span className="text-[12px] text-[var(--color-ink-tertiary)]">
                  {sourceLabel(option.source)}
                  {option.subtitle ? ` · ${option.subtitle}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

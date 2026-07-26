'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { cn } from '@/lib/utils';

interface CalendarProps {
  /** Dates that should show an event dot. */
  markedDates?: Date[];
  selected?: Date;
  onSelect?: (date: Date) => void;
  className?: string;
}

/** Compact month calendar in the iOS style, keyboard and screen-reader friendly. */
export function Calendar({ markedDates = [], selected, onSelect, className }: CalendarProps) {
  const [month, setMonth] = React.useState(() => startOfMonth(selected ?? new Date()));

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month)),
    end: endOfWeek(endOfMonth(month)),
  });

  return (
    <div className={cn('rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-bold" aria-live="polite">
          {format(month, 'MMMM yyyy')}
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            className="rounded-full p-1.5 transition-colors hover:bg-[var(--color-surface-3)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="rounded-full p-1.5 transition-colors hover:bg-[var(--color-surface-3)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div role="grid" aria-label={format(month, 'MMMM yyyy')}>
        <div role="row" className="grid grid-cols-7 text-center">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <span key={i} role="columnheader" className="pb-2 text-[11px] font-bold text-[var(--color-ink-tertiary)]">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {days.map((day) => {
            const marked = markedDates.some((d) => isSameDay(d, day));
            const isSelected = selected && isSameDay(day, selected);
            return (
              <button
                key={day.toISOString()}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-label={format(day, 'PPPP')}
                onClick={() => onSelect?.(day)}
                className={cn(
                  'relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-medium transition-colors',
                  !isSameMonth(day, month) && 'text-[var(--color-ink-tertiary)]/50',
                  isToday(day) && !isSelected && 'font-bold text-[var(--color-accent)]',
                  isSelected ? 'bg-[var(--color-accent)] text-white' : 'hover:bg-[var(--color-surface-3)]',
                )}
              >
                {format(day, 'd')}
                {marked && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute bottom-1 h-1 w-1 rounded-full',
                      isSelected ? 'bg-white' : 'bg-[var(--color-accent)]',
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

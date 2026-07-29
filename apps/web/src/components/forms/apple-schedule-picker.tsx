'use client';

import * as React from 'react';
import { CalendarDays, Clock, Repeat } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  REPEAT_OPTIONS,
  friendlyDayLabel,
  type EndRepeatMode,
  type RepeatFrequency,
} from '@/lib/recurrence';

export interface ScheduleState {
  dateEnabled: boolean;
  selectedDate: Date;
  timeEnabled: boolean;
  startTimeHm: string;
  endTimeHm: string;
  frequency: RepeatFrequency;
  endMode: EndRepeatMode;
  endDate: string;
  endCount: number;
  customRule: string;
}

interface AppleSchedulePickerProps {
  value: ScheduleState;
  onChange: (next: ScheduleState) => void;
  error?: string;
}

export function AppleSchedulePicker({ value, onChange, error }: AppleSchedulePickerProps) {
  const patch = (partial: Partial<ScheduleState>) => onChange({ ...value, ...partial });

  return (
    <fieldset className="space-y-0 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <legend className="sr-only">Date and repeat</legend>

      {/* Date */}
      <div className="border-b border-[var(--color-hairline)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-[var(--color-accent)]" aria-hidden />
            <div>
              <p className="text-[15px] font-semibold">Date</p>
              {value.dateEnabled && (
                <p className="text-[14px] text-[var(--color-accent)]">
                  {friendlyDayLabel(value.selectedDate)}
                </p>
              )}
            </div>
          </div>
          <Switch
            checked={value.dateEnabled}
            onCheckedChange={(checked) => patch({ dateEnabled: checked })}
            aria-label="Enable date"
          />
        </div>
        {value.dateEnabled && (
          <div className="mt-3">
            <Calendar
              selected={value.selectedDate}
              onSelect={(date) => patch({ selectedDate: date, dateEnabled: true })}
              className="border border-[var(--color-hairline)]"
            />
          </div>
        )}
      </div>

      {/* Time */}
      <div className="border-b border-[var(--color-hairline)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-[var(--color-accent)]" aria-hidden />
            <p className="text-[15px] font-semibold">Time</p>
          </div>
          <Switch
            checked={value.timeEnabled}
            onCheckedChange={(checked) => patch({ timeEnabled: checked })}
            aria-label="Enable time"
          />
        </div>
        {value.timeEnabled && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="startTimeHm">Starts</Label>
              <Input
                id="startTimeHm"
                type="time"
                value={value.startTimeHm}
                onChange={(e) => patch({ startTimeHm: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="endTimeHm">Ends</Label>
              <Input
                id="endTimeHm"
                type="time"
                value={value.endTimeHm}
                onChange={(e) => patch({ endTimeHm: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>

      {/* Repeat */}
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <Repeat className="mt-2.5 h-5 w-5 shrink-0 text-[var(--color-accent)]" aria-hidden />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <Label htmlFor="repeatFrequency">Repeat</Label>
              <Select
                id="repeatFrequency"
                value={value.frequency}
                onChange={(e) =>
                  patch({ frequency: e.target.value as RepeatFrequency })
                }
                disabled={!value.dateEnabled}
              >
                {REPEAT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>

            {value.frequency === 'custom' && (
              <div>
                <Label htmlFor="customRule">Custom RRULE</Label>
                <Input
                  id="customRule"
                  value={value.customRule}
                  onChange={(e) => patch({ customRule: e.target.value })}
                  placeholder="FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10"
                />
              </div>
            )}

            {value.frequency !== 'never' && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="endRepeat">End Repeat</Label>
                  <Select
                    id="endRepeat"
                    value={value.endMode}
                    onChange={(e) => patch({ endMode: e.target.value as EndRepeatMode })}
                  >
                    <option value="never">Never</option>
                    <option value="date">On Date</option>
                    <option value="count">After</option>
                  </Select>
                </div>
                {value.endMode === 'date' && (
                  <div>
                    <Label htmlFor="endDate">Ends on</Label>
                    <Input
                      id="endDate"
                      type="date"
                      value={value.endDate}
                      onChange={(e) => patch({ endDate: e.target.value })}
                    />
                  </div>
                )}
                {value.endMode === 'count' && (
                  <div>
                    <Label htmlFor="endCount">Occurrences</Label>
                    <Input
                      id="endCount"
                      type="number"
                      min={2}
                      max={26}
                      value={value.endCount}
                      onChange={(e) => patch({ endCount: Number(e.target.value) || 2 })}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-[var(--color-danger)]">
            {error}
          </p>
        )}
      </div>
    </fieldset>
  );
}

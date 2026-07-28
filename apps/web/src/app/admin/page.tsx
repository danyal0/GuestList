'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { AnalyticsOverview, Paginated, TimeSeriesPoint } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  suspendedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  _count: { memberships: number; rsvps: number };
}

interface AdminReport {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
  reporter: { id: string; name: string; email: string };
}

interface RetentionCohort {
  cohortWeek: string;
  cohortSize: number;
  weeks: number[];
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-tertiary)]">
        {label}
      </p>
      <p className="mt-1 text-[28px] font-extrabold tracking-tight">{value.toLocaleString()}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5">
      <h3 className="mb-4 text-[15px] font-bold">{title}</h3>
      <div className="h-56">{children}</div>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, hydrated } = useAuthStore();
  const [userSearch, setUserSearch] = React.useState('');

  React.useEffect(() => {
    if (hydrated && (!user || user.role !== 'ADMIN')) router.replace('/');
  }, [hydrated, user, router]);

  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api<AnalyticsOverview>('/admin/analytics/overview'),
    enabled: user?.role === 'ADMIN',
  });
  const dau = useQuery({
    queryKey: ['admin-dau'],
    queryFn: () => api<TimeSeriesPoint[]>('/admin/analytics/dau'),
    enabled: user?.role === 'ADMIN',
  });
  const growth = useQuery({
    queryKey: ['admin-growth'],
    queryFn: () => api<TimeSeriesPoint[]>('/admin/analytics/growth'),
    enabled: user?.role === 'ADMIN',
  });
  const retention = useQuery({
    queryKey: ['admin-retention'],
    queryFn: () => api<RetentionCohort[]>('/admin/analytics/retention'),
    enabled: user?.role === 'ADMIN',
  });
  const attendance = useQuery({
    queryKey: ['admin-attendance'],
    queryFn: () =>
      api<Array<{ eventId: string; title: string; goingCount: number; capacity: number | null; attendanceRate: number | null }>>(
        '/admin/analytics/attendance',
      ),
    enabled: user?.role === 'ADMIN',
  });
  const users = useQuery({
    queryKey: ['admin-users', userSearch],
    queryFn: () => api<Paginated<AdminUser>>(`/admin/users?limit=20${userSearch ? `&q=${encodeURIComponent(userSearch)}` : ''}`),
    enabled: user?.role === 'ADMIN',
  });
  const reports = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => api<Paginated<AdminReport>>('/moderation/reports?status=OPEN'),
    enabled: user?.role === 'ADMIN',
  });

  const suspend = useMutation({
    mutationFn: ({ id, suspendUser }: { id: string; suspendUser: boolean }) =>
      api(`/admin/users/${id}/suspension`, {
        method: 'PATCH',
        body: JSON.stringify({ suspend: suspendUser }),
      }),
    onSuccess: () => {
      toast.success('Updated');
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Action failed'),
  });

  const resolveReport = useMutation({
    mutationFn: ({ id, dismiss, takedown }: { id: string; dismiss: boolean; takedown: boolean }) =>
      api(`/moderation/reports/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          dismiss,
          takedown,
          resolution: dismiss ? 'Reviewed — no action needed' : takedown ? 'Content removed' : 'Reviewed and resolved',
        }),
      }),
    onSuccess: () => {
      toast.success('Report handled');
      void queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Action failed'),
  });

  if (!user || user.role !== 'ADMIN') return null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Admin</h1>
        <p className="text-[15px] text-[var(--color-ink-secondary)]">
          Platform health, growth and trust &amp; safety.
        </p>
      </div>

      {/* Overview stats */}
      {overview.isPending ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : overview.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <StatCard label="Users" value={overview.data.totalUsers} />
          <StatCard label="Communities" value={overview.data.totalGroups} />
          <StatCard label="Events" value={overview.data.totalEvents} />
          <StatCard label="RSVPs" value={overview.data.totalRsvps} />
          <StatCard label="Messages" value={overview.data.totalMessages} />
          <StatCard label="DAU" value={overview.data.dau} />
          <StatCard label="MAU" value={overview.data.mau} />
        </div>
      ) : null}

      <Tabs defaultValue="analytics">
        <TabsList>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="reports">
            Reports{reports.data && reports.data.total > 0 ? ` (${reports.data.total})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Daily active users — 30 days">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dau.data ?? []}>
                  <defs>
                    <linearGradient id="dauFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0a84ff" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#0a84ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip />
                  <Area type="monotone" dataKey="value" stroke="#0a84ff" strokeWidth={2} fill="url(#dauFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Signups — 30 days">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={growth.data ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#30d158" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Retention cohorts */}
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5">
            <h3 className="mb-4 text-[15px] font-bold">Weekly retention cohorts</h3>
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead>
                <tr className="text-[var(--color-ink-tertiary)]">
                  <th className="pb-2 font-semibold">Cohort week</th>
                  <th className="pb-2 font-semibold">Size</th>
                  {[1, 2, 3, 4].map((w) => (
                    <th key={w} className="pb-2 font-semibold">
                      W{w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(retention.data ?? []).map((cohort) => (
                  <tr key={cohort.cohortWeek} className="border-t border-[var(--color-hairline)]">
                    <td className="py-2 font-semibold">{cohort.cohortWeek}</td>
                    <td className="py-2">{cohort.cohortSize}</td>
                    {cohort.weeks.map((pct, i) => (
                      <td key={i} className="py-2">
                        <span
                          className="inline-block rounded px-2 py-0.5 font-semibold"
                          style={{ background: `rgba(10,132,255,${Math.max(0.06, pct / 130)})` }}
                        >
                          {pct}%
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Event attendance */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5">
            <h3 className="mb-4 text-[15px] font-bold">Recent event attendance</h3>
            {(attendance.data ?? []).length === 0 ? (
              <p className="text-[14px] text-[var(--color-ink-secondary)]">No completed events yet.</p>
            ) : (
              <ul className="space-y-2">
                {attendance.data!.map((event) => (
                  <li key={event.eventId} className="flex items-center justify-between gap-3 text-[14px]">
                    <span className="min-w-0 truncate font-semibold">{event.title}</span>
                    <span className="shrink-0 text-[var(--color-ink-secondary)]">
                      {event.goingCount} attended
                      {typeof event.attendanceRate === 'number' &&
                        ` · ${event.attendanceRate}% of capacity`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <Input
            placeholder="Search by name or email…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            aria-label="Search users"
            className="max-w-sm"
          />
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-[var(--color-hairline)] text-[13px] text-[var(--color-ink-tertiary)]">
                  <th className="p-4 font-semibold">User</th>
                  <th className="p-4 font-semibold">Role</th>
                  <th className="p-4 font-semibold">Joined</th>
                  <th className="p-4 font-semibold">Status</th>
                  <th className="p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(users.data?.items ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-hairline)] last:border-0">
                    <td className="p-4">
                      <p className="font-semibold">{row.name}</p>
                      <p className="text-[13px] text-[var(--color-ink-tertiary)]">{row.email}</p>
                    </td>
                    <td className="p-4">
                      <Badge variant={row.role === 'ADMIN' ? 'default' : 'neutral'}>{row.role}</Badge>
                    </td>
                    <td className="p-4 text-[var(--color-ink-secondary)]">
                      {formatDate(row.createdAt, { year: 'numeric' })}
                    </td>
                    <td className="p-4">
                      {row.deletedAt ? (
                        <Badge variant="neutral">Deleted</Badge>
                      ) : row.suspendedAt ? (
                        <Badge variant="danger">Suspended</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </td>
                    <td className="p-4">
                      {!row.deletedAt && row.id !== user.id && (
                        <Button
                          size="sm"
                          variant={row.suspendedAt ? 'secondary' : 'destructive'}
                          onClick={() => suspend.mutate({ id: row.id, suspendUser: !row.suspendedAt })}
                        >
                          {row.suspendedAt ? 'Unsuspend' : 'Suspend'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="reports">
          {(reports.data?.items ?? []).length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-[15px] text-[var(--color-ink-secondary)]">
              No open reports. The community is in good shape. ✨
            </p>
          ) : (
            <ul className="space-y-3">
              {reports.data!.items.map((report) => (
                <li
                  key={report.id}
                  className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">{report.targetType}</Badge>
                    <span className="text-[14px] font-semibold">{report.reason}</span>
                    <span className="ml-auto text-[13px] text-[var(--color-ink-tertiary)]">
                      by {report.reporter.name} · {formatDate(report.createdAt)}
                    </span>
                  </div>
                  {report.details && (
                    <p className="mt-2 text-[14px] text-[var(--color-ink-secondary)]">{report.details}</p>
                  )}
                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => resolveReport.mutate({ id: report.id, dismiss: false, takedown: true })}
                    >
                      Remove content
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => resolveReport.mutate({ id: report.id, dismiss: false, takedown: false })}
                    >
                      Resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => resolveReport.mutate({ id: report.id, dismiss: true, takedown: false })}
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

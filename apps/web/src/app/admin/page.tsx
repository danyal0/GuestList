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
import { api, ApiError } from '@/lib/api';
import type { AnalyticsOverview, Paginated, TimeSeriesPoint } from '@/lib/types';
import { formatDate, formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface AdminUser {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  role: string;
  suspendedAt: string | null;
  shadowBannedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  _count: { memberships: number; rsvps: number };
}

interface AdminGroup {
  id: string;
  slug: string;
  name: string;
  category: string;
  memberCount: number;
  deletedAt: string | null;
  createdAt: string;
  owner: { id: string; name: string; email: string | null };
  _count: { events: number; members: number };
}

interface AdminEvent {
  id: string;
  title: string;
  status: string;
  startTime: string;
  group: { id: string; name: string; slug: string };
  host: { id: string; name: string };
  _count: { rsvps: number };
}

interface AdminReport {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
  reporter: { id: string; name: string; email: string | null };
}

interface AuditLog {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string | null } | null;
}

interface DetailedStats {
  users: {
    total: number;
    active: number;
    suspended: number;
    shadowBanned: number;
    deleted: number;
  };
  groups: { active: number; deleted: number };
  events: {
    published: number;
    cancelled: number;
    completed: number;
    draft: number;
  };
  reports: { open: number; resolved: number; dismissed: number };
  social: { friendships: number; pendingRequests: number };
  engagement: { rsvps: number; messages: number };
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
      <p className="mt-1 text-[28px] font-extrabold tracking-tight">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
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

function BulkBar({
  count,
  onClear,
  actions,
}: {
  count: number;
  onClear: () => void;
  actions: Array<{ label: string; variant?: 'destructive' | 'secondary'; onClick: () => void; loading?: boolean }>;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] p-3">
      <span className="text-[14px] font-semibold">{count} selected</span>
      {actions.map((action) => (
        <Button
          key={action.label}
          size="sm"
          variant={action.variant ?? 'destructive'}
          loading={action.loading}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, hydrated } = useAuthStore();
  const [userSearch, setUserSearch] = React.useState('');
  const [groupSearch, setGroupSearch] = React.useState('');
  const [eventSearch, setEventSearch] = React.useState('');
  const [selectedUsers, setSelectedUsers] = React.useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = React.useState<Set<string>>(new Set());
  const [selectedEvents, setSelectedEvents] = React.useState<Set<string>>(new Set());
  const [confirm, setConfirm] = React.useState<{
    title: string;
    description: string;
    action: () => void;
  } | null>(null);

  React.useEffect(() => {
    if (hydrated && (!user || user.role !== 'ADMIN')) router.replace('/');
  }, [hydrated, user, router]);

  const enabled = user?.role === 'ADMIN';

  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api<AnalyticsOverview>('/admin/analytics/overview'),
    enabled,
  });
  const detailed = useQuery({
    queryKey: ['admin-detailed-stats'],
    queryFn: () => api<DetailedStats>('/admin/stats/detailed'),
    enabled,
  });
  const dau = useQuery({
    queryKey: ['admin-dau'],
    queryFn: () => api<TimeSeriesPoint[]>('/admin/analytics/dau'),
    enabled,
  });
  const mau = useQuery({
    queryKey: ['admin-mau'],
    queryFn: () => api<TimeSeriesPoint[]>('/admin/analytics/mau'),
    enabled,
  });
  const growth = useQuery({
    queryKey: ['admin-growth'],
    queryFn: () => api<TimeSeriesPoint[]>('/admin/analytics/growth'),
    enabled,
  });
  const retention = useQuery({
    queryKey: ['admin-retention'],
    queryFn: () => api<RetentionCohort[]>('/admin/analytics/retention'),
    enabled,
  });
  const attendance = useQuery({
    queryKey: ['admin-attendance'],
    queryFn: () =>
      api<
        Array<{
          eventId: string;
          title: string;
          goingCount: number;
          capacity: number | null;
          attendanceRate: number | null;
        }>
      >('/admin/analytics/attendance'),
    enabled,
  });
  const users = useQuery({
    queryKey: ['admin-users', userSearch],
    queryFn: () =>
      api<Paginated<AdminUser>>(
        `/admin/users?limit=50${userSearch ? `&q=${encodeURIComponent(userSearch)}` : ''}`,
      ),
    enabled,
  });
  const groups = useQuery({
    queryKey: ['admin-groups', groupSearch],
    queryFn: () =>
      api<Paginated<AdminGroup>>(
        `/admin/groups?limit=50${groupSearch ? `&q=${encodeURIComponent(groupSearch)}` : ''}`,
      ),
    enabled,
  });
  const events = useQuery({
    queryKey: ['admin-events', eventSearch],
    queryFn: () =>
      api<Paginated<AdminEvent>>(
        `/admin/events?limit=50${eventSearch ? `&q=${encodeURIComponent(eventSearch)}` : ''}`,
      ),
    enabled,
  });
  const reports = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => api<Paginated<AdminReport>>('/moderation/reports?status=OPEN&limit=50'),
    enabled,
  });
  const auditLogs = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => api<Paginated<AuditLog>>('/admin/audit-logs?limit=50'),
    enabled,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-groups'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-events'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-audit'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-detailed-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
  };

  const onError = (error: unknown) =>
    toast.error(error instanceof ApiError ? error.message : 'Action failed');

  const suspend = useMutation({
    mutationFn: ({ id, suspendUser }: { id: string; suspendUser: boolean }) =>
      api(`/admin/users/${id}/suspension`, {
        method: 'PATCH',
        body: JSON.stringify({ suspend: suspendUser }),
      }),
    onSuccess: () => {
      toast.success('Suspension updated');
      invalidateAll();
    },
    onError,
  });

  const shadowBan = useMutation({
    mutationFn: ({ id, ban }: { id: string; ban: boolean }) =>
      api(`/admin/users/${id}/shadow-ban`, {
        method: 'PATCH',
        body: JSON.stringify({ shadowBan: ban }),
      }),
    onSuccess: () => {
      toast.success('Shadow ban updated');
      invalidateAll();
    },
    onError,
  });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api(`/admin/users/${id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      toast.success('Role updated');
      invalidateAll();
    },
    onError,
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api(`/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('User deleted');
      invalidateAll();
    },
    onError,
  });

  const deleteGroup = useMutation({
    mutationFn: (id: string) => api(`/admin/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Community deleted');
      invalidateAll();
    },
    onError,
  });

  const cancelEvent = useMutation({
    mutationFn: (id: string) => api(`/admin/events/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Event cancelled');
      invalidateAll();
    },
    onError,
  });

  const bulkDeleteUsers = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ deleted: number }>('/admin/bulk/users/delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (data) => {
      toast.success(`Deleted ${data.deleted} users`);
      setSelectedUsers(new Set());
      invalidateAll();
    },
    onError,
  });

  const bulkDeleteGroups = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ deleted: number }>('/admin/bulk/groups/delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (data) => {
      toast.success(`Deleted ${data.deleted} communities`);
      setSelectedGroups(new Set());
      invalidateAll();
    },
    onError,
  });

  const bulkCancelEvents = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ cancelled: number }>('/admin/bulk/events/cancel', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (data) => {
      toast.success(`Cancelled ${data.cancelled} events`);
      setSelectedEvents(new Set());
      invalidateAll();
    },
    onError,
  });

  const resolveReport = useMutation({
    mutationFn: ({ id, dismiss, takedown }: { id: string; dismiss: boolean; takedown: boolean }) =>
      api(`/moderation/reports/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          dismiss,
          takedown,
          resolution: dismiss
            ? 'Reviewed — no action needed'
            : takedown
              ? 'Content removed'
              : 'Reviewed and resolved',
        }),
      }),
    onSuccess: () => {
      toast.success('Report handled');
      invalidateAll();
    },
    onError,
  });

  const toggleId = (set: Set<string>, id: string, next: Set<string>, setter: (s: Set<string>) => void) => {
    const copy = new Set(next);
    if (copy.has(id)) copy.delete(id);
    else copy.add(id);
    setter(copy);
  };

  if (!user || user.role !== 'ADMIN') return null;

  const d = detailed.data;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Backoffice</h1>
        <p className="text-[15px] text-[var(--color-ink-secondary)]">
          Superuser controls — users, communities, events, moderation, and platform stats.
        </p>
      </div>

      {overview.isPending || detailed.isPending ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <StatCard label="Users" value={overview.data?.totalUsers ?? 0} />
            <StatCard label="Communities" value={overview.data?.totalGroups ?? 0} />
            <StatCard label="Events" value={overview.data?.totalEvents ?? 0} />
            <StatCard label="RSVPs" value={overview.data?.totalRsvps ?? 0} />
            <StatCard label="Messages" value={overview.data?.totalMessages ?? 0} />
            <StatCard label="DAU" value={overview.data?.dau ?? 0} />
            <StatCard label="MAU" value={overview.data?.mau ?? 0} />
          </div>
          {d ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
              <StatCard label="Active users" value={d.users.active} />
              <StatCard label="Suspended" value={d.users.suspended} />
              <StatCard label="Shadow banned" value={d.users.shadowBanned} />
              <StatCard label="Deleted users" value={d.users.deleted} />
              <StatCard label="Open reports" value={d.reports.open} />
              <StatCard label="Cancelled events" value={d.events.cancelled} />
            </div>
          ) : null}
        </div>
      )}

      <Tabs defaultValue="analytics">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="communities">Communities</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="reports">
            Reports{reports.data && reports.data.total > 0 ? ` (${reports.data.total})` : ''}
          </TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="space-y-4">
          {d ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Published events" value={d.events.published} />
              <StatCard label="Completed events" value={d.events.completed} />
              <StatCard label="Deleted communities" value={d.groups.deleted} />
              <StatCard label="Friendships" value={d.social.friendships} />
            </div>
          ) : null}
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
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
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
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#30d158" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Monthly active users">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mau.data ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip />
                  <Area type="monotone" dataKey="value" stroke="#5e5ce6" strokeWidth={2} fill="#5e5ce633" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5">
              <h3 className="mb-4 text-[15px] font-bold">Recent event attendance</h3>
              {(attendance.data ?? []).length === 0 ? (
                <p className="text-[14px] text-[var(--color-ink-secondary)]">No completed events yet.</p>
              ) : (
                <ul className="space-y-2">
                  {attendance.data!.slice(0, 8).map((event) => (
                    <li key={event.eventId} className="flex items-center justify-between gap-3 text-[14px]">
                      <span className="min-w-0 truncate font-semibold">{event.title}</span>
                      <span className="shrink-0 text-[var(--color-ink-secondary)]">
                        {event.goingCount} attended
                        {typeof event.attendanceRate === 'number' && ` · ${event.attendanceRate}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

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
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <Input
            placeholder="Search by name, email, or phone…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            aria-label="Search users"
            className="max-w-sm"
          />
          <BulkBar
            count={selectedUsers.size}
            onClear={() => setSelectedUsers(new Set())}
            actions={[
              {
                label: 'Delete selected',
                loading: bulkDeleteUsers.isPending,
                onClick: () =>
                  setConfirm({
                    title: `Delete ${selectedUsers.size} users?`,
                    description: 'Soft-deletes accounts and revokes sessions. Cannot be undone from the app.',
                    action: () => bulkDeleteUsers.mutate([...selectedUsers]),
                  }),
              },
            ]}
          />
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
            <table className="w-full min-w-[900px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-[var(--color-hairline)] text-[13px] text-[var(--color-ink-tertiary)]">
                  <th className="p-3 font-semibold">
                    <input
                      type="checkbox"
                      aria-label="Select all users"
                      checked={
                        (users.data?.items.length ?? 0) > 0 &&
                        users.data!.items.every((u) => selectedUsers.has(u.id) || u.id === user.id)
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedUsers(
                            new Set(users.data!.items.filter((u) => u.id !== user.id).map((u) => u.id)),
                          );
                        } else setSelectedUsers(new Set());
                      }}
                    />
                  </th>
                  <th className="p-3 font-semibold">User</th>
                  <th className="p-3 font-semibold">Role</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(users.data?.items ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-hairline)] last:border-0">
                    <td className="p-3">
                      {row.id !== user.id && !row.deletedAt ? (
                        <input
                          type="checkbox"
                          checked={selectedUsers.has(row.id)}
                          onChange={() => toggleId(selectedUsers, row.id, selectedUsers, setSelectedUsers)}
                          aria-label={`Select ${row.name}`}
                        />
                      ) : null}
                    </td>
                    <td className="p-3">
                      <p className="font-semibold">{row.name}</p>
                      <p className="text-[13px] text-[var(--color-ink-tertiary)]">
                        {row.email ?? row.phone ?? row.id}
                      </p>
                    </td>
                    <td className="p-3">
                      {row.id === user.id || row.deletedAt ? (
                        <Badge variant={row.role === 'ADMIN' ? 'default' : 'neutral'}>{row.role}</Badge>
                      ) : (
                        <Select
                          aria-label={`Role for ${row.name}`}
                          value={row.role}
                          onChange={(e) => setRole.mutate({ id: row.id, role: e.target.value })}
                          className="h-9 min-w-[120px]"
                        >
                          <option value="USER">USER</option>
                          <option value="MODERATOR">MODERATOR</option>
                          <option value="ADMIN">ADMIN</option>
                        </Select>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {row.deletedAt ? <Badge variant="neutral">Deleted</Badge> : null}
                        {row.suspendedAt ? <Badge variant="danger">Suspended</Badge> : null}
                        {row.shadowBannedAt ? <Badge variant="warning">Shadow banned</Badge> : null}
                        {!row.deletedAt && !row.suspendedAt && !row.shadowBannedAt ? (
                          <Badge variant="success">Active</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3">
                      {!row.deletedAt && row.id !== user.id ? (
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            size="sm"
                            variant={row.suspendedAt ? 'secondary' : 'destructive'}
                            onClick={() =>
                              suspend.mutate({ id: row.id, suspendUser: !row.suspendedAt })
                            }
                          >
                            {row.suspendedAt ? 'Unsuspend' : 'Ban'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              shadowBan.mutate({ id: row.id, ban: !row.shadowBannedAt })
                            }
                          >
                            {row.shadowBannedAt ? 'Un-shadow' : 'Shadow ban'}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              setConfirm({
                                title: `Delete ${row.name}?`,
                                description: 'Soft-deletes the account and revokes sessions.',
                                action: () => deleteUser.mutate(row.id),
                              })
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="communities" className="space-y-4">
          <Input
            placeholder="Search communities…"
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
            className="max-w-sm"
          />
          <BulkBar
            count={selectedGroups.size}
            onClear={() => setSelectedGroups(new Set())}
            actions={[
              {
                label: 'Delete selected',
                loading: bulkDeleteGroups.isPending,
                onClick: () =>
                  setConfirm({
                    title: `Delete ${selectedGroups.size} communities?`,
                    description: 'Soft-deletes communities so they leave discovery.',
                    action: () => bulkDeleteGroups.mutate([...selectedGroups]),
                  }),
              },
            ]}
          />
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
            <table className="w-full min-w-[720px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-[var(--color-hairline)] text-[13px] text-[var(--color-ink-tertiary)]">
                  <th className="p-3 font-semibold" />
                  <th className="p-3 font-semibold">Community</th>
                  <th className="p-3 font-semibold">Owner</th>
                  <th className="p-3 font-semibold">Members</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(groups.data?.items ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-hairline)] last:border-0">
                    <td className="p-3">
                      {!row.deletedAt ? (
                        <input
                          type="checkbox"
                          checked={selectedGroups.has(row.id)}
                          onChange={() => toggleId(selectedGroups, row.id, selectedGroups, setSelectedGroups)}
                          aria-label={`Select ${row.name}`}
                        />
                      ) : null}
                    </td>
                    <td className="p-3">
                      <p className="font-semibold">{row.name}</p>
                      <p className="text-[13px] text-[var(--color-ink-tertiary)]">{row.category}</p>
                    </td>
                    <td className="p-3 text-[var(--color-ink-secondary)]">{row.owner.name}</td>
                    <td className="p-3">{row.memberCount}</td>
                    <td className="p-3">
                      {row.deletedAt ? (
                        <Badge variant="neutral">Deleted</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </td>
                    <td className="p-3">
                      {!row.deletedAt ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            setConfirm({
                              title: `Delete ${row.name}?`,
                              description: 'Removes the community from discovery.',
                              action: () => deleteGroup.mutate(row.id),
                            })
                          }
                        >
                          Delete
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="events" className="space-y-4">
          <Input
            placeholder="Search events…"
            value={eventSearch}
            onChange={(e) => setEventSearch(e.target.value)}
            className="max-w-sm"
          />
          <BulkBar
            count={selectedEvents.size}
            onClear={() => setSelectedEvents(new Set())}
            actions={[
              {
                label: 'Cancel selected',
                loading: bulkCancelEvents.isPending,
                onClick: () =>
                  setConfirm({
                    title: `Cancel ${selectedEvents.size} events?`,
                    description: 'Marks events as cancelled. They remain under Cancelled.',
                    action: () => bulkCancelEvents.mutate([...selectedEvents]),
                  }),
              },
            ]}
          />
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
            <table className="w-full min-w-[720px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-[var(--color-hairline)] text-[13px] text-[var(--color-ink-tertiary)]">
                  <th className="p-3 font-semibold" />
                  <th className="p-3 font-semibold">Event</th>
                  <th className="p-3 font-semibold">Host</th>
                  <th className="p-3 font-semibold">When</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(events.data?.items ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-hairline)] last:border-0">
                    <td className="p-3">
                      {row.status !== 'CANCELLED' ? (
                        <input
                          type="checkbox"
                          checked={selectedEvents.has(row.id)}
                          onChange={() => toggleId(selectedEvents, row.id, selectedEvents, setSelectedEvents)}
                          aria-label={`Select ${row.title}`}
                        />
                      ) : null}
                    </td>
                    <td className="p-3">
                      <p className="font-semibold">{row.title}</p>
                      <p className="text-[13px] text-[var(--color-ink-tertiary)]">{row.group.name}</p>
                    </td>
                    <td className="p-3 text-[var(--color-ink-secondary)]">{row.host.name}</td>
                    <td className="p-3 text-[var(--color-ink-secondary)]">
                      {formatDate(row.startTime, { year: 'numeric' })}
                    </td>
                    <td className="p-3">
                      <Badge
                        variant={
                          row.status === 'CANCELLED'
                            ? 'danger'
                            : row.status === 'PUBLISHED'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {row.status}
                      </Badge>
                    </td>
                    <td className="p-3">
                      {row.status !== 'CANCELLED' ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            setConfirm({
                              title: `Cancel ${row.title}?`,
                              description: 'Cancels the event for all attendees.',
                              action: () => cancelEvent.mutate(row.id),
                            })
                          }
                        >
                          Cancel
                        </Button>
                      ) : null}
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
              No open reports.
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
                  {report.details ? (
                    <p className="mt-2 text-[14px] text-[var(--color-ink-secondary)]">{report.details}</p>
                  ) : null}
                  <p className="mt-1 text-[12px] text-[var(--color-ink-tertiary)]">
                    Target: {report.targetId}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        resolveReport.mutate({ id: report.id, dismiss: false, takedown: true })
                      }
                    >
                      Remove content
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        resolveReport.mutate({ id: report.id, dismiss: false, takedown: false })
                      }
                    >
                      Resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        resolveReport.mutate({ id: report.id, dismiss: true, takedown: false })
                      }
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="audit">
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-[var(--color-hairline)] text-[13px] text-[var(--color-ink-tertiary)]">
                  <th className="p-4 font-semibold">When</th>
                  <th className="p-4 font-semibold">Actor</th>
                  <th className="p-4 font-semibold">Action</th>
                  <th className="p-4 font-semibold">Target</th>
                </tr>
              </thead>
              <tbody>
                {(auditLogs.data?.items ?? []).map((log) => (
                  <tr key={log.id} className="border-b border-[var(--color-hairline)] last:border-0">
                    <td className="p-4 text-[var(--color-ink-secondary)]">
                      {formatRelative(log.createdAt)}
                    </td>
                    <td className="p-4">{log.actor?.name ?? 'System'}</td>
                    <td className="p-4 font-semibold">{log.action}</td>
                    <td className="p-4 text-[13px] text-[var(--color-ink-tertiary)]">
                      {log.targetType ? `${log.targetType} ${log.targetId ?? ''}`.trim() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={confirm != null} onOpenChange={(open) => !open && setConfirm(null)}>
        {confirm ? (
          <DialogContent title={confirm.title} description={confirm.description}>
            <div className="flex gap-3">
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  confirm.action();
                  setConfirm(null);
                }}
              >
                Confirm
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

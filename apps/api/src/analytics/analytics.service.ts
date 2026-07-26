import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface RetentionCohort {
  cohortWeek: string;
  cohortSize: number;
  /** Percentage of the cohort active in weeks 1–4 after signup. */
  weeks: number[];
}

export interface AttendanceStat {
  eventId: string;
  title: string;
  startTime: Date;
  capacity: number | null;
  goingCount: number;
  attendanceRate: number | null;
}

/**
 * Platform analytics computed from the activity log. Aggregations run as
 * raw SQL group-bys — at larger scale these become materialized views or
 * roll-up tables refreshed on a schedule, with the same service interface.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dailyActiveUsers(days = 30): Promise<TimeSeriesPoint[]> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>(
      Prisma.sql`
        SELECT date_trunc('day', "createdAt") AS day, count(DISTINCT "userId") AS count
        FROM "activity_logs"
        WHERE "createdAt" >= now() - make_interval(days => ${days})
        GROUP BY 1 ORDER BY 1
      `,
    );
    return this.fillDays(rows, days);
  }

  async monthlyActiveUsers(months = 12): Promise<TimeSeriesPoint[]> {
    const rows = await this.prisma.$queryRaw<Array<{ month: Date; count: bigint }>>(
      Prisma.sql`
        SELECT date_trunc('month', "createdAt") AS month, count(DISTINCT "userId") AS count
        FROM "activity_logs"
        WHERE "createdAt" >= now() - make_interval(months => ${months})
        GROUP BY 1 ORDER BY 1
      `,
    );
    return rows.map((r) => ({ date: r.month.toISOString().slice(0, 7), value: Number(r.count) }));
  }

  async signupGrowth(days = 30): Promise<TimeSeriesPoint[]> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>(
      Prisma.sql`
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS count
        FROM "users"
        WHERE "createdAt" >= now() - make_interval(days => ${days})
        GROUP BY 1 ORDER BY 1
      `,
    );
    return this.fillDays(rows, days);
  }

  async weeklyRetention(weeks = 8): Promise<RetentionCohort[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ cohort: Date; offset_weeks: number; users: bigint }>
    >(
      Prisma.sql`
        WITH cohorts AS (
          SELECT id, date_trunc('week', "createdAt") AS cohort
          FROM "users"
          WHERE "createdAt" >= now() - make_interval(weeks => ${weeks})
        ),
        activity AS (
          SELECT DISTINCT "userId", date_trunc('week', "createdAt") AS active_week
          FROM "activity_logs"
        )
        SELECT
          c.cohort,
          floor(extract(epoch FROM (a.active_week - c.cohort)) / 604800)::int AS offset_weeks,
          count(DISTINCT c.id) AS users
        FROM cohorts c
        JOIN activity a ON a."userId" = c.id
        WHERE a.active_week >= c.cohort
        GROUP BY 1, 2 ORDER BY 1, 2
      `,
    );

    const cohortMap = new Map<string, { size: number; weeks: number[] }>();
    for (const row of rows) {
      const key = row.cohort.toISOString().slice(0, 10);
      if (!cohortMap.has(key)) cohortMap.set(key, { size: 0, weeks: [0, 0, 0, 0] });
      const cohort = cohortMap.get(key)!;
      if (row.offset_weeks === 0) {
        cohort.size = Number(row.users);
      } else if (row.offset_weeks >= 1 && row.offset_weeks <= 4) {
        cohort.weeks[row.offset_weeks - 1] = Number(row.users);
      }
    }

    return [...cohortMap.entries()].map(([cohortWeek, data]) => ({
      cohortWeek,
      cohortSize: data.size,
      weeks: data.weeks.map((w) => (data.size > 0 ? Math.round((w / data.size) * 100) : 0)),
    }));
  }

  async eventAttendance(limit = 20): Promise<AttendanceStat[]> {
    const rows = await this.prisma.event.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { startTime: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        startTime: true,
        capacity: true,
        _count: { select: { rsvps: { where: { status: 'GOING' } } } },
      },
    });
    return rows.map((e) => ({
      eventId: e.id,
      title: e.title,
      startTime: e.startTime,
      capacity: e.capacity,
      goingCount: e._count.rsvps,
      attendanceRate:
        e.capacity !== null ? Math.round((e._count.rsvps / e.capacity) * 100) : null,
    }));
  }

  async overview() {
    const [totalUsers, totalGroups, totalEvents, totalRsvps, totalMessages, dauRow, mauRow] =
      await Promise.all([
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.group.count({ where: { deletedAt: null } }),
        this.prisma.event.count(),
        this.prisma.rsvp.count(),
        this.prisma.message.count({ where: { deletedAt: null } }),
        this.prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT count(DISTINCT "userId") AS count FROM "activity_logs" WHERE "createdAt" >= now() - interval '1 day'`,
        ),
        this.prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT count(DISTINCT "userId") AS count FROM "activity_logs" WHERE "createdAt" >= now() - interval '30 days'`,
        ),
      ]);

    return {
      totalUsers,
      totalGroups,
      totalEvents,
      totalRsvps,
      totalMessages,
      dau: Number(dauRow[0]?.count ?? 0),
      mau: Number(mauRow[0]?.count ?? 0),
    };
  }

  private fillDays(rows: Array<{ day: Date; count: bigint }>, days: number): TimeSeriesPoint[] {
    const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));
    const result: TimeSeriesPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      result.push({ date, value: byDay.get(date) ?? 0 });
    }
    return result;
  }
}

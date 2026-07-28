import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EventSearchHit,
  GroupSearchHit,
  SearchFilters,
  SearchProvider,
  UserSearchHit,
} from './search-provider.interface';

/**
 * PostgreSQL full-text search implementation. Expressions must mirror the GIN
 * indexes created in the fts_indexes migration so the planner can use them.
 * All values are bound parameters (Prisma.sql) — no string interpolation.
 */
@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  constructor(private readonly prisma: PrismaService) {}

  async searchGroups(f: SearchFilters): Promise<GroupSearchHit[]> {
    const distanceExpr = this.distanceExpr(f);
    const orderBy = this.orderClause(f, 'g."memberCount" DESC', 'g."createdAt" DESC');

    const rows = await this.prisma.$queryRaw<Array<GroupSearchHit & { distancekm: number | null }>>(
      Prisma.sql`
        SELECT
          g.id, g.slug, g.name, g.description, g."coverImage", g.category,
          g."memberCount", g.location,
          ${distanceExpr('g')} AS distancekm,
          ts_rank(
            to_tsvector('english', g."name" || ' ' || g."description" || ' ' || coalesce(g."location", '')),
            websearch_to_tsquery('english', ${f.query})
          ) AS rank
        FROM "groups" g
        WHERE g."deletedAt" IS NULL
          AND g.privacy <> 'HIDDEN'
          AND to_tsvector('english', g."name" || ' ' || g."description" || ' ' || coalesce(g."location", ''))
              @@ websearch_to_tsquery('english', ${f.query})
          ${f.category ? Prisma.sql`AND g.category = ${f.category}::"GroupCategory"` : Prisma.empty}
          ${this.radiusClause(f, 'g')}
        ORDER BY ${orderBy}
        LIMIT ${f.limit} OFFSET ${f.offset}
      `,
    );
    return rows.map(({ distancekm, ...r }) => ({
      ...r,
      distanceKm: this.round(distancekm),
      rank: Number(r.rank),
    }));
  }

  async searchEvents(f: SearchFilters): Promise<EventSearchHit[]> {
    const distanceExpr = this.distanceExpr(f);
    const orderBy = this.orderClause(f, 'goingcount DESC', 'e."startTime" ASC');

    const rows = await this.prisma.$queryRaw<
      Array<EventSearchHit & { distancekm: number | null; goingcount: bigint; groupname: string; groupslug: string }>
    >(
      Prisma.sql`
        SELECT
          e.id, e.title, e.description, e."coverImage", e.mode, e."locationName",
          e."startTime", e."endTime", e."groupId",
          g.name AS groupname, g.slug AS groupslug,
          (SELECT count(*) FROM "rsvps" r WHERE r."eventId" = e.id AND r.status = 'GOING') AS goingcount,
          ${distanceExpr('e')} AS distancekm,
          ts_rank(
            to_tsvector('english', e."title" || ' ' || e."description" || ' ' || coalesce(e."locationName", '')),
            websearch_to_tsquery('english', ${f.query})
          ) AS rank
        FROM "events" e
        JOIN "groups" g ON g.id = e."groupId"
        WHERE e.status = 'PUBLISHED'
          AND e.visibility = 'PUBLIC'
          AND g."deletedAt" IS NULL
          AND g.privacy <> 'HIDDEN'
          AND e."startTime" >= ${f.from ?? new Date()}
          ${f.to ? Prisma.sql`AND e."startTime" <= ${f.to}` : Prisma.empty}
          AND to_tsvector('english', e."title" || ' ' || e."description" || ' ' || coalesce(e."locationName", ''))
              @@ websearch_to_tsquery('english', ${f.query})
          ${f.category ? Prisma.sql`AND g.category = ${f.category}::"GroupCategory"` : Prisma.empty}
          ${this.radiusClause(f, 'e')}
        ORDER BY ${orderBy}
        LIMIT ${f.limit} OFFSET ${f.offset}
      `,
    );
    return rows.map(({ distancekm, goingcount, groupname, groupslug, ...r }) => ({
      ...r,
      groupName: groupname,
      groupSlug: groupslug,
      goingCount: Number(goingcount),
      distanceKm: this.round(distancekm),
      rank: Number(r.rank),
    }));
  }

  async searchUsers(f: SearchFilters): Promise<UserSearchHit[]> {
    // Names are short strings — trigram similarity beats tsvector here.
    return this.prisma.$queryRaw<UserSearchHit[]>(
      Prisma.sql`
        SELECT u.id, u.name, u."avatarUrl", u.location, u.bio
        FROM "users" u
        WHERE u."deletedAt" IS NULL
          AND u."suspendedAt" IS NULL
          AND u."shadowBannedAt" IS NULL
          AND u.name % ${f.query}
        ORDER BY similarity(u.name, ${f.query}) DESC
        LIMIT ${f.limit} OFFSET ${f.offset}
      `,
    );
  }

  private distanceExpr(f: SearchFilters) {
    return (alias: string) =>
      f.lat !== undefined && f.lng !== undefined
        ? Prisma.sql`(2 * 6371 * asin(sqrt(
            power(sin(radians((${Prisma.raw(alias)}."latitude" - ${f.lat}) / 2)), 2) +
            cos(radians(${f.lat})) * cos(radians(${Prisma.raw(alias)}."latitude")) *
            power(sin(radians((${Prisma.raw(alias)}."longitude" - ${f.lng}) / 2)), 2)
          )))`
        : Prisma.sql`NULL::float`;
  }

  private radiusClause(f: SearchFilters, alias: string) {
    if (f.lat === undefined || f.lng === undefined || f.radiusKm === undefined) {
      return Prisma.empty;
    }
    return Prisma.sql`
      AND ${Prisma.raw(alias)}."latitude" IS NOT NULL
      AND (2 * 6371 * asin(sqrt(
        power(sin(radians((${Prisma.raw(alias)}."latitude" - ${f.lat}) / 2)), 2) +
        cos(radians(${f.lat})) * cos(radians(${Prisma.raw(alias)}."latitude")) *
        power(sin(radians((${Prisma.raw(alias)}."longitude" - ${f.lng}) / 2)), 2)
      ))) <= ${f.radiusKm}
    `;
  }

  private orderClause(f: SearchFilters, popularitySql: string, dateSql: string) {
    switch (f.sort) {
      case 'popularity':
        return Prisma.raw(popularitySql);
      case 'date':
        return Prisma.raw(dateSql);
      case 'distance':
        return Prisma.raw('distancekm ASC NULLS LAST');
      default:
        return Prisma.raw('rank DESC');
    }
  }

  private round(value: number | null): number | null {
    return value === null ? null : Math.round(value * 10) / 10;
  }
}

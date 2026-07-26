import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/** Append-only audit trail for security-sensitive operations. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: entry.ip,
        },
      });
    } catch (err) {
      // Auditing must never take down the primary operation.
      this.logger.error(`Failed to write audit log for ${entry.action}`, err as Error);
    }
  }
}

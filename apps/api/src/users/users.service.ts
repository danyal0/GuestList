import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateUserDto } from './dto/user.dto';
import { Paginated, paginate } from '../common/dto/pagination.dto';
import { isPlausiblePhone, normalizePhoneDigits } from '../common/utils/phone';

/** Fields safe to expose on any user object returned to other users. */
export const publicUserSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  bio: true,
  location: true,
  interests: true,
  skills: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUserSummary = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findPublicById(id: string): Promise<PublicUserSummary> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: publicUserSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: string, dto: UpdateUserDto): Promise<User> {
    let phone: string | undefined;
    if (dto.phone !== undefined) {
      const normalized = normalizePhoneDigits(dto.phone);
      if (!normalized || !isPlausiblePhone(normalized)) {
        throw new BadRequestException('Enter a valid phone number');
      }
      const taken = await this.prisma.user.findFirst({
        where: { phone: normalized, NOT: { id: userId } },
      });
      if (taken) throw new ConflictException('That phone number is already in use');
      phone = normalized;
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        bio: dto.bio,
        location: dto.location,
        latitude: dto.latitude,
        longitude: dto.longitude,
        avatarUrl: dto.avatarUrl,
        interests: dto.interests,
        skills: dto.skills,
        ...(phone !== undefined ? { phone } : {}),
      },
    });
    await this.prisma.activityLog.create({
      data: { userId, type: ActivityType.PROFILE_UPDATED },
    });
    return user;
  }

  async deleteMe(userId: string): Promise<void> {
    // Soft delete: anonymize PII, keep referential integrity for content.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          email: `deleted-${userId}@deleted.mkeplays.app`,
          name: 'Deleted member',
          avatarUrl: null,
          bio: null,
          location: null,
          latitude: null,
          longitude: null,
          phone: null,
          whatsappLid: null,
          passwordHash: null,
          googleId: null,
          appleId: null,
          interests: [],
          skills: [],
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.auditService.log({ actorId: userId, action: 'user.self_delete' });
  }

  async getActivity(
    userId: string,
    page: number,
    limit: number,
  ): Promise<Paginated<{ id: string; type: ActivityType; metadata: unknown; createdAt: Date }>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.activityLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, type: true, metadata: true, createdAt: true },
      }),
      this.prisma.activityLog.count({ where: { userId } }),
    ]);
    return paginate(items, total, page, limit);
  }
}

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupMember, GroupMemberRole, GroupMemberStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Community role hierarchy. Higher ranks inherit all lower-rank permissions:
 *   OWNER     — delete community, transfer ownership
 *   ADMIN     — manage members, edit details, create events
 *   MODERATOR — remove posts, moderate users
 *   MEMBER    — participate
 */
const ROLE_RANK: Record<GroupMemberRole, number> = {
  [GroupMemberRole.OWNER]: 3,
  [GroupMemberRole.ADMIN]: 2,
  [GroupMemberRole.MODERATOR]: 1,
  [GroupMemberRole.MEMBER]: 0,
};

@Injectable()
export class GroupPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  rank(role: GroupMemberRole): number {
    return ROLE_RANK[role];
  }

  async getActiveMembership(groupId: string, userId: string): Promise<GroupMember | null> {
    return this.prisma.groupMember.findFirst({
      where: { groupId, userId, status: GroupMemberStatus.ACTIVE },
    });
  }

  /** Asserts the user holds at least `minimumRole` in the group. */
  async requireRole(
    groupId: string,
    userId: string,
    minimumRole: GroupMemberRole,
  ): Promise<GroupMember> {
    const membership = await this.getActiveMembership(groupId, userId);
    if (!membership) {
      throw new ForbiddenException('You are not a member of this community');
    }
    if (ROLE_RANK[membership.role] < ROLE_RANK[minimumRole]) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return membership;
  }

  /** Asserts `actor` outranks `target` — moderation always flows downward. */
  assertOutranks(actor: GroupMember, target: GroupMember): void {
    if (ROLE_RANK[actor.role] <= ROLE_RANK[target.role]) {
      throw new ForbiddenException('You cannot moderate a member with an equal or higher role');
    }
  }

  async requireVisibleGroup(groupIdOrSlug: string, userId?: string) {
    const group = await this.prisma.group.findFirst({
      where: {
        OR: [{ id: groupIdOrSlug }, { slug: groupIdOrSlug }],
        deletedAt: null,
      },
    });
    if (!group) throw new NotFoundException('Community not found');

    if (group.privacy === 'HIDDEN' && userId) {
      const membership = await this.getActiveMembership(group.id, userId);
      if (!membership) throw new NotFoundException('Community not found');
    } else if (group.privacy === 'HIDDEN' && !userId) {
      throw new NotFoundException('Community not found');
    }
    return group;
  }
}

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupMember, GroupMemberRole } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { GroupPermissionsService } from './group-permissions.service';

function member(role: GroupMemberRole): GroupMember {
  return {
    id: `gm_${role}`,
    groupId: 'grp_1',
    userId: `usr_${role}`,
    role,
    status: 'ACTIVE',
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as GroupMember;
}

describe('GroupPermissionsService', () => {
  let service: GroupPermissionsService;
  let prisma: {
    groupMember: { findFirst: jest.Mock };
    group: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      groupMember: { findFirst: jest.fn() },
      group: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [GroupPermissionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(GroupPermissionsService);
  });

  describe('role hierarchy', () => {
    it('ranks OWNER > ADMIN > MODERATOR > MEMBER', () => {
      expect(service.rank('OWNER')).toBeGreaterThan(service.rank('ADMIN'));
      expect(service.rank('ADMIN')).toBeGreaterThan(service.rank('MODERATOR'));
      expect(service.rank('MODERATOR')).toBeGreaterThan(service.rank('MEMBER'));
    });
  });

  describe('requireRole', () => {
    it('rejects non-members', async () => {
      prisma.groupMember.findFirst.mockResolvedValue(null);
      await expect(service.requireRole('grp_1', 'usr_1', 'MEMBER')).rejects.toThrow(
        'You are not a member of this community',
      );
    });

    it('rejects members below the minimum role', async () => {
      prisma.groupMember.findFirst.mockResolvedValue(member('MEMBER'));
      await expect(service.requireRole('grp_1', 'usr_1', 'ADMIN')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows a role equal to the minimum', async () => {
      prisma.groupMember.findFirst.mockResolvedValue(member('MODERATOR'));
      await expect(service.requireRole('grp_1', 'usr_1', 'MODERATOR')).resolves.toMatchObject({
        role: 'MODERATOR',
      });
    });

    it('allows higher roles (inheritance)', async () => {
      prisma.groupMember.findFirst.mockResolvedValue(member('OWNER'));
      await expect(service.requireRole('grp_1', 'usr_1', 'MEMBER')).resolves.toMatchObject({
        role: 'OWNER',
      });
    });
  });

  describe('assertOutranks', () => {
    it('allows moderating a lower role', () => {
      expect(() => service.assertOutranks(member('ADMIN'), member('MEMBER'))).not.toThrow();
    });

    it('rejects moderating an equal role', () => {
      expect(() => service.assertOutranks(member('ADMIN'), member('ADMIN'))).toThrow(
        ForbiddenException,
      );
    });

    it('rejects moderating a higher role', () => {
      expect(() => service.assertOutranks(member('MODERATOR'), member('OWNER'))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('requireVisibleGroup', () => {
    it('404s for missing groups', async () => {
      prisma.group.findFirst.mockResolvedValue(null);
      await expect(service.requireVisibleGroup('nope')).rejects.toThrow(NotFoundException);
    });

    it('404s hidden groups for anonymous viewers (no existence leak)', async () => {
      prisma.group.findFirst.mockResolvedValue({ id: 'grp_1', privacy: 'HIDDEN' });
      await expect(service.requireVisibleGroup('grp_1')).rejects.toThrow(NotFoundException);
    });

    it('404s hidden groups for authenticated non-members', async () => {
      prisma.group.findFirst.mockResolvedValue({ id: 'grp_1', privacy: 'HIDDEN' });
      prisma.groupMember.findFirst.mockResolvedValue(null);
      await expect(service.requireVisibleGroup('grp_1', 'usr_1')).rejects.toThrow(NotFoundException);
    });

    it('reveals hidden groups to active members', async () => {
      prisma.group.findFirst.mockResolvedValue({ id: 'grp_1', privacy: 'HIDDEN' });
      prisma.groupMember.findFirst.mockResolvedValue(member('MEMBER'));
      await expect(service.requireVisibleGroup('grp_1', 'usr_1')).resolves.toMatchObject({
        id: 'grp_1',
      });
    });

    it('returns public groups to anyone', async () => {
      prisma.group.findFirst.mockResolvedValue({ id: 'grp_1', privacy: 'PUBLIC' });
      await expect(service.requireVisibleGroup('grp_1')).resolves.toMatchObject({ id: 'grp_1' });
    });
  });
});

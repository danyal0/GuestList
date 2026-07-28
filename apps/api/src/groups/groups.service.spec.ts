import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { GroupMemberRole, GroupMemberStatus, GroupPrivacy } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { GroupPermissionsService } from './group-permissions.service';
import { GroupsService } from './groups.service';

describe('GroupsService.create', () => {
  let service: GroupsService;
  let groupCreate: jest.Mock;
  let memberCreate: jest.Mock;

  beforeEach(async () => {
    groupCreate = jest.fn().mockResolvedValue({
      id: 'grp_1',
      slug: 'trail-club-abc',
      name: 'Trail Club',
      memberCount: 1,
    });
    memberCreate = jest.fn().mockResolvedValue({});

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          group: { create: groupCreate },
          groupMember: { create: memberCreate },
          activityLog: { create: jest.fn().mockResolvedValue({}) },
        }),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: PrismaService, useValue: prisma },
        { provide: GroupPermissionsService, useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(GroupsService);
  });

  it('sets memberCount to 1 when creating a community', async () => {
    await service.create('usr_owner', {
      name: 'Trail Club',
      description: 'We hike',
      category: 'OUTDOORS',
      privacy: GroupPrivacy.PUBLIC,
    } as never);

    expect(groupCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          memberCount: 1,
          ownerId: 'usr_owner',
          privacy: GroupPrivacy.PUBLIC,
        }),
      }),
    );
    expect(memberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          groupId: 'grp_1',
          userId: 'usr_owner',
          role: GroupMemberRole.OWNER,
          status: GroupMemberStatus.ACTIVE,
        }),
      }),
    );
  });
});

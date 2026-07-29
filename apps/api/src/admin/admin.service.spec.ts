import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventStatus, GroupMemberRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;
  let auditLog: jest.Mock;
  let userFindUnique: jest.Mock;
  let userUpdate: jest.Mock;
  let userDelete: jest.Mock;
  let refreshUpdateMany: jest.Mock;
  let groupFindUnique: jest.Mock;
  let groupUpdate: jest.Mock;
  let groupDelete: jest.Mock;
  let groupFindMany: jest.Mock;
  let eventFindUnique: jest.Mock;
  let eventUpdate: jest.Mock;
  let eventDelete: jest.Mock;
  let eventDeleteMany: jest.Mock;
  let groupMemberFindUnique: jest.Mock;
  let groupMemberFindMany: jest.Mock;
  let groupMemberUpdate: jest.Mock;
  let groupMemberCreate: jest.Mock;
  let groupMemberUpdateMany: jest.Mock;
  let messageDeleteMany: jest.Mock;
  let paymentDeleteMany: jest.Mock;
  let reportUpdateMany: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    auditLog = jest.fn().mockResolvedValue({});
    userFindUnique = jest.fn();
    userUpdate = jest.fn().mockResolvedValue({});
    userDelete = jest.fn().mockResolvedValue({});
    refreshUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    groupFindUnique = jest.fn();
    groupUpdate = jest.fn().mockResolvedValue({});
    groupDelete = jest.fn().mockResolvedValue({});
    groupFindMany = jest.fn().mockResolvedValue([]);
    eventFindUnique = jest.fn();
    eventUpdate = jest.fn().mockResolvedValue({});
    eventDelete = jest.fn().mockResolvedValue({});
    eventDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    groupMemberFindUnique = jest.fn();
    groupMemberFindMany = jest.fn().mockResolvedValue([]);
    groupMemberUpdate = jest.fn().mockResolvedValue({});
    groupMemberCreate = jest.fn().mockResolvedValue({});
    groupMemberUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    messageDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    paymentDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    reportUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    transaction = jest.fn(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      if (typeof ops === 'function') {
        return ops({
          group: {
            findMany: groupFindMany,
            delete: groupDelete,
            update: groupUpdate,
          },
          event: { deleteMany: eventDeleteMany },
          message: { deleteMany: messageDeleteMany },
          payment: { deleteMany: paymentDeleteMany },
          report: { updateMany: reportUpdateMany },
          user: { delete: userDelete },
          groupMember: {
            updateMany: groupMemberUpdateMany,
            update: groupMemberUpdate,
            create: groupMemberCreate,
          },
        });
      }
      return ops;
    });

    const prisma = {
      $transaction: transaction,
      user: {
        findUnique: userFindUnique,
        update: userUpdate,
        delete: userDelete,
        count: jest.fn().mockResolvedValue(0),
      },
      refreshToken: { updateMany: refreshUpdateMany },
      group: {
        findUnique: groupFindUnique,
        update: groupUpdate,
        delete: groupDelete,
        findMany: groupFindMany,
        count: jest.fn().mockResolvedValue(0),
      },
      groupMember: {
        findUnique: groupMemberFindUnique,
        findMany: groupMemberFindMany,
        update: groupMemberUpdate,
        create: groupMemberCreate,
        updateMany: groupMemberUpdateMany,
      },
      event: {
        findUnique: eventFindUnique,
        update: eventUpdate,
        delete: eventDelete,
        deleteMany: eventDeleteMany,
        count: jest.fn().mockResolvedValue(0),
      },
      message: { deleteMany: messageDeleteMany, count: jest.fn().mockResolvedValue(0) },
      payment: { deleteMany: paymentDeleteMany },
      report: { count: jest.fn().mockResolvedValue(0), updateMany: reportUpdateMany },
      friendship: { count: jest.fn().mockResolvedValue(0) },
      rsvp: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { findMany: jest.fn(), count: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: auditLog } },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  describe('setUserShadowBan', () => {
    it('sets shadowBannedAt and audits', async () => {
      userFindUnique.mockResolvedValue({ id: 'u1', deletedAt: null });
      await service.setUserShadowBan('admin1', 'u1', true);
      expect(userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ shadowBannedAt: expect.any(Date) }),
        }),
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.user_shadow_ban', targetId: 'u1' }),
      );
    });

    it('rejects self shadow-ban', async () => {
      await expect(service.setUserShadowBan('admin1', 'admin1', true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('softDeleteUser', () => {
    it('anonymizes user and revokes tokens', async () => {
      userFindUnique.mockResolvedValue({ id: 'u1', deletedAt: null });
      await service.softDeleteUser('admin1', 'u1');
      expect(transaction).toHaveBeenCalled();
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.user_delete', targetId: 'u1' }),
      );
    });

    it('rejects deleting self', async () => {
      await expect(service.softDeleteUser('admin1', 'admin1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects missing user', async () => {
      userFindUnique.mockResolvedValue(null);
      await expect(service.softDeleteUser('admin1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cancelEvent', () => {
    it('cancels a published event', async () => {
      eventFindUnique.mockResolvedValue({ id: 'e1', status: EventStatus.PUBLISHED });
      await service.cancelEvent('admin1', 'e1');
      expect(eventUpdate).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: EventStatus.CANCELLED },
      });
    });

    it('rejects already cancelled', async () => {
      eventFindUnique.mockResolvedValue({ id: 'e1', status: EventStatus.CANCELLED });
      await expect(service.cancelEvent('admin1', 'e1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('bulkSoftDeleteUsers', () => {
    it('deletes eligible users and skips self', async () => {
      userFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, deletedAt: null }),
      );
      const result = await service.bulkSoftDeleteUsers('admin1', ['u1', 'admin1', 'u2']);
      expect(result.deleted).toBe(2);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.bulk_user_delete' }),
      );
    });
  });

  describe('bulkCancelEvents', () => {
    it('cancels multiple events', async () => {
      eventFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, status: EventStatus.PUBLISHED }),
      );
      const result = await service.bulkCancelEvents('admin1', ['e1', 'e2']);
      expect(result.cancelled).toBe(2);
    });
  });

  describe('removeGroup', () => {
    it('soft-deletes a community', async () => {
      groupFindUnique.mockResolvedValue({ id: 'g1', deletedAt: null });
      await service.removeGroup('admin1', 'g1');
      expect(groupUpdate).toHaveBeenCalledWith({
        where: { id: 'g1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });

  describe('hardDeleteUser', () => {
    it('permanently deletes a user and dependents', async () => {
      userFindUnique.mockResolvedValue({
        id: 'u1',
        name: 'Pat',
        email: 'pat@example.com',
        phone: null,
      });
      groupFindMany.mockResolvedValue([{ id: 'g1' }]);
      await service.hardDeleteUser('admin1', 'u1');
      expect(groupDelete).toHaveBeenCalledWith({ where: { id: 'g1' } });
      expect(eventDeleteMany).toHaveBeenCalledWith({ where: { hostId: 'u1' } });
      expect(userDelete).toHaveBeenCalledWith({ where: { id: 'u1' } });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.user_hard_delete', targetId: 'u1' }),
      );
    });

    it('rejects deleting self', async () => {
      await expect(service.hardDeleteUser('admin1', 'admin1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('hardDeleteGroup', () => {
    it('permanently deletes a community', async () => {
      groupFindUnique.mockResolvedValue({ id: 'g1', name: 'Court A', slug: 'court-a' });
      await service.hardDeleteGroup('admin1', 'g1');
      expect(groupDelete).toHaveBeenCalledWith({ where: { id: 'g1' } });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.group_hard_delete', targetId: 'g1' }),
      );
    });
  });

  describe('hardDeleteEvent', () => {
    it('permanently deletes an event', async () => {
      eventFindUnique.mockResolvedValue({
        id: 'e1',
        title: 'Pickup',
        status: EventStatus.CANCELLED,
      });
      await service.hardDeleteEvent('admin1', 'e1');
      expect(eventDelete).toHaveBeenCalledWith({ where: { id: 'e1' } });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.event_hard_delete', targetId: 'e1' }),
      );
    });
  });

  describe('setGroupMemberRole', () => {
    it('updates an existing member role', async () => {
      groupFindUnique.mockResolvedValue({ id: 'g1', ownerId: 'owner1', deletedAt: null });
      userFindUnique.mockResolvedValue({ id: 'u1', deletedAt: null });
      groupMemberFindUnique.mockResolvedValue({ id: 'm1', role: GroupMemberRole.MEMBER });
      await service.setGroupMemberRole('admin1', 'g1', 'u1', GroupMemberRole.MODERATOR);
      expect(groupMemberUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: expect.objectContaining({ role: GroupMemberRole.MODERATOR }),
        }),
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.group_member_role', targetId: 'g1' }),
      );
    });

    it('creates membership when missing', async () => {
      groupFindUnique.mockResolvedValue({ id: 'g1', ownerId: 'owner1', deletedAt: null });
      userFindUnique.mockResolvedValue({ id: 'u2', deletedAt: null });
      groupMemberFindUnique.mockResolvedValue(null);
      await service.setGroupMemberRole('admin1', 'g1', 'u2', GroupMemberRole.ADMIN);
      expect(groupMemberCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            groupId: 'g1',
            userId: 'u2',
            role: GroupMemberRole.ADMIN,
          }),
        }),
      );
    });

    it('transfers ownership and demotes prior owners', async () => {
      groupFindUnique.mockResolvedValue({ id: 'g1', ownerId: 'owner1', deletedAt: null });
      userFindUnique.mockResolvedValue({ id: 'u2', deletedAt: null });
      groupMemberFindUnique.mockResolvedValue({ id: 'm2', role: GroupMemberRole.ADMIN });
      await service.setGroupMemberRole('admin1', 'g1', 'u2', GroupMemberRole.OWNER);
      expect(groupMemberUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupId: 'g1', role: GroupMemberRole.OWNER },
          data: { role: GroupMemberRole.ADMIN },
        }),
      );
      expect(groupUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'g1' },
          data: { ownerId: 'u2' },
        }),
      );
    });

    it('rejects demoting the current owner without transfer', async () => {
      groupFindUnique.mockResolvedValue({ id: 'g1', ownerId: 'owner1', deletedAt: null });
      userFindUnique.mockResolvedValue({ id: 'owner1', deletedAt: null });
      groupMemberFindUnique.mockResolvedValue({ id: 'm1', role: GroupMemberRole.OWNER });
      await expect(
        service.setGroupMemberRole('admin1', 'g1', 'owner1', GroupMemberRole.ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('detailedStats', () => {
    it('returns nested counts', async () => {
      const stats = await service.detailedStats();
      expect(stats).toEqual(
        expect.objectContaining({
          users: expect.objectContaining({
            total: 0,
            active: 0,
            shadowBanned: 0,
          }),
          events: expect.objectContaining({ published: 0, cancelled: 0 }),
          engagement: expect.objectContaining({ rsvps: 0, messages: 0 }),
        }),
      );
    });
  });
});

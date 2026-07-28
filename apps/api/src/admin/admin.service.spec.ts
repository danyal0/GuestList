import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;
  let auditLog: jest.Mock;
  let userFindUnique: jest.Mock;
  let userUpdate: jest.Mock;
  let refreshUpdateMany: jest.Mock;
  let groupFindUnique: jest.Mock;
  let groupUpdate: jest.Mock;
  let eventFindUnique: jest.Mock;
  let eventUpdate: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    auditLog = jest.fn().mockResolvedValue({});
    userFindUnique = jest.fn();
    userUpdate = jest.fn().mockResolvedValue({});
    refreshUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    groupFindUnique = jest.fn();
    groupUpdate = jest.fn().mockResolvedValue({});
    eventFindUnique = jest.fn();
    eventUpdate = jest.fn().mockResolvedValue({});
    transaction = jest.fn(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops;
    });

    const prisma = {
      $transaction: transaction,
      user: {
        findUnique: userFindUnique,
        update: userUpdate,
        count: jest.fn().mockResolvedValue(0),
      },
      refreshToken: { updateMany: refreshUpdateMany },
      group: {
        findUnique: groupFindUnique,
        update: groupUpdate,
        count: jest.fn().mockResolvedValue(0),
      },
      event: {
        findUnique: eventFindUnique,
        update: eventUpdate,
        count: jest.fn().mockResolvedValue(0),
      },
      report: { count: jest.fn().mockResolvedValue(0) },
      friendship: { count: jest.fn().mockResolvedValue(0) },
      rsvp: { count: jest.fn().mockResolvedValue(0) },
      message: { count: jest.fn().mockResolvedValue(0) },
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

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RsvpStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { GroupPermissionsService } from '../groups/group-permissions.service';
import { RsvpService } from './rsvp.service';

const FUTURE = new Date(Date.now() + 86_400_000);

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_1',
    groupId: 'grp_1',
    title: 'Test Event',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    startTime: FUTURE,
    rsvpDeadline: null,
    capacity: null,
    allowWaitlist: true,
    group: { privacy: 'PUBLIC' },
    ...overrides,
  };
}

describe('RsvpService', () => {
  let service: RsvpService;
  let prisma: {
    event: { findUnique: jest.Mock };
    rsvp: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      groupBy: jest.Mock;
    };
    activityLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let permissions: { getActiveMembership: jest.Mock };
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      event: { findUnique: jest.fn() },
      rsvp: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      // Run the transaction callback against the same mocks.
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    permissions = { getActiveMembership: jest.fn() };
    emitter = { emit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RsvpService,
        { provide: PrismaService, useValue: prisma },
        { provide: GroupPermissionsService, useValue: permissions },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = moduleRef.get(RsvpService);
  });

  describe('setRsvp — validation', () => {
    it('rejects direct WAITLISTED requests', async () => {
      await expect(service.setRsvp('evt_1', 'usr_1', RsvpStatus.WAITLISTED)).rejects.toThrow(
        'Waitlist placement is automatic',
      );
    });

    it('404s for unknown events', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.setRsvp('nope', 'usr_1', RsvpStatus.GOING)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects cancelled events', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ status: 'CANCELLED' }));
      await expect(service.setRsvp('evt_1', 'usr_1', RsvpStatus.GOING)).rejects.toThrow(
        'not open for RSVPs',
      );
    });

    it('rejects events that already started', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ startTime: new Date(Date.now() - 1000) }));
      await expect(service.setRsvp('evt_1', 'usr_1', RsvpStatus.GOING)).rejects.toThrow(
        'already started',
      );
    });

    it('rejects RSVPs after the deadline', async () => {
      prisma.event.findUnique.mockResolvedValue(
        makeEvent({ rsvpDeadline: new Date(Date.now() - 1000) }),
      );
      await expect(service.setRsvp('evt_1', 'usr_1', RsvpStatus.GOING)).rejects.toThrow(
        'deadline has passed',
      );
    });

    it('requires membership for members-only events', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ visibility: 'MEMBERS' }));
      permissions.getActiveMembership.mockResolvedValue(null);
      await expect(service.setRsvp('evt_1', 'usr_1', RsvpStatus.GOING)).rejects.toThrow(
        'community members only',
      );
    });
  });

  describe('setRsvp — capacity and waitlist', () => {
    it('confirms GOING while under capacity', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ capacity: 10 }));
      prisma.rsvp.findUnique.mockResolvedValue(null);
      prisma.rsvp.count.mockResolvedValue(4);
      prisma.rsvp.create.mockResolvedValue({ id: 'r1', status: RsvpStatus.GOING, userId: 'usr_1' });

      const result = await service.setRsvp('evt_1', 'usr_1', RsvpStatus.GOING);
      expect(result.waitlisted).toBe(false);
      expect(result.rsvp.status).toBe(RsvpStatus.GOING);
    });

    it('waitlists GOING requests when the event is full', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ capacity: 5 }));
      prisma.rsvp.findUnique.mockResolvedValue(null);
      prisma.rsvp.count.mockResolvedValue(5);
      prisma.rsvp.create.mockResolvedValue({ id: 'r1', status: RsvpStatus.WAITLISTED, userId: 'usr_1' });

      const result = await service.setRsvp('evt_1', 'usr_1', RsvpStatus.GOING);
      expect(result.waitlisted).toBe(true);
      expect(prisma.rsvp.create).toHaveBeenCalledWith({
        data: { eventId: 'evt_1', userId: 'usr_1', status: RsvpStatus.WAITLISTED },
      });
    });

    it('rejects at capacity when the waitlist is disabled', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ capacity: 5, allowWaitlist: false }));
      prisma.rsvp.findUnique.mockResolvedValue(null);
      prisma.rsvp.count.mockResolvedValue(5);

      await expect(service.setRsvp('evt_1', 'usr_1', RsvpStatus.GOING)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('excludes the user from the capacity count when changing their own RSVP', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ capacity: 5 }));
      prisma.rsvp.findUnique.mockResolvedValue({ id: 'r1', status: RsvpStatus.INTERESTED });
      prisma.rsvp.count.mockResolvedValue(3);
      prisma.rsvp.update.mockResolvedValue({ id: 'r1', status: RsvpStatus.GOING, userId: 'usr_1' });

      await service.setRsvp('evt_1', 'usr_1', RsvpStatus.GOING);
      expect(prisma.rsvp.count).toHaveBeenCalledWith({
        where: { eventId: 'evt_1', status: RsvpStatus.GOING, userId: { not: 'usr_1' } },
      });
    });

    it('promotes from the waitlist when a GOING attendee declines', async () => {
      prisma.event.findUnique.mockResolvedValue(makeEvent({ capacity: 5 }));
      prisma.rsvp.findUnique.mockResolvedValue({ id: 'r1', status: RsvpStatus.GOING });
      prisma.rsvp.update
        .mockResolvedValueOnce({ id: 'r1', status: RsvpStatus.DECLINED, userId: 'usr_1' })
        .mockResolvedValueOnce({ id: 'r2', status: RsvpStatus.GOING, userId: 'usr_2' });
      prisma.rsvp.count.mockResolvedValue(4);
      prisma.rsvp.findFirst.mockResolvedValue({ id: 'r2', status: RsvpStatus.WAITLISTED, userId: 'usr_2' });

      await service.setRsvp('evt_1', 'usr_1', RsvpStatus.DECLINED);

      // FIFO promotion picked the oldest waitlisted RSVP.
      expect(prisma.rsvp.findFirst).toHaveBeenCalledWith({
        where: { eventId: 'evt_1', status: RsvpStatus.WAITLISTED },
        orderBy: { createdAt: 'asc' },
      });
      // The promoted user is notified.
      const promotionEmit = emitter.emit.mock.calls.find(
        ([, payload]) => (payload as { type?: string })?.type === 'RSVP_PROMOTED',
      );
      expect(promotionEmit).toBeDefined();
    });
  });

  describe('cancelRsvp', () => {
    it('404s when no RSVP exists', async () => {
      prisma.rsvp.findUnique.mockResolvedValue(null);
      await expect(service.cancelRsvp('evt_1', 'usr_1')).rejects.toThrow(NotFoundException);
    });

    it('deletes the RSVP and backfills from the waitlist', async () => {
      prisma.rsvp.findUnique.mockResolvedValue({ id: 'r1', status: RsvpStatus.GOING });
      prisma.rsvp.delete.mockResolvedValue({});
      prisma.event.findUnique.mockResolvedValue(makeEvent({ capacity: 5 }));
      prisma.rsvp.count.mockResolvedValue(4);
      prisma.rsvp.findFirst.mockResolvedValue(null);

      await service.cancelRsvp('evt_1', 'usr_1');
      expect(prisma.rsvp.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
      expect(prisma.rsvp.findFirst).toHaveBeenCalled();
    });
  });
});

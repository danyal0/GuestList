import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { FriendshipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from './profiles.service';

describe('ProfilesService.respondToFriendRequest', () => {
  let service: ProfilesService;
  let prisma: {
    friendship: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    user: { findUniqueOrThrow: jest.Mock };
  };
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      friendship: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Ada' }),
      },
    };
    eventEmitter = { emit: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ProfilesService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(ProfilesService);
  });

  it('accepts by friendship id', async () => {
    prisma.friendship.findUnique.mockResolvedValue({
      id: 'fs_1',
      requesterId: 'usr_a',
      addresseeId: 'usr_b',
      status: FriendshipStatus.PENDING,
    });

    await service.respondToFriendRequest('usr_b', 'fs_1', true);

    expect(prisma.friendship.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fs_1' },
        data: expect.objectContaining({ status: FriendshipStatus.ACCEPTED }),
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalled();
  });

  it('accepts by requester user id when friendshipId is missing (legacy notifications)', async () => {
    prisma.friendship.findUnique.mockResolvedValue(null);
    prisma.friendship.findFirst.mockResolvedValue({
      id: 'fs_2',
      requesterId: 'usr_a',
      addresseeId: 'usr_b',
      status: FriendshipStatus.PENDING,
    });

    await service.respondToFriendRequest('usr_b', 'usr_a', true);

    expect(prisma.friendship.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          addresseeId: 'usr_b',
          requesterId: 'usr_a',
          status: FriendshipStatus.PENDING,
        },
      }),
    );
    expect(prisma.friendship.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fs_2' } }),
    );
  });

  it('rejects when the viewer is not the addressee', async () => {
    prisma.friendship.findUnique.mockResolvedValue({
      id: 'fs_1',
      requesterId: 'usr_a',
      addresseeId: 'usr_b',
      status: FriendshipStatus.PENDING,
    });

    await expect(service.respondToFriendRequest('usr_a', 'fs_1', true)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s when no pending request matches', async () => {
    prisma.friendship.findUnique.mockResolvedValue(null);
    prisma.friendship.findFirst.mockResolvedValue(null);

    await expect(service.respondToFriendRequest('usr_b', 'usr_a', true)).rejects.toThrow(
      NotFoundException,
    );
  });
});

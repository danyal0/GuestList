import { Test } from '@nestjs/testing';
import { NotificationType, UserRole } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFY_EVENT } from '../notifications/notification.events';
import { AdminAlertService } from './admin-alert.service';

describe('AdminAlertService', () => {
  let service: AdminAlertService;
  let emit: jest.Mock;
  let userFindMany: jest.Mock;

  beforeEach(async () => {
    emit = jest.fn();
    userFindMany = jest.fn().mockResolvedValue([{ id: 'admin1' }, { id: 'mod1' }]);

    const module = await Test.createTestingModule({
      providers: [
        AdminAlertService,
        {
          provide: PrismaService,
          useValue: { user: { findMany: userFindMany } },
        },
        { provide: EventEmitter2, useValue: { emit } },
      ],
    }).compile();

    service = module.get(AdminAlertService);
  });

  it('fans out staff notifications to admins and moderators', async () => {
    await service.notifyStaff({
      type: NotificationType.REPORT_CREATED,
      payload: { reportId: 'r1' },
    });

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: [UserRole.ADMIN, UserRole.MODERATOR] },
        }),
      }),
    );
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      NOTIFY_EVENT,
      expect.objectContaining({
        userId: 'admin1',
        type: NotificationType.REPORT_CREATED,
      }),
    );
  });

  it('notifies staff about new reports with email', async () => {
    await service.notifyNewReport({
      reportId: 'r1',
      reporterId: 'u1',
      reporterName: 'Alex',
      targetType: 'USER',
      targetId: 'u2',
      reason: 'Harassment',
    });

    expect(emit).toHaveBeenCalledWith(
      NOTIFY_EVENT,
      expect.objectContaining({
        type: NotificationType.REPORT_CREATED,
        email: expect.objectContaining({
          ctaPath: '/admin',
          subject: expect.stringContaining('Harassment'),
        }),
      }),
    );
  });

  it('rate-limits system error alerts per path', async () => {
    await service.notifySystemError({
      statusCode: 500,
      path: '/api/v1/boom',
      method: 'GET',
      message: 'boom',
    });
    await service.notifySystemError({
      statusCode: 500,
      path: '/api/v1/boom',
      method: 'GET',
      message: 'boom again',
    });

    // First alert fans out to 2 staff; second is suppressed by cooldown + global min interval
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][1].type).toBe(NotificationType.SYSTEM_ERROR);
  });
});

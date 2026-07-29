import { AdminService } from './admin.service';

describe('AdminService social moderation', () => {
  const audit = { log: jest.fn() };
  let prisma: {
    conversation: { findUnique: jest.Mock; findMany: jest.Mock; delete: jest.Mock; count: jest.Mock };
    conversationParticipant: { deleteMany: jest.Mock };
    message: { deleteMany: jest.Mock };
    friendship: { findUnique: jest.Mock; findMany: jest.Mock; delete: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: AdminService;

  beforeEach(() => {
    prisma = {
      conversation: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      conversationParticipant: { deleteMany: jest.fn() },
      message: { deleteMany: jest.fn() },
      friendship: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(async (fn) =>
        fn({
          message: prisma.message,
          conversationParticipant: prisma.conversationParticipant,
          conversation: prisma.conversation,
        }),
      ),
    };
    audit.log.mockReset();
    service = new AdminService(prisma as never, audit as never);
  });

  it('hard-deletes a conversation and its messages', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'c1',
      type: 'DIRECT',
      title: null,
      groupId: null,
    });

    await service.hardDeleteConversation('admin1', 'c1');

    expect(prisma.message.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'c1' } });
    expect(prisma.conversationParticipant.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1' },
    });
    expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.conversation_hard_delete', targetId: 'c1' }),
    );
  });

  it('removes a friendship (admin unfriend)', async () => {
    prisma.friendship.findUnique.mockResolvedValue({
      id: 'f1',
      status: 'ACCEPTED',
      requesterId: 'u1',
      addresseeId: 'u2',
      requester: { id: 'u1', name: 'Alice' },
      addressee: { id: 'u2', name: 'Bob' },
    });

    await service.removeFriendship('admin1', 'f1');

    expect(prisma.friendship.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.friendship_remove', targetId: 'f1' }),
    );
  });
});

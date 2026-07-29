import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('file mode friendships', () => {
  async function clientWithCopy() {
    const dbPath = path.join(os.tmpdir(), `fr-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    fs.copyFileSync(path.join(__dirname, '../../data/mock-db.json'), dbPath);
    process.env.DATA_SOURCE = 'file';
    process.env.MOCK_DB_PATH = dbPath;
    jest.resetModules();
    const { createFilePrismaClient } = await import('./file-prisma');
    return createFilePrismaClient() as {
      friendship: {
        create: (args: unknown) => Promise<Record<string, unknown>>;
        findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
      };
    };
  }

  it('defaults new friendships to PENDING', async () => {
    const prisma = await clientWithCopy();
    const created = await prisma.friendship.create({
      data: { requesterId: 'user_admin', addresseeId: 'user_maya' },
    });
    expect(created.status).toBe('PENDING');
  });

  it('finds pending inbound requests by status', async () => {
    const prisma = await clientWithCopy();
    await prisma.friendship.create({
      data: { requesterId: 'user_admin', addresseeId: 'user_maya' },
    });
    const pending = await prisma.friendship.findMany({
      where: {
        addresseeId: 'user_maya',
        OR: [{ status: 'PENDING' }, { status: null }],
        respondedAt: null,
      },
    });
    expect(pending.some((row) => row.requesterId === 'user_admin')).toBe(true);
  });

  it('matches viewer friendship status for outbound pending requests', async () => {
    const prisma = await clientWithCopy();
    await prisma.friendship.create({
      data: { requesterId: 'user_admin', addresseeId: 'user_maya' },
    });
    const row = await prisma.friendship.findFirst({
      where: {
        AND: [
          {
            OR: [
              { requesterId: 'user_admin', addresseeId: 'user_maya' },
              { requesterId: 'user_maya', addresseeId: 'user_admin' },
            ],
          },
          {
            OR: [{ status: { in: ['PENDING', 'ACCEPTED'] } }, { status: null, respondedAt: null }],
          },
        ],
      },
    });
    expect(row?.requesterId).toBe('user_admin');
    expect(row?.status).toBe('PENDING');
  });
});

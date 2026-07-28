import { resolveWhatsappDefaultGroup } from './whatsapp-default-group';

function mockPrisma(overrides: {
  byId?: { id: string; name: string } | null;
  bySlug?: { id: string; name: string } | null;
  byName?: { id: string; name: string } | null;
  sports?: { id: string; name: string } | null;
}) {
  return {
    group: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id) return overrides.byId ?? null;
        if (where.slug) return overrides.bySlug ?? null;
        if (where.name) return overrides.byName ?? null;
        if (where.category === 'SPORTS') return overrides.sports ?? null;
        return null;
      }),
    },
  };
}

describe('resolveWhatsappDefaultGroup', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('uses WHATSAPP_DEFAULT_GROUP_ID when the group exists', async () => {
    process.env.WHATSAPP_DEFAULT_GROUP_ID = 'grp_1';
    const prisma = mockPrisma({ byId: { id: 'grp_1', name: 'MKE Tennis Group' } });
    const result = await resolveWhatsappDefaultGroup(prisma as never);
    expect(result).toEqual({
      group: { id: 'grp_1', name: 'MKE Tennis Group' },
      via: 'WHATSAPP_DEFAULT_GROUP_ID',
    });
  });

  it('falls back to name when id is missing', async () => {
    delete process.env.WHATSAPP_DEFAULT_GROUP_ID;
    delete process.env.WHATSAPP_DEFAULT_GROUP_SLUG;
    process.env.WHATSAPP_GROUP_NAME = 'Tennis Group';
    const prisma = mockPrisma({
      byName: { id: 'grp_tennis', name: 'MKE Tennis Group' },
    });
    const result = await resolveWhatsappDefaultGroup(prisma as never);
    expect(result.via).toBe('name:Tennis Group');
    expect(result.group?.id).toBe('grp_tennis');
  });

  it('falls back to first public SPORTS group', async () => {
    delete process.env.WHATSAPP_DEFAULT_GROUP_ID;
    delete process.env.WHATSAPP_DEFAULT_GROUP_SLUG;
    delete process.env.WHATSAPP_DEFAULT_GROUP_NAME;
    delete process.env.WHATSAPP_GROUP_NAME;
    const prisma = mockPrisma({
      sports: { id: 'grp_sports', name: 'East Bay Fútbol Club' },
    });
    const result = await resolveWhatsappDefaultGroup(prisma as never);
    expect(result).toEqual({
      group: { id: 'grp_sports', name: 'East Bay Fútbol Club' },
      via: 'category:SPORTS',
    });
  });
});

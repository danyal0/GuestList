import { SuggestionsService } from './suggestions.service';
import { resolveCatalogVenue } from '../whatsapp/whatsapp-event-enrich';

describe('SuggestionsService heuristics', () => {
  const prisma = {
    event: { findMany: jest.fn().mockResolvedValue([]) },
    group: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new SuggestionsService(prisma as never);

  beforeEach(() => {
    prisma.event.findMany.mockResolvedValue([]);
    prisma.group.findMany.mockResolvedValue([]);
    delete process.env.XAI_API_KEY;
  });

  it('suggests a tennis venue event from a partial venue clue', async () => {
    const { items } = await service.suggestEvents('mckinley tennis');
    expect(items.length).toBeGreaterThan(0);
    const venueHit = items.find((i) => i.source === 'venue' || i.source === 'heuristic');
    expect(venueHit).toBeDefined();
    expect(venueHit!.fields.locationName).toMatch(/McKinley/i);
    expect(venueHit!.fields.address).toBeTruthy();
    expect(venueHit!.fields.capacity).toBeGreaterThan(0);
  });

  it('prefers an existing similar event when present', async () => {
    prisma.event.findMany.mockResolvedValue([
      {
        id: 'evt1',
        title: 'Saturday Tennis at Lake Park',
        description: 'Doubles open play',
        mode: 'IN_PERSON',
        locationName: 'Lake Park Tennis Courts',
        address: '3233 E Kenwood Blvd',
        latitude: 43.06,
        longitude: -87.87,
        capacity: 20,
        onlineUrl: null,
        startTime: new Date('2030-01-01T17:00:00Z'),
        endTime: new Date('2030-01-01T18:30:00Z'),
        group: { id: 'g1', name: 'MKE Tennis', slug: 'mke-tennis' },
      },
    ]);
    const { items } = await service.suggestEvents('lake park tennis');
    expect(items[0]!.source).toBe('event');
    expect(items[0]!.fields.title).toContain('Lake Park');
    expect(items[0]!.fields.durationMinutes).toBe(90);
  });

  it('suggests a sports community from sport keywords', async () => {
    const { items } = await service.suggestGroups('pickleball milwaukee');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.fields.category === 'SPORTS')).toBe(true);
  });

  it('resolves catalog venues used by suggestions', () => {
    const match = resolveCatalogVenue('lets play at the lakefront');
    expect(match?.venue.slug).toBe('mckinley-tennis-courts');
  });
});

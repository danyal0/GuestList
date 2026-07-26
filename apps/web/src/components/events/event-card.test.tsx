import { render, screen } from '@testing-library/react';
import type { EventSummary } from '@/lib/types';
import { EventCard } from './event-card';

function makeEvent(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    id: 'evt_1',
    groupId: 'grp_1',
    title: 'Sunset Photography Walk',
    description: 'Golden hour shots along the waterfront.',
    coverImage: null,
    mode: 'IN_PERSON',
    locationName: 'Embarcadero',
    address: null,
    onlineUrl: null,
    timezone: 'America/Los_Angeles',
    startTime: '2030-06-15T18:00:00.000Z',
    endTime: '2030-06-15T20:00:00.000Z',
    capacity: 20,
    status: 'PUBLISHED',
    goingCount: 8,
    spotsLeft: 12,
    group: { id: 'grp_1', slug: 'photo-walks', name: 'Photo Walks SF', coverImage: null, category: 'PHOTOGRAPHY' },
    host: { id: 'usr_1', name: 'Ada', avatarUrl: null },
    ...overrides,
  };
}

describe('EventCard', () => {
  it('renders title, community and attendance', () => {
    render(<EventCard event={makeEvent()} />);
    expect(screen.getByText('Sunset Photography Walk')).toBeInTheDocument();
    expect(screen.getByText('Photo Walks SF')).toBeInTheDocument();
    expect(screen.getByText(/8 going/)).toBeInTheDocument();
  });

  it('links to the event detail page with an accessible name', () => {
    render(<EventCard event={makeEvent()} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/events/evt_1');
    expect(link).toHaveAccessibleName(/Sunset Photography Walk/);
  });

  it('shows the location for in-person events', () => {
    render(<EventCard event={makeEvent()} />);
    expect(screen.getByText(/Embarcadero/)).toBeInTheDocument();
  });

  it('labels online events', () => {
    render(<EventCard event={makeEvent({ mode: 'ONLINE', locationName: null })} />);
    expect(screen.getByText(/Online event/)).toBeInTheDocument();
  });

  it('shows a waitlist badge when full', () => {
    render(<EventCard event={makeEvent({ spotsLeft: 0 })} />);
    expect(screen.getByText('Waitlist')).toBeInTheDocument();
  });

  it('shows a cancelled overlay for cancelled events', () => {
    render(<EventCard event={makeEvent({ status: 'CANCELLED' })} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows the viewer RSVP status', () => {
    render(<EventCard event={makeEvent({ rsvpStatus: 'GOING' })} />);
    expect(screen.getByText('Going')).toBeInTheDocument();
  });
});

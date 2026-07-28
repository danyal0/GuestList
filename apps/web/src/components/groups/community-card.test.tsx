import { render, screen } from '@testing-library/react';
import { CommunityCard } from './community-card';
import type { Group } from '@/lib/types';

const baseGroup: Group = {
  id: 'grp_1',
  slug: 'test-club',
  name: 'Test Club',
  description: 'A place to hang',
  coverImage: null,
  category: 'SPORTS',
  privacy: 'PUBLIC',
  memberCount: 3,
  location: 'Milwaukee, WI',
  isVerified: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('CommunityCard', () => {
  it('renders member count safely when missing (file-db create race)', () => {
    const broken = { ...baseGroup, memberCount: undefined as unknown as number };
    render(<CommunityCard group={broken} />);
    expect(screen.getByLabelText(/Test Club, 0 members/i)).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders a normal member count', () => {
    render(<CommunityCard group={baseGroup} />);
    expect(screen.getByLabelText(/Test Club, 3 members/i)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

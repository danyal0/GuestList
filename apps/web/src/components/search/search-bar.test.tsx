import { render, screen } from '@testing-library/react';
import { SearchBar } from './search-bar';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('SearchBar', () => {
  it('uses dark ink text so it stays readable on a light field inside a white-text hero', () => {
    render(<SearchBar initialQuery="tennis" />);
    const input = screen.getByRole('searchbox', { name: 'Search' });
    expect(input.className).toContain('text-[var(--color-ink)]');
    expect(input).toHaveValue('tennis');
  });
});

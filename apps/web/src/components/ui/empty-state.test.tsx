import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from 'lucide-react';
import { EmptyState, ErrorState } from './empty-state';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState icon={Inbox} title="Nothing here" description="Come back later." />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Come back later.')).toBeInTheDocument();
  });

  it('renders an action when provided', () => {
    render(<EmptyState icon={Inbox} title="Empty" action={<button>Create one</button>} />);
    expect(screen.getByRole('button', { name: 'Create one' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('announces the error and retries', async () => {
    const onRetry = jest.fn();
    render(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button', () => {
  it('renders its label and fires clicks', async () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and announces busy while loading', () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('does not fire clicks while disabled', async () => {
    const onClick = jest.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders as the child element with asChild (link buttons)', () => {
    render(
      <Button asChild>
        <a href="/somewhere">Go somewhere</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Go somewhere' });
    expect(link).toHaveAttribute('href', '/somewhere');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('applies variant classes', () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole('button').className).toContain('danger');
  });
});

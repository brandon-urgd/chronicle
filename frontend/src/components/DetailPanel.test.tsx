import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DetailPanel from './DetailPanel';

describe('DetailPanel (Task 7.4)', () => {
  it('renders with aria-hidden="true" when closed', () => {
    render(
      <DetailPanel isOpen={false} onClose={() => {}} title="Test Panel">
        <p>Content</p>
      </DetailPanel>
    );
    const panel = screen.getByRole('complementary', { hidden: true });
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(panel).not.toHaveClass('detail-panel--open');
  });

  it('renders with open class and aria-hidden="false" when open', () => {
    render(
      <DetailPanel isOpen={true} onClose={() => {}} title="Entry Detail">
        <p>Body content</p>
      </DetailPanel>
    );
    const panel = screen.getByRole('complementary');
    expect(panel).toHaveAttribute('aria-hidden', 'false');
    expect(panel).toHaveClass('detail-panel--open');
  });

  it('displays the title text', () => {
    render(
      <DetailPanel isOpen={true} onClose={() => {}} title="My Entry">
        <p>Content</p>
      </DetailPanel>
    );
    expect(screen.getByText('My Entry')).toBeInTheDocument();
  });

  it('renders children content', () => {
    render(
      <DetailPanel isOpen={true} onClose={() => {}} title="Title">
        <p data-testid="child">Hello</p>
      </DetailPanel>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders optional actions', () => {
    render(
      <DetailPanel isOpen={true} onClose={() => {}} title="Title" actions={<button>Save</button>}>
        <p>Content</p>
      </DetailPanel>
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('calls onClose when X button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DetailPanel isOpen={true} onClose={onClose} title="Title">
        <p>Content</p>
      </DetailPanel>
    );
    await user.click(screen.getByRole('button', { name: /close panel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when ESC is pressed (Requirement 17.8)', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DetailPanel isOpen={true} onClose={onClose} title="Title">
        <p>Content</p>
      </DetailPanel>
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on ESC when panel is closed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DetailPanel isOpen={false} onClose={onClose} title="Title">
        <p>Content</p>
      </DetailPanel>
    );
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not render actions section when actions prop is omitted', () => {
    const { container } = render(
      <DetailPanel isOpen={true} onClose={() => {}} title="Title">
        <p>Content</p>
      </DetailPanel>
    );
    expect(container.querySelector('.detail-panel__actions')).not.toBeInTheDocument();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ReportReadyCard from './ReportReadyCard';

describe('ReportReadyCard', () => {
  it('renders nothing when reportReady is null', () => {
    const { container } = render(
      <ReportReadyCard reportReady={null} onNavigateToTab={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when reportReady is undefined', () => {
    const { container } = render(
      <ReportReadyCard reportReady={undefined} onNavigateToTab={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('displays the draft title when reportReady is provided', () => {
    render(
      <ReportReadyCard
        reportReady={{ draft_id: 7, title: 'Week 20 Summary' }}
        onNavigateToTab={() => {}}
      />
    );
    expect(screen.getByText('Week 20 Summary')).toBeInTheDocument();
  });

  it('displays an "Open →" button that navigates to Reports', () => {
    const onNavigate = vi.fn();
    render(
      <ReportReadyCard
        reportReady={{ draft_id: 7, title: 'Week 20 Summary' }}
        onNavigateToTab={onNavigate}
      />
    );
    const openBtn = screen.getByRole('button', { name: /open report/i });
    fireEvent.click(openBtn);
    expect(onNavigate).toHaveBeenCalledWith('Reports');
  });

  it('displays a dismiss button (×) that hides the banner for the session', () => {
    const { container } = render(
      <ReportReadyCard
        reportReady={{ draft_id: 7, title: 'Week 20 Summary' }}
        onNavigateToTab={() => {}}
      />
    );
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);
    // After dismiss, the component should render nothing
    expect(container.firstChild).toBeNull();
  });

  it('has accessible aria-label with the draft title', () => {
    render(
      <ReportReadyCard
        reportReady={{ draft_id: 3, title: 'Monthly Report' }}
        onNavigateToTab={() => {}}
      />
    );
    const banner = screen.getByRole('banner');
    expect(banner).toHaveAttribute('aria-label', 'Report ready: Monthly Report');
  });
});

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ActivityPulse from './ActivityPulse';

describe('ActivityPulse', () => {
  it('renders nothing when data is undefined', () => {
    const { container } = render(<ActivityPulse />);
    expect(container.firstChild).toBeNull();
  });

  it('displays "No entries yet" when there are no entries and no tasks', () => {
    render(
      <ActivityPulse
        data={{
          entries_this_week: 0,
          tasks_completed_this_week: 0,
          time_since_last_entry: 'No entries yet',
        }}
      />
    );
    expect(screen.getByText('No entries yet')).toBeInTheDocument();
  });

  it('displays the full activity pulse line with entries, tasks, and last entry time', () => {
    render(
      <ActivityPulse
        data={{
          entries_this_week: 7,
          tasks_completed_this_week: 3,
          time_since_last_entry: '2 hours ago',
        }}
      />
    );
    expect(screen.getByText('7 entries this week')).toBeInTheDocument();
    expect(screen.getByText('3 tasks done')).toBeInTheDocument();
    expect(screen.getByText('Last entry: 2 hours ago')).toBeInTheDocument();
  });

  it('uses singular "entry" when count is 1', () => {
    render(
      <ActivityPulse
        data={{
          entries_this_week: 1,
          tasks_completed_this_week: 1,
          time_since_last_entry: '5 minutes ago',
        }}
      />
    );
    expect(screen.getByText('1 entry this week')).toBeInTheDocument();
    expect(screen.getByText('1 task done')).toBeInTheDocument();
  });

  it('shows full pulse when entries are 0 but tasks are completed', () => {
    render(
      <ActivityPulse
        data={{
          entries_this_week: 0,
          tasks_completed_this_week: 2,
          time_since_last_entry: '1 day ago',
        }}
      />
    );
    expect(screen.getByText('0 entries this week')).toBeInTheDocument();
    expect(screen.getByText('2 tasks done')).toBeInTheDocument();
    expect(screen.getByText('Last entry: 1 day ago')).toBeInTheDocument();
  });

  it('has an accessible aria-label with the full pulse summary', () => {
    render(
      <ActivityPulse
        data={{
          entries_this_week: 12,
          tasks_completed_this_week: 5,
          time_since_last_entry: '30 minutes ago',
        }}
      />
    );
    const el = screen.getByLabelText(
      'Activity pulse: 12 entries this week, 5 tasks done, Last entry: 30 minutes ago'
    );
    expect(el).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { HistoryNotice } from './HistoryNotice';

describe('HistoryNotice', () => {
  it('lists what may be missing and loads older messages on request', () => {
    const onLoadOlder = vi.fn();
    render(
      <TestApp>
        <HistoryNotice
          history={{ complete: false, canLoadOlder: true, notes: ['relay.example didn\'t respond (timed out).'] }}
          onLoadOlder={onLoadOlder}
        />
      </TestApp>,
    );
    expect(screen.getByText('Older messages may be missing')).toBeInTheDocument();
    expect(screen.getByText("relay.example didn't respond (timed out).")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load older messages' }));
    expect(onLoadOlder).toHaveBeenCalledOnce();
  });

  it('shows nothing when the history is complete', () => {
    const { container } = render(
      <TestApp><HistoryNotice history={{ complete: true, canLoadOlder: false, notes: [] }} onLoadOlder={() => {}} /></TestApp>,
    );
    expect(container.textContent).toBe('');
  });

  it('explains a cap without offering a load that cannot help', () => {
    render(
      <TestApp>
        <HistoryNotice
          history={{ complete: false, canLoadOlder: false, notes: ['Only the latest 100 older-format (NIP-04) messages with this person are loaded.'] }}
          onLoadOlder={() => {}}
        />
      </TestApp>,
    );
    expect(screen.getByText(/Only the latest 100 older-format/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

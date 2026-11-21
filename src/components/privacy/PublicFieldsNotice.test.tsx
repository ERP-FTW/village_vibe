import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { EVENT_PUBLIC_FIELDS, TRIBE_PUBLIC_FIELDS } from '@/lib/publicFields';
import { PublicFieldsNotice } from '@/components/privacy/PublicFieldsNotice';
import { TribeAccessSettings } from '@/components/tribes/TribeAccessSettings';

describe('publication notices', () => {
  it('lists every public event field and says relay readers can see them', () => {
    render(<TestApp><PublicFieldsNotice subject="this event" fields={EVENT_PUBLIC_FIELDS} /></TestApp>);

    expect(screen.getByText('Published publicly on Nostr')).toBeInTheDocument();
    expect(screen.getByText(/Anyone reading a relay or using another Nostr app can see/)).toBeInTheDocument();
    for (const field of EVENT_PUBLIC_FIELDS) expect(screen.getByText(field.label)).toBeInTheDocument();
  });

  it('describes an unlisted tribe as discoverable by link and still public', () => {
    render(
      <TestApp>
        <TribeAccessSettings listed={false} open={true} onListedChange={() => {}} onOpenChange={() => {}} />
      </TestApp>,
    );

    expect(screen.getByLabelText('Listed in discovery')).toBeInTheDocument();
    expect(screen.getByText(/Unlisted: left out of Village Vibe’s tribe lists/)).toBeInTheDocument();
    expect(screen.getByText('Unlisting a tribe does not hide any of this.')).toBeInTheDocument();
    expect(screen.getByText(/Joining always sends a request that an admin approves/)).toBeInTheDocument();
    for (const field of TRIBE_PUBLIC_FIELDS) expect(screen.getByText(field.label)).toBeInTheDocument();
  });
});

import { isDeliveryComplete, type MessageDelivery } from '@/lib/dmDelivery';

/**
 * Outcome of sending an event's private details to its invitees. Kept in memory while the
 * page is open so undelivered invitations can be retried without publishing the event again
 * or re-sending to anyone who already has it.
 */
export interface InvitationOutcome {
  eventId: string;
  /** The invitation text (held only in memory, for invitees whose message couldn't be prepared). */
  message: string;
  deliveries: MessageDelivery[];
  /** Invitees whose message couldn't be encrypted or signed (nothing was sent to them). */
  unprepared: { recipient: string; error: string }[];
}

type Send = (input: { recipient: string; message: string }) => Promise<MessageDelivery>;
type Retry = (delivery: MessageDelivery) => Promise<MessageDelivery>;

export function invitationsComplete(outcome: InvitationOutcome): boolean {
  return outcome.unprepared.length === 0 && outcome.deliveries.every(isDeliveryComplete);
}

async function sendEach(send: Send, recipients: string[], message: string) {
  const settled = await Promise.allSettled(recipients.map(recipient => send({ recipient, message })));
  const deliveries: MessageDelivery[] = [];
  const unprepared: InvitationOutcome['unprepared'] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') deliveries.push(outcome.value);
    else unprepared.push({ recipient: recipients[i], error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) });
  });
  return { deliveries, unprepared };
}

/** Sends one invitation per unique invitee and reports each outcome. */
export async function sendInvitations(send: Send, eventId: string, invitees: string[], message: string): Promise<InvitationOutcome> {
  const { deliveries, unprepared } = await sendEach(send, [...new Set(invitees)], message);
  return { eventId, message, deliveries, unprepared };
}

/** Retries only what's missing: undelivered invitations, missing own copies, unprepared ones. */
export async function retryInvitations(outcome: InvitationOutcome, send: Send, retry: Retry): Promise<InvitationOutcome> {
  const deliveries = await Promise.all(outcome.deliveries.map(delivery =>
    isDeliveryComplete(delivery) ? delivery : retry(delivery).catch(() => delivery)));
  const again = await sendEach(send, outcome.unprepared.map(({ recipient }) => recipient), outcome.message);
  return { ...outcome, deliveries: [...deliveries, ...again.deliveries], unprepared: again.unprepared };
}

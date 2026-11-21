import { useMutation } from '@tanstack/react-query';
import { useSendDirectMessage } from './useSendDirectMessage';
import { extractServiceData, useCreateServiceMatch } from './useServices';
import type { NostrEvent } from '@nostrify/nostrify';

export function useAdminSuggestMatch() {
  const { mutateAsync: createMatch } = useCreateServiceMatch();
  const { mutateAsync: sendMessage } = useSendDirectMessage();
  return useMutation({
    mutationFn: async (data: {
      offerEvent: NostrEvent;
      requestEvent: NostrEvent;
      suggestion: string;
      notifyParties?: boolean;
    }) => {
      const { offerEvent, requestEvent, suggestion } = data;
      const offer = extractServiceData(offerEvent).dTag;
      const request = extractServiceData(requestEvent).dTag;
      if (!offer || !request) throw new Error('Missing service reference');
      await createMatch({
        offerARef: `${offerEvent.kind}:${offerEvent.pubkey}:${offer}`,
        requestARef: `${requestEvent.kind}:${requestEvent.pubkey}:${request}`,
        type: 'admin_suggestion',
      });
      if (!data.notifyParties) return 0;
      const sent = await Promise.allSettled([
        sendMessage({ recipient: offerEvent.pubkey, message: `Your offer may match ${request}. ${suggestion}` }),
        sendMessage({ recipient: requestEvent.pubkey, message: `Your request may match ${offer}. ${suggestion}` }),
      ]);
      // Not delivered: the message couldn't be prepared, or no relay accepted it
      return sent.filter(result => result.status === 'rejected' || result.value.recipient.status !== 'delivered').length;
    },
  });
}

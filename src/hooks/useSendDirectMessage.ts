import { useMutation } from '@tanstack/react-query';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';

export function useSendDirectMessage() {
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  return useMutation({
    mutationFn: async ({ recipient, message }: { recipient: string; message: string }) => {
      if (!user?.signer.nip04) throw new Error('Your signer does not support encrypted messages.');
      const content = await user.signer.nip04.encrypt(recipient, message);
      return publish({ kind: 4, content, tags: [['p', recipient]] });
    },
  });
}

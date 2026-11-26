import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { GoodsCard } from './GoodsCard';
import { CreateGoodsDialog } from './CreateGoodsDialog';
import { RelaySelector } from '@/components/RelaySelector';
import { LoginArea } from '@/components/auth/LoginArea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTribeGoods } from '@/hooks/useGoods';
import { useTribe } from '@/hooks/useTribes';
import { tribeMemberAuthors } from '@/lib/tribes';
import { Plus } from 'lucide-react';

interface TribeGoodsProps {
  tribeId: string;
  className?: string;
  isModerator?: boolean;
}

/** Items that members of a tribe offer for sale. */
export function TribeGoods({ tribeId, className, isModerator = false }: TribeGoodsProps) {
  const { user } = useCurrentUser();
  const { data: tribe } = useTribe(tribeId);
  const { data: goods, isLoading, error } = useTribeGoods(tribeId);

  // The tribe feed only shows members' listings, so only members are offered the form.
  const isMember = !!user && !!tribe && tribeMemberAuthors(tribe).includes(user.pubkey);

  if (isLoading) {
    return (
      <div className={`space-y-6 ${className ?? ''}`}>
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="aspect-[4/3] w-full rounded-b-none" />
              <CardHeader className="space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-6 w-20" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-8 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!goods) {
    return (
      <div className={className}>
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">{error ? 'Could not load goods' : 'No goods found'}</h3>
                <p className="text-muted-foreground">Try switching relays to load the tribe's items.</p>
              </div>
              <RelaySelector className="w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sellButton = (
    <CreateGoodsDialog tribeId={tribeId}>
      <Button size="sm">
        <Plus className="h-4 w-4 mr-2" />
        Sell an item
      </Button>
    </CreateGoodsDialog>
  );

  return (
    <div className={`space-y-6 ${className ?? ''}`}>
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold">Goods</h2>
          <p className="text-muted-foreground">Items offered by members of this tribe</p>
        </div>
        {isMember && sellButton}
      </div>

      {goods.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">No items yet</h3>
                <p className="text-muted-foreground">
                  {isMember
                    ? 'Be the first to offer something to your tribe.'
                    : user
                      ? 'Members of this tribe can list items here.'
                      : 'Log in to ask about items, or to list your own as a member.'}
                </p>
              </div>
              {isMember ? sellButton : !user ? <LoginArea className="max-w-60" /> : <RelaySelector className="w-full" />}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {goods.map(listing => (
            <GoodsCard key={listing.id} event={listing} showModerationControls={isModerator} />
          ))}
        </div>
      )}
    </div>
  );
}

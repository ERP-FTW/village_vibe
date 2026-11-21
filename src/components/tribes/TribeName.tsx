import { useTribeName } from '@/hooks/useTribes';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';

interface TribeNameProps {
  tribeTag?: string;
  /** Author of the content, used to pick the right tribe when several share a d tag. */
  memberPubkey?: string;
  className?: string;
  showIcon?: boolean;
  variant?: 'default' | 'secondary' | 'outline' | 'destructive';
}

export function TribeName({
  tribeTag,
  memberPubkey,
  className = '', 
  showIcon = true,
  variant = 'secondary'
}: TribeNameProps) {
  const { data: tribeData } = useTribeName(tribeTag, memberPubkey);

  if (!tribeTag) return null;

  const displayName = tribeData?.name || tribeTag;

  return (
    <Badge variant={variant} className={`text-xs ${className}`}>
      {showIcon && <Users className="h-3 w-3 mr-1" />}
      {displayName}
    </Badge>
  );
}
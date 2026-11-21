import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deliveryStatusText, type MessageDelivery } from '@/lib/dmDelivery';
import { cn } from '@/lib/utils';

interface DeliveryStatusProps {
  delivery: MessageDelivery;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}

export function DeliveryStatus({ delivery, onRetry, retrying, className }: DeliveryStatusProps) {
  const { text, action } = deliveryStatusText(delivery);
  return (
    <div role="status" className={cn('mt-1 flex flex-wrap items-center gap-2 text-xs', className)}>
      <span>{text}</span>
      {action && (
        <Button type="button" size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={onRetry} disabled={retrying}>
          {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          <span className="ml-1">{action}</span>
        </Button>
      )}
    </div>
  );
}

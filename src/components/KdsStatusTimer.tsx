import { useState, useEffect } from 'react';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KdsStatusTimerProps {
  /** Timestamp of when current status started (status_changed_at or created_at) */
  statusChangedAt: string;
  /** For delivered orders: show total time from created_at to entregue_at */
  createdAt?: string;
  entregueAt?: string | null;
  className?: string;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

function getTimerColor(ms: number): string {
  const minutes = ms / 60000;
  if (minutes >= 15) return 'text-red-500';
  if (minutes >= 10) return 'text-orange-500';
  if (minutes >= 5) return 'text-yellow-600';
  return 'text-muted-foreground';
}

export function KdsStatusTimer({ statusChangedAt, createdAt, entregueAt, className }: KdsStatusTimerProps) {
  const [now, setNow] = useState(Date.now());

  const isDelivered = !!entregueAt;

  useEffect(() => {
    if (isDelivered) return; // no need to tick for delivered
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isDelivered]);

  let elapsed: number;
  let label: string;

  if (isDelivered && createdAt) {
    // Total time from creation to delivery
    elapsed = new Date(entregueAt!).getTime() - new Date(createdAt).getTime();
    label = 'Total';
  } else {
    // Time in current status
    elapsed = now - new Date(statusChangedAt).getTime();
    label = '';
  }

  const colorClass = isDelivered ? 'text-muted-foreground' : getTimerColor(elapsed);

  return (
    <div className={cn('flex items-center gap-1 font-mono text-xs', colorClass, className)}>
      <Timer className="h-3 w-3" />
      {label && <span className="text-[10px]">{label}:</span>}
      <span className="tabular-nums">{formatElapsed(elapsed)}</span>
    </div>
  );
}

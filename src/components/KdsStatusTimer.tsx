import { useState, useEffect, useRef } from 'react';
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
  if (minutes >= 15) return 'text-red-600 font-bold';
  if (minutes >= 10) return 'text-orange-600 font-semibold';
  if (minutes >= 5) return 'text-yellow-600';
  return 'text-foreground';
}

export function KdsStatusTimer({ statusChangedAt, createdAt, entregueAt, className }: KdsStatusTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDelivered = !!entregueAt;

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isDelivered && createdAt) {
      // Fixed elapsed for delivered orders
      const total = new Date(entregueAt!).getTime() - new Date(createdAt).getTime();
      setElapsed(isNaN(total) ? 0 : Math.max(0, total));
      return;
    }

    // Live timer
    const startTime = new Date(statusChangedAt).getTime();
    if (isNaN(startTime)) {
      setElapsed(0);
      return;
    }

    const tick = () => {
      setElapsed(Math.max(0, Date.now() - startTime));
    };

    tick(); // immediate first tick
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [statusChangedAt, createdAt, entregueAt, isDelivered]);

  const colorClass = isDelivered ? 'text-muted-foreground' : getTimerColor(elapsed);

  return (
    <div className={cn('flex items-center gap-1.5 font-mono text-sm', colorClass, className)}>
      <Timer className="h-4 w-4" />
      {isDelivered && <span className="text-[10px]">Total:</span>}
      <span className="tabular-nums">{formatElapsed(elapsed)}</span>
    </div>
  );
}

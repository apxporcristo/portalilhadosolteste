import { Button } from '@/components/ui/button';
import { Clock, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './ConfirmDialog';
import { useState } from 'react';

interface TimeButtonProps {
  tempo: string;
  available: number;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

const timeColors: Record<string, string> = {
  '1 Hora': 'bg-time-1h hover:bg-time-1h/90',
  '2 Horas': 'bg-time-2h hover:bg-time-2h/90',
  '3 Horas': 'bg-time-3h hover:bg-time-3h/90',
  '4 Horas': 'bg-time-4h hover:bg-time-4h/90',
  '5 Horas': 'bg-time-5h hover:bg-time-5h/90',
  '6 Horas': 'bg-time-6h hover:bg-time-6h/90',
};

export function TimeButton({ tempo, available, onClick, disabled, loading }: TimeButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const colorClass = timeColors[tempo] || 'bg-primary hover:bg-primary/90';
  const isUnavailable = available === 0;

  const handleClick = () => {
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    onClick();
    setShowConfirm(false);
  };

  return (
    <>
      <Button
        onClick={handleClick}
        disabled={disabled || isUnavailable || loading}
        className={cn(
          'flex flex-col items-center justify-center h-32 w-full rounded-xl text-primary-foreground shadow-lg transition-all duration-300 transform hover:scale-105',
          isUnavailable ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60' : colorClass
        )}
      >
        <div className="flex items-center gap-2 mb-2">
          <Clock className="h-6 w-6" />
          <span className="text-xl font-bold">{tempo}</span>
        </div>
        <div className="flex items-center gap-2 text-sm opacity-90">
          <span className="font-medium">{available} disponíveis</span>
        </div>
        {!isUnavailable && (
          <div className="flex items-center gap-1 mt-2 text-xs opacity-80">
            <Printer className="h-4 w-4" />
            <span>Clique para imprimir</span>
          </div>
        )}
      </Button>

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Confirmar Impressão"
        description={`Deseja imprimir o voucher de ${tempo}?`}
        onConfirm={handleConfirm}
        confirmText="Imprimir"
        cancelText="Cancelar"
      />
    </>
  );
}

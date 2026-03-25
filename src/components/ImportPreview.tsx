import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, Loader2 } from 'lucide-react';
import { ParsedVoucher, normalizeTempoValidade } from '@/lib/voucher-utils';

interface ImportPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vouchers: ParsedVoucher[];
  onConfirm: (vouchers: ParsedVoucher[]) => Promise<void>;
  processing: boolean;
}

export function ImportPreview({ open, onOpenChange, vouchers, onConfirm, processing }: ImportPreviewProps) {
  // Group vouchers by tempo_validade
  const byTempo: Record<string, number> = {};
  for (const v of vouchers) {
    const tempo = normalizeTempoValidade(v.tempoValidade);
    byTempo[tempo] = (byTempo[tempo] || 0) + 1;
  }

  const handleConfirm = async () => {
    await onConfirm(vouchers);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirmar Importação</DialogTitle>
          <DialogDescription>
            Todos os vouchers serão enviados para processamento
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Total */}
          <div className="bg-primary/10 rounded-lg p-4 border border-primary/20 text-center">
            <span className="text-2xl font-bold text-primary">{vouchers.length}</span>
            <p className="text-sm text-muted-foreground">vouchers para importar</p>
          </div>

          {/* By Tempo */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Por tempo de validade:</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {Object.entries(byTempo).map(([tempo, count]) => (
                <div key={tempo} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                  <span className="font-medium text-sm">{tempo}</span>
                  <Badge variant="secondary" className="text-xs">
                    {count}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={processing}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={processing || vouchers.length === 0}
          >
            {processing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Importar {vouchers.length} vouchers
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

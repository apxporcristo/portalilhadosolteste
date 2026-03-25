import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Ticket, CheckCircle } from 'lucide-react';

interface VoucherViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vouchers: { voucher_id: string; tempo_validade: string }[];
  onConfirm: () => void;
  confirming?: boolean;
}

export function VoucherViewDialog({ open, onOpenChange, vouchers, onConfirm, confirming }: VoucherViewDialogProps) {
  if (vouchers.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            Voucher(s) Gerado(s)
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {vouchers.map((v, idx) => (
            <div key={v.voucher_id} className="border rounded-lg p-4 bg-muted/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Voucher #{idx + 1}</span>
                <Badge variant="secondary">{v.tempo_validade}</Badge>
              </div>
              <p className="font-mono text-lg font-bold text-foreground text-center tracking-wider">
                {v.voucher_id}
              </p>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button onClick={onConfirm} disabled={confirming}>
            <CheckCircle className="h-4 w-4 mr-2" />
            {confirming ? 'Confirmando...' : 'Confirmar e Marcar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

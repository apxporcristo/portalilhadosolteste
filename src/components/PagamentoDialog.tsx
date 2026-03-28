import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Check, Ticket, Loader2, Copy, Clock } from 'lucide-react';
import { FormaPagamento } from '@/hooks/useFormasPagamento';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

export interface PagamentoSelecionado {
  forma: FormaPagamento;
  valor: number;
}

interface VoucherPixConfig {
  canGenerateVoucher: boolean;
  voucherTempo: string | null; // specific tempo or null for all
  availableTempos: string[];
  availableByTempo: Record<string, number>;
  onGenerateVoucher: (tempo: string | null) => Promise<{ voucher_id: string; tempo_validade: string } | null>;
}

interface PagamentoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formasAtivas: FormaPagamento[];
  totalConta: number;
  titulo?: string;
  confirmLabel?: string;
  confirmIcon?: React.ReactNode;
  onConfirm: (pagamentos: PagamentoSelecionado[]) => void;
  onSave?: (pagamentos: PagamentoSelecionado[]) => void;
  saveLabel?: string;
  saveIcon?: React.ReactNode;
  children?: React.ReactNode;
  voucherPix?: VoucherPixConfig;
}

export function PagamentoDialog({
  open,
  onOpenChange,
  formasAtivas,
  totalConta,
  titulo = 'Forma de Pagamento',
  confirmLabel = 'Confirmar',
  confirmIcon,
  onConfirm,
  onSave,
  saveLabel = 'Salvar',
  saveIcon,
  children,
  voucherPix,
}: PagamentoDialogProps) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [generatingVoucher, setGeneratingVoucher] = useState(false);
  const [generatedVoucher, setGeneratedVoucher] = useState<{ voucher_id: string; tempo_validade: string } | null>(null);
  const [showTempoSelection, setShowTempoSelection] = useState(false);

  const resetState = () => {
    setSelected({});
    setGeneratedVoucher(null);
  };

  const toggleForma = (forma: FormaPagamento) => {
    setSelected(prev => {
      const next = { ...prev };
      if (next[forma.id] !== undefined) {
        delete next[forma.id];
      } else {
        const otherCount = Object.keys(next).length;
        next[forma.id] = otherCount === 0 ? totalConta.toFixed(2).replace('.', ',') : '';
      }
      return next;
    });
    // Clear generated voucher when toggling payment
    setGeneratedVoucher(null);
  };

  const setValor = (formaId: string, valor: string) => {
    setSelected(prev => ({ ...prev, [formaId]: valor }));
  };

  const selectedIds = Object.keys(selected);
  const selectedCount = selectedIds.length;

  const pagamentos = useMemo(() => {
    return selectedIds.map(id => {
      const forma = formasAtivas.find(f => f.id === id);
      const valor = parseFloat((selected[id] || '0').replace(',', '.')) || 0;
      return { forma: forma!, valor };
    }).filter(p => p.forma);
  }, [selected, formasAtivas, selectedIds]);

  const totalPago = useMemo(() => pagamentos.reduce((s, p) => s + p.valor, 0), [pagamentos]);
  const restante = totalConta - totalPago;
  const canConfirm = selectedCount > 0 && Math.abs(restante) < 0.01 && pagamentos.every(p => p.valor > 0);

  const trocoForma = selectedCount === 1 ? formasAtivas.find(f => f.id === selectedIds[0]) : null;
  const showTroco = trocoForma?.exibir_troco && totalPago > totalConta + 0.01;
  const troco = totalPago - totalConta;

  // Check if Pix is selected
  const pixSelected = useMemo(() => {
    return pagamentos.some(p => p.forma.nome.toLowerCase().includes('pix'));
  }, [pagamentos]);

  const showVoucherButton = pixSelected && voucherPix?.canGenerateVoucher && !generatedVoucher;

  const handleVoucherClick = () => {
    if (!voucherPix) return;
    if (voucherPix.voucherTempo) {
      // User has specific tempo - generate directly
      handleGenerateVoucher(voucherPix.voucherTempo);
    } else {
      // User has all tempos - show selection
      setShowTempoSelection(true);
    }
  };

  const handleGenerateVoucher = async (tempo: string) => {
    if (!voucherPix || generatingVoucher) return;
    setGeneratingVoucher(true);
    setShowTempoSelection(false);
    try {
      const result = await voucherPix.onGenerateVoucher(tempo);
      if (result) {
        setGeneratedVoucher(result);
        toast({ title: 'Voucher gerado!', description: `Voucher ${result.voucher_id} pré-reservado com sucesso.` });
      }
    } catch (err) {
      toast({ title: 'Erro', description: 'Não foi possível gerar o voucher.', variant: 'destructive' });
    } finally {
      setGeneratingVoucher(false);
    }
  };

  const handleConfirm = () => {
    if (!canConfirm && !showTroco) return;
    onConfirm(pagamentos);
    resetState();
  };

  const handleSave = () => {
    if (!canConfirm && !showTroco) return;
    onSave?.(pagamentos);
    resetState();
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) resetState();
    onOpenChange(v);
  };

  const copyVoucherId = () => {
    if (generatedVoucher) {
      navigator.clipboard.writeText(generatedVoucher.voucher_id).catch(() => {});
      toast({ title: 'Copiado!', description: 'Código do voucher copiado.' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        {/* Summary section */}
        <div className="bg-muted/50 rounded-lg p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Total da conta</span>
            <span className="text-lg font-bold text-primary">R$ {totalConta.toFixed(2).replace('.', ',')}</span>
          </div>
          {selectedCount > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Recebido</span>
                <span className="text-base font-bold text-primary">R$ {totalPago.toFixed(2).replace('.', ',')}</span>
              </div>
              {showTroco ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Troco</span>
                  <span className="text-base font-bold text-primary">R$ {troco.toFixed(2).replace('.', ',')}</span>
                </div>
              ) : restante > 0.01 ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Falta</span>
                  <span className="text-base font-bold text-destructive">R$ {restante.toFixed(2).replace('.', ',')}</span>
                </div>
              ) : restante < -0.01 && !showTroco ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Excedente</span>
                  <span className="text-base font-bold text-destructive">R$ {Math.abs(restante).toFixed(2).replace('.', ',')}</span>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Two-column header */}
        <div className="grid grid-cols-[1fr_auto] gap-2 px-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Forma de Pagto</span>
          <span className="text-xs font-semibold text-muted-foreground uppercase w-28 text-right">Valor</span>
        </div>

        {/* Payment methods - two column rows */}
        <div className="space-y-2">
          {formasAtivas.map(forma => {
            const isSelected = selected[forma.id] !== undefined;
            return (
              <div
                key={forma.id}
                className={cn(
                  "grid grid-cols-[1fr_auto] gap-2 items-center rounded-lg border p-3 transition-colors cursor-pointer",
                  isSelected ? "border-primary bg-primary/10 ring-1 ring-primary" : "hover:bg-muted/50"
                )}
                onClick={() => toggleForma(forma)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{forma.nome}</span>
                  {isSelected && (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <Check className="h-3 w-3" /> Selecionado
                    </Badge>
                  )}
                </div>
                <div className="w-28" onClick={e => e.stopPropagation()}>
                  {isSelected ? (
                    <Input
                      placeholder="0,00"
                      value={selected[forma.id]}
                      onChange={e => setValor(forma.id, e.target.value)}
                      className="h-8 text-right"
                      inputMode="decimal"
                      autoFocus
                    />
                  ) : (
                    <span className="block text-right text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            );
          })}
          {formasAtivas.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma forma de pagamento ativa.</p>
          )}
        </div>

        {/* Pix Voucher Generation */}
        {showVoucherButton && (
          <Button
            variant="outline"
            className="w-full border-primary/50 text-primary"
            onClick={handleGenerateVoucher}
            disabled={generatingVoucher}
          >
            {generatingVoucher ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando voucher...</>
            ) : (
              <><Ticket className="h-4 w-4 mr-2" /> Gerar voucher{voucherPix?.voucherTempo ? ` (${voucherPix.voucherTempo})` : ''}</>
            )}
          </Button>
        )}

        {/* Generated Voucher Display */}
        {generatedVoucher && (
          <div className="bg-primary/5 border-2 border-primary rounded-xl p-6 text-center space-y-2">
            <div className="flex items-center justify-center gap-2">
              <Ticket className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">Voucher Gerado</span>
            </div>
            <p className="text-3xl font-bold text-primary tracking-wider font-mono">
              {generatedVoucher.voucher_id}
            </p>
            <Badge variant="secondary" className="text-sm">{generatedVoucher.tempo_validade}</Badge>
            <Badge variant="outline" className="text-xs ml-2">Pré-reservado</Badge>
            <div className="pt-2">
              <Button variant="ghost" size="sm" onClick={copyVoucherId}>
                <Copy className="h-3 w-3 mr-1" /> Copiar código
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              onClick={handleConfirm}
              disabled={!canConfirm && !(showTroco && pagamentos.every(p => p.valor > 0))}
              className="flex-1"
            >
              {confirmIcon}
              {confirmLabel}
            </Button>
            {onSave && (
              <Button
                variant="secondary"
                onClick={handleSave}
                disabled={!canConfirm && !(showTroco && pagamentos.every(p => p.valor > 0))}
                className="flex-1"
              >
                {saveIcon}
                {saveLabel}
              </Button>
            )}
          </div>
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

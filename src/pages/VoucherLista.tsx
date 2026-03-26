import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Plus } from 'lucide-react';
import { useVouchers } from '@/hooks/useVouchers';
import { usePrinterContext } from '@/contexts/PrinterContext';
import { useVoucherCart } from '@/hooks/useVoucherCart';

import { VoucherCart } from '@/components/VoucherCart';
import { VoucherViewDialog } from '@/components/VoucherViewDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useOptionalUserSession } from '@/contexts/UserSessionContext';

const timeColors: Record<string, string> = {
  '1 Hora': 'bg-time-1h hover:bg-time-1h/90',
  '2 Horas': 'bg-time-2h hover:bg-time-2h/90',
  '3 Horas': 'bg-time-3h hover:bg-time-3h/90',
  '4 Horas': 'bg-time-4h hover:bg-time-4h/90',
  '5 Horas': 'bg-time-5h hover:bg-time-5h/90',
  '6 Horas': 'bg-time-6h hover:bg-time-6h/90',
};

export default function VoucherLista() {
  const navigate = useNavigate();
  const sessionCtx = useOptionalUserSession();
  const userAccess = sessionCtx?.access;
  const isSpecificTempo = !!(userAccess?.acesso_voucher && userAccess?.voucher_tempo_acesso);
  const allowedTempo = userAccess?.voucher_tempo_acesso || null;

  const {
    stats, loading,
    getFreVouchersBatch, markVouchersPreReservado,
  } = useVouchers();

  const { createVoucherData, ensureBluetoothConnected, writeToCharacteristic } = usePrinterContext();
  const cart = useVoucherCart();

  const [batchPrinting, setBatchPrinting] = useState(false);
  const [viewVouchers, setViewVouchers] = useState<{ voucher_id: string; tempo_validade: string }[]>([]);

  const handleAddToCart = useCallback((tempo: string) => {
    const inCart = cart.items.find(i => i.tempo === tempo)?.quantity || 0;
    const available = stats.livresPorTempo[tempo] || 0;
    if (inCart >= available) {
      toast({ title: 'Limite atingido', description: `Todos os ${available} voucher(s) de ${tempo} já estão no carrinho.` });
      return;
    }
    cart.addItem(tempo);
  }, [cart, stats.livresPorTempo]);

  const handleBatchPrint = useCallback(async () => {
    setBatchPrinting(true);
    try {
      const voucherItems = cart.items;
      const selectedVouchers = voucherItems.length > 0 ? getFreVouchersBatch(voucherItems) : [];
      if (selectedVouchers.length === 0) { setBatchPrinting(false); return; }

      // Connect to Bluetooth (auto-reconnect with 3 retries)
      const characteristic = await ensureBluetoothConnected();
      if (!characteristic) {
        toast({ title: 'Impressora não conectada', description: 'Não foi possível conectar à impressora Bluetooth.', variant: 'destructive' });
        setBatchPrinting(false);
        return;
      }

      // Generate ESC/POS data and print directly via Bluetooth
      for (const v of selectedVouchers) {
        const escposData = await createVoucherData(v.voucher_id, v.tempo_validade);
        await writeToCharacteristic(characteristic, escposData);
      }

      // Mark vouchers as pre-reserved
      await markVouchersPreReservado(selectedVouchers.map(v => v.voucher_id));
      toast({ title: 'Impresso!', description: `${selectedVouchers.length} voucher(s) impresso(s) com sucesso.` });
      cart.clearCart();
    } catch (error) {
      console.error('Erro na impressão em lote:', error);
      toast({ title: 'Erro', description: 'Ocorreu um erro durante a impressão.', variant: 'destructive' });
    } finally {
      setBatchPrinting(false);
    }
  }, [cart, getFreVouchersBatch, markVouchersPreReservado, createVoucherData, ensureBluetoothConnected, writeToCharacteristic]);

  const handleViewVoucher = useCallback(async () => {
    setBatchPrinting(true);
    try {
      const voucherItems = cart.items;
      const selectedVouchers = voucherItems.length > 0 ? getFreVouchersBatch(voucherItems) : [];
      if (selectedVouchers.length === 0) { setBatchPrinting(false); return; }
      setViewVouchers(selectedVouchers.map(v => ({ voucher_id: v.voucher_id, tempo_validade: v.tempo_validade })));
    } catch (error) {
      console.error('Erro ao visualizar vouchers:', error);
      toast({ title: 'Erro', description: 'Ocorreu um erro ao gerar os vouchers.', variant: 'destructive' });
    } finally {
      setBatchPrinting(false);
    }
  }, [cart, getFreVouchersBatch]);

  const handleConfirmViewVouchers = useCallback(async () => {
    setBatchPrinting(true);
    try {
      const ids = viewVouchers.map(v => v.voucher_id);
      if (ids.length > 0) await markVouchersPreReservado(ids);
      toast({ title: 'Vouchers confirmados!', description: `${ids.length} voucher(s) marcados como pré-reservado.` });
      cart.clearCart();
      setViewVouchers([]);
    } catch (error) {
      console.error('Erro ao confirmar vouchers:', error);
      toast({ title: 'Erro', description: 'Ocorreu um erro ao confirmar os vouchers.', variant: 'destructive' });
    } finally {
      setBatchPrinting(false);
    }
  }, [viewVouchers, markVouchersPreReservado, cart]);

  const temposComVouchersLivres = stats.temposDisponiveis.filter(
    tempo => {
      if ((stats.livresPorTempo[tempo] || 0) <= 0) return false;
      if (isSpecificTempo && tempo !== allowedTempo) return false;
      return true;
    }
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-full mx-auto px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-foreground">Lista de Vouchers</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
        <Alert variant="default" className="border">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="font-medium">
            {isSpecificTempo
              ? `Selecione vouchers de ${allowedTempo} e visualize na tela`
              : 'Selecione os vouchers desejados e imprima todos de uma vez'}
          </AlertDescription>
        </Alert>

        {temposComVouchersLivres.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {temposComVouchersLivres.map((tempo) => {
              const available = stats.livresPorTempo[tempo] || 0;
              const inCart = cart.items.find(i => i.tempo === tempo)?.quantity || 0;
              const colorClass = timeColors[tempo] || 'bg-primary hover:bg-primary/90';
              return (
                <Button key={tempo} onClick={() => handleAddToCart(tempo)} disabled={batchPrinting || inCart >= available}
                  className={cn('flex flex-col items-center justify-center h-32 w-full rounded-xl text-primary-foreground shadow-lg transition-all duration-300 transform hover:scale-105 relative', colorClass)}>
                  {inCart > 0 && (
                    <Badge className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground text-sm px-2">{inCart}</Badge>
                  )}
                  <span className="text-xl font-bold mb-1">{tempo}</span>
                  <span className="text-sm opacity-90">{available} disponíveis</span>
                  <div className="flex items-center gap-1 mt-2 text-xs opacity-80">
                    <Plus className="h-4 w-4" /><span>Adicionar</span>
                  </div>
                </Button>
              );
            })}
          </div>
        ) : (
          <Alert className="max-w-md mx-auto">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Nenhum voucher disponível no momento.</AlertDescription>
          </Alert>
        )}

        <VoucherCart
          items={cart.items}
          onAdd={(tempo, opts) => cart.addItem(tempo, opts)}
          onRemove={(tempo, fichaType) => cart.removeItem(tempo, fichaType)}
          onRemoveAll={(tempo, fichaType) => cart.removeAll(tempo, fichaType)}
          onClear={cart.clearCart}
          onPrint={isSpecificTempo ? handleViewVoucher : handleBatchPrint}
          totalItems={cart.totalItems}
          printing={batchPrinting}
          availableByTempo={stats.livresPorTempo}
          viewMode={isSpecificTempo}
        />
      </main>

      <VoucherViewDialog
        open={viewVouchers.length > 0}
        onOpenChange={(open) => { if (!open) setViewVouchers([]); }}
        vouchers={viewVouchers}
        onConfirm={handleConfirmViewVouchers}
        confirming={batchPrinting}
      />
    </div>
  );
}

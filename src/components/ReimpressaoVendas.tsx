import { useState, useEffect, useCallback } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { getSupabaseClient } from '@/hooks/useVouchers';
import { getPrintLayoutConfig } from '@/hooks/usePrintLayout';
import { usePrinterContext } from '@/contexts/PrinterContext';
import { useFichasConsumo } from '@/hooks/useFichasConsumo';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Printer, RefreshCw, FileText, Eye } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface VendaItem {
  id: string;
  produto_id: string;
  produto_nome: string;
  categoria_nome: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  nome_cliente: string | null;
  nome_atendente: string | null;
  telefone_cliente: string | null;
  codigo_venda: string;
  created_at: string;
}

interface VendaGroup {
  codigo_venda: string;
  items: VendaItem[];
  total: number;
  hora: string;
  atendente: string | null;
  cliente: string | null;
}

export function ReimpressaoVendas() {
  const [vendas, setVendas] = useState<VendaGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVenda, setSelectedVenda] = useState<VendaGroup | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState(false);
  const { ensureBluetoothConnected, writeToCharacteristic } = usePrinterContext();
  const { produtos } = useFichasConsumo();

  const fetchVendasDoDia = useCallback(async () => {
    setLoading(true);
    try {
      const sbClient = await getSupabaseClient();
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

      const { data, error } = await sbClient
        .from('fichas_impressas' as any)
        .select('*')
        .gte('created_at', startOfDay)
        .lt('created_at', endOfDay)
        .not('codigo_venda', 'is', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Group by codigo_venda
      const groups: Record<string, VendaGroup> = {};
      for (const item of (data || []) as VendaItem[]) {
        const key = item.codigo_venda;
        if (!key) continue;
        if (!groups[key]) {
          const createdAt = new Date(item.created_at);
          groups[key] = {
            codigo_venda: key,
            items: [],
            total: 0,
            hora: createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            atendente: item.nome_atendente,
            cliente: item.nome_cliente,
          };
        }
        groups[key].items.push(item);
        groups[key].total += Number(item.valor_total);
      }

      setVendas(Object.values(groups));
    } catch (err) {
      console.error('Erro ao buscar vendas:', err);
      toast({ title: 'Erro', description: 'Não foi possível carregar as vendas do dia.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVendasDoDia(); }, [fetchVendasDoDia]);

  const generateReprintEscPos = (item: VendaItem, dateStr: string, timeStr: string, codigoVenda: string): Uint8Array => {
    const layoutCfg = getPrintLayoutConfig();
    const normalize = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const escposSizeCmd = (size: number): string => {
      if (size >= 15) return '\x1D\x21\x11';
      if (size >= 11) return '\x1D\x21\x01';
      return '\x1D\x21\x00';
    };

    const titleCmd = escposSizeCmd(layoutCfg.fichaTitleFontSize ?? 10);
    const subtitleCmd = escposSizeCmd(layoutCfg.fichaSubtitleFontSize ?? 8);
    const numberCmd = escposSizeCmd(layoutCfg.fichaNumberFontSize ?? 12);
    const dataCmd = escposSizeCmd(layoutCfg.fichaDataFontSize ?? 6);
    const clienteCmd = escposSizeCmd(layoutCfg.fichaClienteFontSize ?? 8);
    const atendenteCmd = escposSizeCmd(layoutCfg.fichaAtendenteFontSize ?? 8);

    const lines = [
      '\x1B\x40', '\x1B\x61\x01',
      dataCmd, normalize(`Venda: ${codigoVenda}`), '\n',
      dataCmd, normalize('** REIMPRESSAO **'), '\n',
      titleCmd, normalize('Ficha de consumo'), '\n',
      subtitleCmd, normalize(`Categoria: ${item.categoria_nome}`), '\n',
      numberCmd, normalize(item.produto_nome.split(' | ')[0]), '\n',
    ];

    // Complementos from produto_nome
    const parts = item.produto_nome.split(' | ');
    if (parts.length > 1) {
      lines.push('\x1D\x21\x00', '- - - - - - - - - - - - - - - -\n');
      const comps = parts.slice(1).join(' | ').split(', ');
      for (const comp of comps) {
        lines.push(subtitleCmd, normalize(comp), '\n');
      }
    }

    if (item.nome_cliente || item.nome_atendente) {
      lines.push('\x1D\x21\x00', '- - - - - - - - - - - - - - - -\n');
      if (item.nome_cliente) lines.push(clienteCmd, normalize(`Cliente: ${item.nome_cliente}`), '\n');
      if (item.nome_atendente) lines.push(atendenteCmd, normalize(`Atendente: ${item.nome_atendente}`), '\n');
    }

    lines.push(dataCmd, `Data: ${dateStr} ${timeStr}`, '\n', '\x1D\x21\x00', '--------------------------------', '\n\n\n', '\x1D\x56\x00');

    return new TextEncoder().encode(lines.join(''));
  };

  const handleReprint = async (venda: VendaGroup, mode: 'all' | 'printable' | 'selected') => {
    setPrinting(true);
    try {
      const characteristic = await ensureBluetoothConnected();
      if (!characteristic) {
        toast({ title: 'Impressora não conectada', variant: 'destructive' });
        setPrinting(false);
        return;
      }

      const now = new Date();
      const dateStr = now.toLocaleDateString('pt-BR');
      const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      let itemsToPrint = venda.items;
      if (mode === 'printable') {
        itemsToPrint = venda.items.filter(item => {
          const produto = produtos.find(p => p.id === item.produto_id);
          return (produto as any)?.imprimir_ficha !== false;
        });
      } else if (mode === 'selected') {
        itemsToPrint = venda.items.filter(item => selectedItemIds.has(item.id));
      }

      if (itemsToPrint.length === 0) {
        toast({ title: 'Nenhum item para reimprimir', description: 'Nenhum produto selecionado para impressão.' });
        setPrinting(false);
        return;
      }

      for (const item of itemsToPrint) {
        for (let i = 0; i < item.quantidade; i++) {
          const escpos = generateReprintEscPos(item, dateStr, timeStr, venda.codigo_venda);
          await writeToCharacteristic(characteristic, escpos);
        }
      }

      toast({ title: 'Reimpressão enviada!', description: `Venda ${venda.codigo_venda} - ${itemsToPrint.length} item(ns) reimpresso(s).` });
      setSelectedVenda(null);
      setSelectedItemIds(new Set());
    } catch (err) {
      console.error('Erro na reimpressão:', err);
      toast({ title: 'Erro', description: 'Falha na reimpressão.', variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  if (loading) return <Skeleton className="h-48 w-full" />;

  return (
    <>
      <Card className="w-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Printer className="h-5 w-5 text-primary" />
              Reimpressão de Vendas
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={fetchVendasDoDia} className="h-8 w-8">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {vendas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma venda registrada hoje.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {vendas.map(venda => (
                <button
                  key={venda.codigo_venda}
                  onClick={() => setSelectedVenda(venda)}
                  className="w-full flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-primary">{venda.codigo_venda}</span>
                      <Badge variant="outline" className="text-xs">{venda.hora}</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      {venda.atendente && <span>{venda.atendente}</span>}
                      {venda.cliente && <span>• {venda.cliente}</span>}
                      <span>• {venda.items.length} item(ns)</span>
                    </div>
                  </div>
                  <span className="font-bold text-primary whitespace-nowrap ml-2">
                    R$ {venda.total.toFixed(2).replace('.', ',')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detalhes da venda para reimpressão */}
      <Dialog open={!!selectedVenda} onOpenChange={(open) => { if (!open) { setSelectedVenda(null); setSelectedItemIds(new Set()); } }}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-primary" />
              Venda {selectedVenda?.codigo_venda}
            </DialogTitle>
          </DialogHeader>

          {selectedVenda && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">{selectedVenda.hora}</Badge>
                {selectedVenda.atendente && <span>Atendente: {selectedVenda.atendente}</span>}
                {selectedVenda.cliente && <span>• Cliente: {selectedVenda.cliente}</span>}
              </div>

              <div className="border rounded-lg divide-y">
                {selectedVenda.items.map(item => {
                  const produto = produtos.find(p => p.id === item.produto_id);
                  const isPrintable = (produto as any)?.imprimir_ficha !== false;
                  const isSelected = selectedItemIds.has(item.id);
                  return (
                    <label key={item.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          setSelectedItemIds(prev => {
                            const next = new Set(prev);
                            if (checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{item.produto_nome}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">{item.quantidade}x R$ {Number(item.valor_unitario).toFixed(2).replace('.', ',')}</span>
                          {isPrintable && <Badge variant="secondary" className="text-[10px]">Imprimível</Badge>}
                        </div>
                      </div>
                      <span className="text-sm font-bold text-primary">R$ {Number(item.valor_total).toFixed(2).replace('.', ',')}</span>
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t pt-3">
                <span className="font-semibold">Total</span>
                <span className="text-lg font-bold text-primary">R$ {selectedVenda.total.toFixed(2).replace('.', ',')}</span>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => selectedVenda && handleReprint(selectedVenda, 'all')}
              disabled={printing}
            >
              <FileText className="h-4 w-4 mr-2" />
              {printing ? 'Imprimindo...' : 'Reimprimir tudo (conferência)'}
            </Button>
            {selectedItemIds.size > 0 && (
              <Button
                className="w-full sm:w-auto"
                onClick={() => selectedVenda && handleReprint(selectedVenda, 'selected')}
                disabled={printing}
              >
                <Printer className="h-4 w-4 mr-2" />
                {printing ? 'Imprimindo...' : `Reimprimir fichas (${selectedItemIds.size})`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChefHat, Clock, Printer, Check, Eye, Filter, RefreshCw, Play, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useKdsOrders, KdsOrder, KdsStatus } from '@/hooks/useKdsOrders';
import { usePrinterContext } from '@/contexts/PrinterContext';

const statusConfig: Record<KdsStatus, { label: string; color: string; icon: React.ReactNode }> = {
  novo: { label: 'Novo', color: 'bg-red-500 text-white', icon: <Clock className="h-4 w-4" /> },
  em_preparo: { label: 'Em Preparo', color: 'bg-yellow-500 text-white', icon: <ChefHat className="h-4 w-4" /> },
  pronto: { label: 'Pronto', color: 'bg-green-500 text-white', icon: <Check className="h-4 w-4" /> },
  impresso: { label: 'Impresso', color: 'bg-blue-500 text-white', icon: <Printer className="h-4 w-4" /> },
  entregue: { label: 'Entregue', color: 'bg-muted text-muted-foreground', icon: <CheckCircle className="h-4 w-4" /> },
};

const filterOptions: { value: KdsStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Ativos' },
  { value: 'novo', label: 'Novos' },
  { value: 'em_preparo', label: 'Em Preparo' },
  { value: 'pronto', label: 'Prontos' },
  { value: 'impresso', label: 'Impressos' },
  { value: 'entregue', label: 'Entregues' },
];

export default function KdsPage() {
  const navigate = useNavigate();
  const { orders, loading, statusFilter, setStatusFilter, updateStatus, refetch } = useKdsOrders();
  const printerCtx = usePrinterContext();
  const [detailOrder, setDetailOrder] = useState<KdsOrder | null>(null);
  const [printing, setPrinting] = useState(false);

  const handleStatusChange = async (order: KdsOrder, newStatus: KdsStatus) => {
    try {
      await updateStatus(order.id, newStatus);
      toast({ title: `Pedido atualizado para "${statusConfig[newStatus].label}"` });
    } catch {
      toast({ title: 'Erro ao atualizar status', variant: 'destructive' });
    }
  };

  const handlePrint = async (order: KdsOrder) => {
    setPrinting(true);
    try {
      // Connect to Bluetooth (auto-reconnect with 3 retries)
      const characteristic = await printerCtx.ensureBluetoothConnected();
      if (!characteristic) {
        toast({ title: 'Impressora não conectada', description: 'Não foi possível conectar à impressora Bluetooth.', variant: 'destructive' });
        setPrinting(false);
        return;
      }

      // Generate ESC/POS
      const normalize = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const lines = [
        '\x1B\x40', '\x1B\x61\x01',
        '\x1D\x21\x11', normalize('PEDIDO KDS'), '\n',
        '\x1D\x21\x00', '================================\n',
        '\x1D\x21\x01', normalize(order.produto_nome), '\n',
        '\x1D\x21\x00',
        `Qtd: ${order.quantidade}\n`,
      ];
      if (order.complementos) {
        lines.push(`Complementos: ${normalize(order.complementos)}\n`);
      }
      if (order.observacao) {
        lines.push(`Obs: ${normalize(order.observacao)}\n`);
      }
      lines.push('--------------------------------\n');
      if (order.nome_cliente) lines.push(`Cliente: ${normalize(order.nome_cliente)}\n`);
      if (order.nome_atendente) lines.push(`Atendente: ${normalize(order.nome_atendente)}\n`);
      lines.push(`Data: ${new Date(order.created_at).toLocaleString('pt-BR')}\n`);
      lines.push('================================\n\n\n', '\x1D\x56\x00');

      const data = new TextEncoder().encode(lines.join(''));
      await printerCtx.writeToCharacteristic(characteristic, data);

      await updateStatus(order.id, 'impresso');
      toast({ title: 'Impresso com sucesso!' });
    } catch (err) {
      toast({ title: 'Erro ao imprimir', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR');
  };

  const getTimeSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min`;
    return `${Math.floor(mins / 60)}h${mins % 60}min`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          <Skeleton className="h-12 w-full" />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-48" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-full mx-auto px-3 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <ChefHat className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold text-foreground">KDS - Cozinha</h1>
            </div>
            <Badge variant="secondary">{orders.length} pedido(s)</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="max-w-full mx-auto px-3 sm:px-6 py-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {filterOptions.map(opt => (
            <Button
              key={opt.value}
              variant={statusFilter === opt.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(opt.value)}
              className="shrink-0"
            >
              <Filter className="h-3 w-3 mr-1" />
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Orders grid */}
      <main className="max-w-full mx-auto px-3 sm:px-6 pb-6">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <ChefHat className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg">Nenhum pedido no momento</p>
            <p className="text-sm">Os pedidos aparecerão aqui automaticamente</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {orders.map(order => {
              const config = statusConfig[order.kds_status];
              const isNew = order.kds_status === 'novo';
              return (
                <Card
                  key={order.id}
                  className={cn(
                    "transition-all cursor-pointer hover:shadow-lg border-2",
                    isNew && "border-red-500 animate-pulse ring-2 ring-red-500/30",
                    order.kds_status === 'em_preparo' && "border-yellow-500",
                    order.kds_status === 'pronto' && "border-green-500",
                    order.kds_status === 'impresso' && "border-blue-500",
                    order.kds_status === 'entregue' && "border-muted opacity-60",
                  )}
                  onClick={() => setDetailOrder(order)}
                >
                  <CardContent className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <Badge className={cn(config.color, "flex items-center gap-1")}>
                        {config.icon}
                        {config.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono">
                        {getTimeSince(order.created_at)}
                      </span>
                    </div>

                    {/* Product */}
                    <div>
                      <h3 className="font-bold text-lg text-foreground leading-tight">{order.produto_nome}</h3>
                      <p className="text-sm text-muted-foreground">{order.categoria_nome}</p>
                    </div>

                    {/* Quantity */}
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-base font-bold px-3 py-1">
                        x{order.quantidade}
                      </Badge>
                      <span className="text-sm font-medium text-primary">
                        R$ {Number(order.valor_total).toFixed(2).replace('.', ',')}
                      </span>
                    </div>

                    {/* Complementos */}
                    {order.complementos && (
                      <p className="text-xs text-muted-foreground bg-muted rounded px-2 py-1 line-clamp-2">
                        {order.complementos}
                      </p>
                    )}

                    {/* Client/Attendant */}
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {order.nome_atendente && <p>Atendente: {order.nome_atendente}</p>}
                      {order.nome_cliente && <p>Cliente: {order.nome_cliente}</p>}
                      <p>{formatTime(order.created_at)} - {formatDate(order.created_at)}</p>
                    </div>

                    {/* Quick actions - cozinha: apenas novo→em_preparo e em_preparo→pronto */}
                    <div className="flex gap-1 pt-1" onClick={e => e.stopPropagation()}>
                      {order.kds_status === 'novo' && (
                        <Button size="sm" className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white" onClick={() => handleStatusChange(order, 'em_preparo')}>
                          <Play className="h-3 w-3 mr-1" /> Em Preparo
                        </Button>
                      )}
                      {order.kds_status === 'em_preparo' && (
                        <Button size="sm" className="flex-1 bg-green-500 hover:bg-green-600 text-white" onClick={() => handleStatusChange(order, 'pronto')}>
                          <Check className="h-3 w-3 mr-1" /> Pronto
                        </Button>
                      )}
                      {(order.kds_status === 'novo' || order.kds_status === 'em_preparo') && (
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => handlePrint(order)} disabled={printing}>
                          <Printer className="h-3 w-3 mr-1" /> Imprimir
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Detail modal */}
      <Dialog open={!!detailOrder} onOpenChange={(open) => !open && setDetailOrder(null)}>
        <DialogContent className="max-w-md">
          {detailOrder && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ChefHat className="h-5 w-5 text-primary" />
                  Detalhes do Pedido
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Badge className={cn(statusConfig[detailOrder.kds_status].color, "flex items-center gap-1")}>
                    {statusConfig[detailOrder.kds_status].icon}
                    {statusConfig[detailOrder.kds_status].label}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{getTimeSince(detailOrder.created_at)}</span>
                </div>

                <div className="space-y-2 border rounded-lg p-4">
                  <h3 className="font-bold text-xl text-foreground">{detailOrder.produto_nome}</h3>
                  <p className="text-sm text-muted-foreground">Categoria: {detailOrder.categoria_nome}</p>
                  <div className="flex items-center gap-4">
                    <span className="font-bold text-lg">x{detailOrder.quantidade}</span>
                    <span className="font-bold text-primary text-lg">R$ {Number(detailOrder.valor_total).toFixed(2).replace('.', ',')}</span>
                  </div>
                </div>

                {detailOrder.complementos && (
                  <div className="border rounded-lg p-4">
                    <p className="text-sm font-semibold mb-1">Complementos</p>
                    <p className="text-sm text-muted-foreground">{detailOrder.complementos}</p>
                  </div>
                )}

                {detailOrder.observacao && (
                  <div className="border rounded-lg p-4">
                    <p className="text-sm font-semibold mb-1">Observação</p>
                    <p className="text-sm text-muted-foreground">{detailOrder.observacao}</p>
                  </div>
                )}

                <div className="border rounded-lg p-4 space-y-1 text-sm">
                  {detailOrder.nome_atendente && <p><span className="font-medium">Atendente:</span> {detailOrder.nome_atendente}</p>}
                  {detailOrder.nome_cliente && <p><span className="font-medium">Cliente:</span> {detailOrder.nome_cliente}</p>}
                  {detailOrder.telefone_cliente && <p><span className="font-medium">Telefone:</span> {detailOrder.telefone_cliente}</p>}
                  <p><span className="font-medium">Data:</span> {formatDate(detailOrder.created_at)} {formatTime(detailOrder.created_at)}</p>
                </div>
              </div>
              <DialogFooter className="flex flex-wrap gap-2">
                {detailOrder.kds_status === 'novo' && (
                  <Button className="bg-yellow-500 hover:bg-yellow-600 text-white" onClick={() => { handleStatusChange(detailOrder, 'em_preparo'); setDetailOrder(null); }}>
                    <Play className="h-4 w-4 mr-1" /> Em Preparo
                  </Button>
                )}
                {detailOrder.kds_status === 'em_preparo' && (
                  <Button className="bg-green-500 hover:bg-green-600 text-white" onClick={() => { handleStatusChange(detailOrder, 'pronto'); setDetailOrder(null); }}>
                    <Check className="h-4 w-4 mr-1" /> Pronto
                  </Button>
                )}
                {(detailOrder.kds_status === 'novo' || detailOrder.kds_status === 'em_preparo') && (
                  <Button variant="outline" onClick={() => handlePrint(detailOrder)} disabled={printing}>
                    <Printer className="h-4 w-4 mr-1" /> Imprimir
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

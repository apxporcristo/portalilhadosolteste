import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChefHat, Clock, Printer, Check, Eye, RefreshCw, Play, CheckCircle, Search, Flame, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useKdsOrders, KdsOrder, KdsStatus } from '@/hooks/useKdsOrders';
import { parseComplementos } from '@/lib/kds-complementos';
import { usePrinterContext } from '@/contexts/PrinterContext';
import { useOptionalUserSession } from '@/contexts/UserSessionContext';

const statusConfig: Record<KdsStatus, { label: string; color: string; icon: React.ReactNode }> = {
  novo: { label: 'Novo', color: 'bg-red-500 text-white', icon: <Clock className="h-4 w-4" /> },
  em_preparo: { label: 'Em Preparo', color: 'bg-yellow-500 text-white', icon: <ChefHat className="h-4 w-4" /> },
  pronto: { label: 'Pronto', color: 'bg-green-500 text-white', icon: <Check className="h-4 w-4" /> },
  impresso: { label: 'Impresso', color: 'bg-blue-500 text-white', icon: <Printer className="h-4 w-4" /> },
  entregue: { label: 'Entregue', color: 'bg-muted text-muted-foreground', icon: <CheckCircle className="h-4 w-4" /> },
};

function sortByUser(orders: KdsOrder[], userId: string | null): KdsOrder[] {
  if (!userId) return orders;
  return [...orders].sort((a, b) => {
    const aUser = (a as any).atendente_user_id === userId ? 0 : 1;
    const bUser = (b as any).atendente_user_id === userId ? 0 : 1;
    if (aUser !== bUser) return aUser - bUser;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

function filterBySearch(orders: KdsOrder[], search: string): KdsOrder[] {
  if (!search.trim()) return orders;
  const term = search.toLowerCase();
  return orders.filter(o =>
    (o.nome_cliente && o.nome_cliente.toLowerCase().includes(term)) ||
    (o.produto_nome && o.produto_nome.toLowerCase().includes(term))
  );
}

export default function KdsPage() {
  const navigate = useNavigate();
  const { allOrders, loading, updateStatus, refetch } = useKdsOrders();
  const printerCtx = usePrinterContext();
  const userSession = useOptionalUserSession();
  const userId = userSession?.user?.id || null;
  const hasFullKds = userSession?.access?.acesso_kds === true;
  const [detailOrder, setDetailOrder] = useState<KdsOrder | null>(null);
  const [printing, setPrinting] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Split orders by status
  const emPreparo = useMemo(() => {
    const filtered = allOrders.filter(o => o.kds_status === 'novo' || o.kds_status === 'em_preparo');
    return filterBySearch(sortByUser(filtered, userId), search);
  }, [allOrders, userId, search]);

  const prontos = useMemo(() => {
    const filtered = allOrders.filter(o => o.kds_status === 'pronto' || o.kds_status === 'impresso');
    return filterBySearch(sortByUser(filtered, userId), search);
  }, [allOrders, userId, search]);

  const entregues = useMemo(() => {
    const filtered = allOrders.filter(o => o.kds_status === 'entregue');
    return filterBySearch(sortByUser(filtered, userId), search);
  }, [allOrders, userId, search]);

  const handleStatusChange = async (order: KdsOrder, newStatus: KdsStatus) => {
    try {
      await updateStatus(order.id, newStatus);
      toast({ title: `Pedido atualizado para "${statusConfig[newStatus].label}"` });
    } catch {
      toast({ title: 'Erro ao atualizar status', variant: 'destructive' });
    }
  };

  const handleEntregue = async (orderId: string) => {
    setMarkingId(orderId);
    try {
      await updateStatus(orderId, 'entregue');
      toast({ title: 'Pedido marcado como entregue!' });
      if (detailOrder?.id === orderId) setDetailOrder(null);
    } catch {
      toast({ title: 'Erro ao marcar como entregue', variant: 'destructive' });
    } finally {
      setMarkingId(null);
    }
  };

  const handlePrint = async (order: KdsOrder) => {
    setPrinting(true);
    try {
      const characteristic = await printerCtx.ensureBluetoothConnected();
      if (!characteristic) {
        toast({ title: 'Impressora não conectada', description: 'Não foi possível conectar à impressora Bluetooth.', variant: 'destructive' });
        setPrinting(false);
        return;
      }
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
        const items = parseComplementos(order.complementos);
        if (items.length > 0) {
          lines.push('Complementos:\n');
          items.forEach(c => lines.push(`  - ${normalize(c)}\n`));
        }
      }
      if (order.observacao) lines.push(`Obs: ${normalize(order.observacao)}\n`);
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

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('pt-BR');

  const getTimeSince = (dateStr: string) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min`;
    return `${Math.floor(mins / 60)}h${mins % 60}min`;
  };

  const renderOrderCard = (order: KdsOrder, showEntregueBtn: boolean) => {
    const config = statusConfig[order.kds_status];
    const isNew = order.kds_status === 'novo';
    return (
      <Card
        key={order.id}
        className={cn(
          "transition-all cursor-pointer hover:shadow-lg border-2",
          isNew && "border-red-500 animate-pulse ring-2 ring-red-500/30",
          order.kds_status === 'em_preparo' && "border-yellow-500",
          (order.kds_status === 'pronto' || order.kds_status === 'impresso') && "border-green-500",
          order.kds_status === 'entregue' && "border-muted opacity-60",
        )}
        onClick={() => setDetailOrder(order)}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Badge className={cn(config.color, "flex items-center gap-1")}>
              {config.icon}
              {config.label}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">
              {getTimeSince(order.created_at)}
            </span>
          </div>

          <div>
            <h3 className="font-bold text-lg text-foreground leading-tight">{order.produto_nome}</h3>
            <p className="text-sm text-muted-foreground">{order.categoria_nome}</p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-base font-bold px-3 py-1">
              x{order.quantidade}
            </Badge>
            <span className="text-sm font-medium text-primary">
              R$ {Number(order.valor_total).toFixed(2).replace('.', ',')}
            </span>
          </div>

          {order.complementos && (() => {
            const items = parseComplementos(order.complementos);
            return items.length > 0 ? (
              <div className="text-xs text-muted-foreground bg-muted rounded px-2 py-1 space-y-0.5">
                <span className="font-semibold">Complementos:</span>
                {items.map((c, i) => <p key={i}>• {c}</p>)}
              </div>
            ) : null;
          })()}

          {order.observacao && (
            <p className="text-xs text-muted-foreground italic bg-muted rounded px-2 py-1">
              Obs: {order.observacao}
            </p>
          )}

          <div className="text-xs text-muted-foreground space-y-0.5">
            {order.nome_atendente && <p>Atendente: {order.nome_atendente}</p>}
            {order.nome_cliente && <p>Cliente: {order.nome_cliente}</p>}
            <p>{formatTime(order.created_at)} - {formatDate(order.created_at)}</p>
          </div>

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
            {showEntregueBtn && (
              <Button
                size="sm"
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                disabled={markingId === order.id}
                onClick={() => handleEntregue(order.id)}
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                {markingId === order.id ? 'Salvando...' : 'Entregue ao cliente'}
              </Button>
            )}
            {(order.kds_status === 'novo' || order.kds_status === 'em_preparo') && (
              <Button size="sm" variant="outline" onClick={() => handlePrint(order)} disabled={printing}>
                <Printer className="h-3 w-3 mr-1" /> Imprimir
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
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

  const totalActive = emPreparo.length + prontos.length;

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
            {totalActive > 0 && (
              <Badge variant="secondary">{totalActive} pedido(s)</Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Atualizar
          </Button>
        </div>
      </header>

      <main className="max-w-full mx-auto px-3 sm:px-6 py-4 space-y-4">
        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente ou produto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="em_preparo" className="w-full">
          <TabsList className="w-full max-w-lg grid grid-cols-3">
            <TabsTrigger value="em_preparo" className="flex items-center gap-1 text-xs sm:text-sm">
              <Flame className="h-3 w-3" />
              Preparação
              {emPreparo.length > 0 && <Badge variant="outline" className="ml-1 text-[10px] px-1">{emPreparo.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="prontos" className="flex items-center gap-1 text-xs sm:text-sm">
              <ChefHat className="h-3 w-3" />
              Prontos
              {prontos.length > 0 && <Badge variant="outline" className="ml-1 text-[10px] px-1">{prontos.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="entregues" className="flex items-center gap-1 text-xs sm:text-sm">
              <CheckCircle2 className="h-3 w-3" />
              Entregues
            </TabsTrigger>
          </TabsList>

          <TabsContent value="em_preparo" className="mt-4">
            {emPreparo.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <ChefHat className="h-12 w-12 mb-3 opacity-30" />
                <p>Nenhum pedido em preparação</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {emPreparo.map(order => renderOrderCard(order, false))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="prontos" className="mt-4">
            {prontos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Check className="h-12 w-12 mb-3 opacity-30" />
                <p>Nenhum pedido pronto</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {prontos.map(order => renderOrderCard(order, true))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="entregues" className="mt-4">
            {entregues.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <CheckCircle className="h-12 w-12 mb-3 opacity-30" />
                <p>Nenhum pedido entregue</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {entregues.map(order => renderOrderCard(order, false))}
              </div>
            )}
          </TabsContent>
        </Tabs>
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

                {detailOrder.complementos && (() => {
                  const items = parseComplementos(detailOrder.complementos);
                  return items.length > 0 ? (
                    <div className="border rounded-lg p-4">
                      <p className="text-sm font-semibold mb-1">Complementos</p>
                      <ul className="text-sm text-muted-foreground space-y-0.5">
                        {items.map((c, i) => <li key={i}>• {c}</li>)}
                      </ul>
                    </div>
                  ) : null;
                })()}

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
                {(detailOrder.kds_status === 'pronto' || detailOrder.kds_status === 'impresso') && (
                  <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={markingId === detailOrder.id} onClick={() => handleEntregue(detailOrder.id)}>
                    <CheckCircle className="h-4 w-4 mr-1" /> Entregue ao cliente
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

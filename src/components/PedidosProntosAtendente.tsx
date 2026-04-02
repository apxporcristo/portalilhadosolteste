import { useState, useMemo } from 'react';
import { ChefHat, Check, Clock, Eye, Package, Flame, CheckCircle2, Search, XCircle, Plus } from 'lucide-react';
import { KdsStatusTimer } from '@/components/KdsStatusTimer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useAtendenteKds, KdsProntoOrder } from '@/hooks/useAtendenteKds';
import { parseComplementos, cleanProdutoNome } from '@/lib/kds-complementos';
import { useOptionalUserSession } from '@/contexts/UserSessionContext';

interface Props {
  userId: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  novo: 'Novo',
  em_preparo: 'Em preparação',
  pronto: 'Pronto',
  entregue: 'Entregue',
};

const STATUS_COLORS: Record<string, string> = {
  novo: 'bg-blue-500 text-white',
  em_preparo: 'bg-orange-500 text-white',
  pronto: 'bg-green-600 text-white',
  entregue: 'bg-muted text-muted-foreground',
};

function OrderCard({
  order,
  showEntregueBtn,
  showCancelBtn,
  onEntregue,
  onCancel,
  onDetail,
  markingId,
}: {
  order: KdsProntoOrder;
  showEntregueBtn?: boolean;
  showCancelBtn?: boolean;
  onEntregue?: (id: string) => void;
  onCancel?: (id: string) => void;
  onDetail: (o: KdsProntoOrder) => void;
  markingId: string | null;
}) {
  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const getTimeSince = (dateStr: string) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min`;
    return `${Math.floor(mins / 60)}h${mins % 60}min`;
  };

  const borderColor =
    order.kds_status === 'novo'
      ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/20'
      : order.kds_status === 'em_preparo'
      ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20'
      : order.kds_status === 'pronto'
      ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
      : 'border-muted bg-muted/30';

  return (
    <Card className={`border-2 ${borderColor} shadow-md animate-in fade-in slide-in-from-top-2`}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-foreground">{cleanProdutoNome(order.produto_nome)}</h3>
          <KdsStatusTimer
            statusChangedAt={order.status_changed_at || order.created_at}
            createdAt={order.created_at}
            entregueAt={order.entregue_at}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {order.quantidade > 1 && <Badge variant="outline" className="font-bold">x{order.quantidade}</Badge>}
          <Badge className={`text-[10px] px-1.5 py-0.5 ${STATUS_COLORS[order.kds_status] || ''}`}>
            {STATUS_LABELS[order.kds_status] || order.kds_status}
          </Badge>
          {order.categoria_nome && (
            <span className="text-xs text-muted-foreground">{order.categoria_nome}</span>
          )}
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
        {order.observacao?.trim() && (
          <p className="text-xs text-muted-foreground italic">Obs: {order.observacao}</p>
        )}
        <div className="text-xs text-muted-foreground">
          {order.nome_cliente && <span>Cliente: {order.nome_cliente} · </span>}
          <span>{formatTime(order.created_at)}</span>
          {order.nome_atendente && <span> · {order.nome_atendente}</span>}
        </div>
        <div className="flex gap-2 pt-1">
          {showCancelBtn && onCancel && (
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={markingId === order.id}
              onClick={() => onCancel(order.id)}
            >
              <XCircle className="h-3 w-3 mr-1" />
              {markingId === order.id ? 'Cancelando...' : 'Cancelar pedido'}
            </Button>
          )}
          {showEntregueBtn && onEntregue && (
            <Button
              size="sm"
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              disabled={markingId === order.id}
              onClick={() => onEntregue(order.id)}
            >
              <Check className="h-3 w-3 mr-1" />
              {markingId === order.id ? 'Salvando...' : 'Entregue ao cliente'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onDetail(order)}>
            <Eye className="h-3 w-3 mr-1" /> Detalhes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function filterBySearch(orders: KdsProntoOrder[], search: string): KdsProntoOrder[] {
  if (!search.trim()) return orders;
  const term = search.toLowerCase();
  return orders.filter(o =>
    (o.nome_cliente && o.nome_cliente.toLowerCase().includes(term)) ||
    (o.produto_nome && o.produto_nome.toLowerCase().includes(term))
  );
}

export function PedidosProntosAtendente({ userId }: Props) {
  const userSession = useOptionalUserSession();
  const userName = userSession?.access?.nome || userSession?.user?.email || undefined;
  const { novos, emPreparo, prontos, entregues, loading, marcarEntregue, cancelarPedido } = useAtendenteKds(userId);
  const [detailOrder, setDetailOrder] = useState<KdsProntoOrder | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cancelDialogOrder, setCancelDialogOrder] = useState<KdsProntoOrder | null>(null);
  const [cancelMotivo, setCancelMotivo] = useState('');

  const filteredNovos = useMemo(() => filterBySearch(novos, search), [novos, search]);
  const filteredEmPreparo = useMemo(() => filterBySearch(emPreparo, search), [emPreparo, search]);
  const filteredProntos = useMemo(() => filterBySearch(prontos, search), [prontos, search]);
  const filteredEntregues = useMemo(() => filterBySearch(entregues, search), [entregues, search]);

  const handleEntregue = async (orderId: string) => {
    setMarkingId(orderId);
    try {
      await marcarEntregue(orderId);
      toast({ title: 'Pedido marcado como entregue!' });
      if (detailOrder?.id === orderId) setDetailOrder(null);
    } catch {
      toast({ title: 'Erro ao marcar como entregue', variant: 'destructive' });
    } finally {
      setMarkingId(null);
    }
  };

  const handleOpenCancelDialog = (order: KdsProntoOrder) => {
    setCancelDialogOrder(order);
    setCancelMotivo('');
  };

  const handleCancelar = async () => {
    if (!cancelDialogOrder) return;
    if (!cancelMotivo.trim()) {
      toast({ title: 'Informe o motivo do cancelamento', variant: 'destructive' });
      return;
    }

    setMarkingId(cancelDialogOrder.id);
    try {
      await cancelarPedido(cancelDialogOrder.id, cancelMotivo.trim(), userName);
      toast({ title: 'Pedido cancelado!' });
      if (detailOrder?.id === cancelDialogOrder.id) setDetailOrder(null);
      setCancelDialogOrder(null);
      setCancelMotivo('');
    } catch (error) {
      toast({
        title: 'Erro ao cancelar pedido',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setMarkingId(null);
    }
  };

  const totalCount = novos.length + emPreparo.length + prontos.length;

  if (loading || !userId || (totalCount === 0 && entregues.length === 0)) return null;

  return (
    <div className="w-full max-w-md space-y-3">
      <div className="flex items-center gap-2">
        <ChefHat className="h-5 w-5 text-primary" />
        <h2 className="text-base font-bold text-foreground">Pedidos</h2>
        {totalCount > 0 && <Badge className="bg-primary text-primary-foreground">{totalCount}</Badge>}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por cliente ou produto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9 text-sm"
        />
      </div>

      <Tabs defaultValue="novos" className="w-full">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="novos" className="flex items-center gap-1 text-xs">
            <Plus className="h-3 w-3" />
            Novo
            {novos.length > 0 && <Badge variant="outline" className="ml-1 text-[10px] px-1">{novos.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="em_preparo" className="flex items-center gap-1 text-xs">
            <Flame className="h-3 w-3" />
            Preparação
            {emPreparo.length > 0 && <Badge variant="outline" className="ml-1 text-[10px] px-1">{emPreparo.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="prontos" className="flex items-center gap-1 text-xs">
            <ChefHat className="h-3 w-3" />
            Prontos
            {prontos.length > 0 && <Badge variant="outline" className="ml-1 text-[10px] px-1">{prontos.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="entregues" className="flex items-center gap-1 text-xs">
            <CheckCircle2 className="h-3 w-3" />
            Entregues
          </TabsTrigger>
        </TabsList>

        <TabsContent value="novos" className="mt-3 space-y-2">
          {filteredNovos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum pedido novo.</p>
          ) : (
            filteredNovos.map(order => (
              <OrderCard key={order.id} order={order} showCancelBtn onCancel={() => handleOpenCancelDialog(order)} onDetail={setDetailOrder} markingId={markingId} />
            ))
          )}
        </TabsContent>

        <TabsContent value="em_preparo" className="mt-3 space-y-2">
          {filteredEmPreparo.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum pedido em preparação.</p>
          ) : (
            filteredEmPreparo.map(order => (
              <OrderCard key={order.id} order={order} onDetail={setDetailOrder} markingId={markingId} />
            ))
          )}
        </TabsContent>

        <TabsContent value="prontos" className="mt-3 space-y-2">
          {filteredProntos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum pedido pronto.</p>
          ) : (
            filteredProntos.map(order => (
              <OrderCard key={order.id} order={order} showEntregueBtn onEntregue={handleEntregue} onDetail={setDetailOrder} markingId={markingId} />
            ))
          )}
        </TabsContent>

        <TabsContent value="entregues" className="mt-3 space-y-2">
          {filteredEntregues.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum pedido entregue.</p>
          ) : (
            filteredEntregues.map(order => (
              <OrderCard key={order.id} order={order} onDetail={setDetailOrder} markingId={markingId} />
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Detail dialog */}
      <Dialog open={!!detailOrder} onOpenChange={(open) => !open && setDetailOrder(null)}>
        <DialogContent className="max-w-sm">
          {detailOrder && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary" />
                  Detalhes do Pedido
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="border rounded-lg p-3 space-y-1">
                  <h3 className="font-bold text-lg">{cleanProdutoNome(detailOrder.produto_nome)}</h3>
                  <p className="text-sm text-muted-foreground">{detailOrder.categoria_nome}</p>
                  <p className="font-bold">Quantidade: {detailOrder.quantidade}</p>
                  <Badge className={`${STATUS_COLORS[detailOrder.kds_status] || ''}`}>
                    {STATUS_LABELS[detailOrder.kds_status] || detailOrder.kds_status}
                  </Badge>
                </div>
                {detailOrder.complementos && (() => {
                  const items = parseComplementos(detailOrder.complementos);
                  return items.length > 0 ? (
                    <div className="border rounded-lg p-3">
                      <p className="text-sm font-semibold">Complementos</p>
                      <ul className="text-sm text-muted-foreground space-y-0.5">
                        {items.map((c, i) => <li key={i}>• {c}</li>)}
                      </ul>
                    </div>
                  ) : null;
                })()}
                {detailOrder.observacao && (
                  <div className="border rounded-lg p-3">
                    <p className="text-sm font-semibold">Observação</p>
                    <p className="text-sm text-muted-foreground">{detailOrder.observacao}</p>
                  </div>
                )}
                <div className="border rounded-lg p-3 text-sm space-y-1">
                  {detailOrder.nome_cliente && <p><span className="font-medium">Cliente:</span> {detailOrder.nome_cliente}</p>}
                  {detailOrder.nome_atendente && <p><span className="font-medium">Atendente:</span> {detailOrder.nome_atendente}</p>}
                  <p><span className="font-medium">Horário:</span> {new Date(detailOrder.created_at).toLocaleString('pt-BR')}</p>
                </div>
                {detailOrder.kds_status === 'pronto' && (
                  <Button
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                    disabled={markingId === detailOrder.id}
                    onClick={() => handleEntregue(detailOrder.id)}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Entregue ao cliente
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelDialogOrder} onOpenChange={(open) => { if (!open) { setCancelDialogOrder(null); setCancelMotivo(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              Cancelar Pedido
            </DialogTitle>
          </DialogHeader>
          {cancelDialogOrder && (
            <div className="space-y-4">
              <div className="border rounded-lg p-3 bg-muted/50">
                <p className="font-semibold">{cleanProdutoNome(cancelDialogOrder.produto_nome)}</p>
                <p className="text-sm text-muted-foreground">x{cancelDialogOrder.quantidade}</p>
                {cancelDialogOrder.nome_cliente && (
                  <p className="text-sm text-muted-foreground">Cliente: {cancelDialogOrder.nome_cliente}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="motivo-cancel-atendente">Motivo do cancelamento *</Label>
                <Textarea
                  id="motivo-cancel-atendente"
                  placeholder="Ex: cliente desistiu, pedido duplicado, erro no pedido..."
                  value={cancelMotivo}
                  onChange={(e) => setCancelMotivo(e.target.value)}
                  rows={3}
                />
              </div>

              <DialogFooter className="flex gap-2">
                <Button variant="outline" onClick={() => { setCancelDialogOrder(null); setCancelMotivo(''); }}>
                  Voltar
                </Button>
                <Button
                  variant="destructive"
                  disabled={!cancelMotivo.trim() || markingId === cancelDialogOrder.id}
                  onClick={handleCancelar}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  {markingId === cancelDialogOrder.id ? 'Cancelando...' : 'Confirmar cancelamento'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

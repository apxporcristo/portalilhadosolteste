import { useState } from 'react';
import { ChefHat, Check, Clock, Eye, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { useAtendenteKds, KdsProntoOrder } from '@/hooks/useAtendenteKds';

interface Props {
  userId: string | null;
}

export function PedidosProntosAtendente({ userId }: Props) {
  const { orders, loading, marcarEntregue } = useAtendenteKds(userId);
  const [detailOrder, setDetailOrder] = useState<KdsProntoOrder | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

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

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const getTimeSince = (dateStr: string) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min`;
    return `${Math.floor(mins / 60)}h${mins % 60}min`;
  };

  if (loading || !userId || orders.length === 0) return null;

  return (
    <div className="w-full max-w-md space-y-3">
      <div className="flex items-center gap-2">
        <ChefHat className="h-5 w-5 text-green-600" />
        <h2 className="text-base font-bold text-foreground">Pedidos prontos para retirada</h2>
        <Badge className="bg-green-500 text-white">{orders.length}</Badge>
      </div>

      <div className="space-y-2">
        {orders.map(order => (
          <Card
            key={order.id}
            className="border-2 border-green-500 bg-green-50 dark:bg-green-950/20 shadow-md animate-in fade-in slide-in-from-top-2"
          >
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-foreground">{order.produto_nome}</h3>
                <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {getTimeSince(order.created_at)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-bold">x{order.quantidade}</Badge>
                {order.categoria_nome && (
                  <span className="text-xs text-muted-foreground">{order.categoria_nome}</span>
                )}
              </div>

              {order.complementos && (
                <p className="text-xs text-muted-foreground bg-muted rounded px-2 py-1">{order.complementos}</p>
              )}
              {order.observacao && (
                <p className="text-xs text-muted-foreground italic">Obs: {order.observacao}</p>
              )}

              <div className="text-xs text-muted-foreground">
                {order.nome_cliente && <span>Cliente: {order.nome_cliente} · </span>}
                <span>{formatTime(order.created_at)}</span>
                {order.nome_atendente && <span> · {order.nome_atendente}</span>}
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  disabled={markingId === order.id}
                  onClick={() => handleEntregue(order.id)}
                >
                  <Check className="h-3 w-3 mr-1" />
                  {markingId === order.id ? 'Salvando...' : 'Marcar como entregue'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDetailOrder(order)}
                >
                  <Eye className="h-3 w-3 mr-1" /> Detalhes
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detailOrder} onOpenChange={(open) => !open && setDetailOrder(null)}>
        <DialogContent className="max-w-sm">
          {detailOrder && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-green-600" />
                  Detalhes do Pedido Pronto
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="border rounded-lg p-3 space-y-1">
                  <h3 className="font-bold text-lg">{detailOrder.produto_nome}</h3>
                  <p className="text-sm text-muted-foreground">{detailOrder.categoria_nome}</p>
                  <p className="font-bold">Quantidade: {detailOrder.quantidade}</p>
                </div>
                {detailOrder.complementos && (
                  <div className="border rounded-lg p-3">
                    <p className="text-sm font-semibold">Complementos</p>
                    <p className="text-sm text-muted-foreground">{detailOrder.complementos}</p>
                  </div>
                )}
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
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  disabled={markingId === detailOrder.id}
                  onClick={() => handleEntregue(detailOrder.id)}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Marcar como entregue
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

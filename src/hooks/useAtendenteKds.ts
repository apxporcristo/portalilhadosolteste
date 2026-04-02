import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/hooks/useVouchers';
import { cancelKdsOrder, extractKdsCancelError } from '@/lib/kds-cancel';

export interface KdsProntoOrder {
  id: string;
  produto_nome: string;
  categoria_nome: string;
  quantidade: number;
  complementos: string | null;
  observacao: string | null;
  nome_cliente: string | null;
  nome_atendente: string | null;
  atendente_user_id: string | null;
  created_at: string;
  pronto_at: string | null;
  entregue_at: string | null;
  status_changed_at?: string | null;
  kds_status: string;
  cancelado_at?: string | null;
}

function isCancelledOrder(order: Partial<KdsProntoOrder> & { cancelado_at?: string | null }) {
  return order.cancelado_at != null || order.kds_status === 'cancelado';
}

function playAlertSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1200;
    gain.gain.value = 0.4;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1500;
      gain2.gain.value = 0.4;
      osc2.start();
      osc2.stop(ctx.currentTime + 0.15);
    }, 200);
  } catch { /* ignore */ }
}


/** Sort orders: logged user's orders first, then by created_at */
function sortOrders(orders: KdsProntoOrder[], userId: string | null): KdsProntoOrder[] {
  return [...orders].sort((a, b) => {
    const aIsUser = a.atendente_user_id === userId ? 0 : 1;
    const bIsUser = b.atendente_user_id === userId ? 0 : 1;
    if (aIsUser !== bIsUser) return aIsUser - bIsUser;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

export function useAtendenteKds(userId: string | null) {
  const [orders, setOrders] = useState<KdsProntoOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const fetchOrders = useCallback(async () => {
    if (!userId) { setOrders([]); setLoading(false); return; }
    try {
      const supabase = await getSupabaseClient();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const { data, error } = await supabase
        .from('kds_orders' as any)
        .select('*')
        .in('kds_status', ['novo', 'em_preparo', 'pronto', 'entregue'])
        .gte('created_at', today.toISOString())
        .lt('created_at', tomorrow.toISOString())
        .is('cancelado_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const list = ((data as any[]) || []).filter((order) => !isCancelledOrder(order));
      list.forEach(o => knownIdsRef.current.add(o.id));
      setOrders(list);
    } catch (e) {
      console.error('[AtendenteKDS] Erro:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Realtime
  useEffect(() => {
    if (!userId) return;
    let channel: any;
    (async () => {
      const supabase = await getSupabaseClient();
      channel = supabase
        .channel(`atendente-kds-${userId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'kds_orders',
        }, (payload: any) => {
          const row = payload.new as any;
          if (!row) return;

          if (isCancelledOrder(row)) {
            setOrders(prev => prev.filter(o => o.id !== row.id));
            return;
          }

          if (['novo', 'em_preparo', 'pronto', 'entregue'].includes(row.kds_status)) {
            setOrders(prev => {
              const exists = prev.find(o => o.id === row.id);
              if (exists) return prev.map(o => o.id === row.id ? { ...o, ...row } : o);
              if (row.kds_status === 'pronto' && !knownIdsRef.current.has(row.id)) {
                knownIdsRef.current.add(row.id);
                playAlertSound();
              }
              knownIdsRef.current.add(row.id);
              return [...prev, row].sort((a, b) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
            });
          } else {
            setOrders(prev => prev.filter(o => o.id !== row.id));
          }
        })
        .subscribe();
    })();

    return () => {
      if (channel) {
        getSupabaseClient().then(s => s.removeChannel(channel));
      }
    };
  }, [userId]);

  const marcarEntregue = useCallback(async (orderId: string) => {
    try {
      const supabase = await getSupabaseClient();
      const { error } = await supabase
        .from('kds_orders' as any)
        .update({
          kds_status: 'entregue',
          entregue_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', orderId);
      if (error) throw error;
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, kds_status: 'entregue', entregue_at: new Date().toISOString() } : o));
    } catch (e) {
      console.error('[AtendenteKDS] Erro ao marcar entregue:', e);
      throw e;
    }
  }, []);

  const novos = orders.filter(o => o.kds_status === 'novo' && o.atendente_user_id === userId);
  const emPreparo = sortOrders(orders.filter(o => o.kds_status === 'em_preparo'), userId);
  const prontos = sortOrders(orders.filter(o => o.kds_status === 'pronto'), userId);
  const entregues = sortOrders(orders.filter(o => o.kds_status === 'entregue'), userId);

  const cancelarPedido = useCallback(async (orderId: string, motivo?: string, canceladoPor?: string) => {
    try {
      if (!userId) {
        throw new Error('Sessão inválida. Faça login novamente.');
      }

      const motivoTrimmed = motivo?.trim();
      if (!motivoTrimmed) {
        throw new Error('Motivo de cancelamento é obrigatório.');
      }

      const order = orders.find((currentOrder) => currentOrder.id === orderId);
      if (!order) {
        throw new Error('Pedido não encontrado ou não está mais disponível.');
      }

      if (order.atendente_user_id !== userId) {
        throw new Error('Você só pode cancelar pedidos do seu usuário.');
      }

      if (order.kds_status !== 'novo') {
        throw new Error('Somente pedidos com status Novo podem ser cancelados.');
      }

      await cancelKdsOrder({
        orderId,
        motivo: motivoTrimmed,
        canceladoPor,
        callerUserId: userId,
      });

      setOrders(prev => prev.filter(o => o.id !== orderId));
      await fetchOrders();
    } catch (e) {
      console.error('[AtendenteKDS] Erro ao cancelar:', e);
      throw new Error(extractKdsCancelError(e));
    }
  }, [userId, orders, fetchOrders]);

  return { orders, novos, emPreparo, prontos, entregues, loading, marcarEntregue, cancelarPedido, refetch: fetchOrders };
}

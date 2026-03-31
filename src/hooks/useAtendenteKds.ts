import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/hooks/useVouchers';
import { getSupabaseConfig } from '@/lib/supabase-external';

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
  kds_status: string;
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

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as Record<string, unknown>;
    if (typeof maybeError.message === 'string') return maybeError.message;
    if (typeof maybeError.error === 'string') return maybeError.error;
  }
  return 'Erro ao cancelar pedido.';
}

async function cancelOrderViaFunction(params: {
  callerUserId: string;
  orderId: string;
  motivo: string;
  canceladoPor?: string;
}) {
  const { url, anonKey } = await getSupabaseConfig();
  const response = await fetch(`${url}/functions/v1/cancel-kds-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${anonKey}`,
      'apikey': anonKey,
    },
    body: JSON.stringify({
      caller_user_id: params.callerUserId,
      order_id: params.orderId,
      motivo_cancelamento: params.motivo,
      cancelado_por: params.canceladoPor ?? null,
    }),
  });

  const text = await response.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }

  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}: ${text}`);
  }

  return data;
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
        .order('created_at', { ascending: true });
      if (error) throw error;
      const list = (data as any[]) || [];
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

      await cancelOrderViaFunction({
        callerUserId: userId,
        orderId,
        motivo: motivoTrimmed,
        canceladoPor,
      });

      setOrders(prev => prev.filter(o => o.id !== orderId));
    } catch (e) {
      console.error('[AtendenteKDS] Erro ao cancelar:', e);
      throw new Error(extractErrorMessage(e));
    }
  }, [userId]);

  return { orders, novos, emPreparo, prontos, entregues, loading, marcarEntregue, cancelarPedido, refetch: fetchOrders };
}

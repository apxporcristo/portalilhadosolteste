import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/hooks/useVouchers';

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

export function useAtendenteKds(userId: string | null) {
  const [orders, setOrders] = useState<KdsProntoOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const fetchProntoOrders = useCallback(async () => {
    if (!userId) { setOrders([]); setLoading(false); return; }
    try {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('kds_orders' as any)
        .select('*')
        .eq('atendente_user_id', userId)
        .eq('kds_status', 'pronto')
        .order('created_at', { ascending: true });
      if (error) throw error;
      const list = (data as any[]) || [];
      // Track known IDs (don't alert on initial load)
      list.forEach(o => knownIdsRef.current.add(o.id));
      setOrders(list);
    } catch (e) {
      console.error('[AtendenteKDS] Erro:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchProntoOrders();
  }, [fetchProntoOrders]);

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
          // Only care about orders for this attendant
          if (row.atendente_user_id !== userId) return;

          if (row.kds_status === 'pronto') {
            setOrders(prev => {
              const exists = prev.find(o => o.id === row.id);
              if (exists) return prev.map(o => o.id === row.id ? { ...o, ...row } : o);
              // New pronto order - play sound
              if (!knownIdsRef.current.has(row.id)) {
                knownIdsRef.current.add(row.id);
                playAlertSound();
              }
              return [...prev, row].sort((a, b) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
            });
          } else {
            // Status changed away from pronto (e.g. entregue) - remove
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
      setOrders(prev => prev.filter(o => o.id !== orderId));
    } catch (e) {
      console.error('[AtendenteKDS] Erro ao marcar entregue:', e);
      throw e;
    }
  }, []);

  return { orders, loading, marcarEntregue, refetch: fetchProntoOrders };
}

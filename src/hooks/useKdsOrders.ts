import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/hooks/useVouchers';

export type KdsStatus = 'novo' | 'em_preparo' | 'pronto' | 'impresso' | 'entregue';

export interface KdsOrder {
  id: string;
  produto_id: string;
  produto_nome: string;
  categoria_nome: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  nome_cliente: string | null;
  telefone_cliente: string | null;
  nome_atendente: string | null;
  complementos: string | null;
  observacao: string | null;
  kds_status: KdsStatus;
  created_at: string;
  updated_at: string;
}

const ANNOUNCED_KEY = 'kds_announced_ids';

function getAnnouncedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ANNOUNCED_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveAnnouncedIds(ids: Set<string>) {
  // Keep only last 200 to avoid bloating
  const arr = Array.from(ids).slice(-200);
  localStorage.setItem(ANNOUNCED_KEY, JSON.stringify(arr));
}

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch { /* ignore */ }
}

function speakOrder(order: KdsOrder) {
  if ('speechSynthesis' in window) {
    try {
      const complementos = order.complementos ? `. Detalhes: ${order.complementos}` : '';
      const atendente = order.nome_atendente ? `. Atendente: ${order.nome_atendente}` : '';
      const msg = `Novo pedido. Produto: ${order.produto_nome}${complementos}${atendente}.`;
      const utterance = new SpeechSynthesisUtterance(msg);
      utterance.lang = 'pt-BR';
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
      return;
    } catch { /* fallback to beep */ }
  }
  playBeep();
}

export function useKdsOrders() {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<KdsStatus | 'all'>('all');
  const announcedRef = useRef<Set<string>>(getAnnouncedIds());

  const fetchOrders = useCallback(async () => {
    try {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('kds_orders' as any)
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setOrders((data as any[]) || []);
    } catch (e) {
      console.error('[KDS] Erro ao buscar pedidos:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Announce new orders
  const announceNewOrders = useCallback((newOrders: KdsOrder[]) => {
    const announced = announcedRef.current;
    for (const order of newOrders) {
      if (order.kds_status === 'novo' && !announced.has(order.id)) {
        announced.add(order.id);
        speakOrder(order);
      }
    }
    saveAnnouncedIds(announced);
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Realtime subscription
  useEffect(() => {
    let channel: any;
    (async () => {
      const supabase = await getSupabaseClient();
      channel = supabase
        .channel('kds-realtime')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'kds_orders',
        }, (payload: any) => {
          console.log('[KDS] Realtime:', payload.eventType, payload.new?.id);
          if (payload.eventType === 'INSERT') {
            const newOrder = payload.new as KdsOrder;
            setOrders(prev => {
              const exists = prev.find(o => o.id === newOrder.id);
              if (exists) return prev;
              return [...prev, newOrder].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            });
            announceNewOrders([newOrder]);
          } else if (payload.eventType === 'UPDATE') {
            setOrders(prev => prev.map(o => o.id === payload.new.id ? { ...o, ...payload.new } : o));
          } else if (payload.eventType === 'DELETE') {
            setOrders(prev => prev.filter(o => o.id !== payload.old.id));
          }
        })
        .subscribe();
    })();

    return () => {
      if (channel) {
        getSupabaseClient().then(s => s.removeChannel(channel));
      }
    };
  }, [announceNewOrders]);

  // Announce on initial load
  useEffect(() => {
    if (orders.length > 0) {
      announceNewOrders(orders);
    }
  }, [orders, announceNewOrders]);

  const updateStatus = useCallback(async (orderId: string, newStatus: KdsStatus) => {
    try {
      const supabase = await getSupabaseClient();
      const updateData: any = { kds_status: newStatus, updated_at: new Date().toISOString() };
      if (newStatus === 'pronto') updateData.pronto_at = new Date().toISOString();
      if (newStatus === 'entregue') updateData.entregue_at = new Date().toISOString();
      const { error } = await supabase
        .from('kds_orders' as any)
        .update(updateData)
        .eq('id', orderId);
      if (error) throw error;
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, kds_status: newStatus } : o));
    } catch (e) {
      console.error('[KDS] Erro ao atualizar status:', e);
      throw e;
    }
  }, []);

  const filteredOrders = statusFilter === 'all'
    ? orders.filter(o => o.kds_status !== 'entregue')
    : orders.filter(o => o.kds_status === statusFilter);

  // Sort: novo first, then by date
  const sortedOrders = [...filteredOrders].sort((a, b) => {
    const statusOrder: Record<KdsStatus, number> = { novo: 0, em_preparo: 1, pronto: 2, impresso: 3, entregue: 4 };
    const sa = statusOrder[a.kds_status] ?? 5;
    const sb = statusOrder[b.kds_status] ?? 5;
    if (sa !== sb) return sa - sb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  return {
    orders: sortedOrders,
    allOrders: orders,
    loading,
    statusFilter,
    setStatusFilter,
    updateStatus,
    refetch: fetchOrders,
  };
}

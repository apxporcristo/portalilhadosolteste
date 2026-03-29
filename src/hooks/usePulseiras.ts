import { useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase-external';
import { toast } from '@/hooks/use-toast';

export interface Pulseira {
  id: string;
  numero: string;
  nome_cliente: string;
  telefone_cliente: string;
  cpf: string | null;
  status: string;
  aberta_por: string | null;
  aberta_em: string;
  fechada_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface PulseiraItem {
  id: string;
  pulseira_id: string;
  produto_id: string;
  produto_nome: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  atendente_user_id: string | null;
  atendente_nome: string | null;
  codigo_venda: string | null;
  created_at: string;
}

export interface PulseiraConsumo {
  id: string;
  pulseira_id: string;
  pulseira_item_id: string | null;
  produto_id: string;
  produto_nome: string;
  quantidade: number;
  atendente_user_id: string | null;
  atendente_nome: string | null;
  observacao: string | null;
  created_at: string;
}

export interface PulseiraProdutoResumo {
  produto_id: string;
  produto_nome: string;
  comprado: number;
  consumido: number;
  disponivel: number;
  ultima_retirada: string | null;
}

export function usePulseiras() {
  const [loading, setLoading] = useState(false);
  const [pulseira, setPulseira] = useState<Pulseira | null>(null);
  const [itens, setItens] = useState<PulseiraItem[]>([]);
  const [consumos, setConsumos] = useState<PulseiraConsumo[]>([]);
  const [resumoProdutos, setResumoProdutos] = useState<PulseiraProdutoResumo[]>([]);
  const [pulseirasAtivas, setPulseirasAtivas] = useState<Pulseira[]>([]);

  const listarAtivas = useCallback(async () => {
    try {
      const db = await getSupabaseClient();
      const { data, error } = await db
        .from('pulseiras')
        .select('*')
        .eq('status', 'ativa')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPulseirasAtivas((data || []) as any[]);
      return (data || []) as Pulseira[];
    } catch (err: any) {
      console.warn('[Pulseiras] Erro ao listar ativas:', err.message);
      return [];
    }
  }, []);

  const buscarPulseira = useCallback(async (numero: string) => {
    setLoading(true);
    try {
      const db = await getSupabaseClient();
      const { data, error } = await db
        .from('pulseiras')
        .select('*')
        .eq('numero', numero.trim())
        .eq('status', 'ativa')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        setPulseira(null);
        setItens([]);
        setConsumos([]);
        setResumoProdutos([]);
        setLoading(false);
        return null;
      }
      setPulseira(data as any);
      await carregarDetalhes(data.id);
      setLoading(false);
      return data;
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      setLoading(false);
      return null;
    }
  }, []);

  const carregarDetalhes = useCallback(async (pulseiraId: string) => {
    const db = await getSupabaseClient();
    const [itensRes, consumosRes] = await Promise.all([
      db.from('pulseira_itens').select('*').eq('pulseira_id', pulseiraId).order('created_at', { ascending: false }),
      db.from('pulseira_consumos').select('*').eq('pulseira_id', pulseiraId).order('created_at', { ascending: false }),
    ]);
    const itensData = (itensRes.data || []) as any[];
    const consumosData = (consumosRes.data || []) as any[];
    setItens(itensData);
    setConsumos(consumosData);

    // Build product summary
    const prodMap: Record<string, PulseiraProdutoResumo> = {};
    for (const item of itensData) {
      const key = item.produto_id;
      if (!prodMap[key]) {
        prodMap[key] = { produto_id: key, produto_nome: item.produto_nome, comprado: 0, consumido: 0, disponivel: 0, ultima_retirada: null };
      }
      prodMap[key].comprado += item.quantidade;
    }
    for (const consumo of consumosData) {
      const key = consumo.produto_id;
      if (!prodMap[key]) {
        prodMap[key] = { produto_id: key, produto_nome: consumo.produto_nome, comprado: 0, consumido: 0, disponivel: 0, ultima_retirada: null };
      }
      prodMap[key].consumido += consumo.quantidade;
      if (!prodMap[key].ultima_retirada || consumo.created_at > prodMap[key].ultima_retirada!) {
        prodMap[key].ultima_retirada = consumo.created_at;
      }
    }
    for (const key of Object.keys(prodMap)) {
      prodMap[key].disponivel = Math.max(0, prodMap[key].comprado - prodMap[key].consumido);
    }
    setResumoProdutos(Object.values(prodMap));
  }, []);

  const abrirPulseira = useCallback(async (data: { numero: string; nome_cliente: string; telefone_cliente: string; cpf?: string; aberta_por?: string }) => {
    setLoading(true);
    try {
      const db = await getSupabaseClient();
      // Check duplicate
      const { data: existing } = await db
        .from('pulseiras')
        .select('id')
        .eq('numero', data.numero.trim())
        .eq('status', 'ativa')
        .maybeSingle();
      if (existing) {
        toast({ title: 'Erro', description: 'Já existe uma pulseira ativa com este número.', variant: 'destructive' });
        setLoading(false);
        return null;
      }
      const { data: created, error } = await db
        .from('pulseiras')
        .insert({
          numero: data.numero.trim(),
          nome_cliente: data.nome_cliente.trim(),
          telefone_cliente: data.telefone_cliente.trim(),
          cpf: data.cpf?.trim() || null,
          aberta_por: data.aberta_por || null,
          status: 'ativa',
        } as any)
        .select()
        .single();
      if (error) throw error;
      toast({ title: 'Pulseira aberta com sucesso!' });
      setPulseira(created as any);
      setItens([]);
      setConsumos([]);
      setResumoProdutos([]);
      setLoading(false);
      return created;
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      setLoading(false);
      return null;
    }
  }, []);

  const adicionarItens = useCallback(async (pulseiraId: string, items: { produto_id: string; produto_nome: string; quantidade: number; valor_unitario: number; atendente_user_id?: string; atendente_nome?: string; codigo_venda?: string }[]) => {
    try {
      const db = await getSupabaseClient();
      const rows = items.map(i => ({
        pulseira_id: pulseiraId,
        produto_id: i.produto_id,
        produto_nome: i.produto_nome,
        quantidade: i.quantidade,
        valor_unitario: i.valor_unitario,
        valor_total: i.quantidade * i.valor_unitario,
        atendente_user_id: i.atendente_user_id || null,
        atendente_nome: i.atendente_nome || null,
        codigo_venda: i.codigo_venda || null,
      }));
      const { error } = await db.from('pulseira_itens').insert(rows as any);
      if (error) throw error;
      toast({ title: 'Itens adicionados à pulseira!' });
      await carregarDetalhes(pulseiraId);
      return true;
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      return false;
    }
  }, [carregarDetalhes]);

  const consumirProduto = useCallback(async (pulseiraId: string, produto_id: string, produto_nome: string, quantidade: number, atendente_user_id?: string, atendente_nome?: string, observacao?: string) => {
    // Check available balance
    const prod = resumoProdutos.find(p => p.produto_id === produto_id);
    if (!prod || prod.disponivel < quantidade) {
      toast({ title: 'Saldo insuficiente', description: `Disponível: ${prod?.disponivel || 0}`, variant: 'destructive' });
      return false;
    }
    try {
      const db = await getSupabaseClient();
      const { error } = await db.from('pulseira_consumos').insert({
        pulseira_id: pulseiraId,
        produto_id,
        produto_nome,
        quantidade,
        atendente_user_id: atendente_user_id || null,
        atendente_nome: atendente_nome || null,
        observacao: observacao || null,
      } as any);
      if (error) throw error;
      toast({ title: 'Baixa registrada!' });
      await carregarDetalhes(pulseiraId);
      return true;
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      return false;
    }
  }, [resumoProdutos, carregarDetalhes]);

  const fecharPulseira = useCallback(async (pulseiraId: string) => {
    try {
      const db = await getSupabaseClient();
      const { error } = await db
        .from('pulseiras')
        .update({ status: 'fechada', fechada_em: new Date().toISOString() } as any)
        .eq('id', pulseiraId);
      if (error) throw error;
      toast({ title: 'Pulseira fechada!' });
      setPulseira(null);
      return true;
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      return false;
    }
  }, []);

  const limpar = useCallback(() => {
    setPulseira(null);
    setItens([]);
    setConsumos([]);
    setResumoProdutos([]);
  }, []);

  return {
    loading,
    pulseira,
    itens,
    consumos,
    resumoProdutos,
    buscarPulseira,
    abrirPulseira,
    adicionarItens,
    consumirProduto,
    fecharPulseira,
    carregarDetalhes,
    limpar,
  };
}

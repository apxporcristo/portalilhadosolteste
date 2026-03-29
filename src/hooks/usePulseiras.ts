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
  valor_unitario: number;
  ultima_retirada: string | null;
  ultimo_atendente: string | null;
}

export interface PulseiraHistorico {
  tipo: string;
  produto_nome: string;
  quantidade: number;
  atendente_nome: string | null;
  observacao: string | null;
  data: string;
}

export function usePulseiras() {
  const [loading, setLoading] = useState(false);
  const [pulseira, setPulseira] = useState<Pulseira | null>(null);
  const [itens, setItens] = useState<PulseiraItem[]>([]);
  const [consumos, setConsumos] = useState<PulseiraConsumo[]>([]);
  const [resumoProdutos, setResumoProdutos] = useState<PulseiraProdutoResumo[]>([]);
  const [historico, setHistorico] = useState<PulseiraHistorico[]>([]);
  const [pulseirasAtivas, setPulseirasAtivas] = useState<Pulseira[]>([]);

  // Uses vw_pulseiras_ativas view
  const listarAtivas = useCallback(async () => {
    try {
      const db = await getSupabaseClient();
      const { data, error } = await db
        .from('vw_pulseiras_ativas' as any)
        .select('*')
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
        .from('vw_pulseiras_ativas' as any)
        .select('*')
        .eq('numero', numero.trim())
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        setPulseira(null);
        setItens([]);
        setConsumos([]);
        setResumoProdutos([]);
        setHistorico([]);
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

  // Uses vw_pulseira_saldos + vw_pulseira_historico
  const carregarDetalhes = useCallback(async (pulseiraId: string) => {
    const db = await getSupabaseClient();
    const [saldosRes, historicoRes] = await Promise.all([
      db.from('vw_pulseira_saldos' as any).select('*').eq('pulseira_id', pulseiraId),
      db.from('vw_pulseira_historico' as any).select('*').eq('pulseira_id', pulseiraId).order('data', { ascending: false }),
    ]);

    const saldosData = (saldosRes.data || []) as any[];
    const historicoData = (historicoRes.data || []) as any[];

    // Map saldos to resumoProdutos
    const resumo: PulseiraProdutoResumo[] = saldosData.map((s: any) => ({
      produto_id: s.produto_id,
      produto_nome: s.produto_nome,
      comprado: Number(s.total_carregado ?? s.comprado ?? 0),
      consumido: Number(s.total_baixado ?? s.consumido ?? 0),
      disponivel: Number(s.saldo_disponivel ?? s.disponivel ?? 0),
      valor_unitario: Number(s.valor_unitario ?? 0),
      ultima_retirada: s.ultima_baixa ?? s.ultima_retirada ?? null,
      ultimo_atendente: s.ultimo_atendente ?? null,
    }));
    setResumoProdutos(resumo);

    // Map historico
    const hist: PulseiraHistorico[] = historicoData.map((h: any) => ({
      tipo: h.tipo,
      produto_nome: h.produto_nome,
      quantidade: Number(h.quantidade),
      atendente_nome: h.atendente_nome ?? null,
      observacao: h.observacao ?? null,
      data: h.data,
    }));
    setHistorico(hist);

    // Keep itens/consumos from historico for backward compat
    setItens(historicoData.filter((h: any) => h.tipo === 'carga').map((h: any) => ({
      id: h.id || h.data,
      pulseira_id: pulseiraId,
      produto_id: h.produto_id || '',
      produto_nome: h.produto_nome,
      quantidade: Number(h.quantidade),
      valor_unitario: 0,
      valor_total: 0,
      atendente_user_id: null,
      atendente_nome: h.atendente_nome ?? null,
      codigo_venda: null,
      created_at: h.data,
    })));
    setConsumos(historicoData.filter((h: any) => h.tipo === 'baixa').map((h: any) => ({
      id: h.id || h.data,
      pulseira_id: pulseiraId,
      pulseira_item_id: null,
      produto_id: h.produto_id || '',
      produto_nome: h.produto_nome,
      quantidade: Number(h.quantidade),
      atendente_user_id: null,
      atendente_nome: h.atendente_nome ?? null,
      observacao: h.observacao ?? null,
      created_at: h.data,
    })));
  }, []);

  const abrirPulseira = useCallback(async (data: { numero: string; nome_cliente: string; telefone_cliente: string; cpf?: string; aberta_por?: string }) => {
    setLoading(true);
    try {
      const db = await getSupabaseClient();
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
      setHistorico([]);
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
        nome_produto: i.produto_nome,
        quantidade: i.quantidade,
        valor_unitario: i.valor_unitario,
        valor_total: i.quantidade * i.valor_unitario,
        atendente_user_id: i.atendente_user_id || null,
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

  // Uses RPC registrar_baixa_pulseira
  const consumirProduto = useCallback(async (pulseiraId: string, produto_id: string, produto_nome: string, quantidade: number, atendente_user_id?: string, atendente_nome?: string, observacao?: string) => {
    const prod = resumoProdutos.find(p => p.produto_id === produto_id);
    if (!prod || prod.disponivel < quantidade) {
      toast({ title: 'Saldo insuficiente', description: `Disponível: ${prod?.disponivel || 0}`, variant: 'destructive' });
      return false;
    }
    try {
      const db = await getSupabaseClient();
      const { error } = await db.rpc('registrar_baixa_pulseira', {
        p_pulseira_id: pulseiraId,
        p_produto_id: produto_id,
        p_quantidade: quantidade,
        p_atendente_user_id: atendente_user_id || null,
        p_atendente_nome: atendente_nome || null,
        p_observacao: observacao || null,
      });
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
    // Validate: check balances and opening time
    const temSaldo = resumoProdutos.some(p => p.disponivel > 0);
    if (temSaldo && pulseira) {
      const abertaEm = new Date(pulseira.aberta_em);
      const agora = new Date();
      const diffHoras = (agora.getTime() - abertaEm.getTime()) / (1000 * 60 * 60);
      if (diffHoras < 24) {
        toast({
          title: 'Não é possível fechar',
          description: 'A pulseira só pode ser fechada quando não houver mais itens disponíveis para retirada ou após 24 horas da abertura.',
          variant: 'destructive',
        });
        return false;
      }
    }

    try {
      const db = await getSupabaseClient();
      const { error } = await db
        .from('pulseiras')
        .update({ status: 'encerrada', fechada_em: new Date().toISOString() } as any)
        .eq('id', pulseiraId);
      if (error) throw error;
      toast({ title: 'Pulseira fechada!' });
      setPulseira(null);
      return true;
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
      return false;
    }
  }, [resumoProdutos, pulseira]);

  const limpar = useCallback(() => {
    setPulseira(null);
    setItens([]);
    setConsumos([]);
    setResumoProdutos([]);
    setHistorico([]);
  }, []);

  return {
    loading,
    pulseira,
    itens,
    consumos,
    resumoProdutos,
    historico,
    pulseirasAtivas,
    buscarPulseira,
    abrirPulseira,
    adicionarItens,
    consumirProduto,
    fecharPulseira,
    carregarDetalhes,
    listarAtivas,
    limpar,
  };
}

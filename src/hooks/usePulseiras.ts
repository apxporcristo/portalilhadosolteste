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
  pulseira_id: string;
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

const getFirstDefined = (row: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
};

const getFirstNumber = (row: Record<string, any>, keys: string[]): number | null => {
  const value = getFirstDefined(row, keys);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTipoHistorico = (tipoRaw: any): string => {
  const tipo = String(tipoRaw || '').toLowerCase();
  if (tipo.includes('reab')) return 'reabertura';
  if (tipo.includes('abert')) return 'abertura';
  if (tipo.includes('fech')) return 'fechamento';
  if (tipo.includes('baix') || tipo.includes('consum')) return 'baixa';
  if (tipo.includes('carg') || tipo.includes('inclu') || tipo.includes('adicion') || tipo.includes('lanc')) return 'carga';
  return tipo || 'movimentacao';
};

const normalizeSaldoRow = (row: Record<string, any>, pulseiraId: string): PulseiraProdutoResumo => {
  const compradoRaw = getFirstNumber(row, ['comprado', 'total_comprado', 'total_carregado', 'quantidade_comprada', 'quantidade_total']);
  const consumidoRaw = getFirstNumber(row, ['consumido', 'total_consumido', 'total_baixado', 'quantidade_baixada', 'baixado']);
  const disponivelRaw = getFirstNumber(row, ['disponivel', 'saldo_disponivel', 'saldo_quantidade', 'saldo']);

  let comprado = compradoRaw;
  let consumido = consumidoRaw;
  let disponivel = disponivelRaw;

  if (comprado === null && consumido !== null && disponivel !== null) comprado = consumido + disponivel;
  if (consumido === null && comprado !== null && disponivel !== null) consumido = Math.max(0, comprado - disponivel);
  if (disponivel === null && comprado !== null && consumido !== null) disponivel = comprado - consumido;

  comprado = comprado ?? 0;
  consumido = consumido ?? 0;
  disponivel = disponivel ?? (comprado - consumido);

  return {
    pulseira_id: String(getFirstDefined(row, ['pulseira_id']) || pulseiraId),
    produto_id: String(getFirstDefined(row, ['produto_id']) || ''),
    produto_nome: String(getFirstDefined(row, ['produto_nome', 'nome_produto']) || 'Produto sem nome'),
    comprado,
    consumido,
    disponivel: Math.max(0, comprado - consumido),
    valor_unitario: Number(getFirstDefined(row, ['valor_unitario', 'preco_unitario']) ?? 0),
    ultima_retirada: getFirstDefined(row, ['ultima_retirada', 'ultima_baixa_em', 'ultima_baixa']) as string | null,
    ultimo_atendente: (getFirstDefined(row, ['ultimo_atendente', 'ultimo_atendente_nome']) as string | null) ?? null,
  };
};

const normalizeHistoricoRow = (row: Record<string, any>): PulseiraHistorico => {
  const tipo = normalizeTipoHistorico(getFirstDefined(row, ['tipo', 'tipo_movimentacao', 'acao']));
  const data = String(getFirstDefined(row, ['created_at', 'data', 'updated_at']) || new Date().toISOString());

  return {
    tipo,
    produto_nome: String(getFirstDefined(row, ['produto_nome', 'nome_produto']) || '—'),
    quantidade: Number(getFirstDefined(row, ['quantidade']) ?? 0),
    atendente_nome: (getFirstDefined(row, ['usuario_nome', 'atendente_nome', 'responsavel_nome', 'aberta_por', 'fechada_por']) as string | null) ?? 'Usuário não identificado',
    observacao: (getFirstDefined(row, ['observacao', 'descricao']) as string | null) ?? null,
    data,
  };
};

export function usePulseiras() {
  const [loading, setLoading] = useState(false);
  const [pulseira, setPulseira] = useState<Pulseira | null>(null);
  const [itens, setItens] = useState<PulseiraItem[]>([]);
  const [consumos, setConsumos] = useState<PulseiraConsumo[]>([]);
  const [resumoProdutos, setResumoProdutos] = useState<PulseiraProdutoResumo[]>([]);
  const [historico, setHistorico] = useState<PulseiraHistorico[]>([]);
  const [pulseirasAtivas, setPulseirasAtivas] = useState<Pulseira[]>([]);
  const [pulseirasFechadas, setPulseirasFechadas] = useState<Pulseira[]>([]);

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

  const listarFechadas = useCallback(async () => {
    try {
      const db = await getSupabaseClient();
      // Try both possible status values: 'encerrada' and 'fechada'
      const { data, error } = await db
        .from('pulseiras' as any)
        .select('*')
        .in('status', ['encerrada', 'fechada'])
        .order('fechada_em', { ascending: false });
      if (error) throw error;
      setPulseirasFechadas((data || []) as any[]);
      return (data || []) as Pulseira[];
    } catch (err: any) {
      console.warn('[Pulseiras] Erro ao listar fechadas:', err.message);
      return [];
    }
  }, []);

  const buscarPulseira = useCallback(async (numero: string) => {
    setLoading(true);
    try {
      const db = await getSupabaseClient();
      // Search in active first
      let { data, error } = await db
        .from('vw_pulseiras_ativas' as any)
        .select('*')
        .eq('numero', numero.trim())
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        // Also search in closed pulseiras for viewing
        const { data: closedData, error: closedError } = await db
          .from('pulseiras' as any)
          .select('*')
          .eq('numero', numero.trim())
          .eq('status', 'encerrada')
          .maybeSingle();
        if (closedError) throw closedError;
        data = closedData;
      }
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

  const carregarSaldosPadronizados = useCallback(async (db: any, pulseiraId: string): Promise<PulseiraProdutoResumo[]> => {
    const rpcTentativas: { nome: string; payload: Record<string, any> }[] = [
      { nome: 'listar_saldo_pulseira_produto', payload: { pulseira_id: pulseiraId } },
      { nome: 'listar_saldo_pulseira_produto', payload: { p_pulseira_id: pulseiraId } },
    ];

    for (const tentativa of rpcTentativas) {
      const { data, error } = await db.rpc(tentativa.nome as any, tentativa.payload as any);
      if (!error && Array.isArray(data)) {
        return data.map((row: any) => normalizeSaldoRow(row, pulseiraId));
      }
      if (error) {
        console.warn(`[Pulseiras] RPC ${tentativa.nome} falhou:`, error.message);
      }
    }

    const views = ['vw_pulseira_saldo_produto', 'vw_pulseira_saldos'];
    for (const viewName of views) {
      const { data, error } = await db
        .from(viewName as any)
        .select('*')
        .eq('pulseira_id', pulseiraId);

      if (!error) {
        return ((data || []) as any[]).map((row) => normalizeSaldoRow(row, pulseiraId));
      }

      console.warn(`[Pulseiras] View ${viewName} falhou:`, error.message);
    }

    return [];
  }, []);

  const carregarHistoricoPadronizado = useCallback(async (db: any, pulseiraId: string, pulseiraData?: Partial<Pulseira> | null): Promise<PulseiraHistorico[]> => {
    let historicoBase: PulseiraHistorico[] = [];

    // 1. Try RPC listar_historico_pulseira first (most reliable source)
    const rpcPayloads = [
      { p_pulseira_id: pulseiraId },
      { pulseira_id: pulseiraId },
    ];
    let rpcSuccess = false;
    for (const payload of rpcPayloads) {
      const { data, error } = await db.rpc('listar_historico_pulseira' as any, payload as any);
      if (!error && Array.isArray(data) && data.length > 0) {
        historicoBase = data.map((row: any) => normalizeHistoricoRow(row));
        rpcSuccess = true;
        break;
      }
      if (error) console.warn('[Pulseiras] RPC listar_historico_pulseira falhou:', error.message);
    }

    // 2. Fallback to view vw_pulseira_historico
    if (!rpcSuccess) {
      const { data, error } = await db
        .from('vw_pulseira_historico' as any)
        .select('*')
        .eq('pulseira_id', pulseiraId)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        historicoBase = data.map((row: any) => normalizeHistoricoRow(row));
      } else if (error) {
        console.warn('[Pulseiras] View vw_pulseira_historico falhou:', error.message);
      }
    }

    // 3. Add abertura/fechamento from pulseira data if not already present
    const tiposPresentes = new Set(historicoBase.map(h => h.tipo));

    if (pulseiraData?.aberta_em && !tiposPresentes.has('abertura')) {
      historicoBase.push({
        tipo: 'abertura',
        produto_nome: '—',
        quantidade: 0,
        atendente_nome: pulseiraData.aberta_por ?? null,
        observacao: null,
        data: pulseiraData.aberta_em,
      });
    }

    if (pulseiraData?.fechada_em && !tiposPresentes.has('fechamento')) {
      historicoBase.push({
        tipo: 'fechamento',
        produto_nome: '—',
        quantidade: 0,
        atendente_nome: null,
        observacao: null,
        data: pulseiraData.fechada_em,
      });
    }

    // Deduplicate and sort desc
    const unique = new Map<string, PulseiraHistorico>();
    for (const mov of historicoBase) {
      const key = `${mov.tipo}|${mov.produto_nome}|${mov.quantidade}|${mov.data}|${mov.atendente_nome ?? ''}`;
      if (!unique.has(key)) unique.set(key, mov);
    }

    return Array.from(unique.values()).sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  }, []);

  const carregarDetalhes = useCallback(async (pulseiraId: string) => {
    const db = await getSupabaseClient();

    const { data: pulseiraData } = await db
      .from('pulseiras' as any)
      .select('*')
      .eq('id', pulseiraId)
      .maybeSingle();

    if (pulseiraData) {
      setPulseira((prev) => {
        if (prev && prev.id !== pulseiraId) return prev;
        return { ...(prev || {}), ...(pulseiraData as any) } as Pulseira;
      });
    }

    const [resumo, hist] = await Promise.all([
      carregarSaldosPadronizados(db, pulseiraId),
      carregarHistoricoPadronizado(db, pulseiraId, pulseiraData as any),
    ]);

    setResumoProdutos(resumo);
    setHistorico(hist);

    setItens(hist.filter((h) => h.tipo === 'carga').map((h: any) => ({
      id: `${h.tipo}-${h.data}-${h.produto_nome}`,
      pulseira_id: pulseiraId,
      produto_id: '',
      produto_nome: h.produto_nome || 'Produto sem nome',
      quantidade: Number(h.quantidade),
      valor_unitario: 0,
      valor_total: 0,
      atendente_user_id: null,
      atendente_nome: h.atendente_nome ?? null,
      codigo_venda: null,
      created_at: h.data,
    })));
    setConsumos(hist.filter((h) => h.tipo === 'baixa').map((h: any) => ({
      id: `${h.tipo}-${h.data}-${h.produto_nome}`,
      pulseira_id: pulseiraId,
      pulseira_item_id: null,
      produto_id: '',
      produto_nome: h.produto_nome || 'Produto sem nome',
      quantidade: Number(h.quantidade),
      atendente_user_id: null,
      atendente_nome: h.atendente_nome ?? null,
      observacao: h.observacao ?? null,
      created_at: h.data,
    })));
  }, [carregarHistoricoPadronizado, carregarSaldosPadronizados]);

  const abrirPulseira = useCallback(async (data: { numero: string; nome_cliente: string; telefone_cliente: string; cpf?: string; aberta_por?: string }) => {
    setLoading(true);
    try {
      const db = await getSupabaseClient();
      // Check for any existing pulseira with this number
      const { data: existing } = await db
        .from('pulseiras')
        .select('id, status')
        .eq('numero', data.numero.trim())
        .maybeSingle();
      if (existing) {
        if (existing.status === 'ativa') {
          toast({ title: 'Erro', description: 'Esta pulseira já está cadastrada.', variant: 'destructive' });
        } else {
          toast({ title: 'Erro', description: 'Esta pulseira já foi utilizada e não pode ser cadastrada novamente.', variant: 'destructive' });
        }
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

  const executarBaixaRpc = useCallback(async (
    db: any,
    params: {
      pulseiraId: string;
      produtoId: string;
      quantidade: number;
      usuarioIdLogado: string;
      atendenteNome?: string;
      observacao?: string;
    }
  ) => {
    const tentativas: { nome: string; payload: Record<string, any> }[] = [
      {
        nome: 'baixar_produto_pulseira',
        payload: {
          pulseira_id: params.pulseiraId,
          produto_id: params.produtoId,
          quantidade: params.quantidade,
          usuario_id_logado: params.usuarioIdLogado,
        },
      },
      {
        nome: 'rpc_pulseira_baixar_item',
        payload: {
          p_pulseira_id: params.pulseiraId,
          p_produto_id: params.produtoId,
          p_quantidade: params.quantidade,
          p_atendente_id: params.usuarioIdLogado,
          p_atendente_nome: params.atendenteNome || null,
          p_observacao: params.observacao || null,
        },
      },
      {
        nome: 'rpc_pulseira_baixar_item',
        payload: {
          pulseira_id: params.pulseiraId,
          produto_id: params.produtoId,
          quantidade: params.quantidade,
          usuario_id_logado: params.usuarioIdLogado,
          observacao: params.observacao || null,
        },
      },
    ];

    let lastError: any = null;
    for (const tentativa of tentativas) {
      const { error } = await db.rpc(tentativa.nome as any, tentativa.payload as any);
      if (!error) return;
      lastError = error;
      console.warn(`[Pulseiras] RPC ${tentativa.nome} falhou na baixa:`, error.message);
    }

    throw lastError || new Error('Falha ao executar baixa da pulseira');
  }, []);

  const consumirProduto = useCallback(async (pulseiraId: string, produto_id: string, produto_nome: string, quantidade: number, atendente_user_id?: string, atendente_nome?: string, observacao?: string) => {
    const prod = resumoProdutos.find(p => p.produto_id === produto_id);
    if (!prod || prod.disponivel < quantidade) {
      toast({ title: 'Saldo insuficiente', description: 'Este produto não possui saldo disponível para baixa.', variant: 'destructive' });
      return false;
    }

    if (!atendente_user_id) {
      console.warn('[Pulseiras] Baixa bloqueada por falta de usuário logado:', { pulseiraId, produto_id, produto_nome });
      toast({ title: 'Erro', description: 'Não foi possível concluir a baixa do produto.', variant: 'destructive' });
      return false;
    }

    try {
      const db = await getSupabaseClient();
      await executarBaixaRpc(db, {
        pulseiraId,
        produtoId: produto_id,
        quantidade,
        usuarioIdLogado: atendente_user_id,
        atendenteNome: atendente_nome,
        observacao,
      });

      toast({ title: 'Produto baixado com sucesso.' });
      await carregarDetalhes(pulseiraId);
      return true;
    } catch (err: any) {
      console.error('[Pulseiras] Erro na baixa:', err);
      toast({ title: 'Erro', description: 'Não foi possível concluir a baixa do produto.', variant: 'destructive' });
      return false;
    }
  }, [resumoProdutos, carregarDetalhes, executarBaixaRpc]);

  // Manual close: ONLY allowed when saldo = 0
  // 24h rule triggers abatement flow instead
  const fecharPulseira = useCallback(async (pulseiraId: string): Promise<boolean | 'abatimento'> => {
    const temSaldo = resumoProdutos.some(p => p.disponivel > 0);
    
    if (temSaldo) {
      // Check if 24h passed — if so, offer abatement flow
      if (pulseira) {
        const abertaEm = new Date(pulseira.aberta_em);
        const agora = new Date();
        const diffHoras = (agora.getTime() - abertaEm.getTime()) / (1000 * 60 * 60);
        if (diffHoras >= 24) {
          return 'abatimento';
        }
      }
      // Manual close blocked — saldo exists and < 24h
      toast({
        title: 'Não é possível fechar',
        description: 'A pulseira não pode ser finalizada manualmente enquanto existir crédito ou produtos disponíveis para retirada.',
        variant: 'destructive',
      });
      return false;
    }

    // No saldo — close normally
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

  const fecharComAbatimento = useCallback(async (
    pulseiraId: string,
    produtosAbatimento: { produto_id: string; produto_nome: string; quantidade: number; valor_unitario: number }[],
    atendenteUserId?: string,
    atendenteNome?: string,
  ): Promise<boolean> => {
    try {
      const db = await getSupabaseClient();

      // 1. Give baixa on all remaining products via direct insert
      const produtosComSaldo = resumoProdutos.filter(p => p.disponivel > 0);
      for (const prod of produtosComSaldo) {
        const { error } = await db
          .from('pulseira_baixas' as any)
          .insert({
            pulseira_id: pulseiraId,
            produto_id: prod.produto_id,
            nome_produto: prod.produto_nome,
            quantidade: prod.disponivel,
            atendente_id: atendenteUserId || null,
            atendente_nome: atendenteNome || null,
            observacao: 'baixa automática para encerramento com abate de crédito',
          });
        if (error) throw error;
      }

      // 2. Add the abatement products
      if (produtosAbatimento.length > 0) {
        const rows = produtosAbatimento.map(i => ({
          pulseira_id: pulseiraId,
          produto_id: i.produto_id,
          nome_produto: i.produto_nome,
          quantidade: i.quantidade,
          valor_unitario: i.valor_unitario,
          valor_total: i.quantidade * i.valor_unitario,
          atendente_user_id: atendenteUserId || null,
        }));
        const { error: insertError } = await db.from('pulseira_itens').insert(rows as any);
        if (insertError) throw insertError;

        for (const prod of produtosAbatimento) {
          const { error } = await db
            .from('pulseira_baixas' as any)
            .insert({
              pulseira_id: pulseiraId,
              produto_id: prod.produto_id,
              nome_produto: prod.produto_nome,
              quantidade: prod.quantidade,
              atendente_id: atendenteUserId || null,
              atendente_nome: atendenteNome || null,
              observacao: 'inseridos para abate de credito',
            });
          if (error) throw error;
        }
      }

      // 3. Close the pulseira
      const { error: closeError } = await db
        .from('pulseiras')
        .update({ status: 'encerrada', fechada_em: new Date().toISOString() } as any)
        .eq('id', pulseiraId);
      if (closeError) throw closeError;

      toast({ title: 'Pulseira encerrada com abatimento de crédito!' });
      setPulseira(null);
      return true;
    } catch (err: any) {
      toast({ title: 'Erro ao fechar com abatimento', description: err.message, variant: 'destructive' });
      return false;
    }
  }, [resumoProdutos]);

  // Reopen a closed pulseira (only if closed < 24h ago)
  const reabrirPulseira = useCallback(async (pulseiraId: string, fechadaEm: string | null): Promise<boolean> => {
    if (fechadaEm) {
      const fechadaDate = new Date(fechadaEm);
      const agora = new Date();
      const diffHoras = (agora.getTime() - fechadaDate.getTime()) / (1000 * 60 * 60);
      if (diffHoras >= 24) {
        toast({
          title: 'Prazo expirado',
          description: 'Esta pulseira não pode mais ser reaberta porque o prazo de reabertura expirou (mais de 24h desde o fechamento).',
          variant: 'destructive',
        });
        return false;
      }
    }
    try {
      const db = await getSupabaseClient();
      const { error } = await db
        .from('pulseiras')
        .update({ status: 'ativa', fechada_em: null } as any)
        .eq('id', pulseiraId);
      if (error) throw error;
      toast({ title: 'Pulseira reaberta com sucesso!' });
      return true;
    } catch (err: any) {
      toast({ title: 'Erro ao reabrir', description: err.message, variant: 'destructive' });
      return false;
    }
  }, []);

  const excluirPulseira = useCallback(async (pulseiraId: string): Promise<boolean> => {
    try {
      const db = await getSupabaseClient();
      // Check if there's any movement (items or consumos)
      const { data: itensExist } = await db
        .from('pulseira_itens' as any)
        .select('id')
        .eq('pulseira_id', pulseiraId)
        .limit(1);
      if (itensExist && itensExist.length > 0) {
        toast({ title: 'Não é possível excluir', description: 'Esta pulseira possui movimentação vinculada e não pode ser excluída.', variant: 'destructive' });
        return false;
      }
      const { error } = await db
        .from('pulseiras')
        .delete()
        .eq('id', pulseiraId);
      if (error) throw error;
      toast({ title: 'Pulseira excluída com sucesso!' });
      setPulseira(null);
      return true;
    } catch (err: any) {
      toast({ title: 'Erro ao excluir', description: err.message, variant: 'destructive' });
      return false;
    }
  }, []);

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
    pulseirasFechadas,
    buscarPulseira,
    abrirPulseira,
    adicionarItens,
    consumirProduto,
    fecharPulseira,
    fecharComAbatimento,
    reabrirPulseira,
    excluirPulseira,
    carregarDetalhes,
    listarAtivas,
    listarFechadas,
    limpar,
  };
}

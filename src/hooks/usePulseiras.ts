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
  if (tipo.includes('inclu') || tipo.includes('carg') || tipo.includes('adicion') || tipo.includes('lanc')) return 'inclusao';
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

  const carregarSaldosFallback = useCallback(async (db: any, pulseiraId: string): Promise<PulseiraProdutoResumo[]> => {
    const [itensRes, baixasRes] = await Promise.all([
      db
        .from('pulseira_itens' as any)
        .select('*')
        .eq('pulseira_id', pulseiraId),
      db
        .from('pulseira_baixas' as any)
        .select('*')
        .eq('pulseira_id', pulseiraId),
    ]);

    if (itensRes.error) console.warn('[Pulseiras] Fallback pulseira_itens falhou:', itensRes.error.message);
    if (baixasRes.error) console.warn('[Pulseiras] Fallback pulseira_baixas falhou:', baixasRes.error.message);

    const map = new Map<string, PulseiraProdutoResumo>();

    for (const row of (itensRes.data || []) as any[]) {
      const produtoId = String(getFirstDefined(row, ['produto_id']) || `nome:${String(getFirstDefined(row, ['produto_nome', 'nome_produto']) || '')}`);
      const produtoNome = String(getFirstDefined(row, ['produto_nome', 'nome_produto']) || 'Produto sem nome');
      const qtd = Number(getFirstDefined(row, ['quantidade']) ?? 0);
      const valorUnit = Number(getFirstDefined(row, ['valor_unitario']) ?? 0);

      const curr = map.get(produtoId) || {
        pulseira_id: pulseiraId,
        produto_id: produtoId,
        produto_nome: produtoNome,
        comprado: 0,
        consumido: 0,
        disponivel: 0,
        valor_unitario: valorUnit,
        ultima_retirada: null,
        ultimo_atendente: null,
      };

      curr.comprado += Number.isFinite(qtd) ? qtd : 0;
      if (!curr.valor_unitario && Number.isFinite(valorUnit)) curr.valor_unitario = valorUnit;
      curr.disponivel = Math.max(0, curr.comprado - curr.consumido);
      map.set(produtoId, curr);
    }

    for (const row of (baixasRes.data || []) as any[]) {
      const produtoId = String(getFirstDefined(row, ['produto_id']) || `nome:${String(getFirstDefined(row, ['produto_nome', 'nome_produto']) || '')}`);
      const produtoNome = String(getFirstDefined(row, ['produto_nome', 'nome_produto']) || 'Produto sem nome');
      const qtd = Number(getFirstDefined(row, ['quantidade']) ?? 0);
      const createdAt = (getFirstDefined(row, ['created_at']) as string | null) ?? null;
      const atendenteNome = (getFirstDefined(row, ['atendente_nome']) as string | null) ?? null;

      const curr = map.get(produtoId) || {
        pulseira_id: pulseiraId,
        produto_id: produtoId,
        produto_nome: produtoNome,
        comprado: 0,
        consumido: 0,
        disponivel: 0,
        valor_unitario: 0,
        ultima_retirada: null,
        ultimo_atendente: null,
      };

      curr.consumido += Number.isFinite(qtd) ? qtd : 0;
      curr.disponivel = Math.max(0, curr.comprado - curr.consumido);
      if (createdAt && (!curr.ultima_retirada || new Date(createdAt).getTime() >= new Date(curr.ultima_retirada).getTime())) {
        curr.ultima_retirada = createdAt;
        curr.ultimo_atendente = atendenteNome;
      }
      map.set(produtoId, curr);
    }

    return Array.from(map.values());
  }, []);

  const carregarSaldosPadronizados = useCallback(async (db: any, pulseiraId: string): Promise<PulseiraProdutoResumo[]> => {
    const { data, error } = await db.rpc('listar_saldo_pulseira_produto' as any, { p_pulseira_id: pulseiraId } as any);
    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((row: any) => normalizeSaldoRow(row, pulseiraId));
    }
    if (error) console.warn('[Pulseiras] RPC listar_saldo_pulseira_produto falhou:', error.message);
    if (!error && Array.isArray(data) && data.length === 0) {
      console.warn('[Pulseiras] RPC listar_saldo_pulseira_produto retornou vazio, tentando fallback...');
    }
    const fallback = await carregarSaldosFallback(db, pulseiraId);
    if (fallback.length === 0) {
      console.warn('[Pulseiras] Fallback também retornou vazio. Verifique as políticas de RLS nas tabelas pulseira_itens e pulseira_baixas.');
    }
    return fallback;
  }, [carregarSaldosFallback]);

  const carregarHistoricoPadronizado = useCallback(async (db: any, pulseiraId: string, pulseiraData?: Partial<Pulseira> | null): Promise<PulseiraHistorico[]> => {
    let historicoBase: PulseiraHistorico[] = [];

    const { data, error } = await db.rpc('listar_historico_pulseira' as any, { p_pulseira_id: pulseiraId } as any);
    if (!error && Array.isArray(data)) {
      historicoBase = data.map((row: any) => normalizeHistoricoRow(row));
    } else {
      if (error) console.warn('[Pulseiras] RPC listar_historico_pulseira falhou:', error.message);

      const [itensRes, baixasRes] = await Promise.all([
        db
          .from('pulseira_itens' as any)
          .select('*')
          .eq('pulseira_id', pulseiraId)
          .order('created_at', { ascending: false }),
        db
          .from('pulseira_baixas' as any)
          .select('*')
          .eq('pulseira_id', pulseiraId)
          .order('created_at', { ascending: false }),
      ]);

      if (itensRes.error) console.warn('[Pulseiras] Fallback histórico de itens falhou:', itensRes.error.message);
      if (baixasRes.error) console.warn('[Pulseiras] Fallback histórico de baixas falhou:', baixasRes.error.message);

      const histItens = ((itensRes.data || []) as any[]).map((row) =>
        normalizeHistoricoRow({
          ...row,
          tipo: 'inclusao',
          produto_nome: getFirstDefined(row, ['produto_nome', 'nome_produto']),
        })
      );

      const histBaixas = ((baixasRes.data || []) as any[]).map((row) =>
        normalizeHistoricoRow({
          ...row,
          tipo: 'baixa',
          produto_nome: getFirstDefined(row, ['produto_nome', 'nome_produto']),
        })
      );

      historicoBase = [...histItens, ...histBaixas];
    }

    // Add abertura/fechamento from pulseira data if not already present
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

    setItens(hist.filter((h) => h.tipo === 'inclusao').map((h: any) => ({
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

  const adicionarItens = useCallback(async (pulseiraId: string, items: { produto_id: string; produto_nome: string; quantidade: number; valor_unitario: number; atendente_user_id?: string; atendente_nome?: string; codigo_venda?: string; observacao?: string }[]) => {
    try {
      const db = await getSupabaseClient();
      for (const item of items) {
        const usuarioId = item.atendente_user_id?.trim();
        if (!usuarioId) throw new Error('MISSING_LOGGED_USER');

        const { data, error } = await db.rpc('incluir_produto_pulseira' as any, {
          p_pulseira_id: pulseiraId,
          p_produto_id: item.produto_id,
          p_quantidade: item.quantidade,
          p_usuario_id: usuarioId,
          p_observacao: item.observacao?.trim() || null,
        } as any);
        if (error || data === false || data === 0 || data === 'false') {
          const { error: insertFallbackError } = await db
            .from('pulseira_itens' as any)
            .insert({
              pulseira_id: pulseiraId,
              produto_id: item.produto_id,
              nome_produto: item.produto_nome,
              quantidade: item.quantidade,
              valor_unitario: item.valor_unitario,
              valor_total: Number(item.quantidade) * Number(item.valor_unitario),
              atendente_user_id: usuarioId,
            } as any);

          if (insertFallbackError) {
            if (error) throw error;
            throw insertFallbackError;
          }
        }
      }

      await carregarDetalhes(pulseiraId);

      toast({ title: 'Produto adicionado à pulseira com sucesso.' });
      return true;
    } catch (err: any) {
      console.error('[Pulseiras] Erro ao incluir produto:', err);
      toast({ title: 'Erro', description: 'Não foi possível adicionar o produto à pulseira.', variant: 'destructive' });
      return false;
    }
  }, [carregarDetalhes, carregarSaldosPadronizados]);

  const consumirProduto = useCallback(async (pulseiraId: string, produto_id: string, produto_nome: string, quantidade: number, atendente_user_id?: string, atendente_nome?: string, observacao?: string) => {
    const prod = resumoProdutos.find(p => p.produto_id === produto_id);
    if (!prod || prod.disponivel < quantidade) {
      toast({ title: 'Saldo insuficiente', description: 'Este produto não possui saldo disponível para baixa.', variant: 'destructive' });
      return false;
    }

    if (!atendente_user_id) {
      toast({ title: 'Erro', description: 'Não foi possível concluir a baixa do produto.', variant: 'destructive' });
      return false;
    }

    try {
      const db = await getSupabaseClient();
      const { error } = await db.rpc('baixar_produto_pulseira' as any, {
        p_pulseira_id: pulseiraId,
        p_produto_id: produto_id,
        p_quantidade: quantidade,
        p_usuario_id: atendente_user_id,
        p_observacao: observacao || null,
      } as any);
      if (error) {
        const fallback = await db.rpc('rpc_pulseira_baixar_item' as any, {
          p_pulseira_id: pulseiraId,
          p_produto_id: produto_id,
          p_quantidade: quantidade,
          p_usuario_id: atendente_user_id,
          p_observacao: observacao || null,
        } as any);
        if (fallback.error) {
          const { error: insertFallbackError } = await db
            .from('pulseira_baixas' as any)
            .insert({
              pulseira_id: pulseiraId,
              produto_id,
              nome_produto: produto_nome,
              quantidade,
              atendente_id: atendente_user_id,
              atendente_nome: atendente_nome || null,
              observacao: observacao || null,
            } as any);

          if (insertFallbackError) throw error;
        }
      }

      toast({ title: 'Produto baixado com sucesso.' });
      await carregarDetalhes(pulseiraId);
      return true;
    } catch (err: any) {
      console.error('[Pulseiras] Erro na baixa:', err);
      toast({ title: 'Erro', description: 'Não foi possível concluir a baixa do produto.', variant: 'destructive' });
      return false;
    }
  }, [resumoProdutos, carregarDetalhes]);

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

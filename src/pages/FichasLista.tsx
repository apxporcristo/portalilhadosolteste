import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, Printer, ShoppingCart, Trash2, Minus, CreditCard, ClipboardList, Scale, RefreshCw, Save, FileText, Settings2, Watch } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useFichasConsumo, FichaAtiva, FichaProduto } from '@/hooks/useFichasConsumo';
import { useComplementos, Complemento, ComplementoItem, GrupoComplemento } from '@/hooks/useComplementos';
import { getSupabaseClient, useVouchers } from '@/hooks/useVouchers';
import { getPrintLayoutConfig } from '@/hooks/usePrintLayout';
import { useOptionalUserSession } from '@/contexts/UserSessionContext';
import { usePrinterContext } from '@/contexts/PrinterContext';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useFormasPagamento, FormaPagamento } from '@/hooks/useFormasPagamento';
import { useComandas } from '@/hooks/useComandas';
import { usePulseiras, Pulseira } from '@/hooks/usePulseiras';
import { PagamentoDialog, PagamentoSelecionado } from '@/components/PagamentoDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PrintSelectionDialog, PrintSelectableItem } from '@/components/PrintSelectionDialog';
import { useBalanca } from '@/hooks/useBalanca';

function generateCodigoVenda(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `V${datePart}${timePart}-${rand}`;
}

interface SelectedItem {
  categoria: string;
  item: ComplementoItem;
}

interface CartItem {
  ficha: FichaAtiva;
  quantidade: number;
  selectedItems: SelectedItem[];
  peso?: number;
  valorPorKg?: number;
}

function cartItemKey(item: CartItem) {
  const itemIds = item.selectedItems.map(si => si.item.id).sort().join(',');
  const pesoKey = item.peso != null ? `__peso_${item.peso.toFixed(3)}` : '';
  return `${item.ficha.id}__${itemIds}${pesoKey}`;
}

function cartItemTotal(item: CartItem) {
  if (item.peso && item.valorPorKg) {
    return item.peso * item.valorPorKg + item.selectedItems.reduce((sum, si) => sum + Number(si.item.valor), 0);
  }
  return Number(item.ficha.valor) + item.selectedItems.reduce((sum, si) => sum + Number(si.item.valor), 0);
}

export default function FichasLista() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pulseiraContextId = searchParams.get('pulseira_id');
  const pulseiraContextNumero = searchParams.get('pulseira_numero');
  const pulseiraContextNome = searchParams.get('pulseira_nome');
  const hasPulseiraContext = !!(pulseiraContextId && pulseiraContextNumero);
  const { fichasAtivas, loading, registrarImpressao, produtos } = useFichasConsumo();
  const { getCategoriasOrdenadas, getItemsDaCategoria, getGruposDaCategoria, loading: loadingComp } = useComplementos();
  const userSession = useOptionalUserSession();
  const userName = userSession?.access?.nome || '';
  const { comandasAbertas, lancarItens, refetch: refetchComandas } = useComandas();
  const { pulseirasAtivas, listarAtivas: listarPulseirasAtivas, adicionarItens: adicionarItensPulseira } = usePulseiras();
  const { getFreVouchersBatch, markVouchersPreReservado, stats: voucherStats } = useVouchers();
  const { ensureBluetoothConnected, writeToCharacteristic } = usePrinterContext();
  const balanca = useBalanca();
  const { lerPeso, verificarConexaoHeartbeat, garantirConexaoComTentativas, parearNovoDispositivo, startHeartbeat, stopHeartbeat } = balanca;
  const [search, setSearch] = useState('');
  const [selectedCategoria, setSelectedCategoria] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  // Peso manual input
  const [showPesoModal, setShowPesoModal] = useState(false);
  const [pesoManual, setPesoManual] = useState('');
  const [pendingPesoFicha, setPendingPesoFicha] = useState<{ ficha: FichaAtiva; selectedItems: SelectedItem[] } | null>(null);
  const [autoConnectingBalanca, setAutoConnectingBalanca] = useState(false);
  const [showManualConnectButton, setShowManualConnectButton] = useState(false);

  // Lançar na comanda
  const [showComandaModal, setShowComandaModal] = useState(false);
  const [comandaSearch, setComandaSearch] = useState('');
  const [confirmComanda, setConfirmComanda] = useState<{ id: string; numero: number } | null>(null);

  // Lançar na pulseira
  const [showPulseiraModal, setShowPulseiraModal] = useState(false);
  const [pulseiraSearch, setPulseiraSearch] = useState('');
  const [confirmPulseira, setConfirmPulseira] = useState<Pulseira | null>(null);

  // Load pulseiras when needed
  useEffect(() => {
    listarPulseirasAtivas();
  }, [listarPulseirasAtivas]);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);

  // Sequential category selection flow
  const [pendingFicha, setPendingFicha] = useState<FichaAtiva | null>(null);
  const [categoriasSequencia, setCategoriasSequencia] = useState<Complemento[]>([]);
  const [currentCatIndex, setCurrentCatIndex] = useState(0);
  const [currentCatItems, setCurrentCatItems] = useState<ComplementoItem[]>([]);
  const [currentCatGrupos, setCurrentCatGrupos] = useState<GrupoComplemento[]>([]);
  const [showCatModal, setShowCatModal] = useState(false);
  const [collectedItems, setCollectedItems] = useState<SelectedItem[]>([]);
  const [groupSelections, setGroupSelections] = useState<Record<string, ComplementoItem[]>>({});

  const totalCart = useMemo(() => {
    return cart.reduce((sum, item) => sum + cartItemTotal(item) * item.quantidade, 0);
  }, [cart]);

  const totalItems = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantidade, 0);
  }, [cart]);

  // Forma de pagamento modal
  const { formasAtivas } = useFormasPagamento();
  const [showPagamentoModal, setShowPagamentoModal] = useState(false);

  // Print selection modal (after payment confirmed)
  const [showPrintSelection, setShowPrintSelection] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [savedCodigoVenda, setSavedCodigoVenda] = useState<string | null>(null);

  // Voucher Pix config
  const userAccess = userSession?.access;
  const canGenerateVoucher = !!(userAccess?.acesso_voucher);
  const voucherTempo = userAccess?.voucher_tempo_acesso || null;

  const handleGeneratePixVoucher = async (tempo: string | null): Promise<{ voucher_id: string; tempo_validade: string } | null> => {
    const tempoToUse = tempo;
    if (!tempoToUse) {
      toast({ title: 'Tempo não definido', description: 'Selecione um tempo de voucher.', variant: 'destructive' });
      return null;
    }
    const batch = getFreVouchersBatch([{ tempo: tempoToUse, quantity: 1 }]);
    if (batch.length === 0) {
      toast({ title: 'Sem voucher disponível', description: `Não há voucher de ${tempoToUse} disponível no momento.`, variant: 'destructive' });
      return null;
    }
    const voucher = batch[0];
    const success = await markVouchersPreReservado([voucher.voucher_id]);
    if (!success) return null;
    return { voucher_id: voucher.voucher_id, tempo_validade: voucher.tempo_validade };
  };

  // Dynamic fields dialog
  const [printDialog, setPrintDialog] = useState(false);
  const [nomeCliente, setNomeCliente] = useState('');
  const [telefoneCliente, setTelefoneCliente] = useState('');
  const [documentoCliente, setDocumentoCliente] = useState('');
  const nomeAtendente = userName;

  const visibleFichas = useMemo(() => {
    const activeProductIds = new Set(
      produtos
        .filter(produto => produto.ativo)
        .map(produto => produto.id)
    );

    return fichasAtivas.filter(ficha => activeProductIds.has(ficha.id));
  }, [fichasAtivas, produtos]);

  const categoriasList = useMemo(() => {
    const cats = [...new Set(visibleFichas.map(f => f.categoria_nome).filter(Boolean))];
    return cats.sort((a, b) => {
      const aServe = a.toLowerCase().includes('serve-service') || a.toLowerCase().includes('self service') || a.toLowerCase().includes('serve service');
      const bServe = b.toLowerCase().includes('serve-service') || b.toLowerCase().includes('self service') || b.toLowerCase().includes('serve service');
      if (aServe && !bServe) return -1;
      if (!aServe && bServe) return 1;
      return a.localeCompare(b);
    });
  }, [visibleFichas]);

  const filtered = useMemo(() => {
    let list = [...visibleFichas];
    if (selectedCategoria) {
      list = list.filter(f => f.categoria_nome === selectedCategoria);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(f => (f.nome_produto ?? '').toLowerCase().includes(q) || (f.categoria_nome ?? '').toLowerCase().includes(q));
    }
    return list.sort((a, b) => (a.categoria_nome ?? '').localeCompare(b.categoria_nome ?? '') || (a.nome_produto ?? '').localeCompare(b.nome_produto ?? ''));
  }, [visibleFichas, search, selectedCategoria]);

  const grouped = useMemo(() => {
    const map: Record<string, FichaAtiva[]> = {};
    filtered.forEach(f => {
      const cat = f.categoria_nome ?? 'Sem categoria';
      if (!map[cat]) map[cat] = [];
      map[cat].push(f);
    });
    return Object.entries(map).sort(([a], [b]) => {
      const aServe = a.toLowerCase().includes('serve-service') || a.toLowerCase().includes('self service') || a.toLowerCase().includes('serve service');
      const bServe = b.toLowerCase().includes('serve-service') || b.toLowerCase().includes('self service') || b.toLowerCase().includes('serve service');
      if (aServe && !bServe) return -1;
      if (!aServe && bServe) return 1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const needsCliente = useMemo(() => cart.some(item => item.ficha.exigir_dados_cliente), [cart]);
  const needsAtendente = useMemo(() => cart.some(item => item.ficha.exigir_dados_atendente), [cart]);

  const addToCart = async (ficha: FichaAtiva) => {
    // Check if product is by weight
    const produto = produtos.find(p => p.id === ficha.id);
    const isPorPeso = produto?.forma_venda === 'por_peso' || (ficha as any).forma_venda === 'por_peso';

    const cats = getCategoriasOrdenadas(ficha.id);
    if (cats.length > 0) {
      setPendingFicha(ficha);
      setCategoriasSequencia(cats);
      setCollectedItems([]);
      setCurrentCatIndex(0);
      const firstItems = getItemsDaCategoria(cats[0].id);
      const firstGrupos = getGruposDaCategoria(cats[0].id);
      setCurrentCatItems(firstItems);
      setCurrentCatGrupos(firstGrupos);
      setGroupSelections({});
      setShowCatModal(true);
      return;
    }
    if (isPorPeso) {
      await handlePesoProduct(ficha, []);
      return;
    }
    addItemToCart(ficha, []);
  };

  const handlePesoProduct = async (ficha: FichaAtiva, selectedItems: SelectedItem[]) => {
    setPendingPesoFicha({ ficha, selectedItems });
    setPesoManual('');
    setShowManualConnectButton(false);
    setShowPesoModal(true);
  };

  useEffect(() => {
    if (!showPesoModal) return;

    let active = true;
    const autoConnectScale = async () => {
      // Check if already connected — skip reconnection
      const heartbeatOk = await verificarConexaoHeartbeat();
      if (!active) return;

      if (heartbeatOk) {
        console.log('[Balança] Já conectada, reutilizando conexão existente');
        setAutoConnectingBalanca(false);
        setShowManualConnectButton(false);
        startHeartbeat();
        return;
      }

      console.log('[Balança] Não conectada, tentando conexão automática...');
      setAutoConnectingBalanca(true);
      setShowManualConnectButton(false);

      const connectedOk = await garantirConexaoComTentativas(3);
      if (!active) return;

      setAutoConnectingBalanca(false);
      setShowManualConnectButton(!connectedOk);
      console.log('[Balança] Resultado conexão automática:', connectedOk ? 'OK' : 'Falha');
      if (connectedOk) {
        startHeartbeat();
      }
    };

    autoConnectScale();

    return () => {
      active = false;
      stopHeartbeat('modal-closed');
    };
  }, [showPesoModal, verificarConexaoHeartbeat, garantirConexaoComTentativas, startHeartbeat, stopHeartbeat]);

  const handleConfirmPesoManual = () => {
    if (!pendingPesoFicha) return;
    const peso = parseFloat(pesoManual.replace(',', '.'));
    if (!peso || peso <= 0) {
      toast({ title: 'Peso inválido', variant: 'destructive' });
      return;
    }
    const produto = produtos.find(p => p.id === pendingPesoFicha.ficha.id);
    const valorKg = produto?.valor_por_kg || Number(pendingPesoFicha.ficha.valor);
    addItemToCart(pendingPesoFicha.ficha, pendingPesoFicha.selectedItems, peso, valorKg);
    // Keep modal open, just clear weight for next reading
    setPesoManual('');
    toast({ title: 'Item adicionado!', description: `${pendingPesoFicha.ficha.nome_produto} - ${peso.toFixed(3)} kg` });
    console.log('[Balança] Item adicionado, modal permanece aberto, conexão preservada');
  };

  const handleClosePesoModal = () => {
    setShowPesoModal(false);
    setPendingPesoFicha(null);
    console.log('[Balança] Modal fechado pelo usuário');
  };

  const moveToNextCategory = (newCollected: SelectedItem[]) => {
    const nextIndex = currentCatIndex + 1;
    if (nextIndex < categoriasSequencia.length) {
      setCollectedItems(newCollected);
      setCurrentCatIndex(nextIndex);
      const nextItems = getItemsDaCategoria(categoriasSequencia[nextIndex].id);
      const nextGrupos = getGruposDaCategoria(categoriasSequencia[nextIndex].id);
      setCurrentCatItems(nextItems);
      setCurrentCatGrupos(nextGrupos);
      setGroupSelections({});
    } else {
      setShowCatModal(false);
      if (pendingFicha) {
        const produto = produtos.find(p => p.id === pendingFicha.id);
        if (produto?.forma_venda === 'por_peso') {
          handlePesoProduct(pendingFicha, newCollected);
        } else {
          addItemToCart(pendingFicha, newCollected);
        }
        setPendingFicha(null);
      }
    }
  };

  const handleSelectItem = (item: ComplementoItem) => {
    const catName = categoriasSequencia[currentCatIndex]?.nome || '';
    // Count exclusive items in this category to decide if exclusivity rule applies
    const exclusiveCount = currentCatItems.filter(i => i.escolha_exclusiva).length;
    const exclusivityActive = exclusiveCount >= 2;

    if (item.escolha_exclusiva && exclusivityActive) {
      // Exclusive item: toggle, deselect other exclusive items, keep normal items
      setGroupSelections(prev => {
        const freeKey = '__free__';
        const current = prev[freeKey] || [];
        const exists = current.find(i => i.id === item.id);
        if (exists) {
          return { ...prev, [freeKey]: current.filter(i => i.id !== item.id) };
        }
        const filtered = current.filter(i => !i.escolha_exclusiva);
        return { ...prev, [freeKey]: [...filtered, item] };
      });
      return;
    }

    // Normal item (or exclusive with <2 exclusive items): toggle freely
    setGroupSelections(prev => {
      const freeKey = '__free__';
      const current = prev[freeKey] || [];
      const exists = current.find(i => i.id === item.id);
      if (exists) {
        return { ...prev, [freeKey]: current.filter(i => i.id !== item.id) };
      }
      return { ...prev, [freeKey]: [...current, item] };
    });
  };

  const handleConfirmCategorySelection = () => {
    const catName = categoriasSequencia[currentCatIndex]?.nome || '';
    const newSelected: SelectedItem[] = [];
    const freeItems = groupSelections['__free__'] || [];
    for (const item of freeItems) {
      newSelected.push({ categoria: catName, item });
    }
    const newCollected = [...collectedItems, ...newSelected];
    moveToNextCategory(newCollected);
  };

  const handleSkipCategory = () => {
    moveToNextCategory(collectedItems);
  };

  const handleAddWithoutComplementos = () => {
    setShowCatModal(false);
    if (pendingFicha) {
      const produto = produtos.find(p => p.id === pendingFicha.id);
      if (produto?.forma_venda === 'por_peso') {
        handlePesoProduct(pendingFicha, []);
      } else {
        addItemToCart(pendingFicha, []);
      }
      setPendingFicha(null);
    }
  };

  const addItemToCart = (ficha: FichaAtiva, selectedItems: SelectedItem[], peso?: number, valorPorKg?: number) => {
    const itemIds = selectedItems.map(si => si.item.id).sort().join(',');
    const pesoKey = peso ? `_p${peso.toFixed(3)}` : '';
    const key = `${ficha.id}__${itemIds}${pesoKey}`;
    setCart(prev => {
      if (peso) {
        // Weight items are always unique entries
        return [...prev, { ficha, quantidade: 1, selectedItems, peso, valorPorKg }];
      }
      const existing = prev.find(c => cartItemKey(c) === key);
      if (existing) {
        return prev.map(c => cartItemKey(c) === key ? { ...c, quantidade: c.quantidade + 1 } : c);
      }
      return [...prev, { ficha, quantidade: 1, selectedItems }];
    });
  };

  const removeFromCart = (key: string) => {
    setCart(prev => {
      const existing = prev.find(c => cartItemKey(c) === key);
      if (existing && existing.quantidade > 1) {
        return prev.map(c => cartItemKey(c) === key ? { ...c, quantidade: c.quantidade - 1 } : c);
      }
      return prev.filter(c => cartItemKey(c) !== key);
    });
  };

  const removeAllFromCart = (key: string) => {
    setCart(prev => prev.filter(c => cartItemKey(c) !== key));
  };

  const clearCart = () => setCart([]);

  const getCartQty = (fichaId: string) => {
    return cart.filter(c => c.ficha.id === fichaId).reduce((sum, c) => sum + c.quantidade, 0);
  };

  // Save all cart items to DB (payment registration) without printing
  const saveAllToDB = async (): Promise<string | null> => {
    const codigoVenda = generateCodigoVenda();
    const sbClient = await getSupabaseClient();
    for (const item of cart) {
      const unitTotal = cartItemTotal(item);
      const dadosExtras: any = {};
      if (item.ficha.exigir_dados_cliente && nomeCliente.trim()) {
        dadosExtras.nome_cliente = nomeCliente.trim();
        if (telefoneCliente.trim()) dadosExtras.telefone_cliente = telefoneCliente.trim();
      }
      if (item.ficha.exigir_dados_atendente && nomeAtendente.trim()) {
        dadosExtras.nome_atendente = nomeAtendente.trim();
      }
      try {
        await registrarImpressao(item.ficha.id, item.quantidade, unitTotal, dadosExtras);
      } catch (e) { console.warn('[Ficha] registrarImpressao falhou:', e); }

      let produtoNome = item.ficha.nome_produto;
      if (item.selectedItems.length > 0) {
        produtoNome += ' | ' + item.selectedItems.map(si => `${si.categoria}: ${si.item.nome}`).join(', ');
      }
      try {
        await sbClient.from('fichas_impressas' as any).insert({
          produto_id: item.ficha.id,
          produto_nome: produtoNome,
          categoria_id: item.ficha.categoria_id,
          categoria_nome: item.ficha.categoria_nome,
          quantidade: item.quantidade,
          valor_unitario: unitTotal,
          valor_total: unitTotal * item.quantidade,
          nome_cliente: nomeCliente.trim() || null,
          telefone_cliente: telefoneCliente.trim() || null,
          nome_atendente: nomeAtendente.trim() || null,
          codigo_venda: codigoVenda,
        });
      } catch (e) { console.warn('[Ficha] fichas_impressas insert falhou:', e); }

      // Send to KDS if product is marked
      const produto = produtos.find(p => p.id === item.ficha.id);
      if ((produto as any)?.enviar_para_kds) {
        try {
          await sbClient.from('kds_orders' as any).insert({
            produto_id: item.ficha.id,
            produto_nome: item.ficha.nome_produto,
            categoria_nome: item.ficha.categoria_nome || '',
            quantidade: item.quantidade,
            valor_unitario: unitTotal,
            valor_total: unitTotal * item.quantidade,
            nome_cliente: nomeCliente.trim() || null,
            telefone_cliente: telefoneCliente.trim() || null,
            nome_atendente: nomeAtendente.trim() || null,
            complementos: item.selectedItems.length > 0 ? item.selectedItems.map(si => `${si.categoria}: ${si.item.nome}`).join(', ') : null,
            observacao: (produto as any)?.obs || null,
            kds_status: 'novo',
          });
        } catch (e) { console.warn('[Ficha] kds_orders insert falhou:', e); }
      }
    }
    return codigoVenda;
  };

  // Build list of selectable items for the print selection modal
  const printSelectableItems = useMemo((): PrintSelectableItem[] => {
    return cart.map(item => {
      const key = cartItemKey(item);
      const produto = produtos.find(p => p.id === item.ficha.id);
      const imprimivel = (produto as any)?.imprimir_ficha !== false;
      return {
        key,
        nome: item.ficha.nome_produto,
        quantidade: item.quantidade,
        categoria: item.ficha.categoria_nome,
        complementos: item.selectedItems.length > 0 ? item.selectedItems.map(si => si.item.nome).join(', ') : undefined,
        obs: (produto as any)?.obs || undefined,
        imprimivel,
      };
    });
  }, [cart, produtos]);

  // Called when payment is confirmed → save to DB, then open print selection
  const handlePaymentConfirmedForPrint = async () => {
    if (cart.length === 0) return;
    if (needsAtendente && !nomeAtendente) {
      toast({ title: 'Atendente obrigatório', description: 'Faça login para identificar o atendente automaticamente.', variant: 'destructive' });
      return;
    }
    if (needsCliente) {
      setNomeCliente('');
      setTelefoneCliente('');
      setDocumentoCliente('');
      setPrintDialog(true);
      return;
    }
    await proceedAfterClientData();
  };

  const addItemsToPulseiraContext = async (): Promise<boolean> => {
    if (!hasPulseiraContext || !pulseiraContextId) return false;
    try {
      const usuarioId = userSession?.user?.id;
      if (!usuarioId) {
        toast({ title: 'Erro', description: 'Não foi possível adicionar o produto à pulseira.', variant: 'destructive' });
        return false;
      }

      const itemsToAdd = cart.map(ci => ({
        produto_id: ci.ficha.id,
        produto_nome: ci.ficha.nome_produto + (ci.selectedItems.length > 0 ? ' | ' + ci.selectedItems.map(si => si.item.nome).join(', ') : ''),
        quantidade: ci.quantidade,
        valor_unitario: cartItemTotal(ci),
        atendente_user_id: usuarioId,
        atendente_nome: userName || undefined,
      }));
      const success = await adicionarItensPulseira(pulseiraContextId, itemsToAdd);
      return !!success;
    } catch (err: any) {
      toast({ title: 'Erro', description: 'Não foi possível adicionar o produto à pulseira.', variant: 'destructive' });
      return false;
    }
  };

  // Direct pulseira flow — no payment, no print modal
  const handleAddToPulseiraDirectly = async () => {
    if (!hasPulseiraContext || !pulseiraContextId || cart.length === 0) return;
    setPrinting(true);
    try {
      const success = await addItemsToPulseiraContext();
      if (success) clearCart();
    } catch (err: any) {
      console.error('[Pulseira] Erro ao adicionar diretamente:', err);
    } finally {
      setPrinting(false);
    }
  };

  const proceedAfterClientData = async () => {
    setPrinting(true);
    try {
      const codigoVenda = await saveAllToDB();

      // If pulseira context, add items to pulseira after payment
      if (hasPulseiraContext) {
        const success = await addItemsToPulseiraContext();
        if (success) {
          clearCart();
        }
        setPaymentConfirmed(false);
        setSavedCodigoVenda(null);
        return;
      } else {
        setSavedCodigoVenda(codigoVenda);
        setPaymentConfirmed(true);
        // Check if there are any printable items
        const hasPrintable = cart.some(item => {
          const produto = produtos.find(p => p.id === item.ficha.id);
          return (produto as any)?.imprimir_ficha !== false;
        });
        if (hasPrintable) {
          setShowPrintSelection(true);
        } else {
          toast({ title: 'Pagamento confirmado!', description: `Venda ${codigoVenda} registrada. Nenhum item gera ficha de impressão.` });
          clearCart();
          setPaymentConfirmed(false);
          setSavedCodigoVenda(null);
        }
      }
    } catch (err) {
      toast({ title: 'Erro', description: `Falha ao registrar pagamento: ${(err as Error)?.message || 'Erro desconhecido'}`, variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  // Print only selected items via Bluetooth
  const handlePrintSelected = async (selectedKeys: string[]) => {
    setPrinting(true);
    try {
      const now = new Date();
      const dateStr = now.toLocaleDateString('pt-BR');
      const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      const itemsToPrint = cart.filter(item => selectedKeys.includes(cartItemKey(item)));

      if (itemsToPrint.length > 0) {
        const characteristic = await ensureBluetoothConnected();
        if (!characteristic) {
          toast({ title: 'Impressora não conectada', description: 'Não foi possível conectar à impressora Bluetooth.', variant: 'destructive' });
        } else {
          for (const item of itemsToPrint) {
            for (let i = 0; i < item.quantidade; i++) {
              const escposData = generateFichaConsumoEscPos(item, dateStr, timeStr, savedCodigoVenda || undefined);
              await writeToCharacteristic(characteristic, escposData);
            }
          }
          toast({ title: 'Impressão enviada!', description: `Venda ${savedCodigoVenda} - fichas impressas com sucesso.` });
        }
      }

      setShowPrintSelection(false);
      clearCart();
      setPaymentConfirmed(false);
      setSavedCodigoVenda(null);
    } catch (err) {
      console.error('[Ficha Print] Erro:', err);
      toast({ title: 'Erro na impressão', description: (err as Error)?.message || 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  const startConferencePrint = async () => {
    // Print ALL items for conference
    executePrint([...cart], true);
  };

  const handleSaveOnly = async () => {
    if (cart.length === 0) return;
    setPrinting(true);
    try {
      const codigoVenda = await saveAllToDB();
      // If pulseira context, add items to pulseira after save
      if (hasPulseiraContext) {
        const success = await addItemsToPulseiraContext();
        if (success) {
          clearCart();
        }
        return;
      }
      toast({ title: 'Salvo!', description: `Venda ${codigoVenda} - ${totalItems} ficha(s) registrada(s). Total: R$ ${totalCart.toFixed(2).replace('.', ',')}` });
      clearCart();
    } catch (err) {
      toast({ title: 'Erro', description: `Falha ao salvar: ${(err as Error)?.message || 'Erro desconhecido'}`, variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  const handleInitPrint = () => {
    handlePaymentConfirmedForPrint();
  };

  const handleInitConferencePrint = () => {
    if (cart.length === 0) return;
    startConferencePrint();
  };

  const handleConfirmPrint = () => {
    setPrintDialog(false);
    proceedAfterClientData();
  };

  const buildItemsText = (item: CartItem): string => {
    if (item.selectedItems.length === 0) return '';
    return item.selectedItems.map(si => `  ${si.item.nome} R$${Number(si.item.valor).toFixed(2).replace('.', ',')}`).join('\n');
  };

  const generateFichaConsumoEscPos = (item: CartItem, dateStr: string, timeStr: string, codigoVenda?: string): Uint8Array => {
    const layoutCfg = getPrintLayoutConfig();
    const normalize = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const escposSizeCmd = (size: number): string => {
      if (size >= 15) return '\x1D\x21\x11';
      if (size >= 11) return '\x1D\x21\x01';
      return '\x1D\x21\x00';
    };

    const titleCmd = escposSizeCmd(layoutCfg.fichaTitleFontSize ?? 10);
    const subtitleCmd = escposSizeCmd(layoutCfg.fichaSubtitleFontSize ?? 8);
    const numberCmd = escposSizeCmd(layoutCfg.fichaNumberFontSize ?? 12);
    const clienteCmd = escposSizeCmd(layoutCfg.fichaClienteFontSize ?? 8);
    const atendenteCmd = escposSizeCmd(layoutCfg.fichaAtendenteFontSize ?? 8);
    const dataCmd = escposSizeCmd(layoutCfg.fichaDataFontSize ?? 6);

    const hasC = item.ficha.exigir_dados_cliente && nomeCliente.trim();
    const hasA = item.ficha.exigir_dados_atendente && nomeAtendente.trim();

    const lines = [
      '\x1B\x40', '\x1B\x61\x01',
    ];

    if (codigoVenda) {
      lines.push(dataCmd, normalize(`Venda: ${codigoVenda}`), '\n');
    }

    lines.push(
      titleCmd, normalize('Ficha de consumo'), '\n',
      subtitleCmd, normalize(`Categoria: ${item.ficha.categoria_nome}`), '\n',
      numberCmd, normalize(item.ficha.nome_produto), '\n',
    );

    if (item.selectedItems.length > 0) {
      lines.push('\x1D\x21\x00', '- - - - - - - - - - - - - - - -\n');
      for (const si of item.selectedItems) {
        lines.push(subtitleCmd, normalize(`${si.item.nome}`), '\n');
        if (Number(si.item.valor) > 0) {
          lines.push('\x1D\x21\x00', `  R$ ${Number(si.item.valor).toFixed(2).replace('.', ',')}`, '\n');
        }
      }
    }

    const unitTotal = cartItemTotal(item);
    if (item.selectedItems.length > 0) {
      lines.push(subtitleCmd, `Total: R$ ${unitTotal.toFixed(2).replace('.', ',')}`, '\n');
    }

    if (hasC || hasA) {
      lines.push('\x1D\x21\x00', '- - - - - - - - - - - - - - - -\n');
      if (hasC) lines.push(clienteCmd, normalize(`Cliente: ${nomeCliente.trim()}`), '\n');
      if (hasA) lines.push(atendenteCmd, normalize(`Atendente: ${nomeAtendente.trim()}`), '\n');
    }

    lines.push(dataCmd, `Data: ${dateStr} ${timeStr}`, '\n', '\x1D\x21\x00', '--------------------------------', '\n\n\n', '\x1D\x56\x00');

    return new TextEncoder().encode(lines.join(''));
  };

  const executePrint = async (printableItems: CartItem[], isConference: boolean = false) => {
    setPrinting(true);
    try {
      const now = new Date();
      const dateStr = now.toLocaleDateString('pt-BR');
      const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const codigoVenda = generateCodigoVenda();

      // Register all prints in DB first
      const sbClient = await getSupabaseClient();
      for (const item of cart) {
        const unitTotal = cartItemTotal(item);
        const dadosExtras: any = {};
        if (item.ficha.exigir_dados_cliente && nomeCliente.trim()) {
          dadosExtras.nome_cliente = nomeCliente.trim();
          if (telefoneCliente.trim()) dadosExtras.telefone_cliente = telefoneCliente.trim();
        }
        if (item.ficha.exigir_dados_atendente && nomeAtendente.trim()) {
          dadosExtras.nome_atendente = nomeAtendente.trim();
        }
        try {
          await registrarImpressao(item.ficha.id, item.quantidade, unitTotal, dadosExtras);
        } catch (regErr) {
          console.warn('[Ficha Print] registrarImpressao falhou (continuando):', regErr);
        }

        let produtoNome = item.ficha.nome_produto;
        if (item.selectedItems.length > 0) {
          produtoNome += ' | ' + item.selectedItems.map(si => `${si.categoria}: ${si.item.nome}`).join(', ');
        }
        try {
          await sbClient.from('fichas_impressas' as any).insert({
            produto_id: item.ficha.id,
            produto_nome: produtoNome,
            categoria_id: item.ficha.categoria_id,
            categoria_nome: item.ficha.categoria_nome,
            quantidade: item.quantidade,
            valor_unitario: unitTotal,
            valor_total: unitTotal * item.quantidade,
            nome_cliente: nomeCliente.trim() || null,
            telefone_cliente: telefoneCliente.trim() || null,
            nome_atendente: nomeAtendente.trim() || null,
            codigo_venda: codigoVenda,
          });
        } catch (insErr) {
          console.warn('[Ficha Print] fichas_impressas insert falhou (continuando):', insErr);
        }

        // Send to KDS if product is marked
        const produto = produtos.find(p => p.id === item.ficha.id);
        if ((produto as any)?.enviar_para_kds) {
          try {
            await sbClient.from('kds_orders' as any).insert({
              produto_id: item.ficha.id,
              produto_nome: produtoNome,
              categoria_nome: item.ficha.categoria_nome || '',
              quantidade: item.quantidade,
              valor_unitario: unitTotal,
              valor_total: unitTotal * item.quantidade,
              nome_cliente: nomeCliente.trim() || null,
              telefone_cliente: telefoneCliente.trim() || null,
              nome_atendente: nomeAtendente.trim() || null,
              complementos: item.selectedItems.length > 0 ? item.selectedItems.map(si => `${si.categoria}: ${si.item.nome}`).join(', ') : null,
              observacao: (produto as any)?.obs || null,
              kds_status: 'novo',
            });
          } catch (e) { console.warn('[Ficha Print] kds_orders insert falhou:', e); }
        }
      }

      // Print via Bluetooth if there are printable items
      if (printableItems.length > 0) {
        const characteristic = await ensureBluetoothConnected();
        if (!characteristic) {
          toast({ title: 'Impressora não conectada', description: 'Não foi possível conectar à impressora Bluetooth.', variant: 'destructive' });
        } else {
          for (const item of printableItems) {
            for (let i = 0; i < item.quantidade; i++) {
              const escposData = generateFichaConsumoEscPos(item, dateStr, timeStr, codigoVenda);
              await writeToCharacteristic(characteristic, escposData);
            }
          }
        }
      }

      const label = isConference ? 'Conferência impressa!' : 'Impressão enviada!';
      toast({ title: label, description: `Venda ${codigoVenda} - ${totalItems} ficha(s). Total: R$ ${totalCart.toFixed(2).replace('.', ',')}` });
      clearCart();
    } catch (err) {
      console.error('[Ficha Print] Erro em executePrint:', err);
      toast({ title: 'Erro', description: `Falha ao registrar impressão: ${(err as Error)?.message || 'Erro desconhecido'}`, variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  if (loading || loadingComp) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-full mx-auto px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(hasPulseiraContext ? '/pulseiras' : '/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">
              {hasPulseiraContext ? `Fichas — Pulseira #${pulseiraContextNumero}` : 'Lista de Fichas'}
            </h1>
          </div>
        </div>
      </header>

      <div className="flex flex-col md:flex-row">
        {/* Main content - products */}
        <main className={cn("flex-1 px-3 sm:px-6 py-4 sm:py-6 space-y-4 transition-all", cart.length > 0 ? "md:pr-2 pb-52 md:pb-6" : "")}>
          {categoriasList.length > 0 && (
            <div className="overflow-x-auto scrollbar-hide">
              <div className="flex gap-2 flex-nowrap pb-1">
                {categoriasList.map(cat => (
                  <Button
                    key={cat}
                    variant={selectedCategoria === cat ? "default" : "outline"}
                    size="sm"
                    className="shrink-0 font-bold"
                    onClick={() => { setSearch(''); setSelectedCategoria(prev => prev === cat ? null : cat); }}
                  >
                    {cat}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="relative max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome do produto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {grouped.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {search ? 'Nenhum produto encontrado.' : 'Nenhuma ficha ativa no momento.'}
            </div>
          ) : (
            grouped.map(([categoria, items]) => (
              <div key={categoria} className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Badge variant="secondary">{categoria}</Badge>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {items.map(item => {
                    const qty = getCartQty(item.id);
                    const isInCart = qty > 0;
                    const cats = getCategoriasOrdenadas(item.id);
                    const valuedComplementPrices = cats.flatMap(cat =>
                      getItemsDaCategoria(cat.id)
                        .map(ci => Number(ci.valor))
                        .filter(valor => valor > 0)
                    );
                    const hasValuedItems = valuedComplementPrices.length > 0;
                    const minComplementValue = hasValuedItems
                      ? Math.min(...valuedComplementPrices)
                      : Number(item.valor);
                    return (
                      <button
                        key={item.id}
                        onClick={() => addToCart(item)}
                        className={cn(
                          "relative flex flex-col items-center justify-center min-h-[5rem] px-3 py-2 rounded-lg border-2 transition-all",
                          isInCart
                            ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                            : "border-border bg-card hover:border-primary hover:bg-primary/5"
                        )}
                      >
                        {isInCart && (
                          <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full h-5 w-5 flex items-center justify-center text-[10px] font-bold">
                            {qty}
                          </div>
                        )}
                        <span className="font-bold text-sm text-foreground leading-tight text-center">{item.nome_produto}</span>
                        <span className="text-primary font-semibold text-sm mt-0.5">
                          {hasValuedItems ? 'A partir de ' : ''}R$ {minComplementValue.toFixed(2).replace('.', ',')}
                        </span>
                        {(() => {
                          const prod = produtos.find(p => p.id === item.id);
                          const obs = (prod as any)?.obs || (item as any)?.obs;
                          return obs ? <span className="text-[10px] text-muted-foreground leading-tight text-center truncate w-full">{obs}</span> : null;
                        })()}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </main>

        {/* Cart - bottom sheet on mobile, sidebar on desktop */}
        {cart.length > 0 && (
          <aside className="fixed bottom-0 left-0 right-0 md:relative md:w-80 md:min-w-[280px] bg-card border-t md:border-t-0 md:border-l shadow-[0_-4px_20px_rgba(0,0,0,0.15)] md:shadow-lg md:sticky md:top-[65px] md:h-[calc(100vh-65px)] flex flex-col z-20 max-h-[55vh] md:max-h-none rounded-t-2xl md:rounded-none">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary" />
                <span className="font-semibold text-foreground">Carrinho</span>
                <Badge variant="secondary">{totalItems}</Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={clearCart} disabled={printing}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {hasPulseiraContext && (
              <div className="px-4 pb-2 flex items-center gap-2 text-sm">
                <Watch className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">Destino:</span>
                <Badge variant="default">Pulseira #{pulseiraContextNumero}</Badge>
                <span className="text-xs text-muted-foreground">{pulseiraContextNome}</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {cart.map(item => {
                const key = cartItemKey(item);
                const unitTotal = cartItemTotal(item);
                return (
                  <div key={key} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground block truncate">{item.ficha.nome_produto}</span>
                      <span className="text-xs text-muted-foreground">
                        R$ {unitTotal.toFixed(2).replace('.', ',')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => removeFromCart(key)} disabled={printing}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="text-sm font-bold w-5 text-center">{item.quantidade}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAllFromCart(key)} disabled={printing}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">Total</span>
                <span className="text-lg font-bold text-primary">
                  R$ {totalCart.toFixed(2).replace('.', ',')}
                </span>
              </div>

              <Button variant="outline" className="w-full" onClick={() => setShowPagamentoModal(true)} disabled={printing || totalItems === 0}>
                <CreditCard className="h-4 w-4 mr-2" />
                Forma de Pagamento
              </Button>
            </div>
          </aside>
        )}
      </div>

      {/* Sequential category selection modal */}
      <Dialog open={showCatModal} onOpenChange={(open) => { if (!open) { setShowCatModal(false); setPendingFicha(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {categoriasSequencia[currentCatIndex]?.nome || 'Complemento'}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({currentCatIndex + 1}/{categoriasSequencia.length})
              </span>
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Produto: <strong>{pendingFicha?.nome_produto}</strong></p>
          
          {(() => {
            const exclusiveCount = currentCatItems.filter(i => i.escolha_exclusiva).length;
            const exclusivityActive = exclusiveCount >= 2;
            const freeSelected = groupSelections['__free__'] || [];
            return (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {exclusivityActive && (
                  <p className="text-xs text-muted-foreground">Itens marcados com ⚡ são de escolha exclusiva (apenas 1)</p>
                )}
                {currentCatItems.map(item => {
                  const isExclusive = item.escolha_exclusiva && exclusivityActive;
                  const isSelected = freeSelected.some(s => s.id === item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      className={cn(
                        "w-full flex items-center justify-between rounded-lg border p-3 transition-colors text-left",
                        isSelected ? "border-primary bg-primary/10 ring-1 ring-primary" : "hover:bg-muted/50"
                      )}
                    >
                      <span className="font-medium">
                        {isExclusive && <span className="mr-1">⚡</span>}
                        {item.nome}
                      </span>
                      <div className="flex items-center gap-2">
                        {Number(item.valor) > 0 && (
                          <span className="text-sm text-muted-foreground">+ R$ {Number(item.valor).toFixed(2).replace('.', ',')}</span>
                        )}
                        {isSelected && <Badge variant="default" className="text-xs">✓</Badge>}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          <DialogFooter className="flex gap-2">
            <Button onClick={handleConfirmCategorySelection}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dynamic fields print dialog */}
      <Dialog open={printDialog} onOpenChange={setPrintDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dados para impressão</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Preencha os dados do cliente antes da impressão.</p>
          <div className="space-y-4">
            {needsCliente && (
              <>
                <div className="space-y-2">
                  <Label>Nome do Cliente *</Label>
                  <Input value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} placeholder="Nome do cliente" />
                </div>
                <div className="space-y-2">
                  <Label>Documento <span className="text-muted-foreground">(opcional)</span></Label>
                  <Input value={documentoCliente} onChange={(e) => setDocumentoCliente(e.target.value)} placeholder="CPF ou RG" />
                </div>
                <div className="space-y-2">
                  <Label>Telefone <span className="text-muted-foreground">(opcional)</span></Label>
                  <Input value={telefoneCliente} onChange={(e) => setTelefoneCliente(e.target.value)} placeholder="(00) 00000-0000" onKeyDown={(e) => e.key === 'Enter' && handleConfirmPrint()} />
                </div>
              </>
            )}
            {needsAtendente && (
              <div className="space-y-2">
                <Label>Atendente</Label>
                <Input value={nomeAtendente} disabled placeholder="Preenchido automaticamente" />
                <p className="text-xs text-muted-foreground">Identificado pelo usuário logado</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintDialog(false)}>Cancelar</Button>
            <Button onClick={handleConfirmPrint} disabled={printing || (needsCliente && !nomeCliente.trim())}>
              <Printer className="h-4 w-4 mr-2" />
              Confirmar e Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Forma de Pagamento */}
      <PagamentoDialog
        open={showPagamentoModal}
        onOpenChange={setShowPagamentoModal}
        formasAtivas={formasAtivas.filter(f => !f.nome.toLowerCase().includes('comanda'))}
        totalConta={totalCart}
        titulo="Forma de Pagamento"
        confirmLabel={printing ? 'Processando...' : 'Confirmar pagamento'}
        confirmIcon={<CreditCard className="h-5 w-5 mr-2" />}
        onConfirm={() => {
          setShowPagamentoModal(false);
          handleInitPrint();
        }}
        saveLabel="Salvar"
        saveIcon={<Save className="h-5 w-5 mr-2" />}
        onSave={() => {
          setShowPagamentoModal(false);
          handleSaveOnly();
        }}
        voucherPix={canGenerateVoucher ? {
          canGenerateVoucher: true,
          voucherTempo,
          availableTempos: voucherStats.temposDisponiveis,
          availableByTempo: voucherStats.livresPorTempo,
          onGenerateVoucher: handleGeneratePixVoucher,
        } : undefined}
      >
        {hasPulseiraContext && (
          <div className="w-full flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5 text-sm">
            <Watch className="h-4 w-4 text-primary" />
            <span>Itens serão lançados na <strong>Pulseira #{pulseiraContextNumero}</strong> ({pulseiraContextNome}) após confirmar o pagamento.</span>
          </div>
        )}
        {comandasAbertas.length > 0 && !hasPulseiraContext && (
          <Button variant="outline" className="w-full" size="lg" onClick={() => { setShowPagamentoModal(false); setComandaSearch(''); setShowComandaModal(true); }} disabled={totalItems === 0}>
            <ClipboardList className="h-5 w-5 mr-2" />
            Lançar na comanda
          </Button>
        )}
        {pulseirasAtivas.length > 0 && !hasPulseiraContext && (
          <Button variant="outline" className="w-full" size="lg" onClick={() => { setShowPagamentoModal(false); setPulseiraSearch(''); setShowPulseiraModal(true); }} disabled={totalItems === 0}>
            <Watch className="h-5 w-5 mr-2" />
            Adicionar à pulseira
          </Button>
        )}
      </PagamentoDialog>

      {/* Modal Peso - estilo ServeService */}
      <Dialog open={showPesoModal} onOpenChange={(open) => { if (!open) handleClosePesoModal(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" />
              {pendingPesoFicha?.ficha.nome_produto || 'Informar peso'}
              <Badge variant={
                balanca.connected ? 'default'
                : balanca.status === 'conectando' || balanca.status === 'tentando' || balanca.status === 'verificando_conexao' || balanca.status === 'recuperando_conexao' ? 'secondary'
                : balanca.status === 'falha' || balanca.status === 'erro_leitura' ? 'destructive'
                : 'outline'
              } className="ml-auto text-xs">
                {balanca.status === 'lendo' ? 'Lendo...'
                : balanca.status === 'aguardando_leitura' ? 'Conectada'
                : balanca.status === 'conectada' ? 'Conectada'
                : balanca.status === 'verificando_conexao' ? 'Verificando...'
                : balanca.status === 'recuperando_conexao' ? 'Recuperando...'
                : balanca.status === 'conectando' ? 'Conectando...'
                : balanca.status === 'tentando' ? 'Tentando...'
                : balanca.status === 'falha' ? 'Falha'
                : balanca.status === 'erro_leitura' ? 'Erro leitura'
                : 'Desconectada'}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              Leia o peso da balança e adicione ao carrinho. O modal permanece aberto para leituras consecutivas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!balanca.connected && autoConnectingBalanca && (
              <div className="w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Tentando conectar automaticamente...
              </div>
            )}

            {!balanca.connected && !autoConnectingBalanca && showManualConnectButton && (
              <Button onClick={async () => {
                setAutoConnectingBalanca(true);
                const ok = await parearNovoDispositivo();
                setAutoConnectingBalanca(false);
                setShowManualConnectButton(!ok);
              }} className="w-full" variant="outline">
                <Scale className="h-4 w-4 mr-2" />
                Conectar balança
              </Button>
            )}

            {balanca.connected && (
              <Button onClick={async () => {
                console.log('[Balança] Lendo peso, conexão reutilizada');
                const resultado = await lerPeso(3);
                if (resultado !== null && resultado > 0) {
                  setPesoManual(resultado.toFixed(3));
                } else {
                  toast({ title: 'Não foi possível ler o peso', description: 'Tentando recuperar conexão... Tente novamente ou digite manualmente.', variant: 'destructive' });
                }
              }} className="w-full">
                <RefreshCw className={`h-4 w-4 mr-2 ${balanca.status === 'lendo' ? 'animate-spin' : ''}`} />
                Ler Peso da Balança
              </Button>
            )}

            <div>
              <Label className="text-sm">Peso manual (kg)</Label>
              <Input
                type="number"
                step="0.001"
                value={pesoManual}
                onChange={e => setPesoManual(e.target.value)}
                placeholder="Ex: 0.500"
                onKeyDown={e => e.key === 'Enter' && handleConfirmPesoManual()}
              />
            </div>

            {(() => {
              const pesoNum = parseFloat(pesoManual.replace(',', '.')) || 0;
              const produto = pendingPesoFicha ? produtos.find(p => p.id === pendingPesoFicha.ficha.id) : null;
              const valorKg = produto?.valor_por_kg || Number(pendingPesoFicha?.ficha.valor || 0);
              const totalPeso = pesoNum * valorKg;
              return (
                <div className="p-3 border rounded-lg space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Peso:</span>
                    <span className="font-medium">{pesoNum.toFixed(3)} kg</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Valor/kg:</span>
                    <span className="font-medium">R$ {valorKg.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold border-t pt-1 mt-1">
                    <span>Total:</span>
                    <span className="text-primary">R$ {totalPeso.toFixed(2)}</span>
                  </div>
                </div>
              );
            })()}

            <div className="flex gap-2">
              <Button onClick={handleConfirmPesoManual} className="flex-1" disabled={!(parseFloat(pesoManual.replace(',', '.')) > 0)}>
                Adicionar
              </Button>
              <Button variant="outline" onClick={() => setPesoManual('')}>
                Limpar
              </Button>
              <Button variant="ghost" onClick={handleClosePesoModal}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Lançar na Comanda */}
      <Dialog open={showComandaModal} onOpenChange={setShowComandaModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lançar na Comanda</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por número, nome ou telefone..." value={comandaSearch} onChange={e => setComandaSearch(e.target.value)} className="pl-10" />
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {comandasAbertas.filter(c => {
              if (!comandaSearch.trim()) return true;
              const q = comandaSearch.toLowerCase();
              return String(c.numero).includes(q) || (c.nome_cliente || '').toLowerCase().includes(q) || (c.telefone_cliente || '').toLowerCase().includes(q);
            }).map(c => (
              <button
                key={c.id}
                onClick={() => setConfirmComanda({ id: c.id, numero: c.numero })}
                className="w-full flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors text-left"
              >
                <div>
                  <span className="font-bold">#{c.numero}</span>
                  {c.nome_cliente && <span className="text-sm text-muted-foreground ml-2">{c.nome_cliente}</span>}
                </div>
                {c.telefone_cliente && <span className="text-xs text-muted-foreground">{c.telefone_cliente}</span>}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmar lançamento na comanda */}
      <ConfirmDialog
        open={!!confirmComanda}
        onOpenChange={(open) => { if (!open) setConfirmComanda(null); }}
        title="Confirmar lançamento"
        description={`Deseja incluir ${totalItems} item(ns) na comanda #${confirmComanda?.numero || ''}?`}
        onConfirm={async () => {
          if (!confirmComanda) return;
          try {
            const itemsToLaunch = cart.map(ci => ({
              produto_id: ci.ficha.id,
              produto_nome: ci.ficha.nome_produto,
              quantidade: ci.quantidade,
              valor_unitario: cartItemTotal(ci),
              valor_total: cartItemTotal(ci) * ci.quantidade,
              peso: ci.peso || null,
              complementos: ci.selectedItems.length > 0 ? ci.selectedItems.map(si => ({ categoria: si.categoria, nome: si.item.nome, valor: Number(si.item.valor) })) : null,
              printer_id: (ci.ficha as any).printer_id || null,
            }));
            await lancarItens(confirmComanda.id, itemsToLaunch, userName || undefined);
            toast({ title: `${totalItems} item(ns) lançados na comanda #${confirmComanda.numero}` });
            clearCart();
            setConfirmComanda(null);
            setShowComandaModal(false);
            refetchComandas();
          } catch (err: any) {
            toast({ title: 'Erro ao lançar na comanda', description: err?.message || String(err), variant: 'destructive' });
          }
        }}
        confirmText="Sim, incluir"
        cancelText="Não"
      />

      {/* Modal Selecionar Pulseira */}
      <Dialog open={showPulseiraModal} onOpenChange={setShowPulseiraModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar à Pulseira</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por número ou nome..." value={pulseiraSearch} onChange={e => setPulseiraSearch(e.target.value)} className="pl-10" />
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {pulseirasAtivas.filter(p => {
              if (!pulseiraSearch.trim()) return true;
              const q = pulseiraSearch.toLowerCase();
              return p.numero.toLowerCase().includes(q) || p.nome_cliente.toLowerCase().includes(q);
            }).map(p => (
              <button
                key={p.id}
                onClick={() => setConfirmPulseira(p)}
                className="w-full flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors text-left"
              >
                <div>
                  <span className="font-bold">#{p.numero}</span>
                  <span className="text-sm text-muted-foreground ml-2">{p.nome_cliente}</span>
                </div>
                {p.telefone_cliente && <span className="text-xs text-muted-foreground">{p.telefone_cliente}</span>}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmar lançamento na pulseira */}
      <ConfirmDialog
        open={!!confirmPulseira}
        onOpenChange={(open) => { if (!open) setConfirmPulseira(null); }}
        title="Confirmar adição à pulseira"
        description={`Deseja adicionar ${totalItems} item(ns) como saldo na pulseira #${confirmPulseira?.numero || ''} (${confirmPulseira?.nome_cliente || ''})?`}
        onConfirm={async () => {
          if (!confirmPulseira) return;
          try {
            const usuarioId = userSession?.user?.id;
            if (!usuarioId) {
              toast({ title: 'Erro', description: 'Não foi possível adicionar o produto à pulseira.', variant: 'destructive' });
              return;
            }

            const itemsToAdd = cart.map(ci => ({
              produto_id: ci.ficha.id,
              produto_nome: ci.ficha.nome_produto + (ci.selectedItems.length > 0 ? ' | ' + ci.selectedItems.map(si => si.item.nome).join(', ') : ''),
              quantidade: ci.quantidade,
              valor_unitario: cartItemTotal(ci),
              atendente_user_id: usuarioId,
              atendente_nome: userName || undefined,
            }));
            const success = await adicionarItensPulseira(confirmPulseira.id, itemsToAdd);
            if (success) {
              clearCart();
              setConfirmPulseira(null);
              setShowPulseiraModal(false);
            }
          } catch (err: any) {
            toast({ title: 'Erro', description: 'Não foi possível adicionar o produto à pulseira.', variant: 'destructive' });
          }
        }}
        confirmText="Sim, adicionar"
        cancelText="Não"
      />

      {/* Print Selection Dialog - after payment confirmed */}
      <PrintSelectionDialog
        open={showPrintSelection}
        onOpenChange={(open) => {
          setShowPrintSelection(open);
          if (!open && paymentConfirmed) {
            clearCart();
            setPaymentConfirmed(false);
            setSavedCodigoVenda(null);
            toast({ title: 'Pagamento registrado', description: 'A venda foi salva sem impressão.' });
          }
        }}
        items={printSelectableItems}
        onConfirm={handlePrintSelected}
        printing={printing}
      />

    </div>
  );
}

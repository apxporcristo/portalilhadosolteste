import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Plus, Minus, Watch, User, Phone, CreditCard, Clock, Package, History, AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { usePulseiras, Pulseira, PulseiraProdutoResumo } from '@/hooks/usePulseiras';
import { useFichasConsumo } from '@/hooks/useFichasConsumo';
import { useOptionalUserSession } from '@/contexts/UserSessionContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

export default function PulseirasPage() {
  const navigate = useNavigate();
  const userSession = useOptionalUserSession();
  const {
    loading, pulseira, resumoProdutos, itens, consumos, historico, pulseirasAtivas,
    buscarPulseira, abrirPulseira, adicionarItens, consumirProduto, fecharPulseira, fecharComAbatimento, listarAtivas, limpar, carregarDetalhes,
  } = usePulseiras();
  const { fichasAtivas, produtos } = useFichasConsumo();

  const [numeroBusca, setNumeroBusca] = useState('');
  const [abrirModal, setAbrirModal] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [consumoModal, setConsumoModal] = useState<PulseiraProdutoResumo | null>(null);
  const [historicoModal, setHistoricoModal] = useState(false);

  // Form: abrir pulseira
  const [formNumero, setFormNumero] = useState('');
  const [formNome, setFormNome] = useState('');
  const [formTelefone, setFormTelefone] = useState('');
  const [formCpf, setFormCpf] = useState('');

  // Form: adicionar itens
  const [addProdutoId, setAddProdutoId] = useState('');
  const [addQuantidade, setAddQuantidade] = useState(1);

  // Form: consumo
  const [consumoQtd, setConsumoQtd] = useState(1);
  const [consumoObs, setConsumoObs] = useState('');

  // Abatimento de crédito
  const [abatimentoModal, setAbatimentoModal] = useState(false);
  const [abatimentoProdutos, setAbatimentoProdutos] = useState<{ produto_id: string; produto_nome: string; quantidade: number; valor_unitario: number }[]>([]);
  const [abatimentoProdutoId, setAbatimentoProdutoId] = useState('');
  const [abatimentoQtd, setAbatimentoQtd] = useState(1);

  const creditoTotal = useMemo(() => {
    return resumoProdutos
      .filter(p => p.disponivel > 0)
      .reduce((sum, p) => sum + p.disponivel * p.valor_unitario, 0);
  }, [resumoProdutos]);

  const creditoUsado = useMemo(() => {
    return abatimentoProdutos.reduce((sum, p) => sum + p.quantidade * p.valor_unitario, 0);
  }, [abatimentoProdutos]);

  const creditoRestante = creditoTotal - creditoUsado;

  const is24hPassadas = useMemo(() => {
    if (!pulseira) return false;
    const abertaEm = new Date(pulseira.aberta_em);
    const agora = new Date();
    return (agora.getTime() - abertaEm.getTime()) / (1000 * 60 * 60) >= 24;
  }, [pulseira]);
  // Load active pulseiras on mount
  useEffect(() => {
    listarAtivas();
  }, [listarAtivas]);

  const filteredAtivas = useMemo(() => {
    if (!numeroBusca.trim()) return pulseirasAtivas;
    const q = numeroBusca.toLowerCase();
    return pulseirasAtivas.filter(p =>
      p.numero.toLowerCase().includes(q) ||
      p.nome_cliente.toLowerCase().includes(q) ||
      (p.telefone_cliente || '').toLowerCase().includes(q)
    );
  }, [pulseirasAtivas, numeroBusca]);

  const handleBuscar = async () => {
    if (!numeroBusca.trim()) return;
    await buscarPulseira(numeroBusca.trim());
  };

  const handleSelectPulseira = async (p: Pulseira) => {
    await buscarPulseira(p.numero);
  };

  const handleAbrir = async () => {
    if (!formNumero.trim() || !formNome.trim() || !formTelefone.trim()) {
      toast({ title: 'Erro', description: 'Preencha número, nome e telefone.', variant: 'destructive' });
      return;
    }
    const result = await abrirPulseira({
      numero: formNumero,
      nome_cliente: formNome,
      telefone_cliente: formTelefone,
      cpf: formCpf || undefined,
      aberta_por: userSession?.access?.nome || userSession?.user?.email || undefined,
    });
    if (result) {
      setAbrirModal(false);
      setFormNumero('');
      setFormNome('');
      setFormTelefone('');
      setFormCpf('');
      setNumeroBusca((result as any).numero);
      listarAtivas();
    }
  };

  const handleAdicionarItem = async () => {
    if (!pulseira || !addProdutoId || addQuantidade < 1) return;
    const produto = fichasAtivas.find(f => f.id === addProdutoId);
    if (!produto) return;
    const success = await adicionarItens(pulseira.id, [{
      produto_id: produto.id,
      produto_nome: produto.nome_produto,
      quantidade: addQuantidade,
      valor_unitario: produto.valor,
      atendente_user_id: userSession?.user?.id,
      atendente_nome: userSession?.access?.nome || userSession?.user?.email,
    }]);
    if (success) {
      setAddProdutoId('');
      setAddQuantidade(1);
      setAddModal(false);
    }
  };

  const handleConsumir = async () => {
    if (!pulseira || !consumoModal) return;
    await consumirProduto(
      pulseira.id,
      consumoModal.produto_id,
      consumoModal.produto_nome,
      consumoQtd,
      userSession?.user?.id,
      userSession?.access?.nome || userSession?.user?.email,
      consumoObs || undefined,
    );
    setConsumoModal(null);
    setConsumoQtd(1);
    setConsumoObs('');
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    try { return format(new Date(d), 'dd/MM/yyyy HH:mm'); } catch { return d; }
  };

  const formatTime = (d: string | null) => {
    if (!d) return '—';
    try { return format(new Date(d), 'HH:mm'); } catch { return d; }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-3 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-2">
                <Watch className="h-5 w-5 text-primary" />
                <h1 className="text-lg font-bold text-foreground">Pulseiras</h1>
              </div>
            </div>
            <Button size="sm" onClick={() => setAbrirModal(true)}>
              <Plus className="h-4 w-4 mr-1" /> Abrir Pulseira
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Search */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex gap-2">
              <Input
                placeholder="Buscar por número, nome ou telefone..."
                value={numeroBusca}
                onChange={e => setNumeroBusca(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleBuscar()}
                className="flex-1"
              />
              <Button onClick={handleBuscar} disabled={loading}>
                <Search className="h-4 w-4 mr-1" /> Buscar
              </Button>
            </div>
          </CardContent>
        </Card>

        {loading && <Skeleton className="h-64 w-full" />}

        {/* Pulseira Details (when one is selected) */}
        {pulseira && !loading && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Watch className="h-5 w-5 text-primary" />
                    Pulseira #{pulseira.numero}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={pulseira.status === 'ativa' ? 'default' : 'secondary'}>
                      {pulseira.status}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => { limpar(); }}>
                      ✕ Voltar à lista
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{pulseira.nome_cliente}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{pulseira.telefone_cliente}</span>
                  </div>
                  {pulseira.cpf && (
                    <div className="flex items-center gap-1.5">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{pulseira.cpf}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Aberta em {formatDate(pulseira.aberta_em)}</span>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/fichas?pulseira_id=${pulseira.id}&pulseira_numero=${encodeURIComponent(pulseira.numero)}&pulseira_nome=${encodeURIComponent(pulseira.nome_cliente)}`)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Fichas
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setHistoricoModal(true)}>
                    <History className="h-3.5 w-3.5 mr-1" /> Histórico
                  </Button>
                  <Button size="sm" variant="destructive" onClick={async () => { const closed = await fecharPulseira(pulseira.id); if (closed) { limpar(); listarAtivas(); } }}>
                    Fechar Pulseira
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Product balances */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  Saldo por Produto
                </CardTitle>
              </CardHeader>
              <CardContent>
                {resumoProdutos.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum produto adicionado ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {resumoProdutos.map(p => (
                      <div
                        key={p.produto_id}
                        className={cn(
                          'flex items-center justify-between p-3 rounded-lg border',
                          p.disponivel === 0 ? 'bg-destructive/10 border-destructive/30' : 'bg-card'
                        )}
                      >
                        <div className="flex-1">
                          <div className="font-medium text-sm">{p.produto_nome}</div>
                          <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                            <span>Comprado: <strong>{p.comprado}</strong></span>
                            <span>Consumido: <strong>{p.consumido}</strong></span>
                            <span className={cn(p.disponivel === 0 ? 'text-destructive font-bold' : 'text-primary font-bold')}>
                              Disponível: {p.disponivel}
                            </span>
                          </div>
                          {p.ultima_retirada && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Última retirada: {formatTime(p.ultima_retirada)}
                              {p.ultimo_atendente && <span> · {p.ultimo_atendente}</span>}
                            </div>
                          )}
                        </div>
                        {p.disponivel > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setConsumoModal(p); setConsumoQtd(1); setConsumoObs(''); }}
                          >
                            <Minus className="h-3.5 w-3.5 mr-1" /> Baixa
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* List of active pulseiras (when no specific pulseira is selected) */}
        {!pulseira && !loading && (
          <div className="space-y-2">
            {filteredAtivas.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  {numeroBusca.trim()
                    ? `Nenhuma pulseira ativa encontrada para "${numeroBusca}".`
                    : 'Nenhuma pulseira ativa no momento.'}
                </CardContent>
              </Card>
            ) : (
              filteredAtivas.map(p => (
                <Card key={p.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => handleSelectPulseira(p)}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-primary/10 rounded-full p-2">
                        <Watch className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-bold text-sm">#{p.numero}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span>{p.nome_cliente}</span>
                          {p.telefone_cliente && <span>· {p.telefone_cliente}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-muted-foreground text-right">
                        {formatDate(p.aberta_em)}
                      </div>
                      <Badge variant="default" className="text-xs">Ativa</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </main>

      {/* Modal: Abrir Pulseira */}
      <Dialog open={abrirModal} onOpenChange={setAbrirModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir Nova Pulseira</DialogTitle>
            <DialogDescription>Cadastre uma nova pulseira pré-paga.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Número da Pulseira *</Label>
              <Input value={formNumero} onChange={e => setFormNumero(e.target.value)} placeholder="Ex: 001" />
            </div>
            <div className="space-y-1">
              <Label>Nome do Cliente *</Label>
              <Input value={formNome} onChange={e => setFormNome(e.target.value)} placeholder="Nome completo" />
            </div>
            <div className="space-y-1">
              <Label>Telefone *</Label>
              <Input value={formTelefone} onChange={e => setFormTelefone(e.target.value)} placeholder="(00) 00000-0000" />
            </div>
            <div className="space-y-1">
              <Label>CPF (opcional)</Label>
              <Input value={formCpf} onChange={e => setFormCpf(e.target.value)} placeholder="000.000.000-00" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbrirModal(false)}>Cancelar</Button>
            <Button onClick={handleAbrir} disabled={loading}>Abrir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Adicionar Itens */}
      <Dialog open={addModal} onOpenChange={setAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Itens à Pulseira</DialogTitle>
            <DialogDescription>Selecione o produto e a quantidade.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Produto</Label>
              <Select value={addProdutoId} onValueChange={setAddProdutoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um produto" />
                </SelectTrigger>
                <SelectContent>
                  {fichasAtivas.map(f => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome_produto} — R$ {Number(f.valor).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Quantidade</Label>
              <Input type="number" min={1} value={addQuantidade} onChange={e => setAddQuantidade(Math.max(1, Number(e.target.value)))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModal(false)}>Cancelar</Button>
            <Button onClick={handleAdicionarItem} disabled={!addProdutoId || loading}>Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Consumo/Baixa */}
      <Dialog open={!!consumoModal} onOpenChange={(open) => !open && setConsumoModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dar Baixa</DialogTitle>
            <DialogDescription>
              {consumoModal?.produto_nome} — Disponível: {consumoModal?.disponivel}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Quantidade</Label>
              <Input
                type="number"
                min={1}
                max={consumoModal?.disponivel || 1}
                value={consumoQtd}
                onChange={e => setConsumoQtd(Math.max(1, Math.min(consumoModal?.disponivel || 1, Number(e.target.value))))}
              />
            </div>
            <div className="space-y-1">
              <Label>Observação (opcional)</Label>
              <Input value={consumoObs} onChange={e => setConsumoObs(e.target.value)} placeholder="Observação..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsumoModal(null)}>Cancelar</Button>
            <Button onClick={handleConsumir} disabled={loading}>Confirmar Baixa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Histórico */}
      <Dialog open={historicoModal} onOpenChange={setHistoricoModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico da Pulseira #{pulseira?.numero}</DialogTitle>
          </DialogHeader>
          {historico.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma movimentação registrada.</p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-center">Qtd</TableHead>
                    <TableHead>Atendente</TableHead>
                    <TableHead>Obs</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historico.map((h, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <Badge variant={h.tipo === 'carga' ? 'default' : 'secondary'} className="text-xs">
                          {h.tipo === 'carga' ? 'Carga' : 'Baixa'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{h.produto_nome}</TableCell>
                      <TableCell className="text-center">{h.quantidade}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{h.atendente_nome || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{h.observacao || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(h.data)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

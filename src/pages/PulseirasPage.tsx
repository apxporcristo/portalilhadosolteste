import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Plus, Minus, Watch, User, Phone, CreditCard, Clock, Package, History } from 'lucide-react';
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
import { usePulseiras, PulseiraProdutoResumo } from '@/hooks/usePulseiras';
import { useFichasConsumo } from '@/hooks/useFichasConsumo';
import { useOptionalUserSession } from '@/contexts/UserSessionContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

export default function PulseirasPage() {
  const navigate = useNavigate();
  const userSession = useOptionalUserSession();
  const {
    loading, pulseira, resumoProdutos, itens, consumos,
    buscarPulseira, abrirPulseira, adicionarItens, consumirProduto, fecharPulseira, limpar,
  } = usePulseiras();
  const { fichasAtivas } = useFichasConsumo();

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

  const handleBuscar = async () => {
    if (!numeroBusca.trim()) return;
    await buscarPulseira(numeroBusca.trim());
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
                placeholder="Digite o número da pulseira..."
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

        {!loading && !pulseira && numeroBusca && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Nenhuma pulseira ativa encontrada com o número "{numeroBusca}".
            </CardContent>
          </Card>
        )}

        {/* Pulseira Details */}
        {pulseira && !loading && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Watch className="h-5 w-5 text-primary" />
                    Pulseira #{pulseira.numero}
                  </CardTitle>
                  <Badge variant={pulseira.status === 'ativa' ? 'default' : 'secondary'}>
                    {pulseira.status}
                  </Badge>
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
                  <Button size="sm" variant="outline" onClick={() => setAddModal(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Itens
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setHistoricoModal(true)}>
                    <History className="h-3.5 w-3.5 mr-1" /> Histórico
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => fecharPulseira(pulseira.id).then(() => limpar())}>
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
          <Tabs defaultValue="compras">
            <TabsList className="w-full">
              <TabsTrigger value="compras" className="flex-1">Compras ({itens.length})</TabsTrigger>
              <TabsTrigger value="consumos" className="flex-1">Consumos ({consumos.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="compras">
              {itens.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma compra registrada.</p>
              ) : (
                <div className="rounded-md border overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-center">Qtd</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Atendente</TableHead>
                        <TableHead>Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itens.map(item => (
                        <TableRow key={item.id}>
                          <TableCell className="text-sm">{item.produto_nome}</TableCell>
                          <TableCell className="text-center">{item.quantidade}</TableCell>
                          <TableCell className="text-right">R$ {Number(item.valor_total).toFixed(2)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{item.atendente_nome || '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{formatDate(item.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
            <TabsContent value="consumos">
              {consumos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum consumo registrado.</p>
              ) : (
                <div className="rounded-md border overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-center">Qtd</TableHead>
                        <TableHead>Atendente</TableHead>
                        <TableHead>Obs</TableHead>
                        <TableHead>Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consumos.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="text-sm">{c.produto_nome}</TableCell>
                          <TableCell className="text-center">{c.quantidade}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{c.atendente_nome || '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{c.observacao || '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}

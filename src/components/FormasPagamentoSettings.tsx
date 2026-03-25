import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CreditCard, Plus, Pencil, Trash2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { useFormasPagamento, FormaPagamento } from '@/hooks/useFormasPagamento';

export function FormasPagamentoSettings() {
  const { formas, loading, createForma, updateForma, deleteForma } = useFormasPagamento();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [exibirTroco, setExibirTroco] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setNome(''); setAtivo(true); setExibirTroco(false);
    setFormOpen(true);
  };

  const openEdit = (f: FormaPagamento) => {
    setEditingId(f.id);
    setNome(f.nome); setAtivo(f.ativo); setExibirTroco(f.exibir_troco);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!nome.trim()) {
      toast({ title: 'Erro', description: 'Nome é obrigatório.', variant: 'destructive' });
      return;
    }
    let ok: boolean;
    if (editingId) {
      ok = await updateForma(editingId, { nome: nome.trim(), ativo, exibir_troco: exibirTroco });
    } else {
      ok = await createForma({ nome: nome.trim(), ativo, exibir_troco: exibirTroco });
    }
    if (ok) setFormOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    await deleteForma(deleteConfirm);
    setDeleteConfirm(null);
  };

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Formas de Pagamento
          </CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Nova Forma de Pagamento
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {formas.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">Nenhuma forma de pagamento cadastrada.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="text-center">Ativo</TableHead>
                  <TableHead className="text-center">Exibir Troco</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formas.map(f => (
                  <TableRow key={f.id} className={!f.ativo ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{f.nome}</TableCell>
                    <TableCell className="text-center">
                      <Switch checked={f.ativo} onCheckedChange={(v) => updateForma(f.id, { ativo: v })} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={f.exibir_troco} onCheckedChange={(v) => updateForma(f.id, { exibir_troco: v })} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(f)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteConfirm(f.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Forma de Pagamento' : 'Nova Forma de Pagamento'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Dinheiro, Pix, Cartão..." />
            </div>
            <div className="flex items-center justify-between">
              <Label>Ativo</Label>
              <Switch checked={ativo} onCheckedChange={setAtivo} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Exibir Botão de Troco</Label>
                <p className="text-xs text-muted-foreground">Mostrar campo de troco ao selecionar esta forma</p>
              </div>
              <Switch checked={exibirTroco} onCheckedChange={setExibirTroco} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!nome.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title="Excluir forma de pagamento"
        description="Tem certeza que deseja excluir esta forma de pagamento?"
        onConfirm={handleDelete}
      />
    </Card>
  );
}

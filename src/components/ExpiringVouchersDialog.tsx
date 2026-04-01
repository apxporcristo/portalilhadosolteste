import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { getSupabaseClient } from '@/hooks/useVouchers';
import { ConfirmDialog } from '@/components/ConfirmDialog';

interface ExpiringVoucher {
  id: string;
  voucher_id: string;
  tempo_validade: string;
  status: string;
  data_uso: string | null;
  diasExpirar: number;
}

interface ExpiringVouchersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tempo: string;
  onUpdated: () => void;
}

export function ExpiringVouchersDialog({ open, onOpenChange, tempo, onUpdated }: ExpiringVouchersDialogProps) {
  const [vouchers, setVouchers] = useState<ExpiringVoucher[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (open && tempo) {
      fetchExpiring();
      setSelected(new Set());
    }
  }, [open, tempo]);

  const fetchExpiring = async () => {
    setLoading(true);
    try {
      const supabase = await getSupabaseClient();
      const now = new Date();
      const limite = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000);

      let query = supabase
        .from('vouchers')
        .select('id, voucher_id, tempo_validade, status, data_uso')
        .eq('status', 'pre-reservado');

      if (tempo) {
        query = query.eq('tempo_validade', tempo);
      }

      const { data, error } = await query;

      if (error) throw error;

      const expiring: ExpiringVoucher[] = (data || [])
        .filter((v: any) => v.data_uso && new Date(v.data_uso) <= limite)
        .map((v: any) => {
          const dataUso = new Date(v.data_uso);
          const diffMs = now.getTime() - dataUso.getTime();
          const diasExpirar = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          return { ...v, diasExpirar };
        })
        .sort((a: ExpiringVoucher, b: ExpiringVoucher) => b.diasExpirar - a.diasExpirar);

      setVouchers(expiring);
    } catch (err) {
      console.error('Erro ao buscar vouchers a expirar:', err);
      toast({ title: 'Erro', description: 'Não foi possível carregar os vouchers.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === vouchers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(vouchers.map(v => v.id)));
    }
  };

  const handleConfirmUpdate = async () => {
    setUpdating(true);
    setConfirmOpen(false);
    try {
      const supabase = await getSupabaseClient();
      const ids = Array.from(selected);

      const { error } = await supabase
        .from('vouchers')
        .update({ status: 'livre', data_uso: null })
        .in('id', ids);

      if (error) throw error;

      toast({ title: 'Sucesso', description: `${ids.length} voucher(s) alterado(s) para livre.` });
      setSelected(new Set());
      await fetchExpiring();
      onUpdated();
    } catch (err) {
      console.error('Erro ao atualizar vouchers:', err);
      toast({ title: 'Erro', description: 'Não foi possível atualizar os vouchers.', variant: 'destructive' });
    } finally {
      setUpdating(false);
    }
  };

  const allSelected = vouchers.length > 0 && selected.size === vouchers.length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Vouchers a Expirar — {tempo}</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : vouchers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Nenhum voucher a expirar.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  <span className="text-sm text-muted-foreground">Selecionar todos</span>
                </div>
                <Badge variant="outline">{selected.size} selecionado(s)</Badge>
              </div>

              <div className="overflow-auto flex-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Voucher</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Dias</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vouchers.map(v => (
                      <TableRow key={v.id} className="cursor-pointer" onClick={() => toggleSelect(v.id)}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(v.id)}
                            onCheckedChange={() => toggleSelect(v.id)}
                            onClick={e => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{v.voucher_id}</TableCell>
                        <TableCell className="text-sm">
                          {v.data_uso ? new Date(v.data_uso).toLocaleDateString('pt-BR') : '-'}
                        </TableCell>
                        <TableCell className="text-right text-orange-500 font-medium">{v.diasExpirar}d</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{v.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          <DialogFooter>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={selected.size === 0 || updating}
            >
              {updating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Mudar selecionados para livre ({selected.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirmar alteração"
        description={`Deseja alterar ${selected.size} voucher(s) para o status "livre"? Esta ação não pode ser desfeita.`}
        onConfirm={handleConfirmUpdate}
      />
    </>
  );
}

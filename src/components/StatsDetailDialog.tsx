import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { VoucherStats } from '@/hooks/useVouchers';
import { ExpiringVouchersDialog } from '@/components/ExpiringVouchersDialog';

interface StatsDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  type: 'total' | 'livres' | 'usados' | 'reservados';
  stats: VoucherStats;
  onRefresh?: () => void;
}

export function StatsDetailDialog({ open, onOpenChange, title, type, stats, onRefresh }: StatsDetailDialogProps) {
  const [expiringTempo, setExpiringTempo] = useState<string | null>(null);

  const rows = stats.temposDisponiveis.map(tempo => {
    const livres = stats.livresPorTempo[tempo] || 0;
    const usados = stats.usadosPorTempo[tempo] || 0;
    const reservados = stats.reservadosPorTempo[tempo] || 0;
    const aExpirar = stats.aExpirarPorTempo[tempo] || 0;
    return { tempo, livres, usados, reservados, aExpirar, total: livres + usados + reservados };
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title} — Resumo por Pacote</DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pacote</TableHead>
                {(type === 'total' || type === 'livres') && <TableHead className="text-right">Livres</TableHead>}
                {(type === 'total' || type === 'reservados') && <TableHead className="text-right">Reservados</TableHead>}
                {type === 'reservados' && <TableHead className="text-right text-orange-500">A Expirar</TableHead>}
                {(type === 'total' || type === 'usados') && <TableHead className="text-right">Usados</TableHead>}
                {type === 'total' && <TableHead className="text-right">Total</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.tempo}>
                  <TableCell className="font-medium">{r.tempo}</TableCell>
                  {(type === 'total' || type === 'livres') && <TableCell className="text-right">{r.livres}</TableCell>}
                  {(type === 'total' || type === 'reservados') && <TableCell className="text-right">{r.reservados}</TableCell>}
                  {type === 'reservados' && (
                    <TableCell
                      className="text-right text-orange-500 font-medium cursor-pointer hover:underline select-none"
                      onDoubleClick={() => r.aExpirar > 0 && setExpiringTempo(r.tempo)}
                      title={r.aExpirar > 0 ? 'Duplo clique para ver detalhes' : ''}
                    >
                      {r.aExpirar}
                    </TableCell>
                  )}
                  {(type === 'total' || type === 'usados') && <TableCell className="text-right">{r.usados}</TableCell>}
                  {type === 'total' && <TableCell className="text-right font-bold">{r.total}</TableCell>}
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-bold">
                <TableCell>Total</TableCell>
                {(type === 'total' || type === 'livres') && <TableCell className="text-right">{stats.totalLivres}</TableCell>}
                {(type === 'total' || type === 'reservados') && <TableCell className="text-right">{stats.totalReservados}</TableCell>}
                {type === 'reservados' && (
                  <TableCell
                    className="text-right text-orange-500 font-bold cursor-pointer hover:underline select-none"
                    onDoubleClick={() => stats.totalAExpirar > 0 && setExpiringTempo('__all__')}
                    title={stats.totalAExpirar > 0 ? 'Duplo clique para ver todos' : ''}
                  >
                    {stats.totalAExpirar}
                  </TableCell>
                )}
                {(type === 'total' || type === 'usados') && <TableCell className="text-right">{stats.totalUsados}</TableCell>}
                {type === 'total' && <TableCell className="text-right">{stats.totalLivres + stats.totalReservados + stats.totalUsados}</TableCell>}
              </TableRow>
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      {expiringTempo && (
        <ExpiringVouchersDialog
          open={!!expiringTempo}
          onOpenChange={(o) => { if (!o) setExpiringTempo(null); }}
          tempo={expiringTempo === '__all__' ? '' : expiringTempo}
          onUpdated={() => onRefresh?.()}
        />
      )}
    </>
  );
}

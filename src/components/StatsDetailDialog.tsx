import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { VoucherStats } from '@/hooks/useVouchers';

interface StatsDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  type: 'total' | 'livres' | 'usados' | 'reservados';
  stats: VoucherStats;
}

export function StatsDetailDialog({ open, onOpenChange, title, type, stats }: StatsDetailDialogProps) {
  const rows = stats.temposDisponiveis.map(tempo => {
    const livres = stats.livresPorTempo[tempo] || 0;
    const usados = stats.usadosPorTempo[tempo] || 0;
    const reservados = stats.reservadosPorTempo[tempo] || 0;
    const aExpirar = stats.aExpirarPorTempo[tempo] || 0;
    return { tempo, livres, usados, reservados, aExpirar, total: livres + usados + reservados };
  });

  return (
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
                {type === 'reservados' && <TableCell className="text-right text-orange-500 font-medium">{r.aExpirar}</TableCell>}
                {(type === 'total' || type === 'usados') && <TableCell className="text-right">{r.usados}</TableCell>}
                {type === 'total' && <TableCell className="text-right font-bold">{r.total}</TableCell>}
              </TableRow>
            ))}
            <TableRow className="border-t-2 font-bold">
              <TableCell>Total</TableCell>
              {(type === 'total' || type === 'livres') && <TableCell className="text-right">{stats.totalLivres}</TableCell>}
              {(type === 'total' || type === 'reservados') && <TableCell className="text-right">{stats.totalReservados}</TableCell>}
              {type === 'reservados' && <TableCell className="text-right text-orange-500 font-bold">{stats.totalAExpirar}</TableCell>}
              {(type === 'total' || type === 'usados') && <TableCell className="text-right">{stats.totalUsados}</TableCell>}
              {type === 'total' && <TableCell className="text-right">{stats.totalLivres + stats.totalReservados + stats.totalUsados}</TableCell>}
            </TableRow>
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

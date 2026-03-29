import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Printer } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export interface PrintSelectableItem {
  key: string;
  nome: string;
  quantidade: number;
  categoria?: string;
  complementos?: string;
  obs?: string;
  imprimivel: boolean;
}

interface PrintSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PrintSelectableItem[];
  onConfirm: (selectedKeys: string[]) => void;
  printing?: boolean;
}

export function PrintSelectionDialog({
  open,
  onOpenChange,
  items,
  onConfirm,
  printing = false,
}: PrintSelectionDialogProps) {
  const printableItems = useMemo(() => items.filter(i => i.imprimivel), [items]);
  const nonPrintableItems = useMemo(() => items.filter(i => !i.imprimivel), [items]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(printableItems.map(i => i.key)));

  // Reset selection when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setSelected(new Set(printableItems.map(i => i.key)));
    }
    onOpenChange(v);
  };

  const toggleItem = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === printableItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(printableItems.map(i => i.key)));
    }
  };

  const selectedCount = useMemo(
    () => printableItems.filter(i => selected.has(i.key)).reduce((sum, i) => sum + i.quantidade, 0),
    [selected, printableItems]
  );

  const handleConfirm = () => {
    if (selected.size === 0) {
      toast({ title: 'Nenhum item selecionado', description: 'Selecione ao menos um item para imprimir.', variant: 'destructive' });
      return;
    }
    onConfirm(Array.from(selected));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            Selecionar itens para impressão
          </DialogTitle>
          <DialogDescription>
            Marque os itens que deseja imprimir. Apenas itens elegíveis para ficha são exibidos.
          </DialogDescription>
        </DialogHeader>

        {printableItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhum item desta venda gera ficha de impressão.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={toggleAll}
                className="text-sm text-primary hover:underline"
              >
                {selected.size === printableItems.length ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
              <Badge variant="secondary">{selectedCount} ficha(s)</Badge>
            </div>

            <div className="space-y-2">
              {printableItems.map(item => (
                <label
                  key={item.key}
                  className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    checked={selected.has(item.key)}
                    onCheckedChange={() => toggleItem(item.key)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{item.nome}</span>
                      <span className="text-xs text-muted-foreground ml-2">{item.quantidade}x</span>
                    </div>
                    {item.categoria && (
                      <span className="text-xs text-muted-foreground block">{item.categoria}</span>
                    )}
                    {item.complementos && (
                      <span className="text-xs text-muted-foreground block">{item.complementos}</span>
                    )}
                    {item.obs && (
                      <span className="text-xs text-muted-foreground block italic">{item.obs}</span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        {nonPrintableItems.length > 0 && (
          <div className="border-t pt-3 mt-2">
            <p className="text-xs text-muted-foreground mb-2">Itens sem impressão de ficha:</p>
            {nonPrintableItems.map(item => (
              <div key={item.key} className="flex items-center justify-between text-xs text-muted-foreground py-1">
                <span>{item.nome}</span>
                <span>{item.quantidade}x</span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={printing}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={printing || selected.size === 0}
          >
            <Printer className="h-4 w-4 mr-2" />
            {printing ? 'Imprimindo...' : `Imprimir ${selectedCount} ficha(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { ShoppingCart, Trash2, Minus, Plus, Printer, Ticket, UtensilsCrossed, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CartItem } from '@/hooks/useVoucherCart';
import { ConfirmDialog } from './ConfirmDialog';
import { useState } from 'react';

interface VoucherCartProps {
  items: CartItem[];
  onAdd: (tempo: string, options?: { type?: 'voucher' | 'ficha'; fichaType?: 'portaria' | 'comida'; fichaTexto?: string; fichaValor?: number }) => void;
  onRemove: (tempo: string, fichaType?: string) => void;
  onRemoveAll: (tempo: string, fichaType?: string) => void;
  onClear: () => void;
  onPrint: () => void;
  totalItems: number;
  printing: boolean;
  availableByTempo: Record<string, number>;
  viewMode?: boolean;
}

export function VoucherCart({
  items,
  onAdd,
  onRemove,
  onRemoveAll,
  onClear,
  onPrint,
  totalItems,
  printing,
  availableByTempo,
  viewMode = false,
}: VoucherCartProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="bg-card border rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Carrinho de Vouchers</h3>
          <Badge variant="secondary">{totalItems}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={printing}>
          <Trash2 className="h-4 w-4 mr-1" />
          Limpar
        </Button>
      </div>

      <div className="space-y-3 mb-4">
        {items.map((item) => {
          const isFicha = item.type === 'ficha';
          const key = isFicha ? `ficha_${item.fichaType}` : item.tempo;
          const available = isFicha ? Infinity : (availableByTempo[item.tempo] || 0);
          const canAdd = isFicha || item.quantity < available;
          const icon = item.fichaType === 'comida'
            ? <UtensilsCrossed className="h-4 w-4 text-primary" />
            : item.fichaType === 'portaria'
              ? <Ticket className="h-4 w-4 text-primary" />
              : null;

          const label = isFicha
            ? `Ficha ${item.fichaType === 'portaria' ? 'Portaria' : 'Prato Único'}${item.fichaValor && item.fichaValor > 0 ? ` - R$ ${item.fichaValor.toFixed(2).replace('.', ',')}` : ''}`
            : item.tempo;

          return (
            <div key={key} className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2">
                {icon}
                <span className="font-medium text-foreground">{label}</span>
                {!isFicha && (
                  <span className="text-sm text-muted-foreground">
                    ({available} disponíveis)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onRemove(item.tempo, item.fichaType)}
                  disabled={printing}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="font-bold text-lg w-8 text-center">{item.quantity}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => isFicha
                    ? onAdd(item.tempo, { type: 'ficha', fichaType: item.fichaType, fichaTexto: item.fichaTexto, fichaValor: item.fichaValor })
                    : onAdd(item.tempo)
                  }
                  disabled={printing || !canAdd}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => onRemoveAll(item.tempo, item.fichaType)}
                  disabled={printing}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Button
        className="w-full"
        size="lg"
        onClick={() => setShowConfirm(true)}
        disabled={printing || totalItems === 0}
      >
        {viewMode ? (
          <><Eye className="h-5 w-5 mr-2" />{printing ? 'Processando...' : `Visualizar ${totalItems} voucher${totalItems > 1 ? 's' : ''}`}</>
        ) : (
          <><Printer className="h-5 w-5 mr-2" />{printing ? 'Imprimindo...' : `Imprimir ${totalItems} item${totalItems > 1 ? 's' : ''}`}</>
        )}
      </Button>

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title={viewMode ? "Confirmar Visualização" : "Confirmar Impressão"}
        description={viewMode
          ? `Deseja visualizar ${totalItems} voucher${totalItems > 1 ? 's' : ''}? Os vouchers serão marcados como pré-reservados.`
          : `Deseja imprimir ${totalItems} item${totalItems > 1 ? 's' : ''}? Os vouchers serão marcados como usados.`
        }
        onConfirm={() => { setShowConfirm(false); onPrint(); }}
        confirmText={viewMode ? "Visualizar" : "Imprimir Todos"}
        cancelText="Cancelar"
      />
    </div>
  );
}

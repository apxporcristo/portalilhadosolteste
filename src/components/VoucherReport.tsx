import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarIcon, FileText, Search, AlertCircle, Printer, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { VoucherStats } from '@/hooks/useVouchers';

interface Voucher {
  id: string;
  voucher_id: string;
  tempo_validade: string;
  status: string;
  data_uso: string | null;
}

interface VoucherReportProps {
  stats: VoucherStats;
  getUsedVouchersByDateRange: (start: Date | null, end: Date | null) => Promise<Voucher[]>;
}

export function VoucherReport({ stats, getUsedVouchersByDateRange }: VoucherReportProps) {
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [filteredVouchers, setFilteredVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(false);
  const [valorPorVoucher, setValorPorVoucher] = useState<string>('');
  const [selectedTempos, setSelectedTempos] = useState<string[]>([]);
  const reportRef = useRef<HTMLDivElement>(null);

  const handleFilter = async () => {
    setLoading(true);
    const vouchers = await getUsedVouchersByDateRange(startDate || null, endDate || null);
    setFilteredVouchers(vouchers);
    setLoading(false);
  };

  useEffect(() => {
    handleFilter();
  }, []);

  // Initialize selected tempos when stats.temposDisponiveis changes
  useEffect(() => {
    if (stats.temposDisponiveis.length > 0 && selectedTempos.length === 0) {
      setSelectedTempos(stats.temposDisponiveis);
    }
  }, [stats.temposDisponiveis]);

  const filteredStats = filteredVouchers.reduce((acc, v) => {
    acc[v.tempo_validade] = (acc[v.tempo_validade] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Filter vouchers by selected tempos for calculation
  const vouchersParaCalculo = filteredVouchers.filter(v => selectedTempos.includes(v.tempo_validade));
  const totalVouchersCalculo = vouchersParaCalculo.length;

  const valorNumerico = parseFloat(valorPorVoucher.replace(',', '.')) || 0;
  const totalPagar = totalVouchersCalculo * valorNumerico;

  const toggleTempo = (tempo: string) => {
    setSelectedTempos(prev => 
      prev.includes(tempo) 
        ? prev.filter(t => t !== tempo)
        : [...prev, tempo]
    );
  };

  const selectAll = () => setSelectedTempos(stats.temposDisponiveis);
  const selectNone = () => setSelectedTempos([]);

  const handlePrintReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Por favor, permita pop-ups para imprimir o relatório');
      return;
    }

    const dateRangeText = startDate || endDate
      ? `Período: ${startDate ? format(startDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Início'} a ${endDate ? format(endDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Hoje'}`
      : 'Período: Todos';

    const usedByTempo = Object.entries(filteredStats)
      .filter(([tempo]) => selectedTempos.includes(tempo))
      .map(([tempo, count]) => `<tr><td>${tempo}</td><td style="text-align: right;">${count}</td></tr>`)
      .join('');

    const freeByTempo = stats.temposDisponiveis
      .filter((tempo) => selectedTempos.includes(tempo))
      .map((tempo) => `<tr><td>${tempo}</td><td style="text-align: right;">${stats.livresPorTempo[tempo] || 0}</td></tr>`)
      .join('');

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Relatório de Vouchers</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 20px;
              max-width: 800px;
              margin: 0 auto;
            }
            h1 {
              text-align: center;
              color: #333;
              margin-bottom: 10px;
            }
            .date-range {
              text-align: center;
              color: #666;
              margin-bottom: 20px;
            }
            h2 {
              color: #444;
              border-bottom: 2px solid #ddd;
              padding-bottom: 5px;
              margin-top: 25px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 10px 0;
            }
            th, td {
              border: 1px solid #ddd;
              padding: 8px;
              text-align: left;
            }
            th {
              background: #f5f5f5;
            }
            .total-section {
              margin-top: 30px;
              padding: 15px;
              background: #f9f9f9;
              border-radius: 8px;
            }
            .total-row {
              display: flex;
              justify-content: space-between;
              padding: 5px 0;
              font-size: 14px;
            }
            .total-final {
              font-weight: bold;
              font-size: 18px;
              border-top: 2px solid #333;
              margin-top: 10px;
              padding-top: 10px;
            }
            .print-date {
              text-align: right;
              color: #888;
              font-size: 12px;
              margin-top: 30px;
            }
            @media print {
              body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <h1>Relatório de Vouchers</h1>
          <p class="date-range">${dateRangeText}</p>
          
          <h2>Vouchers Usados por Tempo</h2>
          <table>
            <thead>
              <tr>
                <th>Tempo</th>
                <th style="text-align: right;">Quantidade</th>
              </tr>
            </thead>
            <tbody>
              ${usedByTempo || '<tr><td colspan="2">Nenhum voucher usado</td></tr>'}
            </tbody>
          </table>

          <h2>Vouchers Livres por Tempo</h2>
          <table>
            <thead>
              <tr>
                <th>Tempo</th>
                <th style="text-align: right;">Quantidade</th>
              </tr>
            </thead>
            <tbody>
              ${freeByTempo || '<tr><td colspan="2">Nenhum voucher livre</td></tr>'}
            </tbody>
          </table>

          <div class="total-section">
            <div class="total-row">
              <span>Tempos selecionados:</span>
              <span>${selectedTempos.join(', ') || 'Nenhum'}</span>
            </div>
            <div class="total-row">
              <span>Total de vouchers (selecionados):</span>
              <span>${totalVouchersCalculo}</span>
            </div>
            <div class="total-row">
              <span>Valor por voucher:</span>
              <span>R$ ${valorNumerico.toFixed(2).replace('.', ',')}</span>
            </div>
            <div class="total-row total-final">
              <span>TOTAL A PAGAR:</span>
              <span>R$ ${totalPagar.toFixed(2).replace('.', ',')}</span>
            </div>
          </div>

          <p class="print-date">Impresso em: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</p>
          
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() { window.close(); };
            }
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  return (
    <Card className="glass-card" ref={reportRef}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Relatório de Vouchers
        </CardTitle>
        <CardDescription>
          Visualize a quantidade de vouchers por status e tempo
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stats by Time - Free Vouchers */}
        <div>
          <h4 className="text-sm font-medium mb-3 text-muted-foreground">Vouchers Livres por Tempo</h4>
          {stats.temposDisponiveis.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {stats.temposDisponiveis.map((tempo) => (
                <div
                  key={tempo}
                  className="bg-success/10 rounded-lg p-3 text-center border border-success/20"
                >
                  <div className="text-2xl font-bold text-success">
                    {stats.livresPorTempo[tempo] || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">{tempo}</div>
                </div>
              ))}
            </div>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Nenhum voucher cadastrado ainda.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Date Filter */}
        <div className="flex flex-wrap gap-3 items-end border-t pt-6">
          <div className="space-y-1">
            <label className="text-sm font-medium">Data Início</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-[180px] justify-start text-left font-normal',
                    !startDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {startDate ? format(startDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecionar'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={setStartDate}
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Data Fim</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-[180px] justify-start text-left font-normal',
                    !endDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {endDate ? format(endDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecionar'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={endDate}
                  onSelect={setEndDate}
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>
          </div>

          <Button onClick={handleFilter} disabled={loading}>
            <Search className="mr-2 h-4 w-4" />
            Filtrar
          </Button>

          {(startDate || endDate) && (
            <Button
              variant="ghost"
              onClick={() => {
                setStartDate(undefined);
                setEndDate(undefined);
                handleFilter();
              }}
            >
              Limpar
            </Button>
          )}
        </div>

        {/* Filtered Stats */}
        <div>
          <h4 className="text-sm font-medium mb-3 text-muted-foreground">
            Vouchers Usados {startDate || endDate ? '(Filtrado)' : '(Total)'}
          </h4>
          {stats.temposDisponiveis.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              {stats.temposDisponiveis.map((tempo) => (
                <div
                  key={tempo}
                  className="bg-warning/10 rounded-lg p-3 text-center border border-warning/20"
                >
                  <div className="text-2xl font-bold text-warning">
                    {filteredStats[tempo] || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">{tempo}</div>
                </div>
              ))}
            </div>
          ) : (
            <Alert className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Nenhum voucher cadastrado ainda.
              </AlertDescription>
            </Alert>
          )}

          <div className="text-center p-3 bg-muted rounded-lg">
            <span className="text-sm text-muted-foreground">Total de vouchers usados: </span>
            <span className="text-lg font-bold">{filteredVouchers.length}</span>
          </div>
        </div>

        {/* Valor por Voucher & Print */}
        <div className="flex flex-wrap gap-4 items-end border-t pt-6">
          <div className="space-y-1">
            <Label htmlFor="valor-voucher" className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              Valor por Voucher (R$)
            </Label>
            <Input
              id="valor-voucher"
              type="text"
              value={valorPorVoucher}
              onChange={(e) => setValorPorVoucher(e.target.value)}
              placeholder="0,00"
              className="w-32"
            />
          </div>

          {/* Tempo Selection */}
          <div className="space-y-1">
            <Label className="text-sm">Tempos para Cálculo</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[200px] justify-between">
                  {selectedTempos.length === 0 
                    ? 'Selecionar tempos' 
                    : selectedTempos.length === stats.temposDisponiveis.length 
                      ? 'Todos selecionados'
                      : `${selectedTempos.length} selecionado(s)`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[220px] p-3 bg-popover z-50" align="start">
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={selectAll} className="flex-1 text-xs">
                      Todos
                    </Button>
                    <Button variant="outline" size="sm" onClick={selectNone} className="flex-1 text-xs">
                      Nenhum
                    </Button>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {stats.temposDisponiveis.map((tempo) => (
                      <div key={tempo} className="flex items-center gap-2">
                        <Checkbox
                          id={`tempo-${tempo}`}
                          checked={selectedTempos.includes(tempo)}
                          onCheckedChange={() => toggleTempo(tempo)}
                        />
                        <label 
                          htmlFor={`tempo-${tempo}`} 
                          className="text-sm cursor-pointer flex-1"
                        >
                          {tempo} ({filteredStats[tempo] || 0})
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          
          <div className="bg-primary/10 rounded-lg px-4 py-2 border border-primary/20">
            <div className="text-xs text-muted-foreground">
              {totalVouchersCalculo} vouchers × R$ {valorNumerico.toFixed(2).replace('.', ',')}
            </div>
            <span className="text-sm text-muted-foreground">Total: </span>
            <span className="text-lg font-bold text-primary">
              R$ {totalPagar.toFixed(2).replace('.', ',')}
            </span>
          </div>

          <Button onClick={handlePrintReport} className="ml-auto">
            <Printer className="mr-2 h-4 w-4" />
            Imprimir Relatório
          </Button>
        </div>

        {/* Vouchers Table */}
        {filteredVouchers.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID do Voucher</TableHead>
                  <TableHead>Tempo</TableHead>
                  <TableHead>Data de Uso</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVouchers.filter(v => selectedTempos.length === 0 || selectedTempos.includes(v.tempo_validade)).slice(0, 50).map((voucher) => (
                  <TableRow key={voucher.id}>
                    <TableCell className="font-mono font-medium">
                      {voucher.voucher_id}
                    </TableCell>
                    <TableCell>{voucher.tempo_validade}</TableCell>
                    <TableCell>
                      {voucher.data_uso
                        ? format(new Date(voucher.data_uso), 'dd/MM/yyyy HH:mm', { locale: ptBR })
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-warning/20 text-warning">
                        Usado
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredVouchers.filter(v => selectedTempos.length === 0 || selectedTempos.includes(v.tempo_validade)).length > 50 && (
              <div className="p-3 text-center text-sm text-muted-foreground border-t">
                Mostrando 50 de {filteredVouchers.filter(v => selectedTempos.length === 0 || selectedTempos.includes(v.tempo_validade)).length} vouchers
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

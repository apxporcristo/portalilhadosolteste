import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Package, Save, Loader2, RefreshCw } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { getSupabaseClient } from '@/hooks/useVouchers';
import type { SupabaseClient } from '@supabase/supabase-js';

interface PacoteDisponivel {
  tempo_validade: string;
  quantidade: number;
  valor: number;
  pacote_id: string | null;
}

export function PackageSettings() {
  const [pacotes, setPacotes] = useState<PacoteDisponivel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});

  const fetchData = async () => {
    const supabase = await getSupabaseClient();
    setLoading(true);
    try {
      // Fetch all vouchers to handle different status formats (Livre/livre/LIVRE)
      const { data: vouchersData, error: vouchersError } = await supabase
        .from('vouchers')
        .select('tempo_validade, status');

      if (vouchersError) {
        console.error('Error fetching vouchers:', vouchersError);
        throw vouchersError;
      }

      // Filter for 'livre' status (case-insensitive) and group by tempo_validade
      const grouped: Record<string, number> = {};
      (vouchersData || []).forEach((v: any) => {
        const status = String(v.status || '').toLowerCase().trim();
        // Check if status indicates "livre" (free)
        if (status === 'livre' || status === 'free' || status === '0' || status === 'false' || status === '') {
          const tempo = v.tempo_validade;
          grouped[tempo] = (grouped[tempo] || 0) + 1;
        }
      });

      // Fetch existing prices from pacotes table
      const { data: pacotesData, error: pacotesError } = await supabase
        .from('pacotes')
        .select('*');

      if (pacotesError) {
        console.error('Error fetching pacotes:', pacotesError);
        throw pacotesError;
      }

      // Create a map of tempo_validade to pacote info
      const pacotesMap: Record<string, { id: string; valor: number }> = {};
      (pacotesData || []).forEach((p) => {
        pacotesMap[p.tempo_validade] = { id: p.id, valor: Number(p.valor) || 0 };
      });

      // Build the final list - only tempos with available vouchers
      const pacotesDisponiveis: PacoteDisponivel[] = Object.entries(grouped)
        .map(([tempo, quantidade]) => ({
          tempo_validade: tempo,
          quantidade,
          valor: pacotesMap[tempo]?.valor || 0,
          pacote_id: pacotesMap[tempo]?.id || null,
        }))
        .sort((a, b) => a.tempo_validade.localeCompare(b.tempo_validade));

      setPacotes(pacotesDisponiveis);
      
      // Initialize edited values
      const initialValues: Record<string, string> = {};
      pacotesDisponiveis.forEach(p => {
        initialValues[p.tempo_validade] = p.valor.toFixed(2);
      });
      setEditedValues(initialValues);

    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar os dados',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleValueChange = (tempo: string, value: string) => {
    // Allow only numbers and decimal point
    const sanitized = value.replace(/[^0-9.]/g, '');
    setEditedValues(prev => ({ ...prev, [tempo]: sanitized }));
  };

  const handleSave = async (pacote: PacoteDisponivel) => {
    const supabase = await getSupabaseClient();
    setSaving(pacote.tempo_validade);
    try {
      const valor = parseFloat(editedValues[pacote.tempo_validade]) || 0;

      if (pacote.pacote_id) {
        // Update existing pacote
        const { error } = await supabase
          .from('pacotes')
          .update({ valor })
          .eq('id', pacote.pacote_id);

        if (error) throw error;
      } else {
        // Insert new pacote
        const { error } = await supabase
          .from('pacotes')
          .insert({ tempo_validade: pacote.tempo_validade, valor });

        if (error) throw error;
      }

      toast({
        title: 'Sucesso',
        description: `Valor do pacote "${pacote.tempo_validade}" salvo com sucesso`,
      });

      fetchData();
    } catch (error) {
      console.error('Error saving:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível salvar o valor',
        variant: 'destructive',
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Pacotes Disponíveis
            </CardTitle>
            <CardDescription>
              Configure o valor de cada tempo de validade com vouchers disponíveis
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : pacotes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Nenhum pacote com vouchers disponíveis. Importe vouchers para ver os tempos aqui.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tempo de Validade</TableHead>
                <TableHead>Vouchers Disponíveis</TableHead>
                <TableHead>Valor (R$)</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pacotes.map((pacote) => (
                <TableRow key={pacote.tempo_validade}>
                  <TableCell className="font-medium">{pacote.tempo_validade}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{pacote.quantidade}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">R$</span>
                      <Input
                        type="text"
                        value={editedValues[pacote.tempo_validade] || ''}
                        onChange={(e) => handleValueChange(pacote.tempo_validade, e.target.value)}
                        className="w-32"
                        placeholder="0.00"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() => handleSave(pacote)}
                      disabled={saving === pacote.tempo_validade}
                    >
                      {saving === pacote.tempo_validade ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

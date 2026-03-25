import { usePrintLayout, PrintLayoutConfig } from '@/hooks/usePrintLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Ruler, RotateCcw } from 'lucide-react';

function Field({ label, value, unit, onChange, min = 1 }: { label: string; value: number; unit: string; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={min}
          max={200}
          value={value}
          onChange={e => onChange(Math.max(min, Number(e.target.value) || min))}
          className="h-8 text-sm"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">{unit}</span>
      </div>
    </div>
  );
}

function FichaPreview({ config }: { config: PrintLayoutConfig }) {
  const scale = 3;
  const w = config.fichaPaperWidth * scale;
  const h = config.fichaPaperHeight * scale;

  return (
    <div className="flex flex-col items-center gap-2">
      <Label className="text-sm font-semibold">Pré-visualização</Label>
      <div
        className="bg-white border-2 border-dashed border-muted-foreground/40 flex flex-col items-center justify-center overflow-hidden"
        style={{ width: w, height: h, padding: 2 * scale }}
      >
        <span style={{ fontSize: config.fichaTitleFontSize * 1.1, fontWeight: 'bold', color: '#000' }}>
          Ficha de consumo
        </span>
        <span style={{ fontSize: config.fichaSubtitleFontSize * 1.1, color: '#000', marginTop: 2 }}>
          Categoria: Bebidas
        </span>
        <span style={{ fontSize: config.fichaNumberFontSize * 1.1, fontWeight: 'bold', color: '#000', marginTop: 2 }}>
          Refrigerante
        </span>
        <span style={{ fontSize: config.fichaClienteFontSize * 1.1, color: '#000', marginTop: 4 }}>
          Cliente: João Silva
        </span>
        <span style={{ fontSize: config.fichaAtendenteFontSize * 1.1, color: '#000', marginTop: 1 }}>
          Atendente: Maria
        </span>
        <span style={{ fontSize: config.fichaDataFontSize * 1.1, color: '#000', marginTop: 4 }}>
          Data: 16/03/2026 14:30
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{config.fichaPaperWidth}mm × {config.fichaPaperHeight}mm</span>
    </div>
  );
}

export function FichaLayoutSettings() {
  const { config, updateConfig, resetConfig } = usePrintLayout();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ruler className="h-5 w-5" />
          Layout de Impressão - Ficha
        </CardTitle>
        <CardDescription>
          Configure o tamanho das fontes e papel para impressão de fichas de consumo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 space-y-4">
            <div>
              <h4 className="text-sm font-semibold mb-2">Tamanho do Papel</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Largura" value={config.fichaPaperWidth} unit="mm" onChange={v => updateConfig({ fichaPaperWidth: v })} />
                <Field label="Altura" value={config.fichaPaperHeight} unit="mm" onChange={v => updateConfig({ fichaPaperHeight: v })} />
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Fontes</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Título" value={config.fichaTitleFontSize} unit="pt" onChange={v => updateConfig({ fichaTitleFontSize: v })} />
                <Field label="Subtítulo (Categoria)" value={config.fichaSubtitleFontSize} unit="pt" onChange={v => updateConfig({ fichaSubtitleFontSize: v })} />
                <Field label="Nome do Produto" value={config.fichaNumberFontSize} unit="pt" onChange={v => updateConfig({ fichaNumberFontSize: v })} />
                <Field label="Cliente" value={config.fichaClienteFontSize} unit="pt" onChange={v => updateConfig({ fichaClienteFontSize: v })} />
                <Field label="Atendente" value={config.fichaAtendenteFontSize} unit="pt" onChange={v => updateConfig({ fichaAtendenteFontSize: v })} />
                <Field label="Data" value={config.fichaDataFontSize} unit="pt" onChange={v => updateConfig({ fichaDataFontSize: v })} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">≤10 = normal, 11-14 = dupla altura, ≥15 = dupla largura+altura</p>
            </div>

            <Button variant="outline" size="sm" onClick={resetConfig} className="mt-2">
              <RotateCcw className="mr-2 h-4 w-4" />
              Restaurar Padrão
            </Button>
          </div>

          <div className="flex justify-center">
            <FichaPreview config={config} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

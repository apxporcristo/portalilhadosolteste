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

function VoucherPreview({ config }: { config: PrintLayoutConfig }) {
  // Scale factor: render mm as px for preview (approx 3px per mm)
  const scale = 3;
  const w = config.paperWidth * scale;
  const h = config.paperHeight * scale;

  return (
    <div className="flex flex-col items-center gap-2">
      <Label className="text-sm font-semibold">Pré-visualização</Label>
      <div
        className="bg-white border-2 border-dashed border-muted-foreground/40 flex flex-col items-center justify-center overflow-hidden"
        style={{
          width: w,
          height: h,
          padding: 2 * scale,
        }}
      >
        <span style={{ fontSize: config.titleFontSize * 1.1, fontWeight: 'bold', color: '#000' }}>
          VOUCHER DE ACESSO
        </span>
        <span style={{ fontSize: config.messageFontSize * 1.1, color: '#000', textAlign: 'center', lineHeight: 1.3, marginTop: 2 }}>
          Coloque no modo avião antes<br />de acessar a rede <b>"REDE"</b>
        </span>
        {config.qrWidth > 0 && config.qrHeight > 0 && (
          <div
            className="border border-muted-foreground/50 bg-muted/20 flex items-center justify-center my-1"
            style={{
              width: config.qrWidth * scale,
              height: config.qrHeight * scale,
            }}
          >
            <span className="text-[8px] text-muted-foreground">QR CODE</span>
          </div>
        )}
        <span style={{ fontSize: config.voucherIdFontSize * 1.1, fontWeight: 'bold', fontFamily: 'Courier New, monospace', color: '#000', letterSpacing: 1 }}>
          ABC123
        </span>
        <span style={{ fontSize: config.tempoFontSize * 1.1, color: '#000', marginTop: 1 }}>
          Tempo de conexão: 2 Horas
        </span>
        <span style={{ fontSize: config.dateFontSize * 1.1, color: '#000', marginTop: 1 }}>
          Data: 02/03/2026 14:30
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{config.paperWidth}mm × {config.paperHeight}mm</span>
    </div>
  );
}

export function PrintLayoutSettings() {
  const { config, updateConfig, resetConfig } = usePrintLayout();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ruler className="h-5 w-5" />
          Layout de Impressão
        </CardTitle>
        <CardDescription>
          Configure o tamanho das fontes, QR Code e papel do voucher.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Controls */}
          <div className="flex-1 space-y-4">
            <div>
              <h4 className="text-sm font-semibold mb-2">Tamanho do Papel</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Largura" value={config.paperWidth} unit="mm" onChange={v => updateConfig({ paperWidth: v })} />
                <Field label="Altura" value={config.paperHeight} unit="mm" onChange={v => updateConfig({ paperHeight: v })} />
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">QR Code</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Largura" value={config.qrWidth} unit="mm" min={0} onChange={v => updateConfig({ qrWidth: v })} />
                <Field label="Altura" value={config.qrHeight} unit="mm" min={0} onChange={v => updateConfig({ qrHeight: v })} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Defina 0 para ocultar o QR Code na impressão</p>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Fontes</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Título" value={config.titleFontSize} unit="pt" onChange={v => updateConfig({ titleFontSize: v })} />
                <Field label="Mensagem" value={config.messageFontSize} unit="pt" onChange={v => updateConfig({ messageFontSize: v })} />
                <Field label="Nº Voucher" value={config.voucherIdFontSize} unit="pt" onChange={v => updateConfig({ voucherIdFontSize: v })} />
                <Field label="Tempo" value={config.tempoFontSize} unit="pt" onChange={v => updateConfig({ tempoFontSize: v })} />
                <Field label="Data" value={config.dateFontSize} unit="pt" onChange={v => updateConfig({ dateFontSize: v })} />
              </div>
            </div>


            <Button variant="outline" size="sm" onClick={resetConfig} className="mt-2">
              <RotateCcw className="mr-2 h-4 w-4" />
              Restaurar Padrão
            </Button>
          </div>

          {/* Preview */}
          <div className="flex justify-center">
            <VoucherPreview config={config} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

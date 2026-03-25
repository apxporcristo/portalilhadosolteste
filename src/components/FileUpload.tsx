import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, FileSpreadsheet, Loader2, CheckCircle2 } from 'lucide-react';
import { parseExcelFile, ParsedVoucher } from '@/lib/voucher-utils';
import { toast } from '@/hooks/use-toast';
import { ImportPreview } from './ImportPreview';

interface FileUploadProps {
  onImport: (vouchers: ParsedVoucher[]) => Promise<void>;
  processing: boolean;
}

export function FileUpload({ onImport, processing }: FileUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedVouchers, setParsedVouchers] = useState<ParsedVoucher[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast({
        title: 'Arquivo inválido',
        description: 'Por favor, selecione um arquivo Excel (.xlsx ou .xls)',
        variant: 'destructive',
      });
      return;
    }

    setSelectedFile(file);
    
    try {
      const vouchers = await parseExcelFile(file);
      setParsedVouchers(vouchers);
      
      if (vouchers.length === 0) {
        toast({
          title: 'Arquivo vazio',
          description: 'Nenhum voucher encontrado no arquivo',
          variant: 'destructive',
        });
        return;
      }

      // Show preview dialog
      setShowPreview(true);
    } catch (error) {
      toast({
        title: 'Erro ao processar arquivo',
        description: 'Verifique se o arquivo está no formato correto',
        variant: 'destructive',
      });
    }
  };

  const handleConfirmImport = async (vouchers: ParsedVoucher[]) => {
    await onImport(vouchers);
    resetState();
  };

  const resetState = () => {
    setSelectedFile(null);
    setParsedVouchers([]);
    setShowPreview(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  return (
    <>
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Importar Vouchers
          </CardTitle>
          <CardDescription>
            Importe uma planilha Excel com as colunas "ID do voucher" e "Tempo de validade"
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
              dragOver
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="hidden"
              id="file-upload"
            />
            
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2">
              Arraste um arquivo Excel aqui ou
            </p>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              Selecionar Arquivo
            </Button>
          </div>
        </CardContent>
      </Card>

      <ImportPreview
        open={showPreview}
        onOpenChange={(open) => {
          setShowPreview(open);
          if (!open) resetState();
        }}
        vouchers={parsedVouchers}
        onConfirm={handleConfirmImport}
        processing={processing}
      />
    </>
  );
}

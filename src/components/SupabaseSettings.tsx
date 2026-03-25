import { useState, useEffect } from 'react';
import { Database, CheckCircle, XCircle, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSupabaseConfig } from '@/hooks/useSupabaseConfig';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export function SupabaseSettings() {
  const {
    config,
    connectionStatus,
    updateConfig,
    testConnection,
    saveConfig,
    clearConfig,
  } = useSupabaseConfig();

  const [url, setUrl] = useState(config.url);
  const [anonKey, setAnonKey] = useState(config.anonKey);
  const [showClearDialog, setShowClearDialog] = useState(false);

  useEffect(() => {
    setUrl(config.url);
    setAnonKey(config.anonKey);
  }, [config.url, config.anonKey]);

  const handleTest = async () => {
    await testConnection(url, anonKey);
  };

  const handleSave = async () => {
    await saveConfig(url, anonKey);
  };

  const handleClear = () => {
    clearConfig();
    setUrl('');
    setAnonKey('');
    setShowClearDialog(false);
  };

  const getStatusIcon = () => {
    switch (connectionStatus.status) {
      case 'testing':
        return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case 'connected':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return null;
    }
  };

  const getStatusVariant = () => {
    switch (connectionStatus.status) {
      case 'connected':
        return 'default';
      case 'error':
        return 'destructive';
      default:
        return 'default';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Conexão Supabase
        </CardTitle>
        <CardDescription>
          Configure a conexão com seu projeto Supabase. Isso substituirá o banco de dados padrão do Lovable Cloud.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* URL Input */}
        <div className="space-y-2">
          <Label htmlFor="supabase-url">URL do Projeto</Label>
          <Input
            id="supabase-url"
            type="url"
            placeholder="https://seuproject.supabase.co"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              updateConfig(e.target.value, anonKey);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Encontre em: Supabase Dashboard → Settings → API → Project URL
          </p>
        </div>

        {/* Anon Key Input */}
        <div className="space-y-2">
          <Label htmlFor="supabase-key">Chave Anon (pública)</Label>
          <Input
            id="supabase-key"
            type="password"
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            value={anonKey}
            onChange={(e) => {
              setAnonKey(e.target.value);
              updateConfig(url, e.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Encontre em: Supabase Dashboard → Settings → API → anon public
          </p>
        </div>

        {/* Status Display */}
        {connectionStatus.status !== 'idle' && (
          <Alert variant={getStatusVariant()}>
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <AlertDescription>{connectionStatus.message}</AlertDescription>
            </div>
          </Alert>
        )}

        {/* Current Config Status */}
        {config.isConfigured && (
          <Alert>
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertDescription>
              Supabase externo configurado. URL: {config.url.substring(0, 40)}...
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={!url || !anonKey || connectionStatus.status === 'testing'}
          >
            {connectionStatus.status === 'testing' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testando...
              </>
            ) : (
              'Testar Conexão'
            )}
          </Button>

          <Button
            onClick={handleSave}
            disabled={!url || !anonKey || connectionStatus.status === 'testing'}
          >
            Salvar Configuração
          </Button>

          {config.isConfigured && (
            <Button
              variant="destructive"
              onClick={() => setShowClearDialog(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remover
            </Button>
          )}
        </div>

        {/* SQL Schema Info */}
        <div className="mt-6 p-4 bg-muted rounded-lg">
          <h4 className="font-medium mb-2">Estrutura da Tabela Necessária</h4>
          <p className="text-sm text-muted-foreground mb-3">
            Crie esta tabela no seu projeto Supabase:
          </p>
          <pre className="text-xs bg-background p-3 rounded border overflow-x-auto">
{`CREATE TABLE vouchers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_id TEXT NOT NULL UNIQUE,
  tempo_validade TEXT NOT NULL,
  status TEXT DEFAULT 'livre',
  data_uso TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS (opcional mas recomendado)
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;

-- Política para permitir acesso anônimo (para este app)
CREATE POLICY "Allow anonymous access" ON vouchers
  FOR ALL USING (true);`}
          </pre>
        </div>

        {/* Clear Config Dialog */}
        <ConfirmDialog
          open={showClearDialog}
          onOpenChange={setShowClearDialog}
          title="Remover Configuração"
          description="Tem certeza que deseja remover a configuração do Supabase externo? O app voltará a usar o banco de dados padrão do Lovable Cloud."
          confirmText="Remover"
          onConfirm={handleClear}
        />
      </CardContent>
    </Card>
  );
}

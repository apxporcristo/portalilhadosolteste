import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useBalanca, BalancaConfig } from '@/hooks/useBalanca';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Settings, Save, CheckCircle2, Wifi, ImagePlus, Trash2, RefreshCw, Lock, Download, Smartphone, Scale, Bluetooth, BluetoothSearching, Settings2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { getSupabaseClient } from '@/lib/supabase-external';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
import { useNetworkName } from '@/hooks/useNetworkName';
import { getNetworkQrImageUrl, generateAndUploadWifiQr, removeNetworkQrImage } from '@/hooks/useNetworkName';

export function AdminSettings() {
  const { networkName, networkPassword, encryption, saveNetworkName, saveNetworkPassword, saveEncryption } = useNetworkName();
  const [networkInput, setNetworkInput] = useState(networkName);
  const [passwordInput, setPasswordInput] = useState(networkPassword);
  const [encryptionInput, setEncryptionInput] = useState(encryption);
  const [networkSaved, setNetworkSaved] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [generatingQr, setGeneratingQr] = useState(false);
  const [visualizarVoucher, setVisualizarVoucher] = useState(true);
  const [visualizarFichasConsumo, setVisualizarFichasConsumo] = useState(true);

  // PWA Install
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const getGlobalPrompt = () => window.__deferredInstallPrompt ?? null;
    const handleNativePrompt = (e: Event) => {
      e.preventDefault();
      const installEvent = e as BeforeInstallPromptEvent;
      window.__deferredInstallPrompt = installEvent;
      setDeferredPrompt(installEvent);
    };
    const handleInstallAvailable = () => setDeferredPrompt(getGlobalPrompt());
    const handleAppInstalled = () => {
      window.__deferredInstallPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    setDeferredPrompt(getGlobalPrompt());
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    ) {
      setIsInstalled(true);
    }

    window.addEventListener('beforeinstallprompt', handleNativePrompt);
    window.addEventListener('pwa-install-available', handleInstallAvailable as EventListener);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('pwa-installed', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleNativePrompt);
      window.removeEventListener('pwa-install-available', handleInstallAvailable as EventListener);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('pwa-installed', handleAppInstalled);
    };
  }, []);

  const handleInstallPwa = async () => {
    const promptEvent = deferredPrompt ?? window.__deferredInstallPrompt ?? null;
    if (!promptEvent) {
      toast({ title: 'Instalação indisponível agora', description: 'Abra a URL publicada do sistema no Chrome e tente novamente.' });
      return;
    }
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') setIsInstalled(true);
    window.__deferredInstallPrompt = null;
    setDeferredPrompt(null);
  };

  useEffect(() => {
    setNetworkInput(networkName);
    setPasswordInput(networkPassword);
    setEncryptionInput(encryption);
  }, [networkName, networkPassword, encryption]);

  useEffect(() => { getNetworkQrImageUrl().then(url => setQrImage(url)); }, []);

  useEffect(() => {
    getSupabaseClient().then(client => {
      client.from('app_settings').select('key, value').in('key', ['visualizar_voucher', 'visualizar_fichas_consumo']).then(({ data }) => {
        if (data) {
          data.forEach(row => {
            if (row.key === 'visualizar_voucher') setVisualizarVoucher(row.value !== 'false');
            if (row.key === 'visualizar_fichas_consumo') setVisualizarFichasConsumo(row.value !== 'false');
          });
        }
      });
    });
  }, []);

  const handleGenerateQr = async () => {
    setGeneratingQr(true);
    try {
      saveNetworkName(networkInput);
      saveNetworkPassword(passwordInput);
      saveEncryption(encryptionInput);
      const url = await generateAndUploadWifiQr();
      setQrImage(url);
      toast({ title: 'Sucesso', description: 'QR Code WiFi gerado e salvo com sucesso' });
    } catch {
      toast({ title: 'Erro', description: 'Falha ao gerar QR Code', variant: 'destructive' });
    } finally {
      setGeneratingQr(false);
    }
  };

  const handleRemoveQrImage = async () => {
    await removeNetworkQrImage();
    setQrImage(null);
    toast({ title: 'Removido', description: 'QR Code da rede removido' });
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          Configurações
        </CardTitle>
        <CardDescription>
          Configurações gerais do sistema
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Network Name Section */}
        <div className="space-y-4 max-w-md">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wifi className="h-4 w-4 text-primary" />
            Nome da Rede WiFi
          </div>
          <p className="text-sm text-muted-foreground">
            Este nome será exibido no voucher impresso e usado para gerar o QR Code de conexão WiFi.
          </p>
          <div className="flex gap-2">
            <Input id="network-name" value={networkInput} onChange={(e) => setNetworkInput(e.target.value)} placeholder="Nome da rede WiFi (SSID)" />
            <Button type="button" onClick={() => {
              saveNetworkName(networkInput);
              setNetworkSaved(true);
              toast({ title: 'Sucesso', description: 'Nome da rede salvo com sucesso' });
              setTimeout(() => setNetworkSaved(false), 3000);
            }}>
              {networkSaved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex items-center gap-2 text-sm font-medium mt-4">
            <Lock className="h-4 w-4 text-primary" />
            Senha da Rede WiFi
          </div>
          <Input id="network-password" type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="Senha da rede (deixe vazio se aberta)" />

          <div className="flex items-center gap-2">
            <Label htmlFor="encryption" className="text-sm whitespace-nowrap">Criptografia:</Label>
            <select id="encryption" value={encryptionInput} onChange={(e) => setEncryptionInput(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
              <option value="WPA">WPA/WPA2</option>
              <option value="WEP">WEP</option>
              <option value="nopass">Sem senha</option>
            </select>
          </div>
        </div>

        <Separator />

        {/* WiFi QR Code Section */}
        <div className="space-y-4 max-w-md">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ImagePlus className="h-4 w-4 text-primary" />
            QR Code de Conexão WiFi
          </div>
          <p className="text-sm text-muted-foreground">
            Gere o QR Code automaticamente com base no nome e senha da rede.
          </p>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={handleGenerateQr} disabled={generatingQr}>
              <RefreshCw className={`h-4 w-4 mr-2 ${generatingQr ? 'animate-spin' : ''}`} />
              {qrImage ? 'Regerar QR Code' : 'Gerar QR Code'}
            </Button>
            {qrImage && (
              <Button type="button" variant="destructive" size="icon" onClick={handleRemoveQrImage}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          {qrImage && (
            <div className="border rounded-md p-2 inline-block">
              <img src={qrImage} alt="QR Code WiFi" className="w-32 h-32 object-contain" />
              <p className="text-xs text-muted-foreground text-center mt-1">Escaneie para conectar</p>
            </div>
          )}
        </div>

        {/* PWA Install */}
        {!isInstalled && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="text-sm font-medium">Instalar Aplicativo</div>
              <Button variant="outline" onClick={handleInstallPwa}>
                <Download className="h-4 w-4 mr-2" />
                Instalar como App
              </Button>
            </div>
          </>
        )}

        <Separator />
        <BalancaConfigSection />
      </CardContent>
    </Card>
  );
}

function BalancaConfigSection() {
  const {
    config, saveConfig, testarConexao, loading, status, tentativa,
    parearNovoDispositivo, listarDispositivosPareados, conectarDispositivo, disconnect,
    serialConfig, updateSerialConfig
  } = useBalanca();

  const [form, setForm] = useState({
    tipo_conexao: config.tipo_conexao || 'serial',
    dispositivo_nome: config.dispositivo_nome || '',
    porta_serial: config.porta_serial || '',
    baud_rate: config.baud_rate || 9600,
    valor_peso: config.valor_peso || 0,
  });
  const [testing, setTesting] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<Array<{ id: string; name: string; device: any }>>([]);
  const [showDevices, setShowDevices] = useState(false);

  useEffect(() => {
    setForm({
      tipo_conexao: config.tipo_conexao || 'serial',
      dispositivo_nome: config.dispositivo_nome || '',
      porta_serial: config.porta_serial || '',
      baud_rate: config.baud_rate || 9600,
      valor_peso: config.valor_peso || 0,
    });
  }, [config]);

  const handleSave = () => {
    saveConfig({
      ...config,
      tipo_conexao: form.tipo_conexao as BalancaConfig['tipo_conexao'],
      dispositivo_nome: form.dispositivo_nome || null,
      porta_serial: form.porta_serial || null,
      baud_rate: form.baud_rate,
      valor_peso: form.valor_peso,
    });
  };

  const handleTest = async () => {
    setTesting(true);

    // If bluetooth, also list paired devices
    if (form.tipo_conexao === 'bluetooth') {
      const devices = await listarDispositivosPareados();
      setPairedDevices(devices);
      if (devices.length > 0) setShowDevices(true);
    }

    await testarConexao();
    setTesting(false);
  };

  const handleParear = async () => {
    setPairing(true);
    await parearNovoDispositivo();
    setPairing(false);
  };

  const handleSelectDevice = async (device: any) => {
    setTesting(true);
    const ok = await conectarDispositivo(device);
    if (ok) {
      toast({ title: 'Conectado', description: `Balança conectada: ${device.name || 'Dispositivo'}` });
      setShowDevices(false);
    } else {
      toast({ title: 'Falha', description: 'Não foi possível conectar ao dispositivo selecionado.', variant: 'destructive' });
    }
    setTesting(false);
  };

  const statusLabel = () => {
    switch (status) {
      case 'conectada': return { text: 'Conectada', variant: 'default' as const };
      case 'conectando': return { text: 'Conectando...', variant: 'secondary' as const };
      case 'tentando': return { text: `Tentando novamente (${tentativa}/3)`, variant: 'secondary' as const };
      case 'falha': return { text: 'Falha na conexão', variant: 'destructive' as const };
      default: return { text: 'Desconectada', variant: 'outline' as const };
    }
  };

  if (loading) return null;

  const sl = statusLabel();

  return (
    <div className="space-y-4 max-w-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Scale className="h-4 w-4 text-primary" />
          Configuração da Balança (Toledo Prix 3)
        </div>
        <Badge variant={sl.variant}>{sl.text}</Badge>
      </div>

      {/* Dispositivo salvo */}
      {config.dispositivo_nome && (
        <div className="p-2 border rounded-md bg-muted/50 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bluetooth className="h-4 w-4 text-primary" />
            <span>{config.dispositivo_nome}</span>
          </div>
          {status === 'conectada' && (
            <Button variant="ghost" size="sm" onClick={disconnect}>Desconectar</Button>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <Label className="text-sm">Tipo de conexão</Label>
          <select value={form.tipo_conexao} onChange={e => setForm(f => ({ ...f, tipo_conexao: e.target.value as any }))} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
            <option value="serial">Serial</option>
            <option value="usb_serial">USB Serial</option>
            <option value="bluetooth">Bluetooth</option>
          </select>
        </div>
        <div>
          <Label className="text-sm">Nome do dispositivo</Label>
          <Input value={form.dispositivo_nome} onChange={e => setForm(f => ({ ...f, dispositivo_nome: e.target.value }))} placeholder="Ex: Toledo Prix 3" />
        </div>
        {(form.tipo_conexao === 'serial' || form.tipo_conexao === 'usb_serial') && (
          <div>
            <Label className="text-sm">Porta serial / COM</Label>
            <Input value={form.porta_serial} onChange={e => setForm(f => ({ ...f, porta_serial: e.target.value }))} placeholder="Ex: COM3" />
          </div>
         )}

        <Separator className="my-2" />
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Settings2 className="h-4 w-4" />
          Configuração Serial
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Baud Rate</Label>
            <Select value={String(serialConfig.baudRate)} onValueChange={v => updateSerialConfig({ baudRate: Number(v) })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[9600, 19200, 38400, 57600, 115200].map(r => (
                  <SelectItem key={r} value={String(r)}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Data Bits</Label>
            <Select value={String(serialConfig.dataBits)} onValueChange={v => updateSerialConfig({ dataBits: Number(v) as 7 | 8 })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7</SelectItem>
                <SelectItem value="8">8</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Stop Bits</Label>
            <Select value={String(serialConfig.stopBits)} onValueChange={v => updateSerialConfig({ stopBits: Number(v) as 1 | 2 })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Paridade</Label>
            <Select value={serialConfig.parity} onValueChange={v => updateSerialConfig({ parity: v as 'none' | 'even' | 'odd' })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="even">Even</SelectItem>
                <SelectItem value="odd">Odd</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={handleSave}><Save className="h-4 w-4 mr-2" />Salvar</Button>
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? (status === 'tentando' ? `Tentando (${tentativa}/3)...` : 'Testando...') : 'Testar balança'}
          </Button>
          {form.tipo_conexao === 'bluetooth' && (
            <Button variant="outline" onClick={handleParear} disabled={pairing}>
              <BluetoothSearching className="h-4 w-4 mr-2" />
              {pairing ? 'Buscando...' : 'Parear novo'}
            </Button>
          )}
        </div>

        {/* Lista de dispositivos BT pareados */}
        {showDevices && pairedDevices.length > 0 && (
          <div className="border rounded-md p-3 space-y-2">
            <p className="text-sm font-medium">Dispositivos Bluetooth pareados:</p>
            {pairedDevices.map((d, i) => (
              <div key={d.id || i} className="flex items-center justify-between p-2 border rounded bg-muted/30">
                <div className="flex items-center gap-2">
                  <Bluetooth className="h-4 w-4 text-primary" />
                  <span className="text-sm">{d.name}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleSelectDevice(d.device)} disabled={testing}>
                  Conectar
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Botão parear novamente após falha */}
        {status === 'falha' && form.tipo_conexao === 'bluetooth' && (
          <div className="p-3 border border-destructive/30 rounded-md bg-destructive/5">
            <p className="text-sm text-destructive mb-2">Não foi possível conectar após 3 tentativas.</p>
            <Button variant="outline" onClick={handleParear} disabled={pairing}>
              <BluetoothSearching className="h-4 w-4 mr-2" />
              {pairing ? 'Buscando...' : 'Parear novamente'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

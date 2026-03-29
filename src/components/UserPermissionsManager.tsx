import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase-external';
import { supabase as cloudSupabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Users, RefreshCw, Plus, Pencil, KeyRound, Trash2, Power, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { formatCPF, cleanCPF, isValidCPF } from '@/lib/cpf-utils';

interface UserWithPermissions {
  user_id: string;
  nome: string;
  email: string;
  cpf: string;
  ativo: boolean;
  acesso_voucher: boolean;
  cadastrar_produto: boolean;
  ficha_consumo: boolean;
  acesso_comanda: boolean;
  acesso_kds: boolean;
  reimpressao_venda: boolean;
  pulseira: boolean;
  is_admin: boolean;
}

type ModalMode = 'create' | 'edit' | 'reset-password' | null;

function getCallerUserId(): string {
  try {
    const raw = localStorage.getItem('app-session');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.user_id) return parsed.user_id;
    }
  } catch { /* ignore */ }
  throw new Error('Sessão expirada. Faça login novamente.');
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null) {
    const maybe = err as Record<string, unknown>;
    if (typeof maybe.message === 'string' && maybe.message) return maybe.message;
    if (typeof maybe.error === 'string' && maybe.error) return maybe.error;
    if (typeof maybe.error_description === 'string' && maybe.error_description) return maybe.error_description;
  }
  return 'Erro desconhecido.';
}

async function invokeEdgeFunction(functionName: string, body: Record<string, unknown>): Promise<any> {
  const callerUserId = getCallerUserId();
  const requestBody = { ...body, caller_user_id: callerUserId };

  // Use external Supabase config to call edge functions on the correct project
  const config = await getSupabaseConfig();
  const url = `${config.url}/functions/v1/${functionName}`;

  console.log(`[invokeEdgeFunction] Calling: ${url}`, { payload: requestBody });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.anonKey}`,
      'apikey': config.anonKey,
    },
    body: JSON.stringify(requestBody),
  });

  const text = await res.text();
  console.log(`[invokeEdgeFunction] Status: ${res.status}, Body: ${text}`);

  let data: any;
  try { data = JSON.parse(text); } catch { data = { error: text }; }

  if (!res.ok) {
    const msg = data?.error || `Erro HTTP ${res.status}: ${text}`;
    throw new Error(msg);
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  return data;
}

export function UserPermissionsManager() {
  const [users, setUsers] = useState<UserWithPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedUser, setSelectedUser] = useState<UserWithPermissions | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form fields
  const [formNome, setFormNome] = useState('');
  const [formCpf, setFormCpf] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formSenha, setFormSenha] = useState('');
  const [formAtivo, setFormAtivo] = useState(true);
  const [formVoucher, setFormVoucher] = useState(false);
  const [formProduto, setFormProduto] = useState(false);
  const [formFicha, setFormFicha] = useState(false);
  const [formComanda, setFormComanda] = useState(false);
  const [formKds, setFormKds] = useState(false);
  const [formReimpressao, setFormReimpressao] = useState(false);
  const [formPulseira, setFormPulseira] = useState(false);
  const [formAdmin, setFormAdmin] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getSupabaseClient();
      const { data, error } = await db
        .from('user_profiles')
        .select(`
          id,
          nome,
          email,
          cpf,
          ativo,
          user_permissions!left(
            user_id,
            is_admin,
            acesso_voucher,
            cadastrar_produto,
            ficha_consumo,
            acesso_comanda,
            acesso_kds,
            reimpressao_venda,
            pulseira
          )
        `)
        .order('nome');

      if (error) throw error;

      const merged: UserWithPermissions[] = (data || []).map((p: any) => {
        const perm = Array.isArray(p.user_permissions) ? p.user_permissions[0] : p.user_permissions;
        return {
          user_id: p.id,
          nome: p.nome || '',
          email: p.email || '',
          cpf: p.cpf ? String(p.cpf) : '',
          ativo: p.ativo ?? true,
          acesso_voucher: perm?.acesso_voucher ?? false,
          cadastrar_produto: perm?.cadastrar_produto ?? false,
          ficha_consumo: perm?.ficha_consumo ?? false,
          acesso_comanda: perm?.acesso_comanda ?? false,
          acesso_kds: perm?.acesso_kds ?? false,
          reimpressao_venda: perm?.reimpressao_venda ?? false,
          pulseira: perm?.pulseira ?? false,
          is_admin: perm?.is_admin ?? false,
        };
      });
      setUsers(merged);
    } catch (err: any) {
      toast({ title: 'Erro', description: extractErrorMessage(err), variant: 'destructive' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const resetForm = () => {
    setFormNome(''); setFormCpf(''); setFormEmail(''); setFormSenha('');
    setFormAtivo(true); setFormVoucher(false); setFormProduto(false);
    setFormFicha(false); setFormComanda(false); setFormKds(false); setFormReimpressao(false); setFormPulseira(false); setFormAdmin(false);
  };

  const openCreate = () => { resetForm(); setSelectedUser(null); setModalMode('create'); };

  const openEdit = (u: UserWithPermissions) => {
    setSelectedUser(u);
    setFormNome(u.nome);
    setFormCpf(formatCPF(u.cpf));
    setFormEmail(u.email);
    setFormAtivo(u.ativo);
    setFormVoucher(u.acesso_voucher);
    setFormProduto(u.cadastrar_produto);
    setFormFicha(u.ficha_consumo);
    setFormComanda(u.acesso_comanda);
    setFormKds(u.acesso_kds);
    setFormReimpressao(u.reimpressao_venda);
    setFormPulseira(u.pulseira);
    setFormAdmin(u.is_admin);
    setModalMode('edit');
  };

  const openResetPassword = (u: UserWithPermissions) => {
    setSelectedUser(u); setFormSenha(''); setModalMode('reset-password');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (modalMode === 'create') {
        if (!formEmail || !formSenha || !formNome || !cleanCPF(formCpf)) {
          toast({ title: 'Erro', description: 'Preencha nome, CPF, email e senha.', variant: 'destructive' });
          setSaving(false); return;
        }
        const cpfClean = cleanCPF(formCpf);
        if (!isValidCPF(cpfClean)) {
          toast({ title: 'CPF inválido', description: 'Verifique o CPF informado.', variant: 'destructive' });
          setSaving(false); return;
        }
        if (formSenha.length < 6) {
          toast({ title: 'Erro', description: 'Senha deve ter pelo menos 6 caracteres.', variant: 'destructive' });
          setSaving(false); return;
        }

        await invokeEdgeFunction('manage-users', {
          action: 'create-user',
          email: formEmail,
          password: formSenha,
          profile: {
            nome: formNome,
            cpf: cpfClean,
            ativo: formAtivo,
          },
          permissions: {
            acesso_voucher: formVoucher,
            cadastrar_produto: formProduto,
            ficha_consumo: formFicha,
            acesso_comanda: formComanda,
            acesso_kds: formKds,
            reimpressao_venda: formReimpressao,
            pulseira: formPulseira,
            is_admin: formAdmin,
          },
        });
        toast({ title: 'Usuário salvo com sucesso.' });

      } else if (modalMode === 'edit' && selectedUser) {
        const cpfClean = cleanCPF(formCpf);

        await invokeEdgeFunction('manage-users', {
          action: 'update-user',
          user_id: selectedUser.user_id,
          profile: { nome: formNome, email: formEmail, cpf: cpfClean, ativo: formAtivo },
          permissions: {
            acesso_voucher: formVoucher,
            cadastrar_produto: formProduto,
            ficha_consumo: formFicha,
            acesso_comanda: formComanda,
            acesso_kds: formKds,
            reimpressao_venda: formReimpressao,
            pulseira: formPulseira,
            is_admin: formAdmin,
          },
        });
        toast({ title: 'Usuário salvo com sucesso.' });

      } else if (modalMode === 'reset-password' && selectedUser) {
        if (!formSenha || formSenha.length < 6) {
          toast({ title: 'Erro', description: 'Senha deve ter pelo menos 6 caracteres.', variant: 'destructive' });
          setSaving(false); return;
        }
        await invokeEdgeFunction('manage-users', {
          action: 'reset-password',
          user_id: selectedUser.user_id,
          new_password: formSenha,
        });
        toast({ title: 'Senha redefinida com sucesso!' });
      }

      setModalMode(null);
      await fetchUsers();
    } catch (err: any) {
      console.error('Erro ao salvar usuário:', err);
      toast({ title: 'Erro', description: extractErrorMessage(err), variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setSaving(true);
    try {
      await invokeEdgeFunction('manage-users', { action: 'delete-user', user_id: deleteConfirm });
      toast({ title: 'Usuário excluído!' });
      await fetchUsers();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
    setDeleteConfirm(null);
    setSaving(false);
  };

  const toggleAtivo = async (u: UserWithPermissions) => {
    try {
      await invokeEdgeFunction('manage-users', { action: 'toggle-ativo', user_id: u.user_id, ativo: !u.ativo });
      toast({ title: u.ativo ? 'Usuário desativado' : 'Usuário ativado' });
      await fetchUsers();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  // Filter users by search
  const filteredUsers = users.filter(u => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      u.nome.toLowerCase().includes(s) ||
      u.cpf.includes(s.replace(/\D/g, '')) ||
      u.email.toLowerCase().includes(s)
    );
  });

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Gestão de Usuários
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchUsers}>
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Novo Usuário
            </Button>
          </div>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, CPF ou email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        {filteredUsers.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            {search ? 'Nenhum usuário encontrado.' : 'Nenhum usuário cadastrado.'}
          </p>
        ) : (
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>CPF</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>Permissões</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map(u => (
                  <TableRow key={u.user_id} className={!u.ativo ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{u.nome || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.cpf ? formatCPF(u.cpf) : '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={u.ativo ? 'default' : 'secondary'} className="cursor-pointer" onClick={() => toggleAtivo(u)}>
                        {u.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.is_admin && <Badge variant="destructive" className="text-xs">Admin</Badge>}
                        {u.acesso_voucher && <Badge variant="outline" className="text-xs">Voucher</Badge>}
                        {u.cadastrar_produto && <Badge variant="outline" className="text-xs">Produtos</Badge>}
                        {u.ficha_consumo && <Badge variant="outline" className="text-xs">Fichas</Badge>}
                        {u.acesso_comanda && <Badge variant="outline" className="text-xs">Comanda</Badge>}
                        {u.acesso_kds && <Badge variant="outline" className="text-xs">KDS</Badge>}
                        {u.reimpressao_venda && <Badge variant="outline" className="text-xs">Reimpressão</Badge>}
                        {u.pulseira && <Badge variant="outline" className="text-xs">Pulseira</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(u)} title="Editar">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openResetPassword(u)} title="Redefinir Senha">
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleAtivo(u)} title={u.ativo ? 'Desativar' : 'Ativar'}>
                          <Power className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteConfirm(u.user_id)} title="Excluir">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Modal: Create / Edit / Reset Password */}
      <Dialog open={!!modalMode} onOpenChange={(open) => !open && setModalMode(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {modalMode === 'create' ? 'Novo Usuário' : modalMode === 'edit' ? 'Editar Usuário' : 'Redefinir Senha'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {modalMode === 'reset-password' ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Definir nova senha para <strong>{selectedUser?.nome || selectedUser?.email}</strong>
                </p>
                <div className="space-y-2">
                  <Label>Nova Senha</Label>
                  <Input type="password" value={formSenha} onChange={(e) => setFormSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Nome *</Label>
                  <Input value={formNome} onChange={(e) => setFormNome(e.target.value)} placeholder="Nome completo" />
                </div>
                <div className="space-y-2">
                  <Label>CPF * <span className="text-xs text-muted-foreground">(usado para login)</span></Label>
                  <Input
                    inputMode="numeric"
                    value={formCpf}
                    onChange={(e) => setFormCpf(formatCPF(e.target.value))}
                    placeholder="000.000.000-00"
                    maxLength={14}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email * <span className="text-xs text-muted-foreground">(para recuperação de senha)</span></Label>
                  <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="email@exemplo.com" />
                </div>
                {modalMode === 'create' && (
                  <div className="space-y-2">
                    <Label>Senha *</Label>
                    <Input type="password" value={formSenha} onChange={(e) => setFormSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label>Ativo</Label>
                  <Switch checked={formAtivo} onCheckedChange={setFormAtivo} />
                </div>
                <div className="border rounded-lg p-3 space-y-3">
                  <Label className="text-sm font-semibold">Permissões</Label>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Acesso Voucher</Label>
                    <Switch checked={formVoucher} onCheckedChange={setFormVoucher} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Cadastrar Produto</Label>
                    <Switch checked={formProduto} onCheckedChange={setFormProduto} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Ficha de Consumo</Label>
                    <Switch checked={formFicha} onCheckedChange={setFormFicha} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Acesso Comanda</Label>
                    <Switch checked={formComanda} onCheckedChange={setFormComanda} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Acesso KDS (Cozinha)</Label>
                    <Switch checked={formKds} onCheckedChange={setFormKds} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Reimpressão de Venda</Label>
                    <Switch checked={formReimpressao} onCheckedChange={setFormReimpressao} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Pulseira</Label>
                    <Switch checked={formPulseira} onCheckedChange={setFormPulseira} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold text-destructive">Administrador</Label>
                    <Switch checked={formAdmin} onCheckedChange={setFormAdmin} />
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalMode(null)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title="Excluir usuário"
        description="Tem certeza que deseja excluir este usuário? Esta ação não pode ser desfeita."
        onConfirm={handleDelete}
      />
    </Card>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient, getSupabaseConfig } from '@/lib/supabase-external';
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

/* ── Types ── */

interface UserRow {
  user_id: string;
  nome: string;
  email: string;
  cpf: string;
  ativo: boolean;
  login_count: number | null;
  last_login_at: string | null;
  // permissions (standardized names)
  is_admin: boolean;
  acesso_voucher: boolean;
  acesso_cadastrar_produto: boolean;
  acesso_ficha_consumo: boolean;
  acesso_comanda: boolean;
  acesso_kds: boolean;
  reimpressao_venda: boolean;
  acesso_pulseira: boolean;
  voucher_todos: boolean;
  voucher_tempo_id: string | null;
  voucher_tempo_acesso: string | null;
}

type ModalMode = 'create' | 'edit' | 'reset-password' | null;

/* ── Helpers ── */

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

function extractError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const m = err as Record<string, unknown>;
    if (typeof m.message === 'string') return m.message;
    if (typeof m.error === 'string') return m.error;
  }
  return 'Erro desconhecido.';
}

async function invokeEdgeFunction(functionName: string, body: Record<string, unknown>): Promise<any> {
  const callerUserId = getCallerUserId();
  const payload = { ...body, caller_user_id: callerUserId };
  const config = await getSupabaseConfig();
  const url = `${config.url}/functions/v1/${functionName}`;

  console.log(`[EdgeFunction] POST ${url}`, payload);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.anonKey}`,
      'apikey': config.anonKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log(`[EdgeFunction] ${functionName} → ${res.status}`, text);

  let data: any;
  try { data = JSON.parse(text); } catch { data = { error: text }; }

  if (!res.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${res.status}: ${text}`);
  }
  return data;
}

/* ── Component ── */

export function UserPermissionsManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [fNome, setFNome] = useState('');
  const [fCpf, setFCpf] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fSenha, setFSenha] = useState('');
  const [fAtivo, setFAtivo] = useState(true);
  const [fAdmin, setFAdmin] = useState(false);
  const [fVoucher, setFVoucher] = useState(false);
  const [fCadProduto, setFCadProduto] = useState(false);
  const [fFicha, setFFicha] = useState(false);
  const [fComanda, setFComanda] = useState(false);
  const [fKds, setFKds] = useState(false);
  const [fReimpressao, setFReimpressao] = useState(false);
  const [fPulseira, setFPulseira] = useState(false);
  const [fVoucherTodos, setFVoucherTodos] = useState(false);
  const [fVoucherTempoId, setFVoucherTempoId] = useState('');
  const [fVoucherTempoAcesso, setFVoucherTempoAcesso] = useState('');

  /* ── Fetch users ── */
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getSupabaseClient();
      const { data, error } = await db
        .from('user_profiles')
        .select(`
          id, nome, email, cpf, ativo, login_count, last_login_at,
          user_permissions!left(
            user_id, is_admin, acesso_voucher, acesso_cadastrar_produto,
            acesso_ficha_consumo, acesso_comanda, acesso_kds,
            reimpressao_venda, acesso_pulseira, voucher_todos,
            voucher_tempo_id, voucher_tempo_acesso
          )
        `)
        .order('nome');

      if (error) throw error;

      const rows: UserRow[] = (data || []).map((p: any) => {
        const perm = Array.isArray(p.user_permissions)
          ? p.user_permissions[0]
          : p.user_permissions;
        return {
          user_id: p.id,
          nome: p.nome || '',
          email: p.email || '',
          cpf: p.cpf ? String(p.cpf) : '',
          ativo: p.ativo ?? true,
          login_count: p.login_count ?? null,
          last_login_at: p.last_login_at ?? null,
          is_admin: perm?.is_admin ?? false,
          acesso_voucher: perm?.acesso_voucher ?? false,
          acesso_cadastrar_produto: perm?.acesso_cadastrar_produto ?? false,
          acesso_ficha_consumo: perm?.acesso_ficha_consumo ?? false,
          acesso_comanda: perm?.acesso_comanda ?? false,
          acesso_kds: perm?.acesso_kds ?? false,
          reimpressao_venda: perm?.reimpressao_venda ?? false,
          acesso_pulseira: perm?.acesso_pulseira ?? false,
          voucher_todos: perm?.voucher_todos ?? false,
          voucher_tempo_id: perm?.voucher_tempo_id ?? null,
          voucher_tempo_acesso: perm?.voucher_tempo_acesso ?? null,
        };
      });
      setUsers(rows);
    } catch (err) {
      console.error('[fetchUsers]', err);
      toast({ title: 'Erro', description: extractError(err), variant: 'destructive' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  /* ── Form helpers ── */
  const resetForm = () => {
    setFNome(''); setFCpf(''); setFEmail(''); setFSenha('');
    setFAtivo(true); setFAdmin(false); setFVoucher(false);
    setFCadProduto(false); setFFicha(false); setFComanda(false);
    setFKds(false); setFReimpressao(false); setFPulseira(false);
    setFVoucherTodos(false); setFVoucherTempoId(''); setFVoucherTempoAcesso('');
  };

  const openCreate = () => { resetForm(); setSelectedUser(null); setModalMode('create'); };

  const openEdit = (u: UserRow) => {
    setSelectedUser(u);
    setFNome(u.nome);
    setFCpf(formatCPF(u.cpf));
    setFEmail(u.email);
    setFAtivo(u.ativo);
    setFAdmin(u.is_admin);
    setFVoucher(u.acesso_voucher);
    setFCadProduto(u.acesso_cadastrar_produto);
    setFFicha(u.acesso_ficha_consumo);
    setFComanda(u.acesso_comanda);
    setFKds(u.acesso_kds);
    setFReimpressao(u.reimpressao_venda);
    setFPulseira(u.acesso_pulseira);
    setFVoucherTodos(u.voucher_todos);
    setFVoucherTempoId(u.voucher_tempo_id || '');
    setFVoucherTempoAcesso(u.voucher_tempo_acesso || '');
    setModalMode('edit');
  };

  const openResetPassword = (u: UserRow) => {
    setSelectedUser(u); setFSenha(''); setModalMode('reset-password');
  };

  /* ── Build permissions payload ── */
  const buildPermissions = () => ({
    is_admin: fAdmin,
    acesso_voucher: fVoucher,
    acesso_cadastrar_produto: fCadProduto,
    acesso_ficha_consumo: fFicha,
    acesso_comanda: fComanda,
    acesso_kds: fKds,
    reimpressao_venda: fReimpressao,
    acesso_pulseira: fPulseira,
    voucher_todos: fVoucher ? fVoucherTodos : false,
    voucher_tempo_id: fVoucher && !fVoucherTodos ? (fVoucherTempoId || null) : null,
    voucher_tempo_acesso: fVoucher ? (fVoucherTempoAcesso || null) : null,
  });

  /* ── Save ── */
  const handleSave = async () => {
    setSaving(true);
    try {
      if (modalMode === 'create') {
        const cpfClean = cleanCPF(fCpf);
        if (!fNome || !cpfClean || !fEmail || !fSenha) {
          toast({ title: 'Erro', description: 'Preencha nome, CPF, email e senha.', variant: 'destructive' });
          setSaving(false); return;
        }
        if (!isValidCPF(cpfClean)) {
          toast({ title: 'CPF inválido', description: 'Verifique o CPF informado.', variant: 'destructive' });
          setSaving(false); return;
        }
        if (fSenha.length < 6) {
          toast({ title: 'Erro', description: 'Senha deve ter pelo menos 6 caracteres.', variant: 'destructive' });
          setSaving(false); return;
        }

        await invokeEdgeFunction('manage-users', {
          action: 'create-user',
          email: fEmail,
          password: fSenha,
          profile: { nome: fNome, cpf: cpfClean, ativo: fAtivo },
          permissions: buildPermissions(),
        });
        toast({ title: 'Usuário criado com sucesso!' });

      } else if (modalMode === 'edit' && selectedUser) {
        const cpfClean = cleanCPF(fCpf);
        await invokeEdgeFunction('manage-users', {
          action: 'update-user',
          user_id: selectedUser.user_id,
          profile: { nome: fNome, email: fEmail, cpf: cpfClean, ativo: fAtivo },
          permissions: buildPermissions(),
        });
        toast({ title: 'Usuário atualizado com sucesso!' });

      } else if (modalMode === 'reset-password' && selectedUser) {
        if (!fSenha || fSenha.length < 6) {
          toast({ title: 'Erro', description: 'Senha deve ter pelo menos 6 caracteres.', variant: 'destructive' });
          setSaving(false); return;
        }
        await invokeEdgeFunction('manage-users', {
          action: 'reset-password',
          user_id: selectedUser.user_id,
          new_password: fSenha,
        });
        toast({ title: 'Senha redefinida com sucesso!' });
      }

      setModalMode(null);
      await fetchUsers();
    } catch (err) {
      console.error('[handleSave]', err);
      toast({ title: 'Erro ao salvar', description: extractError(err), variant: 'destructive' });
    }
    setSaving(false);
  };

  /* ── Delete ── */
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setSaving(true);
    try {
      await invokeEdgeFunction('manage-users', { action: 'delete-user', user_id: deleteConfirm });
      toast({ title: 'Usuário excluído!' });
      await fetchUsers();
    } catch (err) {
      toast({ title: 'Erro', description: extractError(err), variant: 'destructive' });
    }
    setDeleteConfirm(null);
    setSaving(false);
  };

  /* ── Toggle ativo ── */
  const toggleAtivo = async (u: UserRow) => {
    try {
      await invokeEdgeFunction('manage-users', { action: 'toggle-ativo', user_id: u.user_id, ativo: !u.ativo });
      toast({ title: u.ativo ? 'Usuário desativado' : 'Usuário ativado' });
      await fetchUsers();
    } catch (err) {
      toast({ title: 'Erro', description: extractError(err), variant: 'destructive' });
    }
  };

  /* ── Filter ── */
  const filtered = users.filter(u => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return u.nome.toLowerCase().includes(s) || u.cpf.includes(s.replace(/\D/g, '')) || u.email.toLowerCase().includes(s);
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
          <Input className="pl-9" placeholder="Buscar por nome, CPF ou email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </CardHeader>

      <CardContent>
        {filtered.length === 0 ? (
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
                  <TableHead className="text-center">Logins</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(u => (
                  <TableRow key={u.user_id} className={!u.ativo ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{u.nome || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.cpf ? formatCPF(u.cpf) : '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.email || '—'}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={u.ativo ? 'default' : 'secondary'} className="cursor-pointer" onClick={() => toggleAtivo(u)}>
                        {u.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.is_admin && <Badge variant="destructive" className="text-xs">Admin</Badge>}
                        {u.acesso_voucher && <Badge variant="outline" className="text-xs">Voucher</Badge>}
                        {u.acesso_cadastrar_produto && <Badge variant="outline" className="text-xs">Produtos</Badge>}
                        {u.acesso_ficha_consumo && <Badge variant="outline" className="text-xs">Fichas</Badge>}
                        {u.acesso_comanda && <Badge variant="outline" className="text-xs">Comanda</Badge>}
                        {u.acesso_kds && <Badge variant="outline" className="text-xs">KDS</Badge>}
                        {u.reimpressao_venda && <Badge variant="outline" className="text-xs">Reimpressão</Badge>}
                        {u.acesso_pulseira && <Badge variant="outline" className="text-xs">Pulseira</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-xs text-muted-foreground">
                      {u.login_count ?? 0}
                      {u.last_login_at && (
                        <div className="text-[10px]">{new Date(u.last_login_at).toLocaleDateString('pt-BR')}</div>
                      )}
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

      {/* Modal */}
      <Dialog open={!!modalMode} onOpenChange={open => !open && setModalMode(null)}>
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
                  Nova senha para <strong>{selectedUser?.nome || selectedUser?.email}</strong>
                </p>
                <div className="space-y-2">
                  <Label>Nova Senha</Label>
                  <Input type="password" value={fSenha} onChange={e => setFSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
                </div>
              </>
            ) : (
              <>
                {/* Profile fields */}
                <div className="space-y-2">
                  <Label>Nome *</Label>
                  <Input value={fNome} onChange={e => setFNome(e.target.value)} placeholder="Nome completo" />
                </div>
                <div className="space-y-2">
                  <Label>CPF * <span className="text-xs text-muted-foreground">(usado para login)</span></Label>
                  <Input inputMode="numeric" value={fCpf} onChange={e => setFCpf(formatCPF(e.target.value))} placeholder="000.000.000-00" maxLength={14} />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="email@exemplo.com" />
                </div>
                {modalMode === 'create' && (
                  <div className="space-y-2">
                    <Label>Senha *</Label>
                    <Input type="password" value={fSenha} onChange={e => setFSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label>Ativo</Label>
                  <Switch checked={fAtivo} onCheckedChange={setFAtivo} />
                </div>

                {/* Permissions */}
                <div className="border rounded-lg p-3 space-y-3">
                  <Label className="text-sm font-semibold">Permissões</Label>

                  <PermToggle label="Acesso Voucher" checked={fVoucher} onChange={setFVoucher} />

                  {/* Voucher sub-options */}
                  {fVoucher && (
                    <div className="ml-4 border-l-2 border-muted pl-3 space-y-3">
                      <PermToggle label="Todos os vouchers" checked={fVoucherTodos} onChange={setFVoucherTodos} />
                      {!fVoucherTodos && (
                        <div className="space-y-2">
                          <Label className="text-sm">Voucher Tempo ID</Label>
                          <Input value={fVoucherTempoId} onChange={e => setFVoucherTempoId(e.target.value)} placeholder="ID do tempo" />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label className="text-sm">Voucher Tempo Acesso</Label>
                        <Input value={fVoucherTempoAcesso} onChange={e => setFVoucherTempoAcesso(e.target.value)} placeholder="Tempo de acesso" />
                      </div>
                    </div>
                  )}

                  <PermToggle label="Cadastrar Produto" checked={fCadProduto} onChange={setFCadProduto} />
                  <PermToggle label="Ficha de Consumo" checked={fFicha} onChange={setFFicha} />
                  <PermToggle label="Acesso Comanda" checked={fComanda} onChange={setFComanda} />
                  <PermToggle label="Acesso KDS (Cozinha)" checked={fKds} onChange={setFKds} />
                  <PermToggle label="Reimpressão de Venda" checked={fReimpressao} onChange={setFReimpressao} />
                  <PermToggle label="Pulseira" checked={fPulseira} onChange={setFPulseira} />

                  <div className="pt-2 border-t">
                    <PermToggle label="Administrador" checked={fAdmin} onChange={setFAdmin} destructive />
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
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Excluir usuário"
        description="Tem certeza que deseja excluir este usuário? Esta ação não pode ser desfeita."
        onConfirm={handleDelete}
      />
    </Card>
  );
}

/* ── Small helper component ── */
function PermToggle({ label, checked, onChange, destructive }: { label: string; checked: boolean; onChange: (v: boolean) => void; destructive?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <Label className={`text-sm ${destructive ? 'font-semibold text-destructive' : ''}`}>{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

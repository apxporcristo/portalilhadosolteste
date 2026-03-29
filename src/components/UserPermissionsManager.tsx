import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase-external';
import { supabase as cloudSupabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Users, RefreshCw, Plus, Pencil, KeyRound, Trash2, Power, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { formatCPF, cleanCPF, isValidCPF } from '@/lib/cpf-utils';
import { hashPassword } from '@/lib/password-utils';

interface UserWithPermissions {
  user_id: string;
  nome: string;
  email: string;
  cpf: string;
  ativo: boolean;
  acesso_voucher: boolean;
  acesso_cadastrar_produto: boolean;
  acesso_ficha_consumo: boolean;
  acesso_comanda: boolean;
  acesso_kds: boolean;
  reimpressao_venda: boolean;
  pulseira: boolean;
  is_admin: boolean;
  voucher_tempo_acesso: string | null;
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

async function createUserDirect(body: Record<string, unknown>) {
  const db = await getSupabaseClient();
  const profile = typeof body.profile === 'object' && body.profile !== null ? body.profile as Record<string, unknown> : {};
  const permissions = typeof body.permissions === 'object' && body.permissions !== null ? body.permissions as Record<string, unknown> : {};

  const nome = String(profile.nome ?? body.nome ?? '').trim();
  const email = String(profile.email ?? body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const cpfRaw = String(profile.cpf ?? body.cpf ?? '');
  const ativo = profile.ativo !== undefined ? !!profile.ativo : true;
  const cpfClean = cleanCPF(cpfRaw);

  const acessoVoucher = !!(permissions.acesso_voucher ?? body.acesso_voucher);
  const acessoCadastrarProduto = !!(permissions.acesso_cadastrar_produto ?? body.acesso_cadastrar_produto ?? body.cadastrar_produto);
  const acessoFichaConsumo = !!(permissions.acesso_ficha_consumo ?? body.acesso_ficha_consumo ?? body.ficha_consumo);
  const acessoComanda = !!(permissions.acesso_comanda ?? body.acesso_comanda);
  const acessoKds = !!(permissions.acesso_kds ?? body.acesso_kds);
  const reimpressaoVenda = !!(permissions.reimpressao_venda ?? body.reimpressao_venda);
  const pulseira = !!(permissions.pulseira ?? permissions.acesso_pulseira ?? body.pulseira ?? body.acesso_pulseira);
  const isAdmin = !!(permissions.is_admin ?? body.is_admin ?? body.administrador);
  const voucherTempoAcesso = permissions.voucher_tempo_acesso ?? body.voucher_tempo_acesso ?? body.tempo_voucher;

  if (!nome || !email || !password || !cpfClean) throw new Error('Campos obrigatórios: nome, email, senha e cpf.');
  if (password.length < 6) throw new Error('Senha deve ter pelo menos 6 caracteres.');

  const { data: existingCpf } = await db.from('user_profiles').select('id').eq('cpf', cpfClean).maybeSingle();
  if (existingCpf) throw new Error('CPF já cadastrado.');

  const senhaHash = await hashPassword(password, cpfClean);
  const userId = crypto.randomUUID();

  const { error: profErr } = await db.from('user_profiles').insert({
    id: userId,
    nome,
    email,
    cpf: cpfClean,
    senha_hash: senhaHash,
    ativo,
  } as any);
  if (profErr) throw new Error(`Erro perfil: ${profErr.message}`);

  const { error: permErr } = await db.from('user_permissions').insert({
    user_id: userId,
    acesso_voucher: acessoVoucher,
    acesso_cadastrar_produto: acessoCadastrarProduto,
    acesso_ficha_consumo: acessoFichaConsumo,
    acesso_comanda: acessoComanda,
    acesso_kds: acessoKds,
    reimpressao_venda: reimpressaoVenda,
    pulseira,
    is_admin: isAdmin,
    voucher_tempo_acesso: typeof voucherTempoAcesso === 'string' && voucherTempoAcesso !== 'Todos' && voucherTempoAcesso.trim()
      ? voucherTempoAcesso.trim()
      : null,
  } as any);
  if (permErr) {
    await db.from('user_profiles').delete().eq('id', userId);
    throw new Error(`Erro permissões: ${permErr.message}`);
  }

  return { success: true, user_id: userId };
}

async function invokeManageUsersDirect(body: Record<string, unknown>) {
  const db = await getSupabaseClient();
  const action = typeof body.action === 'string' ? body.action : null;
  const userId = typeof body.user_id === 'string' ? body.user_id : null;

  if (!action) throw new Error('Ação inválida.');

  if (action === 'create-user') {
    return createUserDirect(body);
  }

  if (!userId) throw new Error('user_id é obrigatório.');

  if (action === 'update-user') {
    const profile = typeof body.profile === 'object' && body.profile !== null ? body.profile as Record<string, unknown> : {};
    const permissions = typeof body.permissions === 'object' && body.permissions !== null ? body.permissions as Record<string, unknown> : {};

    const profileUpdate: Record<string, unknown> = {};
    if (profile.nome !== undefined) profileUpdate.nome = String(profile.nome ?? '').trim();
    if (profile.email !== undefined) profileUpdate.email = String(profile.email ?? '').trim().toLowerCase();
    if (profile.cpf !== undefined) profileUpdate.cpf = cleanCPF(String(profile.cpf ?? ''));
    if (profile.ativo !== undefined) profileUpdate.ativo = !!profile.ativo;

    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await db.from('user_profiles').update(profileUpdate as any).eq('id', userId);
      if (error) throw new Error(`Erro perfil: ${error.message}`);
    }

    const permUpdate: Record<string, unknown> = {};
    if (permissions.acesso_voucher !== undefined) permUpdate.acesso_voucher = !!permissions.acesso_voucher;
    if (permissions.acesso_cadastrar_produto !== undefined) permUpdate.acesso_cadastrar_produto = !!permissions.acesso_cadastrar_produto;
    if (permissions.acesso_ficha_consumo !== undefined) permUpdate.acesso_ficha_consumo = !!permissions.acesso_ficha_consumo;
    if (permissions.acesso_comanda !== undefined) permUpdate.acesso_comanda = !!permissions.acesso_comanda;
    if (permissions.acesso_kds !== undefined) permUpdate.acesso_kds = !!permissions.acesso_kds;
    if (permissions.reimpressao_venda !== undefined) permUpdate.reimpressao_venda = !!permissions.reimpressao_venda;
    if (permissions.pulseira !== undefined) permUpdate.pulseira = !!permissions.pulseira;
    if (permissions.is_admin !== undefined) permUpdate.is_admin = !!permissions.is_admin;
    if (permissions.voucher_tempo_acesso !== undefined) {
      const value = permissions.voucher_tempo_acesso;
      permUpdate.voucher_tempo_acesso = typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    if (Object.keys(permUpdate).length > 0) {
      const { error } = await db
        .from('user_permissions')
        .upsert({ user_id: userId, ...permUpdate } as any, { onConflict: 'user_id' });
      if (error) throw new Error(`Erro permissões: ${error.message}`);
    }

    return { success: true };
  }

  if (action === 'reset-password') {
    const newPassword = typeof body.new_password === 'string' ? body.new_password : '';
    if (newPassword.length < 6) throw new Error('Senha deve ter pelo menos 6 caracteres.');

    const { data: userProfile, error: profileError } = await db
      .from('user_profiles')
      .select('cpf')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);
    if (!userProfile?.cpf) throw new Error('Usuário sem CPF cadastrado.');

    const senhaHash = await hashPassword(newPassword, String(userProfile.cpf));
    const { error } = await db
      .from('user_profiles')
      .update({ senha_hash: senhaHash } as any)
      .eq('id', userId);

    if (error) throw new Error(error.message);
    return { success: true };
  }

  if (action === 'delete-user') {
    const [permRes, profRes] = await Promise.all([
      db.from('user_permissions').delete().eq('user_id', userId),
      db.from('user_profiles').delete().eq('id', userId),
    ]);

    if (permRes.error) throw new Error(permRes.error.message);
    if (profRes.error) throw new Error(profRes.error.message);
    return { success: true };
  }

  if (action === 'toggle-ativo') {
    const { error } = await db
      .from('user_profiles')
      .update({ ativo: !!body.ativo } as any)
      .eq('id', userId);

    if (error) throw new Error(error.message);
    return { success: true };
  }

  throw new Error(`Ação desconhecida: ${action}`);
}

async function invokeEdgeFunction(functionName: string, body: Record<string, unknown>): Promise<any> {
  const callerUserId = getCallerUserId();
  const requestBody = { ...body, caller_user_id: callerUserId };

  try {
    const { data, error } = await cloudSupabase.functions.invoke(functionName, {
      body: requestBody,
    });

    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed') || msg.includes('non-2xx')) {
        if (functionName === 'manage-users') return invokeManageUsersDirect(requestBody);
        if (functionName === 'create-user-admin') return createUserDirect(requestBody);
      }
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    if (functionName === 'manage-users' && data?.success !== true) {
      return invokeManageUsersDirect(requestBody);
    }
    if (functionName === 'create-user-admin' && data?.success !== true) {
      return createUserDirect(requestBody);
    }

    return data;

  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
      if (functionName === 'manage-users') return invokeManageUsersDirect(requestBody);
      if (functionName === 'create-user-admin') return createUserDirect(requestBody);
    }
    throw err;
  }
}

export function UserPermissionsManager() {
  const [users, setUsers] = useState<UserWithPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedUser, setSelectedUser] = useState<UserWithPermissions | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [temposDisponiveis, setTemposDisponiveis] = useState<string[]>([]);

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
  const [formVoucherTempo, setFormVoucherTempo] = useState<string>('todos');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getSupabaseClient();
      const [profilesRes, permsRes] = await Promise.all([
        db.from('user_profiles').select('*').order('nome'),
        db.from('user_permissions').select('*'),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (permsRes.error) throw permsRes.error;

      const profiles = profilesRes.data || [];
      const perms = permsRes.data || [];

      const merged: UserWithPermissions[] = profiles.map((p: any) => {
        const uid = p.user_id || p.id;
        const perm = perms.find((pm: any) => pm.user_id === uid);
        return {
          user_id: uid,
          nome: p.nome || '',
          email: p.email || '',
          cpf: p.cpf ? String(p.cpf) : '',
          ativo: p.ativo ?? true,
          acesso_voucher: perm?.acesso_voucher ?? false,
          acesso_cadastrar_produto: perm?.acesso_cadastrar_produto ?? false,
          acesso_ficha_consumo: perm?.acesso_ficha_consumo ?? false,
          acesso_comanda: perm?.acesso_comanda ?? false,
          acesso_kds: perm?.acesso_kds ?? false,
          reimpressao_venda: (perm as any)?.reimpressao_venda ?? false,
          pulseira: (perm as any)?.pulseira ?? false,
          is_admin: perm?.is_admin ?? false,
          voucher_tempo_acesso: perm?.voucher_tempo_acesso ?? null,
        };
      });
      setUsers(merged);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message || 'Não foi possível carregar usuários.', variant: 'destructive' });
    }
    setLoading(false);
  }, []);

  const fetchTempos = useCallback(async () => {
    try {
      const db = await getSupabaseClient();
      const { data, error } = await db.from('vouchers').select('tempo_validade');
      if (error) throw error;
      const temposSet = new Set<string>();
      (data || []).forEach((v: any) => { if (v.tempo_validade) temposSet.add(v.tempo_validade); });
      setTemposDisponiveis(Array.from(temposSet).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0)));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchUsers(); fetchTempos(); }, [fetchUsers, fetchTempos]);

  const resetForm = () => {
    setFormNome(''); setFormCpf(''); setFormEmail(''); setFormSenha('');
    setFormAtivo(true); setFormVoucher(false); setFormProduto(false);
    setFormFicha(false); setFormComanda(false); setFormKds(false); setFormReimpressao(false); setFormPulseira(false); setFormAdmin(false);
    setFormVoucherTempo('todos');
  };

  const openCreate = () => { resetForm(); setSelectedUser(null); setModalMode('create'); };

  const openEdit = (u: UserWithPermissions) => {
    setSelectedUser(u);
    setFormNome(u.nome);
    setFormCpf(formatCPF(u.cpf));
    setFormEmail(u.email);
    setFormAtivo(u.ativo);
    setFormVoucher(u.acesso_voucher);
    setFormProduto(u.acesso_cadastrar_produto);
    setFormFicha(u.acesso_ficha_consumo);
    setFormComanda(u.acesso_comanda);
    setFormKds(u.acesso_kds);
    setFormReimpressao(u.reimpressao_venda);
    setFormPulseira(u.pulseira);
    setFormAdmin(u.is_admin);
    setFormVoucherTempo(u.voucher_tempo_acesso || 'todos');
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
            acesso_cadastrar_produto: formProduto,
            acesso_ficha_consumo: formFicha,
            acesso_comanda: formComanda,
            acesso_kds: formKds,
            reimpressao_venda: formReimpressao,
            pulseira: formPulseira,
            acesso_pulseira: formPulseira,
            is_admin: formAdmin,
            voucher_tempo_acesso: formVoucher && formVoucherTempo !== 'todos' ? formVoucherTempo : null,
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
            acesso_cadastrar_produto: formProduto,
            acesso_ficha_consumo: formFicha,
            acesso_comanda: formComanda,
            acesso_kds: formKds,
            reimpressao_venda: formReimpressao,
            pulseira: formPulseira,
            is_admin: formAdmin,
            voucher_tempo_acesso: formVoucher && formVoucherTempo !== 'todos' ? formVoucherTempo : null,
          },
          new_email: formEmail !== selectedUser.email ? formEmail : undefined,
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
      toast({ title: 'Erro', description: 'Não foi possível salvar o usuário.', variant: 'destructive' });
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
                        {u.acesso_cadastrar_produto && <Badge variant="outline" className="text-xs">Produtos</Badge>}
                        {u.acesso_ficha_consumo && <Badge variant="outline" className="text-xs">Fichas</Badge>}
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
                    <Switch checked={formVoucher} onCheckedChange={(checked) => {
                      setFormVoucher(checked);
                      if (!checked) setFormVoucherTempo('todos');
                    }} />
                  </div>
                  {formVoucher && (
                    <div className="ml-4 space-y-1">
                      <Label className="text-xs text-muted-foreground">Tempo de voucher</Label>
                      <Select value={formVoucherTempo} onValueChange={setFormVoucherTempo}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Selecione o tempo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos">Todos</SelectItem>
                          {temposDisponiveis.map(t => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
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

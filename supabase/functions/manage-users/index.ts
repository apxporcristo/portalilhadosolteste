import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Configuração ausente: ${name}`);
  return value;
}

function requireEnvFallback(primary: string, fallback: string): string {
  const value = Deno.env.get(primary) || Deno.env.get(fallback);
  if (!value) throw new Error(`Configuração ausente: ${primary} ou ${fallback}`);
  return value;
}

function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e || null;
}

function normalizeString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s || null;
}

function normalizeCpf(v: unknown): string | null {
  const raw = normalizeString(v);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits || null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bool(v: unknown): boolean {
  return v === true;
}

function parsePermissions(input: unknown): Record<string, boolean> {
  const p = isObject(input) ? input : {};

  return {
    is_admin: bool(p.is_admin),
    acesso_voucher: bool(p.acesso_voucher),
    cadastrar_produto: bool(p.cadastrar_produto) || bool(p.acesso_cadastrar_produto),
    ficha_consumo: bool(p.ficha_consumo) || bool(p.acesso_ficha_consumo),
    acesso_comanda: bool(p.acesso_comanda),
    acesso_kds: bool(p.acesso_kds),
    reimpressao_venda: bool(p.reimpressao_venda),
    pulseira: bool(p.pulseira) || bool(p.acesso_pulseira),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const externalUrl = requireEnvFallback("EXTERNAL_SUPABASE_URL", "SUPABASE_URL");
    const externalServiceKey = requireEnvFallback("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");

    const body = await req.json();
    if (!isObject(body)) return json({ error: "Payload inválido." }, 400);

    const callerUserId = normalizeString(body.caller_user_id);
    if (!callerUserId) return json({ error: "Sessão inválida." }, 401);

    const admin = createClient(externalUrl, externalServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerPerm, error: callerPermErr } = await admin
      .from("user_permissions")
      .select("is_admin")
      .eq("user_id", callerUserId)
      .maybeSingle();

    if (callerPermErr) return json({ error: callerPermErr.message }, 400);
    if (!callerPerm?.is_admin) {
      return json({ error: "Acesso negado: apenas administradores." }, 403);
    }

    const { action } = body;

    if (action === "create-user") {
      const profile = isObject(body.profile) ? body.profile : {};
      const permissions = parsePermissions(body.permissions);

      const nome = normalizeString(profile.nome) || "";
      const email = normalizeEmail(profile.email ?? body.email);
      const password = normalizeString(body.password);
      const cpf = normalizeCpf(profile.cpf ?? body.cpf);
      const ativo = profile.ativo !== false;

      if (!email || !password) return json({ error: "Email e senha são obrigatórios." }, 400);
      if (password.length < 6) return json({ error: "Senha deve ter pelo menos 6 caracteres." }, 400);
      if (!cpf) return json({ error: "CPF é obrigatório." }, 400);

      const { data: existingCpf, error: existingCpfErr } = await admin
        .from("user_profiles")
        .select("id")
        .eq("cpf", cpf)
        .maybeSingle();
      if (existingCpfErr) return json({ error: existingCpfErr.message }, 400);
      if (existingCpf) return json({ error: "CPF já cadastrado." }, 400);

      const { data: existingEmail, error: existingEmailErr } = await admin
        .from("user_profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (existingEmailErr) return json({ error: existingEmailErr.message }, 400);
      if (existingEmail) return json({ error: "Email já cadastrado." }, 400);

      const { data: createdAuth, error: authCreateErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome, cpf },
      });

      if (authCreateErr || !createdAuth?.user?.id) {
        return json({ error: authCreateErr?.message || "Não foi possível criar usuário de autenticação." }, 400);
      }

      const userId = createdAuth.user.id;

      const { error: profErr } = await admin.from("user_profiles").insert({
        id: userId,
        nome,
        email,
        cpf,
        ativo,
      });

      if (profErr) {
        await admin.auth.admin.deleteUser(userId);
        return json({ error: `Erro perfil: ${profErr.message}` }, 400);
      }

      const { error: permErr } = await admin.from("user_permissions").insert({
        user_id: userId,
        ...permissions,
      });

      if (permErr) {
        await admin.from("user_profiles").delete().eq("id", userId);
        await admin.auth.admin.deleteUser(userId);
        return json({ error: `Erro permissões: ${permErr.message}` }, 400);
      }

      return json({ success: true, user_id: userId });
    }

    if (action === "update-user") {
      const userId = normalizeString(body.user_id);
      if (!userId) return json({ error: "user_id é obrigatório." }, 400);

      const profile = isObject(body.profile) ? body.profile : {};
      const profileUpdate: Record<string, unknown> = {};

      if (profile.nome !== undefined) profileUpdate.nome = normalizeString(profile.nome) || "";
      if (profile.email !== undefined) profileUpdate.email = normalizeEmail(profile.email);
      if (profile.cpf !== undefined) profileUpdate.cpf = normalizeCpf(profile.cpf);
      if (profile.ativo !== undefined) profileUpdate.ativo = !!profile.ativo;

      if (typeof profileUpdate.cpf === "string") {
        const { data: existingCpf, error: existingCpfErr } = await admin
          .from("user_profiles")
          .select("id")
          .eq("cpf", profileUpdate.cpf)
          .neq("id", userId)
          .maybeSingle();
        if (existingCpfErr) return json({ error: existingCpfErr.message }, 400);
        if (existingCpf) return json({ error: "CPF já cadastrado para outro usuário." }, 400);
      }

      if (typeof profileUpdate.email === "string") {
        const { data: existingEmail, error: existingEmailErr } = await admin
          .from("user_profiles")
          .select("id")
          .eq("email", profileUpdate.email)
          .neq("id", userId)
          .maybeSingle();
        if (existingEmailErr) return json({ error: existingEmailErr.message }, 400);
        if (existingEmail) return json({ error: "Email já cadastrado para outro usuário." }, 400);
      }

      if (Object.keys(profileUpdate).length > 0) {
        const { error: profileErr } = await admin.from("user_profiles").update(profileUpdate).eq("id", userId);
        if (profileErr) return json({ error: `Erro perfil: ${profileErr.message}` }, 400);

        if (typeof profileUpdate.email === "string" && profileUpdate.email) {
          const { error: authUpdateErr } = await admin.auth.admin.updateUserById(userId, {
            email: profileUpdate.email,
          });
          if (authUpdateErr) return json({ error: `Erro auth: ${authUpdateErr.message}` }, 400);
        }
      }

      if (isObject(body.permissions)) {
        const permissions = parsePermissions(body.permissions);

        const { data: existingPerm, error: existingPermErr } = await admin
          .from("user_permissions")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();

        if (existingPermErr) return json({ error: `Erro permissões: ${existingPermErr.message}` }, 400);

        if (existingPerm?.user_id) {
          const { error: updatePermErr } = await admin
            .from("user_permissions")
            .update(permissions)
            .eq("user_id", userId);
          if (updatePermErr) return json({ error: `Erro permissões: ${updatePermErr.message}` }, 400);
        } else {
          const { error: insertPermErr } = await admin
            .from("user_permissions")
            .insert({ user_id: userId, ...permissions });
          if (insertPermErr) return json({ error: `Erro permissões: ${insertPermErr.message}` }, 400);
        }
      }

      return json({ success: true });
    }

    if (action === "delete-user") {
      const userId = normalizeString(body.user_id);
      if (!userId) return json({ error: "user_id é obrigatório." }, 400);

      const [permRes, profileRes, authRes] = await Promise.all([
        admin.from("user_permissions").delete().eq("user_id", userId),
        admin.from("user_profiles").delete().eq("id", userId),
        admin.auth.admin.deleteUser(userId),
      ]);

      if (permRes.error) return json({ error: permRes.error.message }, 400);
      if (profileRes.error) return json({ error: profileRes.error.message }, 400);
      if (authRes.error) return json({ error: authRes.error.message }, 400);

      return json({ success: true });
    }

    if (action === "reset-password") {
      const userId = normalizeString(body.user_id);
      const newPassword = normalizeString(body.new_password);
      if (!userId || !newPassword) return json({ error: "user_id e new_password obrigatórios." }, 400);
      if (newPassword.length < 6) return json({ error: "Senha deve ter pelo menos 6 caracteres." }, 400);

      const { error } = await admin.auth.admin.updateUserById(userId, {
        password: newPassword,
      });

      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "toggle-ativo") {
      const userId = normalizeString(body.user_id);
      if (!userId) return json({ error: "user_id é obrigatório." }, 400);

      const { error } = await admin.from("user_profiles").update({ ativo: !!body.ativo }).eq("id", userId);
      if (error) return json({ error: error.message }, 400);

      return json({ success: true });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (err) {
    console.error("Edge function error:", err);
    return json({ error: err instanceof Error ? err.message : "Erro interno" }, 500);
  }
});

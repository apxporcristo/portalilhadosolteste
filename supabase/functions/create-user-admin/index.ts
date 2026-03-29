import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bool(v: unknown): boolean {
  return v === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const externalUrl = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL");
    const externalServiceKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!externalUrl || !externalServiceKey) {
      return jsonResponse({ error: "Configuração do Supabase ausente." }, 500);
    }

    const body = await req.json();
    const { caller_user_id, nome, email, password, cpf, ativo } = body;

    if (!caller_user_id) {
      return jsonResponse({ error: "Sessão inválida." }, 401);
    }

    const admin = createClient(externalUrl, externalServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Check caller is admin
    const { data: callerPerm } = await admin
      .from("user_permissions")
      .select("is_admin")
      .eq("user_id", caller_user_id)
      .maybeSingle();

    if (!callerPerm?.is_admin) {
      return jsonResponse({ error: "Acesso negado: apenas administradores." }, 403);
    }

    if (!nome || !email || !password || !cpf) {
      return jsonResponse({ error: "Campos obrigatórios: nome, email, senha e cpf." }, 400);
    }

    const emailNormalized = String(email).trim().toLowerCase();
    if (String(password).length < 6) {
      return jsonResponse({ error: "Senha deve ter pelo menos 6 caracteres." }, 400);
    }

    const cpfClean = String(cpf).replace(/\D/g, "");

    // Check CPF uniqueness
    const { data: existingCpf } = await admin
      .from("user_profiles").select("id").eq("cpf", cpfClean).maybeSingle();
    if (existingCpf) {
      return jsonResponse({ error: "CPF já cadastrado." }, 400);
    }

    // Check email uniqueness
    const { data: existingEmail } = await admin
      .from("user_profiles").select("id").eq("email", emailNormalized).maybeSingle();
    if (existingEmail) {
      return jsonResponse({ error: "Email já cadastrado." }, 400);
    }

    // Create auth user
    const { data: createdAuth, error: authErr } = await admin.auth.admin.createUser({
      email: emailNormalized,
      password: String(password),
      email_confirm: true,
      user_metadata: { nome: String(nome).trim(), cpf: cpfClean },
    });

    if (authErr || !createdAuth?.user?.id) {
      return jsonResponse({ error: authErr?.message || "Não foi possível criar usuário." }, 400);
    }

    const userId = createdAuth.user.id;

    // Insert profile
    const { error: profErr } = await admin.from("user_profiles").insert({
      id: userId,
      nome: String(nome).trim(),
      email: emailNormalized,
      cpf: cpfClean,
      ativo: ativo !== false,
    });

    if (profErr) {
      await admin.auth.admin.deleteUser(userId);
      return jsonResponse({ error: `Erro perfil: ${profErr.message}` }, 400);
    }

    // Insert permissions with standardized field names
    const permissions: Record<string, unknown> = {
      user_id: userId,
      is_admin: bool(body.is_admin),
      acesso_voucher: bool(body.acesso_voucher),
      acesso_cadastrar_produto: bool(body.acesso_cadastrar_produto),
      acesso_ficha_consumo: bool(body.acesso_ficha_consumo),
      acesso_comanda: bool(body.acesso_comanda),
      acesso_kds: bool(body.acesso_kds),
      reimpressao_venda: bool(body.reimpressao_venda),
      acesso_pulseira: bool(body.acesso_pulseira),
      voucher_todos: bool(body.voucher_todos),
      voucher_tempo_id: typeof body.voucher_tempo_id === "string" ? body.voucher_tempo_id || null : null,
      voucher_tempo_acesso: typeof body.voucher_tempo_acesso === "string" ? body.voucher_tempo_acesso || null : null,
    };

    const { error: permErr } = await admin.from("user_permissions").insert(permissions);

    if (permErr) {
      await admin.from("user_profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
      return jsonResponse({ error: `Erro permissões: ${permErr.message}` }, 400);
    }

    return jsonResponse({ success: true, user_id: userId });
  } catch (err) {
    console.error("Edge function error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Erro interno" }, 500);
  }
});

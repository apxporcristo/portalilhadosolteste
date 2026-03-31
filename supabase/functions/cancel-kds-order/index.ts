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

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function requireEnvFallback(primary: string, fallback: string): string {
  const value = Deno.env.get(primary) || Deno.env.get(fallback);
  if (!value) throw new Error(`Configuração ausente: ${primary} ou ${fallback}`);
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const externalUrl = requireEnvFallback("EXTERNAL_SUPABASE_URL", "SUPABASE_URL");
    const externalServiceKey = requireEnvFallback("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");

    const body = await req.json();
    const callerUserId = normalizeString(body?.caller_user_id);
    const orderId = normalizeString(body?.order_id);
    const motivoCancelamento = normalizeString(body?.motivo_cancelamento);
    const canceladoPor = normalizeString(body?.cancelado_por) || callerUserId;

    if (!callerUserId) return jsonResponse({ error: "Sessão inválida." }, 401);
    if (!orderId) return jsonResponse({ error: "order_id é obrigatório." }, 400);
    if (!motivoCancelamento) return jsonResponse({ error: "Motivo de cancelamento é obrigatório." }, 400);

    const admin = createClient(externalUrl, externalServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: callerPerm, error: callerPermErr }, { data: order, error: orderErr }] = await Promise.all([
      admin
        .from("user_permissions")
        .select("is_admin, acesso_ficha_consumo, acesso_kds")
        .eq("user_id", callerUserId)
        .maybeSingle(),
      admin
        .from("kds_orders")
        .select("id, kds_status, atendente_user_id")
        .eq("id", orderId)
        .maybeSingle(),
    ]);

    if (callerPermErr) return jsonResponse({ error: callerPermErr.message }, 400);
    if (orderErr) return jsonResponse({ error: orderErr.message }, 400);
    if (!order?.id) return jsonResponse({ error: "Pedido não encontrado." }, 404);

    const isAdmin = callerPerm?.is_admin === true;
    const canUseKds = callerPerm?.acesso_ficha_consumo === true || callerPerm?.acesso_kds === true || isAdmin;
    const isOwner = order.atendente_user_id === callerUserId;

    if (!canUseKds) {
      return jsonResponse({ error: "Acesso negado ao cancelamento." }, 403);
    }

    if (!isAdmin) {
      if (!isOwner) {
        return jsonResponse({ error: "Você só pode cancelar pedidos vinculados ao seu usuário." }, 403);
      }

      if (order.kds_status !== "novo") {
        return jsonResponse({ error: "Somente pedidos novos podem ser cancelados pelo atendente." }, 409);
      }
    }

    const { error: updateErr } = await admin
      .from("kds_orders")
      .update({
        kds_status: "cancelado",
        motivo_cancelamento: motivoCancelamento,
        cancelado_at: new Date().toISOString(),
        cancelado_por: canceladoPor,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateErr) return jsonResponse({ error: updateErr.message }, 400);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("cancel-kds-order error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Erro interno." }, 500);
  }
});
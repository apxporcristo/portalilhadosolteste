import { getSupabaseConfig } from '@/lib/supabase-external';

const SESSION_KEY = 'app-session';

export function extractKdsCancelError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as Record<string, unknown>;
    if (typeof maybeError.message === 'string') return maybeError.message;
    if (typeof maybeError.error === 'string') return maybeError.error;
  }
  return 'Erro ao cancelar pedido.';
}

export function getKdsCallerUserId(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) throw new Error('Sessão inválida. Faça login novamente.');

    const parsed = JSON.parse(raw);
    if (!parsed?.user_id) throw new Error('Sessão inválida. Faça login novamente.');

    return parsed.user_id;
  } catch {
    throw new Error('Sessão inválida. Faça login novamente.');
  }
}

export async function cancelKdsOrder(params: {
  orderId: string;
  motivo: string;
  canceladoPor?: string;
  callerUserId?: string;
}) {
  const callerUserId = params.callerUserId ?? getKdsCallerUserId();
  const { url, anonKey } = await getSupabaseConfig();

  const response = await fetch(`${url}/functions/v1/cancel-kds-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      caller_user_id: callerUserId,
      order_id: params.orderId,
      motivo_cancelamento: params.motivo,
      cancelado_por: params.canceladoPor ?? null,
    }),
  });

  const text = await response.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }

  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}: ${text}`);
  }

  return data;
}
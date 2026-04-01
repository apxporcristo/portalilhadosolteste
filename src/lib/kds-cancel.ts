import { supabase as cloudSupabase } from '@/integrations/supabase/client';

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
  const { data, error } = await cloudSupabase.functions.invoke('cancel-kds-order', {
    body: {
      caller_user_id: callerUserId,
      order_id: params.orderId,
      motivo_cancelamento: params.motivo,
      cancelado_por: params.canceladoPor ?? null,
    },
  });

  if (error) throw new Error(extractKdsCancelError(error));
  if (data?.error) throw new Error(extractKdsCancelError(data.error));

  return data;
}
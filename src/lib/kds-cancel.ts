import { supabase as cloudSupabase } from '@/integrations/supabase/client';
import { getSupabaseClient } from '@/lib/supabase-external';

const SESSION_KEY = 'app-session';

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as Record<string, unknown>;
    if (typeof maybeError.message === 'string') return maybeError.message;
    if (typeof maybeError.error === 'string') return maybeError.error;
    if (typeof maybeError.details === 'string') return maybeError.details;
  }
  return null;
}

function isEdgeFunctionUnavailable(error: unknown): boolean {
  const message = readErrorMessage(error)?.toLowerCase() ?? '';
  return (
    message.includes('failed to send a request to the edge function') ||
    message.includes('failed to fetch') ||
    message.includes('requested function was not found') ||
    message.includes('not_found')
  );
}

export function extractKdsCancelError(error: unknown): string {
  const message = readErrorMessage(error);
  if (message) return message;
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

  const cancelDirectly = async () => {
    const supabase = await getSupabaseClient();

    const { data: order, error: orderError } = await supabase
      .from('kds_orders' as any)
      .select('id, kds_status, atendente_user_id, cancelado_at')
      .eq('id', params.orderId)
      .maybeSingle();

    if (orderError) throw new Error(extractKdsCancelError(orderError));
    if (!order?.id) throw new Error('Pedido não encontrado.');
    if (order.cancelado_at) {
      return { success: true, mode: 'direct-update' };
    }
    if (order.kds_status !== 'novo') {
      throw new Error('Somente pedidos com status Novo podem ser cancelados.');
    }
    if (!callerUserId || order.atendente_user_id !== callerUserId) {
      throw new Error('Você só pode cancelar pedidos do seu usuário.');
    }

    const now = new Date().toISOString();
    const { data: updatedOrder, error: updateError } = await supabase
      .from('kds_orders' as any)
      .update({
        motivo_cancelamento: params.motivo,
        cancelado_at: now,
        cancelado_por: params.canceladoPor ?? callerUserId,
        updated_at: now,
      })
      .eq('id', params.orderId)
      .eq('kds_status', 'novo')
      .eq('atendente_user_id', callerUserId)
      .select('id')
      .maybeSingle();

    if (updateError) throw new Error(extractKdsCancelError(updateError));
    if (!updatedOrder?.id) {
      throw new Error('Não foi possível cancelar o pedido. Verifique se ele ainda está como Novo e vinculado ao usuário atual.');
    }

    return { success: true, mode: 'direct-update' };
  };

  try {
    const { data, error } = await cloudSupabase.functions.invoke('cancel-kds-order', {
      body: {
        caller_user_id: callerUserId,
        order_id: params.orderId,
        motivo_cancelamento: params.motivo,
        cancelado_por: params.canceladoPor ?? null,
      },
    });

    if (error) {
      if (isEdgeFunctionUnavailable(error)) return cancelDirectly();
      throw new Error(extractKdsCancelError(error));
    }
    if (data?.error) {
      if (isEdgeFunctionUnavailable(data.error)) return cancelDirectly();
      throw new Error(extractKdsCancelError(data.error));
    }

    return data;
  } catch (error) {
    if (isEdgeFunctionUnavailable(error)) return cancelDirectly();
    throw new Error(extractKdsCancelError(error));
  }
}
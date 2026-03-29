import { useOptionalUserSession } from '@/contexts/UserSessionContext';

interface PermissionGateProps {
  children: React.ReactNode;
  permission: 'acesso_voucher' | 'acesso_cadastrar_produto' | 'acesso_ficha_consumo' | 'acesso_comanda' | 'acesso_kds' | 'reimpressao_venda' | 'pulseira' | 'is_admin';
  fallback?: React.ReactNode;
}

export function PermissionGate({ children, permission, fallback = null }: PermissionGateProps) {
  const ctx = useOptionalUserSession();
  
  if (!ctx || !ctx.access) return <>{fallback}</>;
  
  if (!ctx.access[permission]) return <>{fallback}</>;

  return <>{children}</>;
}

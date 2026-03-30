import { Navigate } from 'react-router-dom';
import { useUserSession } from '@/contexts/UserSessionContext';
import { Skeleton } from '@/components/ui/skeleton';

type PermissionKey = 'acesso_voucher' | 'acesso_cadastrar_produto' | 'acesso_ficha_consumo' | 'acesso_kds' | 'acesso_pulseira' | 'is_admin';

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission?: PermissionKey;
  /** If provided, user needs permission OR any of these */
  anyPermission?: PermissionKey[];
}

export function ProtectedRoute({ children, permission, anyPermission }: ProtectedRouteProps) {
  const { user, access, loading } = useUserSession();

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <Skeleton className="h-20 w-64" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (anyPermission && access) {
    const hasAny = anyPermission.some(p => access[p]);
    if (!hasAny) return <Navigate to="/acesso-negado" replace />;
  } else if (permission && access && !access[permission]) {
    return <Navigate to="/acesso-negado" replace />;
  }

  return <>{children}</>;
}

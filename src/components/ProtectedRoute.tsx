import { Navigate } from 'react-router-dom';
import { useUserSession } from '@/contexts/UserSessionContext';
import { Skeleton } from '@/components/ui/skeleton';

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission?: 'acesso_voucher' | 'acesso_cadastrar_produto' | 'acesso_ficha_consumo' | 'acesso_kds' | 'pulseira' | 'is_admin';
}

export function ProtectedRoute({ children, permission }: ProtectedRouteProps) {
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

  if (permission && access && !access[permission]) {
    return <Navigate to="/acesso-negado" replace />;
  }

  return <>{children}</>;
}

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: number | string;
  description?: string;
  icon: LucideIcon;
  variant?: 'default' | 'success' | 'warning' | 'primary';
}

const variantStyles = {
  default: 'bg-card',
  success: 'bg-success/10 border-success/20',
  warning: 'bg-warning/10 border-warning/20',
  primary: 'bg-primary/10 border-primary/20',
};

const iconStyles = {
  default: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  primary: 'text-primary',
};

export function StatsCard({ title, value, description, icon: Icon, variant = 'default' }: StatsCardProps) {
  return (
    <Card className={cn('glass-card transition-all hover:shadow-xl', variantStyles[variant])}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn('h-5 w-5', iconStyles[variant])} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PerformanceBadgeProps {
  percentage: number | null;
  className?: string;
}

export function PerformanceBadge({ percentage, className }: PerformanceBadgeProps) {
  const getVariant = (multiplier: number) => {
    if (multiplier >= 2.0) return 'excellent'; // 2.0x+ performance
    if (multiplier >= 1.0) return 'good'; // 1.0-2.0x performance  
    if (multiplier >= 0.5) return 'average'; // 0.5-1.0x performance
    return 'poor'; // Below 0.5x performance
  };

  // Handle null/undefined percentage values
  const safePercentage = percentage ?? 0;
  const variant = getVariant(safePercentage);
  const displayValue = `${safePercentage.toFixed(1)}x`;

  return (
    <Badge
      className={cn(
        'font-semibold text-xs px-2 py-1 shadow-sm border-0',
        {
          'bg-green-500 text-white hover:bg-green-600': variant === 'excellent',
          'bg-blue-500 text-white hover:bg-blue-600': variant === 'good',
          'bg-yellow-500 text-white hover:bg-yellow-600': variant === 'average',
          'bg-red-500 text-white hover:bg-red-600': variant === 'poor',
        },
        className
      )}
    >
      {displayValue}
    </Badge>
  );
}
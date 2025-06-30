import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PerformanceBadgeProps {
  percentage: number;
  className?: string;
}

export function PerformanceBadge({ percentage, className }: PerformanceBadgeProps) {
  const getVariant = (multiplier: number) => {
    if (multiplier > 2.0) return 'excellent'; // 200%+ above baseline
    if (multiplier >= 0) return 'average'; // At or above baseline
    return 'poor'; // Below baseline
  };

  const variant = getVariant(percentage);
  const displayValue = percentage >= 0 ? `+${percentage.toFixed(2)}` : percentage.toFixed(2);

  return (
    <Badge
      className={cn(
        'font-semibold text-xs px-2 py-1 shadow-sm border-0',
        {
          'bg-green-500 text-white hover:bg-green-600': variant === 'excellent',
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
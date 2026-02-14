import { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export type GridLayout = 1 | 4 | 9;

export function CameraGrid({ layout, children }: { layout: GridLayout; children: ReactNode }) {
  const cols = layout === 1 ? 1 : layout === 4 ? 2 : 3;
  return (
    <div className={cn('grid gap-3', cols === 1 && 'grid-cols-1', cols === 2 && 'grid-cols-1 md:grid-cols-2', cols === 3 && 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3')}>
      {children}
    </div>
  );
}

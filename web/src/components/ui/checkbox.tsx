import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

/**
 * Native checkbox styled to match the other primitives. Kept as a plain input
 * (rather than a Radix-style custom control) so react-hook-form's `register`
 * works on it with no adapter.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...props }, ref) => (
  <input
    type="checkbox"
    className={cn(
      'h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    ref={ref}
    {...props}
  />
));
Checkbox.displayName = 'Checkbox';

export { Checkbox };

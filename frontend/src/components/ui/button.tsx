import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { MotionGlyph } from '@/components/motion';
import { Tooltip } from './tooltip';
import { Icon } from '@/components/icon';

// shadcn/ui Button composition, adapted to FRONTEND_REQUIREMENTS §5.
const buttonVariants = cva('button', {
  variants: {
    variant: {
      default: 'button-outline',
      primary: 'button-primary',
      run: 'button-run',
      agent: 'button-agent',
      ghost: 'button-ghost',
      outline: 'button-outline',
      secondary: 'button-secondary',
      destructive: 'button-destructive',
      link: 'button-link',
    },
    size: { default: 'button-standard', compact: 'button-compact', icon: 'button-icon', sm: 'button-compact', xs: 'button-compact', lg: 'button-standard', 'icon-sm': 'button-icon', 'icon-xs': 'button-icon', 'icon-lg': 'button-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
export { buttonVariants };

type ButtonProps = React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean; previewState?: 'hover' | 'focus' | 'active' | 'error' };

export function Button({ className, variant, size, asChild = false, loading = false, previewState, children, disabled, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component data-slot="button" data-preview={previewState} aria-busy={loading || undefined} disabled={disabled || loading} className={cn(buttonVariants({ variant, size, className }))} {...props}>{asChild ? children : <>{loading && <MotionGlyph kind="running" />}{children}</>}</Component>;
}

export function IconButton({ icon, label, ...props }: Omit<ButtonProps, 'children' | 'asChild'> & { icon: string; label: string }) {
  return <Tooltip content={label}><Button {...props} size="icon" aria-label={label}><Icon name={icon} /></Button></Tooltip>;
}

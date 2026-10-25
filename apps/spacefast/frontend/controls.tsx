import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { Button as WpButton, ButtonLink, IconButton, Dialog, Notice as WpNotice, InputControl, SwitchControl } from '@wordpress/ui';
export { Spinner, CheckboxControl } from '@wordpress/ui';

// Small application adapters keep common semantics in one place. All controls
// below render the new WordPress UI package, not legacy Components controls.
type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children?: ReactNode; variant?: 'primary' | 'secondary' | 'tertiary';
  icon?: ComponentProps<typeof IconButton>['icon']; label?: string;
  isBusy?: boolean; isDestructive?: boolean; href?: string; target?: string; rel?: string;
};
export function Button({ variant = 'tertiary', icon, label, isBusy, isDestructive, href, target, rel, children, className = '', ...props }: ButtonProps) {
  const pressed = props['aria-pressed'] !== undefined;
  const visual = { variant: pressed ? 'minimal' as const : variant === 'primary' ? 'solid' as const : variant === 'secondary' ? 'outline' as const : 'minimal' as const, tone: pressed || isDestructive ? 'neutral' as const : 'brand' as const, className: `app-button ${className}`, 'data-destructive': isDestructive || undefined };
  if (href) return <ButtonLink {...visual} href={href} target={target} rel={rel}>{icon && <ButtonLink.Icon icon={icon} />}{children}</ButtonLink>;
  if (icon && !children) return <IconButton {...visual} {...props} icon={icon} label={label || 'Action'} loading={isBusy} />;
  return <WpButton {...visual} {...props} aria-label={label || props['aria-label']} loading={isBusy}>{icon && <WpButton.Icon icon={icon} />}{children}</WpButton>;
}

export function Notice({ children, status = 'info', isDismissible = true, onRemove }: { children: ReactNode; status?: ComponentProps<typeof WpNotice.Root>['intent']; isDismissible?: boolean; onRemove?: () => void }) {
  return <WpNotice.Root intent={status} className="app-notice" role={status === 'error' ? 'alert' : 'status'}><WpNotice.Description>{children}</WpNotice.Description>{isDismissible && onRemove && <WpNotice.CloseIconButton label="Dismiss notice" onClick={onRemove} />}</WpNotice.Root>;
}

export function Modal({ title, onRequestClose, className = '', children }: { title: string; onRequestClose: () => void; className?: string; children: ReactNode }) {
  return <Dialog.Root open onOpenChange={open => { if (!open) onRequestClose(); }}><Dialog.Popup className={`app-dialog ${className}`} size={className.includes('article-drawer') ? 'large' : 'medium'}><Dialog.Header className="app-dialog-header"><Dialog.Title>{title}</Dialog.Title><Dialog.CloseIconButton label="Close panel" /></Dialog.Header><Dialog.Content className="app-dialog-content">{children}</Dialog.Content></Dialog.Popup></Dialog.Root>;
}

type TextProps = Omit<ComponentProps<typeof InputControl>, 'onValueChange' | 'onChange'> & { onChange: (value: string) => void; help?: string };
export function TextControl({ onChange, help, className = '', ...props }: TextProps) {
  return <InputControl {...props} className={`app-field ${className}`} description={help} onValueChange={value => onChange(String(value))} />;
}
type ToggleProps = Omit<ComponentProps<typeof SwitchControl>, 'onCheckedChange' | 'onChange'> & { onChange: (value: boolean) => void };
export function ToggleControl({ onChange, className = '', ...props }: ToggleProps) {
  return <SwitchControl {...props} className={`app-toggle ${className}`} onCheckedChange={onChange} />;
}

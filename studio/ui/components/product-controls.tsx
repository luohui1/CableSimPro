import { ActionIcon, Button as MantineButton, Checkbox as MantineCheckbox, Modal, Select, Tabs as MantineTabs, TextInput, Textarea } from '@mantine/core';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Cable, Check, CircleAlert, Clock3, FileDown, FileSpreadsheet, FileText, Folder, Layers3, Library, Moon, Play, RefreshCw, Search, Sun, Upload, X } from 'lucide-react';
import { Children, isValidElement, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

const ICONS = { 'action/import': Upload, 'action/arrow-left': ArrowLeft, 'action/arrow-right': ArrowRight, 'action/arrow-up': ArrowUp, 'action/arrow-down': ArrowDown,
  'action/check': Check, 'action/close': X, 'action/history': Clock3, 'action/refresh': RefreshCw, 'nav/library': Library, 'nav/cable-type': Cable,
  'object/folder': Folder, 'object/file': FileSpreadsheet, 'object/section': Layers3, 'module/structure': Layers3, 'result/report': FileDown, 'run/run': Play,
  moon: Moon, sun: Sun, warning: CircleAlert, search: Search, document: FileText };

export function ProductIcon({ name, className }: { name: string; className?: string }) {
  const Glyph = ICONS[name as keyof typeof ICONS] ?? Cable;
  return <Glyph aria-hidden="true" size={18} strokeWidth={1.8} className={cn('product-icon', className)} />;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost'; size?: 'compact' | 'standard'; icon?: string; busy?: boolean;
}
export function Button({ variant = 'outline', size = 'standard', icon, busy, disabled, children, className, ...props }: ButtonProps) {
  return <MantineButton {...props} className={cn('product-button', className)} variant={variant === 'outline' ? 'default' : variant === 'ghost' ? 'subtle' : 'filled'}
    size={size === 'compact' ? 'xs' : 'sm'} disabled={disabled || busy} loading={busy} leftSection={icon && <ProductIcon name={icon} />}>{children}</MantineButton>;
}
export function ToolButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return <ActionIcon variant="subtle" color="gray" size="lg" aria-label={label} onClick={onClick}><ProductIcon name={icon} /></ActionIcon>;
}
export const Input = TextInput;
export const TextArea = Textarea;

export function Checkbox({ checked, onChange, children, required, className }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; required?: boolean; className?: string }) {
  return <MantineCheckbox checked={checked} onChange={event => onChange(event.currentTarget.checked)} required={required} className={className} label={children} size="sm" />;
}

export function SelectField({ value, defaultValue = '', onValueChange, children, className, 'aria-label': label, disabled }: {
  value?: string | number; defaultValue?: string; onValueChange: (value: string) => void; children: ReactNode; className?: string; 'aria-label': string; disabled?: boolean;
}) {
  const [local, setLocal] = useState(defaultValue);
  const data = Children.toArray(children).filter(isValidElement<{ value?: string | number; children: ReactNode }>).map(child => ({
    value: String(child.props.value ?? Children.toArray(child.props.children).join('')), label: Children.toArray(child.props.children).join(''),
  }));
  return <Select aria-label={label} className={cn('product-select', className)} value={String(value ?? local)} data={data} allowDeselect={false}
    onChange={next => { if (next !== null) { setLocal(next); onValueChange(next); } }} disabled={disabled} comboboxProps={{ withinPortal: true }} />;
}

export function SearchField({ label, placeholder, value, onChange, className }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; className?: string }) {
  return <TextInput type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.currentTarget.value)} className={cn('product-search', className)}
    leftSection={<Search size={16} />} rightSection={value ? <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`清除${label}`} onClick={() => onChange('')}><X size={14} /></ActionIcon> : null} />;
}

export function Tabs({ value, onChange, items, children, className, label = '规格详情内容' }: { value: string; onChange: (value: string) => void; items: { value: string; label: ReactNode }[]; children?: ReactNode; className?: string; label?: string }) {
  return <MantineTabs value={value} onChange={next => { if (next) onChange(next); }} className={cn('product-tabs', className)} keepMounted={false}>
    <MantineTabs.List aria-label={label}>{items.map(item => <MantineTabs.Tab key={item.value} value={item.value}>{item.label}</MantineTabs.Tab>)}</MantineTabs.List>
    {children}
  </MantineTabs>;
}
export function TabPanel({ value, children }: { value: string; children: ReactNode }) { return <MantineTabs.Panel value={value}>{children}</MantineTabs.Panel>; }

export function ReviewDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return <Modal opened={open} onClose={onClose} title="确认批量审核" size="lg" centered classNames={{ content: 'product-ui' }} closeButtonProps={{ 'aria-label': '关闭审核窗口' }}>{children}</Modal>;
}
export function DocumentDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return <Modal opened={open} onClose={onClose} title="规格书 PDF 预览" size="min(1100px, 95vw)" centered classNames={{ content: 'product-ui' }} closeButtonProps={{ 'aria-label': '关闭规格书预览' }}>{children}</Modal>;
}

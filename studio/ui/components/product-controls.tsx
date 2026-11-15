import { Button as HeroButton, Checkbox as HeroCheckbox, Input, Label, ListBox, Modal, SearchField as HeroSearchField, Select, Spinner, Tabs as HeroTabs, TextArea } from '@heroui/react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Cable, Check, CircleAlert, Clock3, FileDown, FileSpreadsheet, FileText, Folder, Layers3, Library, Moon, Play, RefreshCw, Search, Sun, Upload, X } from 'lucide-react';
import { Children, isValidElement, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

const ICONS = { 'action/import': Upload, 'action/arrow-left': ArrowLeft, 'action/arrow-right': ArrowRight, 'action/arrow-up': ArrowUp, 'action/arrow-down': ArrowDown,
  'action/check': Check, 'action/close': X, 'action/history': Clock3, 'action/refresh': RefreshCw, 'nav/library': Library, 'nav/cable-type': Cable,
  'object/folder': Folder, 'object/file': FileSpreadsheet, 'object/section': Layers3, 'module/structure': Layers3, 'result/report': FileDown, 'run/run': Play,
  moon: Moon, sun: Sun, warning: CircleAlert, search: Search, document: FileText };

export function ProductIcon({ name, className }: { name: string; className?: string }) {
  const Glyph = ICONS[name as keyof typeof ICONS] ?? Cable;
  return <Glyph aria-hidden="true" size={16} strokeWidth={1.7} className={cn('product-icon', className)} />;
}

interface ButtonProps extends Omit<ComponentProps<typeof HeroButton>, 'variant' | 'size' | 'children' | 'className'> {
  children?: ReactNode; className?: string; disabled?: boolean;
  variant?: 'primary' | 'outline' | 'ghost'; size?: 'compact' | 'standard'; icon?: string; busy?: boolean;
}
export function Button({ variant = 'outline', size = 'standard', icon, busy, disabled, children, className, onClick, ...props }: ButtonProps) {
  return <HeroButton {...props} className={cn('product-button', className)} variant={variant === 'outline' ? 'secondary' : variant === 'ghost' ? 'ghost' : 'primary'} size={size === 'compact' ? 'sm' : 'md'}
    isDisabled={disabled || busy} isPending={busy} onClick={onClick}>
    {busy ? <Spinner size="sm" /> : icon ? <ProductIcon name={icon} /> : null}{children}
  </HeroButton>;
}
export function ToolButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return <HeroButton className="product-button" variant="ghost" size="sm" isIconOnly aria-label={label} onPress={onClick}><ProductIcon name={icon} /></HeroButton>;
}
export { Input, TextArea };

export function Checkbox({ checked, onChange, children, required, className }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; required?: boolean; className?: string }) {
  return <HeroCheckbox isSelected={checked} onChange={onChange} isRequired={required} className={cn('product-checkbox', className)}>
    <HeroCheckbox.Content><HeroCheckbox.Control><HeroCheckbox.Indicator /></HeroCheckbox.Control><Label>{children}</Label></HeroCheckbox.Content>
  </HeroCheckbox>;
}

// Native-looking option declarations keep the business forms readable; HeroUI owns
// the trigger, keyboard navigation, selection, popover and accessible listbox.
export function SelectField({ value, defaultValue = '', onValueChange, children, className, 'aria-label': label, disabled }: {
  value?: string | number; defaultValue?: string; onValueChange: (value: string) => void; children: ReactNode; className?: string; 'aria-label': string; disabled?: boolean;
}) {
  const [local, setLocal] = useState(defaultValue);
  const options = Children.toArray(children).filter(isValidElement<{ value?: string | number; children: ReactNode }>).map(child => ({
    key: String(child.props.value ?? Children.toArray(child.props.children).join('')) || '__none__', label: child.props.children,
    text: Children.toArray(child.props.children).join(''),
  }));
  return <Select aria-label={label} className={cn('product-select', className)} value={String(value ?? local) || '__none__'}
    onChange={key => { const next = key === '__none__' ? '' : String(key ?? ''); setLocal(next); onValueChange(next); }} isDisabled={disabled}>
    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
    <Select.Popover className="product-ui product-select-popover"><ListBox aria-label={label} items={options}>
      {option => <ListBox.Item id={option.key} textValue={option.text}>{option.label}<ListBox.ItemIndicator /></ListBox.Item>}
    </ListBox></Select.Popover>
  </Select>;
}

export function SearchField({ label, placeholder, value, onChange, className }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; className?: string }) {
  return <HeroSearchField aria-label={label} value={value} onChange={onChange} className={cn('product-search', className)}>
    <HeroSearchField.Group><HeroSearchField.SearchIcon /><HeroSearchField.Input placeholder={placeholder} /><HeroSearchField.ClearButton aria-label={`清除${label}`} /></HeroSearchField.Group>
  </HeroSearchField>;
}

export function Tabs({ value, onChange, items, children, className, label = '规格详情内容' }: { value: string; onChange: (value: string) => void; items: { value: string; label: ReactNode }[]; children?: ReactNode; className?: string; label?: string }) {
  return <HeroTabs selectedKey={value} onSelectionChange={key => onChange(String(key))} variant="secondary" className={cn('product-tabs', className)}>
    <HeroTabs.ListContainer><HeroTabs.List aria-label={label}>{items.map(item => <HeroTabs.Tab key={item.value} id={item.value}>{item.label}<HeroTabs.Indicator /></HeroTabs.Tab>)}</HeroTabs.List></HeroTabs.ListContainer>
    {children}
  </HeroTabs>;
}
export function TabPanel({ value, children }: { value: string; children: ReactNode }) { return <HeroTabs.Panel id={value}>{children}</HeroTabs.Panel>; }

export function ReviewDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return <Modal.Backdrop isOpen={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }} className="product-ui product-modal-backdrop">
    <Modal.Container size="lg"><Modal.Dialog aria-label="确认批量审核"><Modal.CloseTrigger aria-label="关闭审核窗口" /><Modal.Header><Modal.Heading>批量审核</Modal.Heading></Modal.Header><Modal.Body>{children}</Modal.Body></Modal.Dialog></Modal.Container>
  </Modal.Backdrop>;
}

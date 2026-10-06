import * as Primitive from "@radix-ui/react-select";
import { useId, type ComponentProps } from "react";
import { Icon } from "@/components/icon";
import { displayText } from "@/lib/display-names";

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  loading,
  error,
  path,
  placeholder = "请选择",
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  path?: string;
  placeholder?: string;
}) {
  const id = useId();
  const emptyChoice = id + "-empty";
  const hasEmptyChoice = options.some((option) => option.value === "");
  return (
    <div className="select-field" data-field-path={path}>
      <label htmlFor={id}>{label}</label>
      <Primitive.Root
        value={value === "" && hasEmptyChoice ? emptyChoice : value}
        onValueChange={(next) => onChange(next === emptyChoice ? "" : next)}
        disabled={disabled || loading}
      >
        <Primitive.Trigger
          id={id}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-busy={loading || undefined}
          className="select-trigger"
        >
          <Primitive.Value placeholder={loading ? "加载中" : placeholder} />
          <Primitive.Icon>
            <Icon name="action/chevron-down" />
          </Primitive.Icon>
        </Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            position="popper"
            sideOffset={4}
            className="select-content"
          >
            <Primitive.Viewport>
              {options.length ? (
                options.map((option) => (
                  <Primitive.Item
                    key={option.value}
                    value={option.value === "" ? emptyChoice : option.value}
                    disabled={option.disabled}
                    className="select-item"
                  >
                    <Primitive.ItemText>{displayText(option.label)}</Primitive.ItemText>
                    <Primitive.ItemIndicator>
                      <span aria-hidden="true">✓</span>
                    </Primitive.ItemIndicator>
                  </Primitive.Item>
                ))
              ) : (
                <span className="select-empty">无可选项</span>
              )}
            </Primitive.Viewport>
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
      {error && (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Select(props: ComponentProps<typeof LabeledSelect> | ComponentProps<typeof Primitive.Root>) {
  return 'options' in props ? <LabeledSelect {...props} /> : <Primitive.Root {...props} />;
}
export const SelectValue = Primitive.Value;
export const SelectGroup = Primitive.Group;
export const SelectLabel = Primitive.Label;
export const SelectSeparator = Primitive.Separator;
export function SelectTrigger({ className = '', children, ...props }: ComponentProps<typeof Primitive.Trigger> & { size?: 'sm' | 'default' }) {
  return <Primitive.Trigger className={`select-trigger ${className}`} {...props}>{children}<Primitive.Icon><Icon name="action/chevron-down" /></Primitive.Icon></Primitive.Trigger>;
}
export function SelectContent({ className = '', children, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content className={`select-content ${className}`} position="popper" sideOffset={4} {...props}><Primitive.Viewport>{children}</Primitive.Viewport></Primitive.Content></Primitive.Portal>;
}
export function SelectItem({ className = '', children, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={`select-item ${className}`} {...props}><Primitive.ItemText>{children}</Primitive.ItemText><Primitive.ItemIndicator><Icon name="action/check" /></Primitive.ItemIndicator></Primitive.Item>;
}

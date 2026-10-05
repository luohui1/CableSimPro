import * as Primitive from "@radix-ui/react-select";
import { useId } from "react";
import { Icon } from "@/components/icon";
import { displayText } from "@/lib/display-names";

export function Select({
  label,
  value,
  onChange,
  options,
  disabled,
  loading,
  error,
  placeholder = "请选择",
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  placeholder?: string;
}) {
  const id = useId();
  const emptyChoice = id + "-empty";
  const hasEmptyChoice = options.some((option) => option.value === "");
  return (
    <div className="select-field">
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

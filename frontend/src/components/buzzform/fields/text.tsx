"use client";

import type { TextField as TextFieldDef } from "@buildnbuzz/form-react";
import { useDataField } from "@buildnbuzz/form-react";
import { Input } from "@/components/ui/input";
import { CopyButton } from "../components/clipboard-button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { cn } from "@/lib/cn";

interface TextUi {
  copyable?: boolean;
  autoFocus?: boolean;
  className?: string;
  width?: string | number;
  asterisk?: boolean;
}

export function TextField() {
  const {
    fieldApi,
    field,
    isDisabled,
    isReadOnly,
    isRequired,
    label,
    placeholder,
    description,
    errors: ownErrors,
    isInvalid: ownInvalid,
    descriptionId,
    errorId,
    ariaDescribedBy: ownDescription,
    handleChange,
    handleBlur,
  } = useDataField<TextFieldDef>();

  const hostError = typeof field.meta?.error === 'string' ? field.meta.error : '';
  const isInvalid = ownInvalid || !!hostError;
  const errors = hostError ? [{ message: hostError }] : ownErrors;
  const ariaDescribedBy = hostError ? errorId : ownDescription;

  const value = (fieldApi.state.value as string) ?? "";
  const ui = field.ui as TextUi | undefined;


  return (
    <FieldGroup
      data-field={fieldApi.name}
      data-field-path={String(field.meta?.path || '')}
      className={ui?.className}
    >
      <Field data-invalid={isInvalid} data-disabled={isDisabled}>
        {label && (
          <FieldLabel title={typeof description === "string" && description ? description : undefined} htmlFor={fieldApi.name} className="gap-1 items-baseline">
            {label}
            {isRequired && ui?.asterisk !== false ? (
              <span className="text-destructive">*</span>
            ) : null}
          </FieldLabel>
        )}

        <FieldContent>
          <div className={cn("relative", ui?.copyable && "flex items-center")}>
            <Input
              id={fieldApi.name}
              name={fieldApi.name}
              type="text"
              autoComplete={field.autoComplete}
              autoFocus={ui?.autoFocus}
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={handleBlur}
              placeholder={placeholder}
              disabled={isDisabled}
              readOnly={isReadOnly}
              aria-invalid={isInvalid}
              aria-describedby={ariaDescribedBy}
              minLength={field.minLength}
              maxLength={field.maxLength}
              required={isRequired}
              className={cn(ui?.copyable && "pr-9")}
            />
            {ui?.copyable && (
              <CopyButton
                value={value}
                disabled={isDisabled}
                className="absolute right-0 top-0 h-full px-2.5 text-muted-foreground hover:text-foreground"
              />
            )}
          </div>
        </FieldContent>

        {description && !isInvalid && (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        )}

        {isInvalid && <FieldError id={errorId} errors={errors} />}
      </Field>
    </FieldGroup>
  );
}

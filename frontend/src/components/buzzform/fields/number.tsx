"use client";

import * as React from "react";
import type { NumberField as NumberFieldDef } from "@buildnbuzz/form-react";
import {
  clampNumber,
  applyNumericPrecision,
  formatNumberWithSeparator,
  parseFormattedNumber,
} from "@buildnbuzz/form-react";
import { useDataField } from "@buildnbuzz/form-react";
import { Input } from "@/components/ui/input";
import { CopyButton } from "../components/clipboard-button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { IconPlaceholder } from "@/components/icon-placeholder";
import { cn } from "@/lib/cn";

interface NumberUi {
  prefix?: string;
  suffix?: string;
  variant?: "default" | "stacked" | "pill" | "plain";
  hideSteppers?: boolean;
  thousandSeparator?: boolean | string;
  copyable?: boolean;
  autoFocus?: boolean;
  className?: string;
  width?: string | number;
  asterisk?: boolean;
  rangeHint?: string;
}

export function NumberField() {
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
    handleBlur,
  } = useDataField<NumberFieldDef>();

  const hostError = typeof field.meta?.error === 'string' ? field.meta.error : '';
  const isInvalid = ownInvalid || !!hostError;
  const errors = hostError ? [{ message: hostError }] : ownErrors;
  const rangeHint = (field.ui as NumberUi | undefined)?.rangeHint;
  const ariaDescribedBy = [hostError ? errorId : ownDescription,rangeHint ? fieldApi.name+'-range' : ''].filter(Boolean).join(' ') || undefined;

  const value = fieldApi.state.value as number | undefined;
  const ui = field.ui as NumberUi | undefined;
  const precisionHint=typeof value==='number' && String(value).length>11 ? String(value) : '';

  // UI options
  const step = field.step ?? 1;
  const variant = ui?.variant ?? "default";
  const prefix = ui?.prefix;
  const suffix = ui?.suffix;
  const hideSteppers = ui?.hideSteppers || variant === "plain";
  const thousandSeparator = ui?.thousandSeparator;
  const copyable = ui?.copyable;
  const sep = typeof thousandSeparator === "string" ? thousandSeparator : ",";


  // Display value for thousand separator mode
  const [displayValue, setDisplayValue] = React.useState<string>(() =>
    thousandSeparator && typeof value === "number"
      ? formatNumberWithSeparator(value, sep)
      : "",
  );

  // Sync display value when external value changes
  React.useEffect(() => {
    if (thousandSeparator && typeof value === "number") {
      setDisplayValue(formatNumberWithSeparator(value, sep));
    } else if (thousandSeparator && value === undefined) {
      setDisplayValue("");
    }
  }, [value, thousandSeparator, sep]);

  const handleChange = (val: number | undefined) => {
    if (isReadOnly) return;
    // Apply precision if specified
    const finalVal = applyNumericPrecision(val, field.precision);
    fieldApi.handleChange(finalVal);
  };

  const handleAdjust = (delta: number) => {
    if (isReadOnly || isDisabled) return;
    const current = typeof value === "number" ? value : (field.min ?? 0);
    const next = clampNumber(current + delta, field.min, field.max);
    handleChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isDisabled || isReadOnly) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      handleAdjust(step);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      handleAdjust(-step);
    }
  };

  const handleFormattedInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const inputVal = e.target.value;
    setDisplayValue(inputVal);
    const parsed = parseFormattedNumber(inputVal, sep);
    handleChange(parsed);
  };

  const handleFormattedInputBlur = () => {
    if (typeof value === "number") {
      setDisplayValue(formatNumberWithSeparator(value, sep));
    }
    handleBlur();
  };

  const renderInput = (className?: string) => {
    // When thousandSeparator is enabled, use text input
    if (thousandSeparator) {
      return (
        <InputGroupInput
          id={fieldApi.name}
          type="text"
          inputMode="numeric"
          value={displayValue}
          onChange={handleFormattedInputChange}
          onBlur={handleFormattedInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            hideSteppers ? "" : "text-center",
            "tabular-nums",
            className,
          )}
          disabled={isDisabled}
          readOnly={isReadOnly}
          aria-invalid={isInvalid}
          aria-describedby={ariaDescribedBy}
          autoFocus={ui?.autoFocus}
        />
      );
    }

    // Standard number input
    return (
      <InputGroupInput
        id={fieldApi.name}
        name={fieldApi.name}
        data-field-path={String(field.meta?.path ?? '')}
        type="number"
        value={value ?? ""}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          handleChange(
            e.target.value === "" ? undefined : Number(e.target.value),
          )
        }
        onBlur={handleBlur}
        onFocus={event=>event.currentTarget.select()}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          "tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]",
          hideSteppers ? "" : "text-center",
          className,
        )}
        disabled={isDisabled}
        readOnly={isReadOnly}
        min={field.min}
        max={field.max}
        step={field.step ?? 'any'}
        aria-invalid={isInvalid}
        aria-describedby={ariaDescribedBy}
        autoFocus={ui?.autoFocus}
        title={value===undefined ? undefined : String(value)+(suffix?' '+suffix:'')}
      />
    );
  };

  const renderInputContent = () => {
    // Plain variant - no steppers
    if (hideSteppers) {
      if (prefix || suffix || copyable) {
        return (
          <InputGroup className="h-9">
            {prefix && (
              <InputGroupAddon
                align="inline-start"
                className="px-3 text-muted-foreground text-ui-note"
              >
                {prefix}
              </InputGroupAddon>
            )}
            {renderInput()}
            {suffix && (
              <InputGroupAddon align="inline-end" className="px-3 text-muted-foreground text-ui-note">
                {suffix}
              </InputGroupAddon>
            )}
            {copyable && (
              <InputGroupAddon align="inline-end">
                <CopyButton value={value?.toString() ?? ""} />
              </InputGroupAddon>
            )}
          </InputGroup>
        );
      }
      return (
        <Input
          id={fieldApi.name}
          data-field-path={String(field.meta?.path ?? '')}
          type="number"
          value={value ?? ""}
          onChange={(e) =>
            handleChange(
              e.target.value === "" ? undefined : Number(e.target.value),
            )
          }
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isDisabled}
          readOnly={isReadOnly}
          min={field.min}
          max={field.max}
          step={field.step ?? 'any'}
          aria-invalid={isInvalid}
          aria-describedby={ariaDescribedBy}
          autoFocus={ui?.autoFocus}
          className="tabular-nums"
        />
      );
    }

    // Stacked variant - vertical buttons on right
    if (variant === "stacked") {
      return (
        <InputGroup className="h-9">
          {prefix && (
            <InputGroupAddon
              align="inline-start"
              className="px-3 text-muted-foreground text-ui-note"
            >
              {prefix}
            </InputGroupAddon>
          )}
          {renderInput("tabular-nums")}
          {suffix && (
            <InputGroupAddon align="inline-end" className="px-2 text-muted-foreground text-ui-note">
              {suffix}
            </InputGroupAddon>
          )}
          <InputGroupAddon
            align="inline-end"
            className="p-0 pr-0 h-full self-stretch"
          >
            <div className="flex flex-col h-full border-l border-input -mr-px overflow-hidden rounded-r-md">
              <button
                type="button"
                onClick={() => handleAdjust(step)}
                disabled={isDisabled || isReadOnly}
                className="flex-1 w-7 flex items-center justify-center border-b border-input text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
                aria-label="增加"
              >
                <IconPlaceholder
                  lucide="Plus"
                  hugeicons="Add01Icon"
                  tabler="IconPlus"
                  phosphor="Plus"
                  remixicon="RiAddLine"
                  className="size-3"
                />
              </button>
              <button
                type="button"
                onClick={() => handleAdjust(-step)}
                disabled={isDisabled || isReadOnly}
                className="flex-1 w-7 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
                aria-label="减少"
              >
                <IconPlaceholder
                  lucide="Minus"
                  hugeicons="MinusSignIcon"
                  tabler="IconMinus"
                  phosphor="Minus"
                  remixicon="RiSubtractLine"
                  className="size-3"
                />
              </button>
            </div>
          </InputGroupAddon>
        </InputGroup>
      );
    }

    // Pill variant - rounded with buttons on sides
    if (variant === "pill") {
      return (
        <InputGroup className="h-9 rounded-ui-pill px-1.5">
          <InputGroupAddon align="inline-start">
            <InputGroupButton
              variant="ghost"
              size="icon-xs"
              onClick={() => handleAdjust(-step)}
              className="rounded-ui-pill size-6"
              disabled={isDisabled || isReadOnly}
              aria-label="减少"
            >
              <IconPlaceholder
                lucide="Minus"
                hugeicons="MinusSignIcon"
                tabler="IconMinus"
                phosphor="Minus"
                remixicon="RiSubtractLine"
                className="size-4"
              />
            </InputGroupButton>
          </InputGroupAddon>
          {prefix && (
            <span className="text-muted-foreground text-ui-note">{prefix}</span>
          )}
          {renderInput()}
          {suffix && (
            <span className="text-muted-foreground text-ui-note">{suffix}</span>
          )}
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              variant="ghost"
              size="icon-xs"
              onClick={() => handleAdjust(step)}
              className="rounded-ui-pill size-6"
              disabled={isDisabled || isReadOnly}
              aria-label="增加"
            >
              <IconPlaceholder
                lucide="Plus"
                hugeicons="Add01Icon"
                tabler="IconPlus"
                phosphor="Plus"
                remixicon="RiAddLine"
                className="size-4"
              />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      );
    }

    // Default variant - inline buttons on sides
    return (
      <InputGroup className="h-9">
        <InputGroupAddon align="inline-start" className="pl-1">
          <InputGroupButton
            variant="ghost"
            size="icon-xs"
            onClick={() => handleAdjust(-step)}
            disabled={isDisabled || isReadOnly}
            aria-label="减少"
            className="size-7"
          >
            <IconPlaceholder
              lucide="Minus"
              hugeicons="MinusSignIcon"
              tabler="IconMinus"
              phosphor="Minus"
              remixicon="RiSubtractLine"
              className="size-3.5"
            />
          </InputGroupButton>
        </InputGroupAddon>
        {prefix && (
          <span className="text-muted-foreground text-ui-note pl-1">{prefix}</span>
        )}
        {renderInput()}
        {suffix && (
          <span className="text-muted-foreground text-ui-note pr-1">{suffix}</span>
        )}
        <InputGroupAddon align="inline-end" className="pr-1">
          <InputGroupButton
            variant="ghost"
            size="icon-xs"
            onClick={() => handleAdjust(step)}
            disabled={isDisabled || isReadOnly}
            aria-label="增加"
            className="size-7"
          >
            <IconPlaceholder
              lucide="Plus"
              hugeicons="Add01Icon"
              tabler="IconPlus"
              phosphor="Plus"
              remixicon="RiAddLine"
              className="size-3.5"
            />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    );
  };

  return (
    <FieldGroup
      data-field={fieldApi.name}
      data-field-path={String(field.meta?.path || '')}
      data-number-wide={(suffix?.length || 0) > 6 || !!precisionHint}
      className={ui?.className}
    >
      <Field data-invalid={isInvalid} data-disabled={isDisabled}>
        {label && (
          <FieldLabel title={typeof description === "string" && description ? description : undefined} htmlFor={fieldApi.name}>
            {isRequired && ui?.asterisk !== false && (
              <span className="text-destructive mr-1">*</span>
            )}
            {label}
          </FieldLabel>
        )}

        <FieldContent>{renderInputContent()}</FieldContent>

        {rangeHint && <p id={fieldApi.name+'-range'} className="parameter-range-hint">{rangeHint}</p>}
        {precisionHint && <p className="parameter-range-hint">完整值：{precisionHint}{suffix ? ' '+suffix : ''}</p>}

        {description && !isInvalid && (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        )}

        {isInvalid && <FieldError id={errorId} errors={errors} />}
      </Field>
    </FieldGroup>
  );
}

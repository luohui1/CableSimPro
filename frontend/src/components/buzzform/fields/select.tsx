"use client";
// BuzzForm registry field adapted to the host's Radix Select.
import { useDataField, useFieldOptions, type SelectField as SelectFieldDef } from '@buildnbuzz/form-react';
import { Select } from '@/components/ui/select';
export function SelectField() {
  const { fieldApi, field, label, description, isDisabled, isReadOnly, isInvalid, errors, handleBlur } = useDataField<SelectFieldDef>();
  const { options, isLoading } = useFieldOptions(field.options);
  return <div data-field={fieldApi.name} data-field-path={String(field.meta?.path || '')} title={typeof description === 'string' && description ? description : undefined}>
    <Select label={typeof label === 'string' ? label : '参数'} value={typeof fieldApi.state.value === 'string' ? fieldApi.state.value : ''}
      options={options.map(option => ({ value: option.value, label: String(option.label), disabled: option.disabled }))}
      disabled={isDisabled || isReadOnly} loading={isLoading}
      error={isInvalid ? errors.map(error => typeof error === 'string' ? error : error.message).join('；') : undefined}
      onChange={value => { fieldApi.handleChange(value); handleBlur(); }} />
    {description && <p className="muted" data-slot="field-description">{description}</p>}
  </div>;
}

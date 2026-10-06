import type { FieldRegistry } from '@buildnbuzz/form-react';
import { NumberField } from './fields/number';
import { TextField } from './fields/text';
import { SelectField } from './fields/select';
import { SwitchField } from './fields/switch';
export const registry: FieldRegistry = { number: NumberField, text: TextField, select: SelectField, switch: SwitchField };

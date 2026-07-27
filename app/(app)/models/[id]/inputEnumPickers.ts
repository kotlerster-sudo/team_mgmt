// Model-side enum pickers — mirror lib/budget/inputEnumOptions.ts but for the
// PlayWorkbench sidebar. The pure formula engine only understands numbers, so
// enum semantics are implemented as 2+ sentinel inputs (exactly one is 1) and
// this picker translates a single dropdown into that shape.
//
// Keyed by (templateKey, groupKey) so different templates can define their own
// pickers without cross-contamination.

export type EnumOption = {
  value: string;
  label: string;
  sentinels: Record<string, number>;
};

export type EnumPicker = {
  pickerKey: string;
  label: string;
  groupKey: string;         // Which model group the picker lives in
  defaultValue: string;
  options: EnumOption[];
  managedNodeKeys: string[];  // ModelNode.key values that this picker owns
};

const SANITATION_PICKERS: EnumPicker[] = [
  {
    pickerKey: "structure_type",
    label: "Building structure",
    groupKey: "capex_in",
    defaultValue: "g_plus_2",
    managedNodeKeys: ["structure_is_single", "structure_is_g1", "structure_is_g2"],
    options: [
      { value: "single_floor", label: "Single floor",       sentinels: { structure_is_single: 1, structure_is_g1: 0, structure_is_g2: 0 } },
      { value: "g_plus_1",     label: "G + 1 (2 floors)",   sentinels: { structure_is_single: 0, structure_is_g1: 1, structure_is_g2: 0 } },
      { value: "g_plus_2",     label: "G + 2 (3 floors)",   sentinels: { structure_is_single: 0, structure_is_g1: 0, structure_is_g2: 1 } },
    ],
  },
];

// templateKey → pickers
export const MODEL_ENUM_PICKERS: Record<string, EnumPicker[]> = {
  sanitation_complex: SANITATION_PICKERS,
};

export function pickersForTemplate(templateKey: string): EnumPicker[] {
  return MODEL_ENUM_PICKERS[templateKey] ?? [];
}

export function managedNodeKeys(templateKey: string): Set<string> {
  return new Set(pickersForTemplate(templateKey).flatMap(p => p.managedNodeKeys));
}

/** Given a picker + selected value, return the sentinel patch to merge into inputs. */
export function expandPickerValue(picker: EnumPicker, value: string): Record<string, number> {
  const opt = picker.options.find(o => o.value === value) ?? picker.options.find(o => o.value === picker.defaultValue);
  return opt?.sentinels ?? {};
}

/** Given an input record, infer which option a picker is currently on. */
export function inferPickerValue(picker: EnumPicker, inputs: Record<string, unknown>, defaults: Record<string, number>): string {
  for (const opt of picker.options) {
    const match = Object.entries(opt.sentinels).every(([k, v]) => {
      const current = inputs[k] ?? defaults[k] ?? 0;
      return Number(current) === v;
    });
    if (match) return opt.value;
  }
  return picker.defaultValue;
}

// Enum-typed programme inputs — presented as a single picker in the budget
// form, but stored as N sentinel numeric inp.* keys (one is 1, rest are 0)
// so the pure-numeric formula engine can multiply against them.
//
// Add an entry per enum picker. The `pickerKey` is a virtual input key that
// only exists in the form; on submit, its selected option's `sentinels`
// are folded into the real inp.* payload sent to the generator.

export type EnumOption = {
  value: string;
  label: string;
  sentinels: Record<string, number>;
};

export type EnumPicker = {
  pickerKey: string;         // virtual, only used in the form
  label: string;
  displayGroup?: string;
  defaultValue: string;
  options: EnumOption[];
  // Sentinel keys we manage — for hiding them from the standard numeric list.
  managedInputKeys: string[];
};

export const ENUM_PICKERS: EnumPicker[] = [
  {
    pickerKey: "structureType",
    label: "Building structure",
    displayGroup: "facilities",
    defaultValue: "g_plus_2",
    managedInputKeys: ["structureIsSingle", "structureIsG1", "structureIsG2"],
    options: [
      { value: "single_floor", label: "Single floor",       sentinels: { structureIsSingle: 1, structureIsG1: 0, structureIsG2: 0 } },
      { value: "g_plus_1",     label: "G + 1 (2 floors)",   sentinels: { structureIsSingle: 0, structureIsG1: 1, structureIsG2: 0 } },
      { value: "g_plus_2",     label: "G + 2 (3 floors)",   sentinels: { structureIsSingle: 0, structureIsG1: 0, structureIsG2: 1 } },
    ],
  },
];

/** All inp.* keys managed by an enum picker — hide these from numeric input rows. */
export const ENUM_MANAGED_INPUT_KEYS = new Set(
  ENUM_PICKERS.flatMap(p => p.managedInputKeys)
);

/** Given a picker + selected value, return the sentinel inp.* payload. */
export function expandEnum(pickerKey: string, value: string): Record<string, number> {
  const picker = ENUM_PICKERS.find(p => p.pickerKey === pickerKey);
  if (!picker) return {};
  const opt = picker.options.find(o => o.value === value) ?? picker.options.find(o => o.value === picker.defaultValue);
  return opt?.sentinels ?? {};
}

/** Given a full inp.* record, infer which enum option is currently selected. */
export function inferEnumValue(pickerKey: string, inp: Record<string, number | undefined>): string {
  const picker = ENUM_PICKERS.find(p => p.pickerKey === pickerKey);
  if (!picker) return "";
  for (const opt of picker.options) {
    const match = Object.entries(opt.sentinels).every(([k, v]) => (inp[k] ?? 0) === v);
    if (match) return opt.value;
  }
  return picker.defaultValue;
}

// The connector choices shown in the charge point forms. Each value is the code the
// server stores and sends to roaming partners (OCPI 2.2.1). The label is the friendly
// name; the aliases are other names people use for the same plug or format.

export const CONNECTOR_STANDARD_OPTIONS = [
  { value: 'IEC_62196_T1', name: 'SAE J1772 Type 1', aliases: ['J1772', 'IEC 62196 Type 1'], group: 'AC' },
  { value: 'IEC_62196_T2', name: 'Type 2 (Mennekes)', aliases: ['IEC 62196 Type 2', 'Mennekes'], group: 'AC' },
  { value: 'IEC_62196_T3A', name: 'Type 3A', aliases: ['EV-Plug Alliance', 'IEC 62196 Type 3A'], group: 'AC' },
  { value: 'IEC_62196_T3C', name: 'Type 3C (Scame)', aliases: ['Scame', 'IEC 62196 Type 3C'], group: 'AC' },
  { value: 'IEC_62196_T1_COMBO', name: 'CCS1 (Combo 1)', aliases: ['Combined Charging System Type 1', 'SAE J1772 combo'], group: 'DC' },
  { value: 'IEC_62196_T2_COMBO', name: 'CCS2 (Combo 2)', aliases: ['Combined Charging System Type 2'], group: 'DC' },
  { value: 'CHADEMO', name: 'CHAdeMO', aliases: ['DC fast charge'], group: 'DC' },
  {
    value: 'TESLA_S',
    name: 'Tesla connector (NACS)',
    aliases: ['SAE J3400', 'Tesla'],
    group: 'Tesla',
    note: 'The same Tesla plug can charge on AC or DC. Set the power type to match this connector.',
  },
  { value: 'TESLA_R', name: 'Tesla Roadster connector', aliases: ['Tesla Roadster'], group: 'Tesla' },
  { value: 'DOMESTIC_A', name: 'NEMA 1-15 (US household)', aliases: ['Domestic A'], group: 'Domestic' },
  { value: 'DOMESTIC_B', name: 'NEMA 5-15 (US and Canada household)', aliases: ['Domestic B'], group: 'Domestic' },
  { value: 'DOMESTIC_C', name: 'Europe 2-pin (Type C)', aliases: ['Euro plug', 'Domestic C'], group: 'Domestic' },
  { value: 'DOMESTIC_D', name: 'India (Type D)', aliases: ['Domestic D'], group: 'Domestic' },
  { value: 'DOMESTIC_E', name: 'France (Type E, CEE 7/5)', aliases: ['Domestic E'], group: 'Domestic' },
  { value: 'DOMESTIC_F', name: 'Schuko (Type F, CEE 7/4)', aliases: ['Domestic F'], group: 'Domestic' },
  { value: 'DOMESTIC_G', name: 'UK 3-pin (Type G, BS 1363)', aliases: ['Domestic G'], group: 'Domestic' },
  { value: 'DOMESTIC_H', name: 'Israel (SI 32)', aliases: ['Domestic H'], group: 'Domestic' },
  { value: 'DOMESTIC_I', name: 'Australia and New Zealand (Type I)', aliases: ['Domestic I'], group: 'Domestic' },
  { value: 'DOMESTIC_J', name: 'Switzerland (Type J, SEV 1011)', aliases: ['Domestic J'], group: 'Domestic' },
  { value: 'DOMESTIC_K', name: 'Denmark (Type K)', aliases: ['Domestic K'], group: 'Domestic' },
  { value: 'DOMESTIC_L', name: 'Italy (Type L, CEI 23-50)', aliases: ['Domestic L'], group: 'Domestic' },
];

export const CONNECTOR_FORMAT_OPTIONS = [
  { value: 'CABLE', name: 'Tethered cable', aliases: ['The cable is attached to the charger'] },
  { value: 'SOCKET', name: 'Socket', aliases: ['The driver brings their own cable'] },
];

export const POWER_TYPE_OPTIONS = [
  { value: 'AC_1_PHASE', name: 'AC single-phase', aliases: [] },
  { value: 'AC_2_PHASE', name: 'AC two-phase', aliases: [] },
  { value: 'AC_2_PHASE_SPLIT', name: 'AC split-phase', aliases: [] },
  { value: 'AC_3_PHASE', name: 'AC three-phase', aliases: [] },
  { value: 'DC', name: 'DC', aliases: ['Rapid and fast charging'] },
];

export function optionFor(options, value) {
  return options.find((o) => o.value === value);
}

// The regions a license plate can belong to, offered on the waitlist join form.
//
// Each installation picks which built-in sets to offer (US states, Canadian
// provinces and territories, EU member states) and can add its own entries.
// Codes are ISO 3166-2 style ("US-CA", "CA-ON") for the subdivisions, and
// ISO 3166-1 alpha-2 for countries, so they never clash.

export const PLATE_REGION_SETS = {
  US: {
    name: 'United States',
    entries: [
      ['US-AL', 'Alabama'], ['US-AK', 'Alaska'], ['US-AZ', 'Arizona'], ['US-AR', 'Arkansas'],
      ['US-CA', 'California'], ['US-CO', 'Colorado'], ['US-CT', 'Connecticut'], ['US-DE', 'Delaware'],
      ['US-DC', 'District of Columbia'], ['US-FL', 'Florida'], ['US-GA', 'Georgia'], ['US-HI', 'Hawaii'],
      ['US-ID', 'Idaho'], ['US-IL', 'Illinois'], ['US-IN', 'Indiana'], ['US-IA', 'Iowa'],
      ['US-KS', 'Kansas'], ['US-KY', 'Kentucky'], ['US-LA', 'Louisiana'], ['US-ME', 'Maine'],
      ['US-MD', 'Maryland'], ['US-MA', 'Massachusetts'], ['US-MI', 'Michigan'], ['US-MN', 'Minnesota'],
      ['US-MS', 'Mississippi'], ['US-MO', 'Missouri'], ['US-MT', 'Montana'], ['US-NE', 'Nebraska'],
      ['US-NV', 'Nevada'], ['US-NH', 'New Hampshire'], ['US-NJ', 'New Jersey'], ['US-NM', 'New Mexico'],
      ['US-NY', 'New York'], ['US-NC', 'North Carolina'], ['US-ND', 'North Dakota'], ['US-OH', 'Ohio'],
      ['US-OK', 'Oklahoma'], ['US-OR', 'Oregon'], ['US-PA', 'Pennsylvania'], ['US-RI', 'Rhode Island'],
      ['US-SC', 'South Carolina'], ['US-SD', 'South Dakota'], ['US-TN', 'Tennessee'], ['US-TX', 'Texas'],
      ['US-UT', 'Utah'], ['US-VT', 'Vermont'], ['US-VA', 'Virginia'], ['US-WA', 'Washington'],
      ['US-WV', 'West Virginia'], ['US-WI', 'Wisconsin'], ['US-WY', 'Wyoming'],
    ],
  },
  CA: {
    name: 'Canada',
    entries: [
      ['CA-AB', 'Alberta'], ['CA-BC', 'British Columbia'], ['CA-MB', 'Manitoba'], ['CA-NB', 'New Brunswick'],
      ['CA-NL', 'Newfoundland and Labrador'], ['CA-NS', 'Nova Scotia'], ['CA-ON', 'Ontario'],
      ['CA-PE', 'Prince Edward Island'], ['CA-QC', 'Quebec'], ['CA-SK', 'Saskatchewan'],
      ['CA-NT', 'Northwest Territories'], ['CA-NU', 'Nunavut'], ['CA-YT', 'Yukon'],
    ],
  },
  EU: {
    name: 'European Union',
    entries: [
      ['AT', 'Austria'], ['BE', 'Belgium'], ['BG', 'Bulgaria'], ['HR', 'Croatia'], ['CY', 'Cyprus'],
      ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EE', 'Estonia'], ['FI', 'Finland'], ['FR', 'France'],
      ['DE', 'Germany'], ['GR', 'Greece'], ['HU', 'Hungary'], ['IE', 'Ireland'], ['IT', 'Italy'],
      ['LV', 'Latvia'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MT', 'Malta'], ['NL', 'Netherlands'],
      ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SK', 'Slovakia'], ['SI', 'Slovenia'],
      ['ES', 'Spain'], ['SE', 'Sweden'],
    ],
  },
};

export const DEFAULT_PLATE_REGION_SETS = ['US', 'CA', 'EU'];

const CODE_PATTERN = /^[A-Za-z0-9-]{1,12}$/;
const MAX_CUSTOM = 200;

// The built-in sets, for the admin form to offer as checkboxes.
export function plateRegionSetList() {
  return Object.entries(PLATE_REGION_SETS).map(([id, set]) => ({ id, name: set.name, count: set.entries.length }));
}

// Every built-in region, with the set it belongs to, so the admin form can show the
// default list for whichever sets are ticked before it is saved.
export function plateRegionCatalog() {
  return Object.entries(PLATE_REGION_SETS).flatMap(([id, set]) =>
    set.entries.map(([code, name]) => ({ code, name, group: set.name, set: id })),
  );
}

// Parses the stored configuration. Null (never set) means the default sets and no custom entries.
export function parsePlateRegionConfig(stored) {
  if (!stored) return { sets: [...DEFAULT_PLATE_REGION_SETS], custom: [] };
  try {
    const parsed = JSON.parse(stored);
    return {
      sets: Array.isArray(parsed.sets) ? parsed.sets.filter((s) => PLATE_REGION_SETS[s]) : [],
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    };
  } catch {
    return { sets: [...DEFAULT_PLATE_REGION_SETS], custom: [] };
  }
}

// The regions the join form offers: the chosen built-in sets, then the custom entries.
export function effectivePlateRegions(config) {
  const builtIn = config.sets.flatMap((id) =>
    PLATE_REGION_SETS[id].entries.map(([code, name]) => ({ code, name, group: PLATE_REGION_SETS[id].name })),
  );
  const custom = config.custom.map((entry) => ({ code: entry.code, name: entry.name, group: 'Custom' }));
  return [...builtIn, ...custom];
}

// Checks an admin's submission. Returns { config } (ready to store) or { error }.
export function validatePlateRegionConfig(input) {
  if (!input || typeof input !== 'object') return { error: 'plateRegionConfig must be an object' };
  const sets = Array.isArray(input.sets) ? input.sets : [];
  if (sets.some((s) => !PLATE_REGION_SETS[s])) return { error: 'Unknown plate region set' };
  const custom = Array.isArray(input.custom) ? input.custom : [];
  if (custom.length > MAX_CUSTOM) return { error: `At most ${MAX_CUSTOM} custom plate regions` };

  const seen = new Set(effectivePlateRegions({ sets: [...new Set(sets)], custom: [] }).map((r) => r.code));
  const cleanCustom = [];
  for (const entry of custom) {
    const code = typeof entry?.code === 'string' ? entry.code.trim().toUpperCase() : '';
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!CODE_PATTERN.test(code)) return { error: `Code "${entry?.code ?? ''}" must be 1-12 letters, digits or hyphens` };
    if (!name || name.length > 80) return { error: `Give code ${code} a name of up to 80 characters` };
    if (seen.has(code)) return { error: `Code ${code} is listed twice` };
    seen.add(code);
    cleanCustom.push({ code, name });
  }
  if (seen.size === 0) return { error: 'Offer at least one plate region' };
  return { config: { sets: [...new Set(sets)], custom: cleanCustom } };
}

// True when a region code is on the list the installation offers.
export function isOfferedRegion(config, code) {
  return effectivePlateRegions(config).some((r) => r.code === code);
}

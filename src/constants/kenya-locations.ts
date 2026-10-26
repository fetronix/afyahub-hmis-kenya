/**
 * Kenya's counties and their sub-counties.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The registration screen offered ten counties in a hard-coded `<select>` and
 * a free-text sub-county box. A patient from, say, Baringo could not be
 * recorded at all; a patient from Nyeri could be given the sub-county
 * "Kasarani", which is in Nairobi. Both facts then went into the patients
 * table and into anything built on it afterwards.
 *
 * THE DATA
 * --------
 * 47 counties, 290 sub-counties. The counts are fixed by the Constitution of
 * Kenya (First Schedule for the counties) and by IEBC for the constituencies,
 * which is what the sub-county boundaries follow; total 290 is the number
 * used by the Independent Electoral and Boundaries Commission and by the
 * Ministry of Health's sub-county health management teams.
 *
 * County codes are the official 001-047 codes, kept as strings because they
 * are identifiers with leading zeros, not numbers. They are here for reports
 * that key on the official code and are not shown in the UI.
 *
 * Names use the official spelling: "Taita-Taveta", "Tharaka-Nithi",
 * "Elgeyo-Marakwet", "Murang'a", "Nairobi" (the county is Nairobi City, but
 * every dataset, the 2019 census and the MOH use "Nairobi").
 *
 * SUB-COUNTIES, NOT WARDS
 * -----------------------
 * A sub-county is a constituency here, not a ward. Wards are the third tier
 * (1,450 of them) and are too fine-grained for a residence field: most
 * facilities would leave the ward blank, and the field would stop being used.
 * A sub-county is what a health record needs - it names the sub-county health
 * management team responsible for the patient's residence.
 *
 * This is the single source of truth. The registration form, the facility
 * form, the write-path validation and the 0023 migration all read from it -
 * the migration's VALUES list is generated from this file and a test asserts
 * the two still agree.
 */

export interface KenyaCounty {
  /** Official county code, 001-047. A string because of the leading zeros. */
  readonly code: string;
  readonly name: string;
  /** Constituencies, which is what a sub-county is in the health system. */
  readonly subCounties: readonly string[];
}

export const KENYA_COUNTIES: readonly KenyaCounty[] = [
  {
    code: '001',
    name: 'Mombasa',
    subCounties: ['Changamwe', 'Jomvu', 'Kisauni', 'Likoni', 'Mvita', 'Nyali'],
  },
  {
    code: '002',
    name: 'Kwale',
    subCounties: ['Kinango', 'Lunga Lunga', 'Matuga', 'Msambweni'],
  },
  {
    code: '003',
    name: 'Kilifi',
    subCounties: [
      'Ganze',
      'Kaloleni',
      'Kilifi North',
      'Kilifi South',
      'Magarini',
      'Malindi',
      'Rabai',
    ],
  },
  {
    code: '004',
    name: 'Tana River',
    subCounties: ['Bura', 'Galole', 'Garsen'],
  },
  {
    code: '005',
    name: 'Lamu',
    subCounties: ['Lamu East', 'Lamu West'],
  },
  {
    code: '006',
    name: 'Taita-Taveta',
    subCounties: ['Mwatate', 'Taveta', 'Voi', 'Wundanyi'],
  },
  {
    code: '007',
    name: 'Garissa',
    subCounties: ['Balambala', 'Dadaab', 'Fafi', 'Garissa Township', 'Ijara', 'Lagdera'],
  },
  {
    code: '008',
    name: 'Wajir',
    subCounties: ['Eldas', 'Tarbaj', 'Wajir East', 'Wajir North', 'Wajir South', 'Wajir West'],
  },
  {
    code: '009',
    name: 'Mandera',
    subCounties: [
      'Banissa',
      'Lafey',
      'Mandera East',
      'Mandera North',
      'Mandera South',
      'Mandera West',
    ],
  },
  {
    code: '010',
    name: 'Marsabit',
    subCounties: ['Laisamis', 'Moyale', 'North Horr', 'Saku'],
  },
  {
    code: '011',
    name: 'Isiolo',
    subCounties: ['Isiolo North', 'Isiolo South'],
  },
  {
    code: '012',
    name: 'Meru',
    subCounties: [
      'Buuri',
      'Central Imenti',
      'Igembe Central',
      'Igembe North',
      'Igembe South',
      'North Imenti',
      'South Imenti',
      'Tigania East',
      'Tigania West',
    ],
  },
  {
    code: '013',
    name: 'Tharaka-Nithi',
    subCounties: ["Chuka/Igambang'ombe", 'Maara', 'Tharaka'],
  },
  {
    code: '014',
    name: 'Embu',
    subCounties: ['Manyatta', 'Mbeere North', 'Mbeere South', 'Runyenjes'],
  },
  {
    code: '015',
    name: 'Kitui',
    subCounties: [
      'Kitui Central',
      'Kitui East',
      'Kitui Rural',
      'Kitui South',
      'Kitui West',
      'Mwingi Central',
      'Mwingi North',
      'Mwingi West',
    ],
  },
  {
    code: '016',
    name: 'Machakos',
    subCounties: [
      'Kangundo',
      'Kathiani',
      'Machakos Town',
      'Masinga',
      'Matungulu',
      'Mavoko',
      'Mwala',
      'Yatta',
    ],
  },
  {
    code: '017',
    name: 'Makueni',
    subCounties: ['Kaiti', 'Kibwezi East', 'Kibwezi West', 'Kilome', 'Makueni', 'Mbooni'],
  },
  {
    code: '018',
    name: 'Nyandarua',
    subCounties: ['Kinangop', 'Kipipiri', 'Ndaragwa', 'Ol Joro Orok', 'Ol Kalou'],
  },
  {
    code: '019',
    name: 'Nyeri',
    subCounties: ['Kieni', 'Mathira', 'Mukurweini', 'Nyeri Town', 'Othaya', 'Tetu'],
  },
  {
    code: '020',
    name: 'Kirinyaga',
    subCounties: ['Gichugu', 'Kirinyaga Central', 'Mwea', 'Ndia'],
  },
  {
    code: '021',
    name: "Murang'a",
    subCounties: ['Gatanga', 'Kandara', 'Kangema', 'Kigumo', 'Kiharu', 'Maragua', 'Mathioya'],
  },
  {
    code: '022',
    name: 'Kiambu',
    subCounties: [
      'Gatundu North',
      'Gatundu South',
      'Githunguri',
      'Juja',
      'Kabete',
      'Kiambaa',
      'Kiambu Town',
      'Kikuyu',
      'Lari',
      'Limuru',
      'Ruiru',
      'Thika Town',
    ],
  },
  {
    code: '023',
    name: 'Turkana',
    subCounties: [
      'Loima',
      'Turkana Central',
      'Turkana East',
      'Turkana North',
      'Turkana South',
      'Turkana West',
    ],
  },
  {
    code: '024',
    name: 'West Pokot',
    subCounties: ['Kacheliba', 'Kapenguria', 'Pokot South', 'Sigor'],
  },
  {
    code: '025',
    name: 'Samburu',
    subCounties: ['Samburu East', 'Samburu North', 'Samburu West'],
  },
  {
    code: '026',
    name: 'Trans Nzoia',
    subCounties: ['Cherangany', 'Endebess', 'Kiminini', 'Kwanza', 'Saboti'],
  },
  {
    code: '027',
    name: 'Uasin Gishu',
    subCounties: ['Ainabkoi', 'Kapseret', 'Kesses', 'Moiben', 'Soy', 'Turbo'],
  },
  {
    code: '028',
    name: 'Elgeyo-Marakwet',
    subCounties: ['Keiyo North', 'Keiyo South', 'Marakwet East', 'Marakwet West'],
  },
  {
    code: '029',
    name: 'Nandi',
    subCounties: ['Aldai', 'Chesumei', 'Emgwen', 'Mosop', 'Nandi Hills', 'Tinderet'],
  },
  {
    code: '030',
    name: 'Baringo',
    subCounties: [
      'Baringo Central',
      'Baringo North',
      'Baringo South',
      'Eldama Ravine',
      'Mogotio',
      'Tiaty',
    ],
  },
  {
    code: '031',
    name: 'Laikipia',
    subCounties: ['Laikipia East', 'Laikipia North', 'Laikipia West'],
  },
  {
    code: '032',
    name: 'Nakuru',
    subCounties: [
      'Bahati',
      'Gilgil',
      'Kuresoi North',
      'Kuresoi South',
      'Molo',
      'Naivasha',
      'Nakuru Town East',
      'Nakuru Town West',
      'Njoro',
      'Rongai',
      'Subukia',
    ],
  },
  {
    code: '033',
    name: 'Narok',
    subCounties: [
      'Emurua Dikirr',
      'Kilgoris',
      'Narok East',
      'Narok North',
      'Narok South',
      'Narok West',
    ],
  },
  {
    code: '034',
    name: 'Kajiado',
    subCounties: [
      'Kajiado Central',
      'Kajiado East',
      'Kajiado North',
      'Kajiado South',
      'Kajiado West',
    ],
  },
  {
    code: '035',
    name: 'Kericho',
    subCounties: [
      'Ainamoi',
      'Belgut',
      'Bureti',
      'Kipkelion East',
      'Kipkelion West',
      'Sigowet/Soin',
    ],
  },
  {
    code: '036',
    name: 'Bomet',
    subCounties: ['Bomet Central', 'Bomet East', 'Chepalungu', 'Konoin', 'Sotik'],
  },
  {
    code: '037',
    name: 'Kakamega',
    subCounties: [
      'Butere',
      'Ikolomani',
      'Khwisero',
      'Likuyani',
      'Lugari',
      'Lurambi',
      'Malava',
      'Matungu',
      'Mumias East',
      'Mumias West',
      'Navakholo',
      'Shinyalu',
    ],
  },
  {
    code: '038',
    name: 'Bungoma',
    subCounties: [
      'Bumula',
      'Kabuchai',
      'Kanduyi',
      'Kimilili',
      'Mt. Elgon',
      'Sirisia',
      'Tongaren',
      'Webuye East',
      'Webuye West',
    ],
  },
  {
    code: '039',
    name: 'Vihiga',
    subCounties: ['Emuhaya', 'Hamisi', 'Luanda', 'Sabatia', 'Vihiga'],
  },
  {
    code: '040',
    name: 'Busia',
    subCounties: [
      'Budalangi',
      'Butula',
      'Funyula',
      'Matayos',
      'Nambale',
      'Teso North',
      'Teso South',
    ],
  },
  {
    code: '041',
    name: 'Siaya',
    subCounties: ['Alego Usonga', 'Bondo', 'Gem', 'Rarieda', 'Ugenya', 'Ugunja'],
  },
  {
    code: '042',
    name: 'Kisumu',
    subCounties: [
      'Kisumu Central',
      'Kisumu East',
      'Kisumu West',
      'Muhoroni',
      'Nyakach',
      'Nyando',
      'Seme',
    ],
  },
  {
    code: '043',
    name: 'Homa Bay',
    subCounties: [
      'Homa Bay Town',
      'Kabondo Kasipul',
      'Karachuonyo',
      'Kasipul',
      'Ndhiwa',
      'Rangwe',
      'Suba North',
      'Suba South',
    ],
  },
  {
    code: '044',
    name: 'Migori',
    subCounties: [
      'Awendo',
      'Kuria East',
      'Kuria West',
      'Nyatike',
      'Rongo',
      'Suna East',
      'Suna West',
      'Uriri',
    ],
  },
  {
    code: '045',
    name: 'Kisii',
    subCounties: [
      'Bobasi',
      'Bomachoge Borabu',
      'Bomachoge Chache',
      'Bonchari',
      'Kitutu Chache North',
      'Kitutu Chache South',
      'Nyaribari Chache',
      'Nyaribari Masaba',
      'South Mugirango',
    ],
  },
  {
    code: '046',
    name: 'Nyamira',
    subCounties: ['Borabu', 'Kitutu Masaba', 'North Mugirango', 'West Mugirango'],
  },
  {
    code: '047',
    name: 'Nairobi',
    subCounties: [
      'Dagoretti North',
      'Dagoretti South',
      'Embakasi Central',
      'Embakasi East',
      'Embakasi North',
      'Embakasi South',
      'Embakasi West',
      'Kamukunji',
      'Kasarani',
      'Kibra',
      'Langata',
      'Makadara',
      'Mathare',
      'Roysambu',
      'Ruaraka',
      'Starehe',
      'Westlands',
    ],
  },
];

/** The 47 county names, in official order. */
export const COUNTY_NAMES: readonly string[] = KENYA_COUNTIES.map((county) => county.name);

/** Comparison key: ignores case, surrounding space and repeated inner space. */
function key(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

const BY_COUNTY = new Map(KENYA_COUNTIES.map((county) => [key(county.name), county]));

/** Sub-county name -> every county that contains a sub-county of that name. */
const BY_SUB_COUNTY = new Map<string, KenyaCounty[]>();

for (const county of KENYA_COUNTIES) {
  for (const subCounty of county.subCounties) {
    const bucket = BY_SUB_COUNTY.get(key(subCounty)) ?? [];

    bucket.push(county);
    BY_SUB_COUNTY.set(key(subCounty), bucket);
  }
}

/**
 * The canonical county record for a name the caller supplied.
 *
 * Case, padding and repeated spaces are tolerated - a record typed as
 * "nairobi" or " Trans  Nzoia " is the county. Anything else returns
 * undefined rather than a guess.
 */
export function findCounty(name: string | null | undefined): KenyaCounty | undefined {
  if (!name) return undefined;

  return BY_COUNTY.get(key(name));
}

/** True when `name` is one of the 47, however it was capitalised. */
export function isKnownCounty(name: string | null | undefined): boolean {
  return findCounty(name) !== undefined;
}

/**
 * The sub-counties of a county, in the order they are listed above.
 *
 * Returns an empty array for a county this file does not know: an unknown
 * county has no sub-counties to choose from, which is a truer answer than
 * offering all 290.
 */
export function subCountiesOf(county: string | null | undefined): readonly string[] {
  return findCounty(county)?.subCounties ?? [];
}

/** The canonical spelling of a sub-county inside a county, or undefined. */
export function findSubCounty(
  county: string | null | undefined,
  subCounty: string | null | undefined,
): string | undefined {
  if (!subCounty) return undefined;

  return subCountiesOf(county).find((candidate) => key(candidate) === key(subCounty));
}

/**
 * Every county that has a sub-county of this name.
 *
 * Ambiguous by nature - there is a Kitui Central in Kitui but no rule that
 * stops another county naming one the same way - so the caller gets a list.
 * Used by the migration to repair a county only when exactly one county can
 * own the stored sub-county.
 */
export function countiesWithSubCounty(subCounty: string | null | undefined): readonly string[] {
  if (!subCounty) return [];

  return (BY_SUB_COUNTY.get(key(subCounty)) ?? []).map((county) => county.name);
}

/** Total sub-counties across the country. Should be 290. */
export const SUB_COUNTY_COUNT = KENYA_COUNTIES.reduce(
  (total, county) => total + county.subCounties.length,
  0,
);

/**
 * County names that appeared in this repository or in the older screens and
 * are not the canonical spelling.
 *
 * Only additions of a spelling variant belong here - never a rename of a
 * county. The migration uses this list; `normaliseCounty` applies it.
 */
export const COUNTY_ALIASES: Readonly<Record<string, string>> = {
  'nairobi city': 'Nairobi',
  'nairobi city county': 'Nairobi',
  muranga: "Murang'a",
  'murang`a': "Murang'a",
  'taita taveta': 'Taita-Taveta',
  'tharaka nithi': 'Tharaka-Nithi',
  'elgeyo marakwet': 'Elgeyo-Marakwet',
  transnzoia: 'Trans Nzoia',
  'trans-nzoia': 'Trans Nzoia',
  westpokot: 'West Pokot',
  'west-pokot': 'West Pokot',
  homabay: 'Homa Bay',
  'homa-bay': 'Homa Bay',
  'uasin-gishu': 'Uasin Gishu',
  'baringo county': 'Baringo',
};

/**
 * The canonical county name for whatever was stored, or undefined.
 *
 * Tries the canonical list first, then the alias table, so "muranga" and
 * "Murang'a" both answer "Murang'a".
 */
export function normaliseCounty(value: string | null | undefined): string | undefined {
  const direct = findCounty(value);

  if (direct) return direct.name;

  if (!value) return undefined;

  return COUNTY_ALIASES[key(value)];
}

/**
 * What the write path should store for a county/sub-county pair.
 *
 * Used by patient registration and by the platform facility routes, which is
 * why it is named for the pair rather than for a patient.
 *
 * The rules, in order:
 *
 *   - no county            -> store nothing for city, refuse a sub-county
 *                             with no county to check it against;
 *   - unknown county       -> store both as supplied, so an older client or
 *                             an import is not silently rejected (the data
 *                             is still wrong, and the migration reports it,
 *                             but this path does not lose the record);
 *   - known county         -> county in canonical spelling; sub-county must
 *                             be one of that county's, in canonical spelling,
 *                             or the request is refused with the list.
 */
export type LocationResolution =
  { ok: true; county: string | null; subCounty: string | null } | { ok: false; message: string };

export function resolveLocation(
  county: string | null | undefined,
  subCounty: string | null | undefined,
): LocationResolution {
  const cleanCounty = county?.trim() ?? '';
  const cleanSubCounty = subCounty?.trim() ?? '';

  if (!cleanCounty) {
    if (cleanSubCounty) {
      return {
        ok: false,
        message: 'A sub-county needs a county: choose the county of residence first.',
      };
    }

    return { ok: true, county: null, subCounty: null };
  }

  const canonicalCounty = normaliseCounty(cleanCounty);

  if (!canonicalCounty) {
    return { ok: true, county: cleanCounty, subCounty: cleanSubCounty || null };
  }

  if (!cleanSubCounty) return { ok: true, county: canonicalCounty, subCounty: null };

  const canonicalSubCounty = findSubCounty(canonicalCounty, cleanSubCounty);

  if (!canonicalSubCounty) {
    const options = subCountiesOf(canonicalCounty).join(', ');

    return {
      ok: false,
      message: `"${cleanSubCounty}" is not a sub-county of ${canonicalCounty}. Choose one of: ${options}.`,
    };
  }

  return { ok: true, county: canonicalCounty, subCounty: canonicalSubCounty };
}

// build_assessment_cache.mjs
// Fetches all Veierland species from GBIF, checks Norwegian Red List (2015)
// + Vascular Plants 2021 + GRIIS Norway, saves assessment_cache.json

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '../src/data');

// GBIF dataset keys
const RL2015   = '4f1047ac-a19d-41a8-98eb-d968b2548b53'; // Norwegian Red List 2015
const RL_PLANT = '02b69283-72f8-4406-81ac-5cae93e18846'; // Red List Vascular Plants 2021
const GRIIS_NO = '38de3b7a-5af3-4b6f-a1c5-4c0aa6abf010'; // GRIIS Norway

const THREAT_MAP = {
  NEAR_THREATENED:       'NT',
  VULNERABLE:            'VU',
  ENDANGERED:            'EN',
  CRITICALLY_ENDANGERED: 'CR',
  REGIONALLY_EXTINCT:    'RE',
  DATA_DEFICIENT:        'DD',
};

// Veierland boundary (CCW for GBIF)
const boundary = JSON.parse(readFileSync(join(DATA_DIR, 'veierland_boundary.json'), 'utf8'));
const coords = [...boundary.coordinates[0]].reverse();
const GBIF_POLYGON = encodeURIComponent(
  'POLYGON((' + coords.map(c => `${c[0]} ${c[1]}`).join(',') + '))'
);

const NATURE_GROUPS = {
  Fugler:      { taxonKey: 212  },
  Karplanter:  { taxonKey: 6    },
  Pattedyr:    { taxonKey: 359  },
  Sommerfugler:{ taxonKey: 797  },
  Sopper:      { taxonKey: 5    },
};

async function fetchGroup(taxonKey) {
  const url = `https://api.gbif.org/v1/occurrence/search?geometry=${GBIF_POLYGON}&taxonKey=${taxonKey}&limit=300`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

function deduplicateSpecies(allObs) {
  const latestMap = new Map();
  for (const o of allObs) {
    const key = o.speciesKey;
    if (!key || !o.decimalLatitude || !o.species) continue;
    const date = String(o.eventDate ?? '');
    const existing = latestMap.get(key);
    if (!existing || date > existing.date) {
      latestMap.set(key, { scientificName: o.species, gbifKey: key, date });
    }
  }
  return [...latestMap.values()];
}

async function checkChecklist(datasetKey, name) {
  try {
    const res = await fetch(
      `https://api.gbif.org/v1/species/search?datasetKey=${datasetKey}&q=${encodeURIComponent(name)}&limit=1`
    );
    if (!res.ok) return { found: false };
    const d = await res.json();
    const item = d.results?.[0];
    if (!item) return { found: false };
    const resultName = (item.canonicalName ?? item.scientificName ?? '').toLowerCase();
    const genus = name.split(' ')[0].toLowerCase();
    const epithet = name.split(' ')[1]?.toLowerCase();
    if (!resultName.startsWith(genus) || (epithet && !resultName.includes(epithet))) return { found: false };
    const threat = item.threatStatuses?.[0];
    return { found: true, category: threat ? (THREAT_MAP[threat] ?? undefined) : undefined };
  } catch {
    return { found: false };
  }
}

async function assessSpecies(scientificName) {
  const [rl2015, rlPlant, alien] = await Promise.all([
    checkChecklist(RL2015,   scientificName),
    checkChecklist(RL_PLANT, scientificName),
    checkChecklist(GRIIS_NO, scientificName),
  ]);
  const redListCategory =
    (rlPlant.found && rlPlant.category) ? rlPlant.category :
    (rl2015.found  && rl2015.category)  ? rl2015.category  : undefined;
  const alienCategory = alien.found ? 'FREMMED' : undefined;
  return { redListCategory, alienCategory };
}

async function main() {
  console.log('Fetching Veierland species from GBIF...');
  const rawGroups = await Promise.all(
    Object.values(NATURE_GROUPS).map(g => fetchGroup(g.taxonKey))
  );
  const allObs = rawGroups.flat();
  const species = deduplicateSpecies(allObs);
  console.log(`Found ${species.length} unique species. Checking assessments...`);

  const result = {};
  const BATCH = 20;
  let done = 0;

  for (let i = 0; i < species.length; i += BATCH) {
    const batch = species.slice(i, i + BATCH);
    const assessments = await Promise.all(batch.map(s => assessSpecies(s.scientificName)));
    for (let j = 0; j < batch.length; j++) {
      const { redListCategory, alienCategory } = assessments[j];
      if (redListCategory || alienCategory) {
        result[batch[j].scientificName] = {};
        if (redListCategory) result[batch[j].scientificName].redListCategory = redListCategory;
        if (alienCategory)   result[batch[j].scientificName].alienCategory   = alienCategory;
      }
    }
    done += batch.length;
    process.stdout.write(`\r  ${done}/${species.length} checked...`);
  }

  console.log(`\nDone. ${Object.keys(result).length} species have assessment data.`);

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      redList: 'Norwegian Red List 2015 + Vascular Plants 2021 (GBIF)',
      alien:   'GRIIS Norway (GBIF)',
    },
    assessments: result,
  };

  const outPath = join(DATA_DIR, 'assessment_cache.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Saved to ${outPath}`);

  // Summary
  const rl = Object.values(result).filter(v => v.redListCategory).length;
  const fa = Object.values(result).filter(v => v.alienCategory).length;
  console.log(`  Rødlistede: ${rl}  |  Fremmedarter: ${fa}`);
}

main().catch(err => { console.error(err); process.exit(1); });

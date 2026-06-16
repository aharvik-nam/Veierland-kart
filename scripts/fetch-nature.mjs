/**
 * Run with: node scripts/fetch-nature.mjs
 * Fetches all GBIF occurrences + iNaturalist enrichment for Veierland
 * and writes src/data/nature_cache.json
 */
import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '../src/data/nature_cache.json');

const boundary = JSON.parse(
  readFileSync(join(__dir, '../src/data/veierland_boundary.json'), 'utf8')
);
// GBIF requires CCW winding — reverse the polygon coordinates
const coords = [...boundary.coordinates[0]].reverse();
const POLYGON = encodeURIComponent(
  'POLYGON((' + coords.map(c => `${c[0]} ${c[1]}`).join(',') + '))'
);

const GROUPS = {
  Fugler:       { taxonKey: 212, no: 'Fugler',       en: 'Birds',       color: '#3b7fc4' },
  Karplanter:   { taxonKey: 6,   no: 'Karplanter',   en: 'Plants',      color: '#4a8a2a' },
  Pattedyr:     { taxonKey: 359, no: 'Pattedyr',     en: 'Mammals',     color: '#8b5c2a' },
  Sommerfugler: { taxonKey: 797, no: 'Sommerfugler', en: 'Butterflies', color: '#b84fa0' },
  Sopper:       { taxonKey: 5,   no: 'Sopper',       en: 'Fungi',       color: '#c07a3a' },
};

async function fetchGroup(group, taxonKey) {
  const url = `https://api.gbif.org/v1/occurrence/search?geometry=${POLYGON}&taxonKey=${taxonKey}&limit=300`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return { group, obs: data.results ?? [] };
  } catch {
    console.error(`  GBIF error for ${group}:`, text.slice(0, 200));
    return { group, obs: [] };
  }
}

function processRaw(rawGroups) {
  const countMap = new Map();
  const latestMap = new Map();
  for (const { group, obs } of rawGroups) {
    for (const o of obs) {
      const key = o.speciesKey;
      if (!key || !o.decimalLatitude || !o.species) continue;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
      const date = String(o.eventDate ?? '');
      const ex = latestMap.get(key);
      if (!ex || date > ex.date) latestMap.set(key, { raw: o, group, date });
    }
  }
  const result = [];
  for (const [key, { raw, group, date }] of latestMap) {
    result.push({
      scientificName: String(raw.species ?? ''),
      popularName: '',
      photoUrl: '',
      photoAttribution: '',
      group,
      lat: raw.decimalLatitude,
      lng: raw.decimalLongitude,
      date,
      obsCount: countMap.get(key) ?? 1,
      gbifKey: key,
    });
  }
  return result.sort((a, b) => b.obsCount - a.obsCount || a.scientificName.localeCompare(b.scientificName));
}

async function fetchINat(scientificName) {
  try {
    const res = await fetch(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&locale=nb&per_page=5`
    );
    const data = await res.json();
    const genus = scientificName.split(' ')[0].toLowerCase();
    const taxon = data.results?.find(t => t.name.toLowerCase().startsWith(genus));
    if (!taxon) return { norwegianName: '', photoUrl: '', photoAttribution: '' };
    return {
      norwegianName: taxon.preferred_common_name ?? '',
      photoUrl: taxon.default_photo?.medium_url ?? '',
      photoAttribution: taxon.default_photo?.attribution ?? '',
    };
  } catch { return { norwegianName: '', photoUrl: '', photoAttribution: '' }; }
}

async function main() {
  console.log('Fetching GBIF occurrences…');
  const rawGroups = await Promise.all(
    Object.entries(GROUPS).map(([group, cfg]) => fetchGroup(group, cfg.taxonKey))
  );
  const obs = processRaw(rawGroups);
  console.log(`  ${obs.length} unique species found`);

  console.log('Enriching with iNaturalist (Norwegian names + photos)…');
  const uniqueNames = [...new Set(obs.map(o => o.scientificName))];
  const results = await Promise.all(uniqueNames.map(n => fetchINat(n)));
  const map = new Map(uniqueNames.map((n, i) => [n, results[i]]));

  const enriched = obs.map(o => {
    const r = map.get(o.scientificName);
    return { ...o, popularName: r.norwegianName || o.popularName, photoUrl: r.photoUrl, photoAttribution: r.photoAttribution };
  });

  const out = { generatedAt: new Date().toISOString(), obs: enriched };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`Done! Wrote ${enriched.length} species to ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });

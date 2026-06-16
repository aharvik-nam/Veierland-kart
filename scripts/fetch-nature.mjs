/**
 * Run with: node scripts/fetch-nature.mjs
 * Fetches all GBIF occurrences + iNaturalist/GBIF enrichment for Veierland
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
    const nameLower = scientificName.toLowerCase();
    const genus = nameLower.split(' ')[0];
    // Prefer exact match, fall back to genus match
    const taxon = data.results?.find(t => t.name.toLowerCase() === nameLower)
               ?? data.results?.find(t => t.name.toLowerCase().startsWith(genus));
    if (!taxon) return { norwegianName: '', photoUrl: '', photoAttribution: '' };
    return {
      norwegianName: taxon.preferred_common_name ?? '',
      photoUrl: taxon.default_photo?.medium_url ?? '',
      photoAttribution: taxon.default_photo?.attribution ?? '',
    };
  } catch { return { norwegianName: '', photoUrl: '', photoAttribution: '' }; }
}

const NOR_LANGS = new Set(['nor', 'nob', 'nno', 'no', 'nb']);

async function fetchGBIFVernacular(gbifKey) {
  try {
    const res = await fetch(`https://api.gbif.org/v1/species/${gbifKey}/vernacularNames?limit=200`);
    const data = await res.json();
    const hit = data.results?.find(r => NOR_LANGS.has((r.language ?? '').toLowerCase()));
    return hit?.vernacularName ?? '';
  } catch { return ''; }
}

async function batchMap(items, fn, batchSize = 20) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) {
      process.stdout.write(`  ${Math.min(i + batchSize, items.length)}/${items.length}\r`);
    }
  }
  return results;
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
  const inatResults = await batchMap(uniqueNames, fetchINat, 30);
  const inatMap = new Map(uniqueNames.map((n, i) => [n, inatResults[i]]));

  // First pass: apply iNaturalist data
  let enriched = obs.map(o => {
    const r = inatMap.get(o.scientificName);
    return { ...o, popularName: r.norwegianName || '', photoUrl: r.photoUrl, photoAttribution: r.photoAttribution };
  });

  // Second pass: GBIF vernacular names for species still missing Norwegian name
  const missingName = enriched.filter(o => !o.popularName);
  if (missingName.length > 0) {
    console.log(`Fetching GBIF vernacular names for ${missingName.length} species without Norwegian name…`);
    const gbifNames = await batchMap(missingName.map(o => o.gbifKey), fetchGBIFVernacular, 20);
    const gbifMap = new Map(missingName.map((o, i) => [o.gbifKey, gbifNames[i]]));
    enriched = enriched.map(o => ({
      ...o,
      popularName: o.popularName || gbifMap.get(o.gbifKey) || '',
    }));
  }

  const withName = enriched.filter(o => o.popularName).length;
  console.log(`  ${withName}/${enriched.length} species have Norwegian names`);

  const out = { generatedAt: new Date().toISOString(), obs: enriched };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`Done! Wrote ${enriched.length} species to ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });

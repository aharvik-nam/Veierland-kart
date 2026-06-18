import { WeatherData, ArtskartObservation, SNLData, LokalhistorieData, MuseumPhoto, TideWater, WikimediaImage, WikipediaData } from "./types";
import { VEIERLAND_POLYGON_UTM33 } from "../data/veierland";

// 1. Weather (Via our local proxy to MET)
export async function fetchTidevann(lat: number, lon: number): Promise<TideWater | null> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://api.sehavniva.no/tideapi.php?lat=${lat}&lon=${lon}&fromtime=${today}T00:00&totime=${today}T23:59&datatype=tab&refcode=cd&place=&file=&lang=nb&interval=60&dst=1&tzone=&tide_request=locationdata`;
    const res = await fetch(url);
    const xmlText = await res.text();
    
    // Simple naive regex xml parser to find the current/next tide
    // Real implementation should use DOMParser, but doing quick extraction for now:
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const levels = xmlDoc.getElementsByTagName("waterlevel");
    
    if (levels.length > 0) {
      // Return the first reading today for simplicity, or iterate
      return {
        time: levels[0].getAttribute("time") || "",
        value: levels[0].getAttribute("value") || ""
      };
    }
  } catch(e) {}
  return null;
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData | null> {
  try {
    const url = `/api/weather?lat=${lat}&lon=${lon}&altitude=30`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Weather fetch failed");
    
    const data = await res.json();
    const now = data.properties.timeseries[0];
    const details = now.data.instant.details;
    const next = now.data.next_1_hours || now.data.next_6_hours;

    return {
      temperatur: Math.round(details.air_temperature),
      vind: Math.round(details.wind_speed),
      vindretning: details.wind_from_direction,
      nedbør: next?.details?.precipitation_amount ?? 0,
      symbolKode: next?.summary?.symbol_code ?? "cloudy",
      ikonUrl: `https://raw.githubusercontent.com/metno/weathericons/main/weather/png/${next?.summary?.symbol_code ?? "cloudy"}.png`,
      oppdatert: now.time
    };
  } catch (err) {
    console.error("MET API Error:", err);
    return null;
  }
}

// 2. Artsdatabanken
export async function fetchWildlife(taxonGroup: string): Promise<ArtskartObservation[]> {
  try {
    const url = new URL('https://artskart.artsdatabanken.no/publicapi/api/Observations/list/');
    url.searchParams.set('gmWktPolygon', VEIERLAND_POLYGON_UTM33);
    url.searchParams.append('taxonGroups[]', taxonGroup);
    url.searchParams.set('pageSize', '500'); // Up to 500

    const res = await fetch(url.toString());
    if (!res.ok) return [];
    
    const data = await res.json();
    return Array.isArray(data) ? data : (data.observations || data.Observations || []);
  } catch (err) {
    console.warn("API Artskart failed", err);
    return [];
  }
}

// 3. Store norske leksikon (SNL)
export async function fetchSNL(query: string): Promise<SNLData | null> {
  try {
    const url = `https://snl.no/api/v1/search?query=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.length) return null;

    const art = data[0];
    return {
      tittel: art.title,
      ingress: art.first_two_sentences,
      snippet: art.snippet,
      url: art.article_url,
      bilde: art.first_image_url,
      bildeLisens: art.first_image_license,
      lisens: art.license
    };
  } catch (err) {
    return null;
  }
}

// 4. Lokalhistoriewiki
export async function fetchLokalhistorie(title: string): Promise<LokalhistorieData | null> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'extracts|pageimages|info',
      exintro: '1',
      explaintext: '1',
      pithumbsize: '400',
      inprop: 'url',
      format: 'json',
      origin: '*'
    });
    
    const res = await fetch(`https://lokalhistoriewiki.no/api.php?${params}`);
    const data = await res.json();
    const page = Object.values(data.query.pages)[0] as any;

    if (page.missing !== undefined) return null;

    return {
      tittel: page.title,
      tekst: page.extract,
      bilde: page.thumbnail?.source,
      url: page.fullurl,
      kilde: 'Lokalhistoriewiki (CC-BY-SA)'
    };
  } catch (err) {
    return null;
  }
}

// 5. Wikimedia Commons (geo-tagged images near coordinates)
export async function fetchWikimediaImages(lat: number, lng: number, radius = 300): Promise<WikimediaImage[]> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'geosearch',
      ggsnamespace: '6',
      ggscoord: `${lat}|${lng}`,
      ggsradius: String(radius),
      ggslimit: '8',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: '800',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data.query?.pages ?? {}) as any[];
    return pages
      .filter(p => p.imageinfo?.[0]?.thumburl)
      .map(p => {
        const info = p.imageinfo[0];
        const meta = info.extmetadata ?? {};
        return {
          title: p.title.replace(/^File:/, '').replace(/\.[^.]+$/, ''),
          thumbUrl: info.thumburl,
          author: meta.Artist?.value?.replace(/<[^>]+>/g, '').trim() ?? '',
          license: meta.LicenseShortName?.value ?? '',
          pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
        };
      });
  } catch {
    return [];
  }
}

// 6. Wikipedia species lookup
async function tryWikipedia(wiki: string, title: string): Promise<WikipediaData | null> {
  try {
    const res = await fetch(`https://${wiki}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.type === 'disambiguation' || !d.extract) return null;
    return {
      title: d.title,
      extract: d.extract,
      imageUrl: d.thumbnail?.source,
      pageUrl: d.content_urls?.desktop?.page ?? `https://${wiki}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch { return null; }
}

export async function fetchWikipediaSpecies(scientificName: string, popularName: string, _lang: 'no' | 'en'): Promise<WikipediaData | null> {
  // Try Norwegian Wikipedia first, fall back to English
  const byScientific = (await tryWikipedia('no', scientificName)) ?? (await tryWikipedia('en', scientificName));
  if (byScientific) return byScientific;
  // Fall back to popular name if scientific lookup fails
  if (popularName) return (await tryWikipedia('no', popularName)) ?? tryWikipedia('en', popularName);
  return null;
}

// 7. Species assessment: Norwegian Red List (GBIF checklists) + GRIIS Norway (alien species)
const _RL2015   = '4f1047ac-a19d-41a8-98eb-d968b2548b53'; // Norwegian Red List 2015
const _RL_PLANT = '02b69283-72f8-4406-81ac-5cae93e18846'; // Red List Vascular Plants 2021
const _GRIIS_NO = '38de3b7a-5af3-4b6f-a1c5-4c0aa6abf010'; // GRIIS Norway (alien species)

const _THREAT_MAP: Record<string, string> = {
  NEAR_THREATENED:       'NT',
  VULNERABLE:            'VU',
  ENDANGERED:            'EN',
  CRITICALLY_ENDANGERED: 'CR',
  REGIONALLY_EXTINCT:    'RE',
  DATA_DEFICIENT:        'DD',
};

async function _checkChecklist(datasetKey: string, name: string): Promise<{ found: boolean; category?: string }> {
  try {
    const res = await fetch(
      `https://api.gbif.org/v1/species/search?datasetKey=${datasetKey}&q=${encodeURIComponent(name)}&limit=1`
    );
    if (!res.ok) return { found: false };
    const d = await res.json();
    const item = d.results?.[0];
    if (!item) return { found: false };
    // Verify the match is actually for this species (not just a genus hit)
    const resultName: string = (item.canonicalName ?? item.scientificName ?? '').toLowerCase();
    const genus = name.split(' ')[0].toLowerCase();
    const epithet = name.split(' ')[1]?.toLowerCase();
    if (!resultName.startsWith(genus) || (epithet && !resultName.includes(epithet))) return { found: false };
    const threat: string | undefined = item.threatStatuses?.[0];
    return { found: true, category: threat ? (_THREAT_MAP[threat] ?? undefined) : undefined };
  } catch {
    return { found: false };
  }
}

export interface SpeciesAssessment {
  redListCategory?: string; // NT, VU, EN, CR, RE, DD
  alienCategory?: string;   // 'FREMMED' if in GRIIS Norway
}

export async function fetchArtsdatabankenAssessment(scientificName: string): Promise<SpeciesAssessment> {
  const [rl2015, rlPlant, alien] = await Promise.all([
    _checkChecklist(_RL2015, scientificName),
    _checkChecklist(_RL_PLANT, scientificName),
    _checkChecklist(_GRIIS_NO, scientificName),
  ]);
  // Prefer 2021 vascular plants category if available, fall back to 2015
  const redListCategory = (rlPlant.found && rlPlant.category) ? rlPlant.category
    : (rl2015.found && rl2015.category) ? rl2015.category
    : undefined;
  return { redListCategory, alienCategory: alien.found ? 'FREMMED' : undefined };
}

// 8. DigitaltMuseum
const DIMU_API_KEY = 'demo'; 
export async function fetchDigitalMuseum(query: string, ownerCode?: string): Promise<MuseumPhoto[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      wt: 'json',
      rows: '3',
      'api.key': DIMU_API_KEY,
      fl: [
        'identifier.id', 'identifier.owner', 'artifact.uniqueId', 
        'artifact.ingress.title', 'artifact.ingress.production.fromYear',
        'artifact.ingress.license', 'artifact.defaultMediaIdentifier'
      ].join(',')
    });

    const fq = ['artifact.hasPictures:true'];
    if (ownerCode) fq.push(`identifier.owner:${ownerCode}`);
    fq.forEach(f => params.append('fq', f));

    const res = await fetch(`https://api.dimu.org/api/solr/select?${params}`);
    const data = await res.json();

    return data.response.docs.map((doc: any) => ({
      id: doc['identifier.id'],
      tittel: doc['artifact.ingress.title'],
      fraTid: doc['artifact.ingress.production.fromYear'],
      lisens: doc['artifact.ingress.license'],
      bilde250: doc['artifact.defaultMediaIdentifier'] ? `https://mm.dimu.org/image/${doc['artifact.defaultMediaIdentifier']}?dimension=250x250` : null,
      bilde600: doc['artifact.defaultMediaIdentifier'] ? `https://mm.dimu.org/image/${doc['artifact.defaultMediaIdentifier']}?dimension=600x380` : null,
      objektUrl: `https://digitaltmuseum.no/${doc['artifact.uniqueId']}`
    }));
  } catch (err) {
    return [];
  }
}

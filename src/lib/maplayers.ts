// Base map tile-layer configs (Kartlag switcher) and the geology overlay
// (Løsmasser/Berggrunn) styling — split out of VeierlandApp.tsx since none
// of this depends on component state.
import L from 'leaflet';
import losmassData from '../data/losmasser.geojson';
import berggrunData from '../data/berggrunn.geojson';

export interface LayerCfg {
  label: { no: string; en: string };
  sw: string;
  url: string;
  opts: Record<string, unknown>;
  filter: string;
  wms?: boolean;
  wmsLayers?: string;
}

export const LAYERS: Record<string, LayerCfg> = {
  soleng: {
    label: { no: 'Lyst', en: 'Light' },
    sw: 'linear-gradient(135deg,#f3f4f1,#e3e5df)',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    opts: { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap · © CARTO' },
    filter: 'none',
  },
  friluft: {
    label: { no: 'Friluft', en: 'Outdoor' },
    sw: 'repeating-linear-gradient(125deg,#e0ebc8,#e0ebc8 4px,#cfe0af 4px,#cfe0af 8px)',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
    opts: { maxZoom: 18, attribution: '© Kartverket' },
    filter: 'saturate(1.05) brightness(1.01)',
  },
  flyfoto: {
    label: { no: 'Flyfoto', en: 'Satellite' },
    sw: 'linear-gradient(135deg,#39563d,#73824f)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 18, attribution: '© Esri · Maxar' },
    filter: 'none',
  },
  historisk: {
    label: { no: 'Historisk', en: 'Historic' },
    sw: 'linear-gradient(135deg,#e8dfc8,#c8b89a)',
    url: 'https://wms.geonorge.no/skwms1/wms.historiskekart',
    wms: true,
    wmsLayers: 'historiskekart',
    opts: { maxZoom: 16, attribution: '© Kartverket' },
    filter: 'sepia(.4) contrast(1.1) brightness(1.05)',
  },
};
export const LAYER_ORDER = ['soleng', 'friluft', 'flyfoto', 'historisk'] as const;

export interface GeoLayerCfg {
  label: { no: string; en: string };
  sw: string;
  noDataMsg: { no: string; en: string };
}
export const GEO_LAYERS: Record<string, GeoLayerCfg> = {
  losmasse: {
    label: { no: 'Løsmasser', en: 'Surface deposits' },
    sw: 'linear-gradient(135deg,#c8a05a,#a8c870)',
    noDataMsg: { no: 'Kjør generate_geology.py', en: 'Run generate_geology.py' },
  },
  berggrunn: {
    label: { no: 'Berggrunn', en: 'Bedrock' },
    sw: 'linear-gradient(135deg,#9a6aaa,#6a8aaa)',
    noDataMsg: { no: 'Kjør generate_geology.py', en: 'Run generate_geology.py' },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GEO_DATA: Record<string, any> = {
  losmasse: losmassData,
  berggrunn: berggrunData,
};

// NGU source colors that conflict with the blue sea-level flood overlay → remapped to
// visually distinct equivalents while preserving geological meaning.
const GEO_COLOR_REMAP: Record<string, string> = {
  '#4a90d9': '#c8a050',  // Marin strandavsetning: blue→sandy gold (same hue as flood overlay)
  '#b0b0b0': '#a8b0a0',  // Bart fjell: neutral gray→cool greenish gray
};

export function geoStyle(feature?: { properties?: { color?: string } }): L.PathOptions {
  const src = feature?.properties?.color ?? '#cccccc';
  return {
    fillColor: GEO_COLOR_REMAP[src] ?? src,
    fillOpacity: 0.62,
    color: '#222',
    weight: 1.5,
    opacity: 0.75,
  };
}

export function geoOnEach(feature: { properties?: { type_no?: string; label?: string } }, layer: L.Layer) {
  const name = feature?.properties?.label ?? feature?.properties?.type_no;
  if (name) (layer as L.Path).bindTooltip(name, { sticky: true, className: 'vl-geo-tip' });
}

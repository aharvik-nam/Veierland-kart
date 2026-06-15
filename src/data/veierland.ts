import { POI } from "../lib/types";
import poiData from "./veierland_poi.json";
import stedsnavnData from "./veierland_stedsnavn.json";

// Veierland bounding polygon for Artsdatabanken in UTM33
export const VEIERLAND_POLYGON_UTM33 = 'POLYGON((233837.25 6568293.26,233098.62 6565865.34,233105.46 6565024.12,233632.08 6564271.81,234767.38 6564093.99,235574.41 6564935.21,235423.95 6565899.54,235150.38 6567527.27,234999.92 6568279.58,234445.94 6568204.35,233837.25 6568293.26))';

// Map manual SNL/Lokalhistorie clues
const poiEnrichment: Record<string, any> = {
  "Veierland kirke": {
    lokalhistoriewiki: "Veierland_kirke",
    snl_søkeord: "Maria Vigeland"
  },
  "Vestgården fergeleie": {
    lokalhistoriewiki: "Vestgården_(Nøtterøy_gnr._142)",
    dimu_søk: "hvalskytter Nøtterøy",
    dimu_eier: "HS"
  },
  "Alby (nordre gjestehavn)": {
    lokalhistoriewiki: "Veierland"
  }
};

const poisFromGeoJSON = poiData.features.map((feature: any, index: number) => {
  const enrich = poiEnrichment[feature.properties.navn] || {};
  return {
    ...feature.properties,
    id: `poi-${index}`,
    navn: feature.properties.navn,
    kategori: feature.properties.kategori,
    beskrivelse: feature.properties.beskrivelse,
    coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as [number, number],
    ...enrich
  };
});

const stedsnavnFromGeoJSON = stedsnavnData.features.map((feature: any, index: number) => {
  return {
    ...feature.properties,
    id: `sted-${index}`,
    navn: feature.properties.navn,
    kategori: feature.properties.kategori || "stedsnavn",
    beskrivelse: feature.properties.forklaring || "",
    coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as [number, number],
  };
});

// Combines POIs and Stedsnavn
export const ALL_POIS: POI[] = [...poisFromGeoJSON, ...stedsnavnFromGeoJSON];


import { POI } from "../lib/types";
import { loadPoiGeoJSON, loadStedsnavnGeoJSON } from "../lib/geodata";

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
  "Albykilen – Veierland Båtforening": {
    lokalhistoriewiki: "Veierland"
  },
  "Alby gård": {
    lokalhistoriewiki: "Alby_(Nøtterøy)"
  }
};

export async function loadAllPOIs(): Promise<POI[]> {
  const [poiData, stedsnavnData] = await Promise.all([
    loadPoiGeoJSON(),
    loadStedsnavnGeoJSON(),
  ]);

  const poisFromGeoJSON = poiData.features.map((feature: any, index: number) => {
    const enrich = poiEnrichment[feature.properties.navn] || {};
    const kategorier: string[] = feature.properties.kategorier
      ?? (feature.properties.kategori ? [feature.properties.kategori] : []);
    return {
      ...feature.properties,
      id: `poi-${index}`,
      kategorier,
      kategori: kategorier[0] ?? '',
      coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as [number, number],
      ...enrich,
    };
  });

  const stedsnavnFromGeoJSON = stedsnavnData.features
    .filter((feature: any) => feature.properties.visibility !== false)
    .map((feature: any, index: number) => {
      const kategori = feature.properties.kategori || 'stedsnavn';
      return {
        ...feature.properties,
        id: `sted-${index}`,
        kategori,
        kategorier: [kategori],
        beskrivelse: feature.properties.forklaring || "",
        coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as [number, number],
      };
    });

  return [...poisFromGeoJSON, ...stedsnavnFromGeoJSON];
}

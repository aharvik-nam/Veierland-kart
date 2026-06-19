import { POI } from "../lib/types";
import { loadPoiGeoJSON, loadStedsnavnGeoJSON } from "../lib/geodata";

export const VEIERLAND_POLYGON_UTM33 = 'POLYGON((233837.25 6568293.26,233098.62 6565865.34,233105.46 6565024.12,233632.08 6564271.81,234767.38 6564093.99,235574.41 6564935.21,235423.95 6565899.54,235150.38 6567527.27,234999.92 6568279.58,234445.94 6568204.35,233837.25 6568293.26))';

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
    return {
      ...feature.properties,
      id: `poi-${index}`,
      coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as [number, number],
      ...enrich,
    };
  });

  const stedsnavnFromGeoJSON = stedsnavnData.features
    .filter((feature: any) => feature.properties.visibility !== false)
    .map((feature: any, index: number) => ({
      ...feature.properties,
      id: `sted-${index}`,
      kategori: feature.properties.kategori || "stedsnavn",
      beskrivelse: feature.properties.forklaring || "",
      coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as [number, number],
    }));

  return [...poisFromGeoJSON, ...stedsnavnFromGeoJSON];
}

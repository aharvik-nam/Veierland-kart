export interface TideWater {
  time: string;
  value: string;
}

export interface POI {
  id: string;
  navn: string;
  kategori: "bad" | "ferge" | "kultur" | "hvalfangst" | "info" | "havn" | string;
  kategorier: string[];
  beskrivelse: string;
  coordinates: [number, number];
  snl_søkeord?: string;
  lokalhistoriewiki?: string;
  dimu_søk?: string;
  dimu_eier?: string;
  [key: string]: any;
}

export interface WeatherData {
  temperatur: number;
  vind: number;
  vindretning: number;
  nedbør: number;
  symbolKode: string;
  ikonUrl: string;
  oppdatert: string;
}

export interface ArtskartObservation {
  PreferredPopularName: string;
  ScientificName: string;
  ValidScientificName: string;
  Latitude: string;
  Longitude: string;
  CollectedDate: string;
  TaxonId: number;
  Locality: string;
}

export interface SNLData {
  tittel: string;
  ingress: string;
  snippet: string;
  url: string;
  bilde?: string;
  bildeLisens?: string;
  lisens: string;
}

export interface LokalhistorieData {
  tittel: string;
  tekst: string;
  bilde?: string;
  url: string;
  kilde: string;
}

export interface MuseumPhoto {
  id: string;
  tittel: string;
  fraTid?: string;
  lisens: string;
  bilde250: string | null;
  bilde600: string | null;
  objektUrl: string;
}

export interface WikipediaData {
  title: string;
  extract: string;
  imageUrl?: string;
  pageUrl: string;
}

export interface WikimediaImage {
  title: string;
  thumbUrl: string;
  author: string;
  license: string;
  pageUrl: string;
}

export interface RouteCache {
  id: number;
  name: string;
  timestamp: number;
  coordinates: [number, number][]; // Array of [lat, lng]
}

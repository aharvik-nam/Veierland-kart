export interface POI {
  id: string;
  navn: string;
  kategori: "bad" | "ferge" | "kultur" | "hvalfangst" | "info" | "havn" | string;
  kategorier: string[];
  beskrivelse: string;
  beskrivelse_lang?: string;
  coordinates: [number, number];
  snl_søkeord?: string;
  lokalhistoriewiki?: string;
  dimu_søk?: string;
  dimu_eier?: string;
  [key: string]: any;
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

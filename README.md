<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/b6b22ff7-7955-411a-8042-717893b99f9d

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Sol- og vindforhold (DOM-høydedata)

Kart-appen viser sol/skygge- og vind/le-lag over hele øya, og sol/le/badetemp
på hver badeplass. Terrenget ligger i `src/data/dom_grid.json`.

**Ferdig i repoet:** en terreng-fallback bygget fra flood-konturene (Kartverkets
DTM, bar bakke) — generert med `python scripts/generate_dtm_grid_from_flood.py`.
Den gir fungerende sol/skygge og landformbasert le med en gang.

**Oppgradering med trær og bygninger (DOM):** for mer presis skygge (skogbelter
og hus kaster også skygge) last ned DOM (overflatemodell) for Veierland som
GeoTIFF fra <https://hoydedata.no>, så:

1. `pip install rasterio numpy`
2. `python scripts/generate_dom_grid.py <sti/til/dom.tif>`  (overskriver samme fil)

Hvis `dom_grid.json` settes til `{"empty": true}` skjuler appen sol/vind-knappene
automatisk (badetemperatur vises fortsatt). Vær og sjøtemperatur hentes live fra
MET (api.met.no, ingen nøkkel nødvendig).

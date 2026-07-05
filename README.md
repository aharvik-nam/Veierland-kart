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

Kart-appen kan vise sol/skygge- og vind/le-lag over hele øya, og sol/le/badetemp
på hver badeplass. Sol- og vindlaget trenger en overflatemodell (DOM) fra
Kartverket — trær og bygninger, ikke bare bakken:

1. Last ned DOM (overflatemodell) for Veierland som GeoTIFF fra <https://hoydedata.no>
2. `pip install rasterio numpy`
3. `python scripts/generate_dom_grid.py <sti/til/dom.tif>`

Dette skriver `src/data/dom_grid.json`. Uten dette laget skjuler appen sol/vind-
knappene automatisk (badetemperatur vises fortsatt — den kommer fra api.met.no).
Vær- og sjøtemperatur hentes live fra MET (ingen nøkkel nødvendig).

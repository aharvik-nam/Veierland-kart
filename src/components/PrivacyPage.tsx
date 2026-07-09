import React from 'react';

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', background: 'var(--bg, #f6f4ee)', color: 'var(--ink, #1f2420)',
    fontFamily: 'inherit', padding: '32px 20px 64px',
  },
  wrap: { maxWidth: 640, margin: '0 auto' },
  h1: { fontSize: 26, fontWeight: 700, marginBottom: 4 },
  updated: { fontSize: 13, color: 'var(--muted, #6b7a86)', marginBottom: 28 },
  h2: { fontSize: 17, fontWeight: 700, marginTop: 28, marginBottom: 8 },
  p: { fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink2, #333)', marginBottom: 10 },
  ul: { fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink2, #333)', margin: '0 0 10px', paddingLeft: 20 },
  hr: { border: 'none', borderTop: '1px solid var(--line, #e5e2d8)', margin: '32px 0' },
  a: { color: 'var(--accent, #3d6ea5)', fontWeight: 600 },
};

export function PrivacyPage() {
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.h1}>Personvernerklæring for Veierland</div>
        <div style={S.updated}>Sist oppdatert: 9. juli 2026</div>

        <p style={S.p}>
          Veierland er en gratis øyguide for Veierland i Nøtterøy/Tønsberg. Appen krever ingen
          brukerkonto og selger eller deler ikke data om deg med tredjeparter til markedsføringsformål.
        </p>

        <div style={S.h2}>Posisjon (GPS)</div>
        <p style={S.p}>
          Appen kan be om tilgang til posisjonen din for å vise hvor du er på kartet og beregne
          gangavstand til steder på øya. Posisjonen din behandles kun lokalt på enheten din for å
          tegne den på kartet — den sendes ikke til noen server og lagres ikke noe sted. Du kan når
          som helst slå av posisjonstilgang i telefonens innstillinger uten at kjernefunksjonene i
          appen slutter å virke.
        </p>

        <div style={S.h2}>Lagrede steder ("Lagret")</div>
        <p style={S.p}>
          Når du trykker på hjertet på et sted eller en tur, lagres dette kun lokalt på enheten din
          (i nettleserens/appens lokale lagring). Denne listen sendes aldri til en server og er ikke
          knyttet til noen konto — den følger ikke med om du bytter enhet, og slettes hvis du
          avinstallerer appen.
        </p>

        <div style={S.h2}>Innhold og eksterne datakilder</div>
        <p style={S.p}>
          Stedsinformasjon, turer og historisk innhold hentes fra vår egen database (Firebase
          Firestore) — dette er skrivebeskyttet innhold vi selv har lagt inn, ikke personopplysninger
          om deg. I tillegg henter appen sanntidsdata direkte fra følgende offentlige/eksterne
          tjenester, uten at appen selv lagrer noe av dette:
        </p>
        <ul style={S.ul}>
          <li><a style={S.a} href="https://www.met.no/" target="_blank" rel="noreferrer">MET Norway (Meteorologisk institutt)</a> — vær- og sjøtemperaturdata</li>
          <li><a style={S.a} href="https://www.kartverket.no/til-sjos/se-havniva" target="_blank" rel="noreferrer">Se havnivå (Kartverket)</a> — tidevannsdata</li>
          <li><a style={S.a} href="https://www.artsdatabanken.no/" target="_blank" rel="noreferrer">Artsdatabanken / GBIF</a> — artsobservasjoner</li>
          <li><a style={S.a} href="https://snl.no/" target="_blank" rel="noreferrer">Store norske leksikon</a> — leksikonartikler</li>
          <li><a style={S.a} href="https://lokalhistoriewiki.no/" target="_blank" rel="noreferrer">Lokalhistoriewiki</a> — lokalhistorisk innhold</li>
          <li><a style={S.a} href="https://www.wikipedia.org/" target="_blank" rel="noreferrer">Wikipedia / Wikimedia Commons</a> — artikler og bilder</li>
          <li><a style={S.a} href="https://digitaltmuseum.no/" target="_blank" rel="noreferrer">DigitaltMuseum</a> — historiske fotografier</li>
        </ul>
        <p style={S.p}>
          Disse forespørslene går direkte fra din enhet til den aktuelle tjenesten (samme som om du
          besøkte nettsiden deres selv), og hver av dem har sine egne personvernvilkår.
        </p>

        <div style={S.h2}>Sporing, analyse og reklame</div>
        <p style={S.p}>
          Appen inneholder ingen reklame, ingen analyse-/sporingsverktøy (som Google Analytics eller
          tilsvarende) og deler ikke data med annonsenettverk. Vi vet ikke hvem du er, og vi ønsker
          ikke å vite det.
        </p>

        <div style={S.h2}>Kontakt</div>
        <p style={S.p}>
          Spørsmål om personvern i appen kan sendes til{' '}
          <a style={S.a} href="mailto:aharvik@gmail.com">aharvik@gmail.com</a>.
        </p>

        <hr style={S.hr} />

        <div style={S.h2}>Privacy policy (English summary)</div>
        <p style={S.p}>
          Veierland is a free island guide app. It requires no account and does not sell or share
          your data. Location access is used only to show your position on the map and estimate
          walking distances — it is processed locally on your device and never sent to or stored on
          a server. "Saved" places are stored only in local device storage, never uploaded. Place and
          trail content comes from our own read-only Firebase database; live weather, tide, species,
          and historical data are fetched directly from public third-party sources (MET Norway,
          Kartverket, Artsdatabanken/GBIF, Store norske leksikon, Lokalhistoriewiki, Wikipedia/
          Wikimedia Commons, DigitaltMuseum), each governed by their own privacy terms. The app
          contains no ads and no analytics/tracking SDKs. Contact:{' '}
          <a style={S.a} href="mailto:aharvik@gmail.com">aharvik@gmail.com</a>.
        </p>
      </div>
    </div>
  );
}

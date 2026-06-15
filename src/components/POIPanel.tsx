import React, { useState, useEffect } from "react";
import { Compass, Info, Image as ImageIcon, MapPin, Search } from "lucide-react";
import { fetchSNL, fetchLokalhistorie, fetchDigitalMuseum } from "../lib/api";
import { POI, SNLData, LokalhistorieData, MuseumPhoto } from "../lib/types";

export function POIPanel({ poi, onClose }: { poi: POI | null, onClose: () => void }) {
  const [snldata, setSnldata] = useState<SNLData | null>(null);
  const [lokaldata, setLokaldata] = useState<LokalhistorieData | null>(null);
  const [dimudata, setDimudata] = useState<MuseumPhoto[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!poi) return;
    setSnldata(null);
    setLokaldata(null);
    setDimudata([]);
    
    let isMounted = true;

    async function loadData() {
      setLoading(true);
      const tasks = [];
      
      if (poi?.snl_søkeord) {
        tasks.push(fetchSNL(poi.snl_søkeord).then(res => { if(isMounted) setSnldata(res); }));
      }
      if (poi?.lokalhistoriewiki) {
        tasks.push(fetchLokalhistorie(poi.lokalhistoriewiki).then(res => { if(isMounted) setLokaldata(res); }));
      }
      if (poi?.dimu_søk) {
        tasks.push(fetchDigitalMuseum(poi.dimu_søk, poi.dimu_eier).then(res => { if(isMounted) setDimudata(res); }));
      }
      
      await Promise.all(tasks);
      if(isMounted) setLoading(false);
    }

    loadData();
    
    return () => { isMounted = false; }
  }, [poi]);

  if (!poi) return null;

  return (
    <div className="absolute top-0 right-0 bottom-0 w-full sm:w-80 bg-[#111111] z-[2000] shadow-2xl transition-transform duration-300 flex flex-col overflow-hidden border-l border-white/5 text-slate-200">
      <div className="p-6 border-b border-white/5 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white">{poi.navn}</h2>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/5 transition-colors text-slate-500">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Introtekst (offline fallback) */}
        <section>
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-4 px-2">Informasjon</h2>
          <div className="px-2">
            <p className="text-slate-300 leading-relaxed text-sm">{poi.beskrivelse}</p>

            {/* Extra properties from data */}
            {poi.datering && (
              <div className="mt-3 text-xs text-slate-400">
                <span className="font-semibold text-slate-300">Datering:</span> {poi.datering}
              </div>
            )}
            {poi.vernestatus && (
              <div className="mt-1 text-xs text-slate-400">
                <span className="font-semibold text-slate-300">Vernestatus:</span> {poi.vernestatus}
              </div>
            )}
            {poi.askeladden_url && (
              <div className="mt-2">
                <a href={poi.askeladden_url} target="_blank" rel="noreferrer" className="text-xs text-cyan-500 hover:underline">
                  Se på Askeladden (Kulturminnesøk) ↗
                </a>
              </div>
            )}
          </div>
        </section>

        {/* Historisk data fra Lokalhistoriewiki (Prioritert) */}
        {lokaldata && (
          <section>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-4 px-2 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> Lokalhistoriewiki
            </h2>
            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
              {lokaldata.bilde && (
                <img src={lokaldata.bilde} alt={lokaldata.tittel} className="w-full h-32 object-cover rounded-md mb-3 opacity-90" />
              )}
              <p className="text-sm text-slate-300 font-serif leading-relaxed line-clamp-4">{lokaldata.tekst}</p>
              <a href={lokaldata.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-500 mt-2 inline-block hover:underline">Les hele på Lokalhistoriewiki.no ↗</a>
            </div>
          </section>
        )}

        {/* Data fra SNL */}
        {snldata && !lokaldata && (
          <section>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-4 px-2 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5" /> Store norske leksikon
            </h2>
            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
              <p className="text-sm text-slate-300 font-serif leading-relaxed">{snldata.ingress}</p>
              <a href={snldata.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-500 mt-2 inline-block hover:underline">Les mer på SNL.no ↗</a>
            </div>
          </section>
        )}

        {/* Museumsbilder fra DigitaltMuseum */}
        {dimudata.length > 0 && (
          <section>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-4 px-2 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" /> Historiske bilder
            </h2>
            <div className="space-y-4">
              {dimudata.map(img => (
                <div key={img.id} className="relative group rounded-xl overflow-hidden bg-black/20 border border-white/5">
                  {img.bilde600 && <img src={img.bilde600} alt={img.tittel} className="w-full h-auto object-cover opacity-90 grayscale hover:grayscale-0 transition-all duration-500" />}
                  <div className="p-3 bg-[#111111] border-t border-white/5">
                    <p className="text-xs font-medium text-slate-300 leading-snug">{img.tittel} {img.fraTid ? `(${img.fraTid})` : ''}</p>
                    <a href={img.objektUrl} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-500 mt-1 block hover:underline">Foto: DigitaltMuseum</a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

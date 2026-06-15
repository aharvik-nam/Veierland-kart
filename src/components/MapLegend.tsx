import React, { useState } from 'react';
import { Layers, X } from 'lucide-react';

export function MapLegend() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative flex flex-col gap-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="bg-black/80 backdrop-blur-md border border-white/10 w-10 h-10 rounded-xl text-slate-200 flex items-center justify-center hover:bg-black transition-colors shadow-lg"
        title="Karttegn og forklaring"
      >
        <Layers size={18} />
      </button>

      {isOpen && (
        <div className="bg-[#121214]/95 backdrop-blur-xl border border-white/10 shadow-2xl rounded-lg w-72 sm:w-80 md:w-96 overflow-hidden flex flex-col max-h-[60vh]">
          <div className="flex items-center justify-between p-3 border-b border-white/10 bg-black/50">
            <h3 className="font-semibold text-sm text-cyan-400 uppercase tracking-wider">Tegnforklaring</h3>
            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="p-4 overflow-y-auto custom-scrollbar flex flex-col gap-6">
            
            <section>
              <h4 className="font-medium text-slate-200 mb-2 border-b border-white/5 pb-1">Naturtyper NiN (Miljødirektoratet)</h4>
              <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                Natur i Norge (NiN) er et typeinndelingssystem for all natur her til lands. Dette overlaget viser kartlagte naturområder fordelt på kvalitetsklasser.
              </p>
              <div className="bg-white/5 p-2 rounded">
                <img 
                  src="https://kart.miljodirektoratet.no/arcgis/services/naturtyper_nin/MapServer/WmsServer?request=GetLegendGraphic&version=1.3.0&format=image/png&layer=naturtyper_nin_alle" 
                  alt="Naturtyper legend" 
                  className="max-w-full"
                />
              </div>
            </section>

            <section>
              <h4 className="font-medium text-slate-200 mb-2 border-b border-white/5 pb-1">Dybdekurver (Kartverket)</h4>
              <p className="text-xs text-slate-400 leading-relaxed mb-3">
                Viser dybdekurver, dybdetall og grunner i sjøområdene rundt øya. Kystkontur og utvalgte topografiske data på sjøbunnen. Data hentet fra Sjøkart null (LAT).
              </p>
              <div className="bg-white/5 p-2 rounded">
                <img 
                  src="https://wms.geonorge.no/skwms1/wms.dybdedata2?request=GetLegendGraphic&version=1.3.0&format=image/png&layer=Dybdekontur" 
                  alt="Dybdekurver legend" 
                  className="max-w-full"
                />
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

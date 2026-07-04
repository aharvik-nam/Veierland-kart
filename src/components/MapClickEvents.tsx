import React, { useState } from 'react';
import { useMapEvents, Popup } from 'react-leaflet';
import { Layers } from 'lucide-react';

interface NaturtypeData {
  attributes: {
    Naturtype: string;
    Lokalitetskvalitet: number;
    Tilstand: number;
    Naturmangfold: number;
    Hovedøkosystem: string;
    Nøyaktighet: number;
    Faktaark: string;
    Kartleggingsår: number;
    Tilstandbeskrivelse: string;
    Naturmangfoldbeskrivelse: string;
  };
}

export function MapClickEvents() {
  const [clickedData, setClickedData] = useState<{
    latlng: [number, number];
    data: NaturtypeData | null;
    loading: boolean;
  } | null>(null);

  useMapEvents({
    click: async (e) => {
      const { lat, lng } = e.latlng;
      
      // Start loading indicator
      setClickedData({ latlng: [lat, lng], data: null, loading: true });

      try {
        const url = `https://kart.miljodirektoratet.no/arcgis/rest/services/naturtyper_nin/MapServer/0/query?geometry=%7B%22x%22%3A${lng}%2C%22y%22%3A${lat}%7D&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json&inSR=4326`;
        
        const response = await fetch(url);
        const json = await response.json();
        
        if (json.features && json.features.length > 0) {
          setClickedData({ latlng: [lat, lng], data: json.features[0], loading: false });
        } else {
          setClickedData(null); // Close if nothing found
        }
      } catch (error) {
        console.error("Error fetching naturtyper API", error);
        setClickedData(null);
      }
    }
  });

  if (!clickedData) return null;

  return (
    <Popup position={clickedData.latlng} eventHandlers={{ remove: () => setClickedData(null) }}>
      <div className="w-64 max-h-[400px] overflow-y-auto custom-scrollbar flex flex-col gap-3">
        {clickedData.loading ? (
          <div className="text-sm font-medium animate-pulse text-slate-500">Søker etter naturtype...</div>
        ) : clickedData.data ? (
          <>
            <div className="flex items-center gap-2 border-b border-black/10 pb-2">
              <div className="w-6 h-6 rounded-md bg-green-100 flex items-center justify-center text-green-700">
                <Layers size={14} />
              </div>
              <h3 className="font-bold text-sm tracking-tight m-0 leading-tight">
                {clickedData.data.attributes.Naturtype}
              </h3>
            </div>
            
            <div className="text-xs flex flex-col gap-2">
              <p className="m-0 text-slate-700"><strong>Økosystem:</strong> {clickedData.data.attributes.Hovedøkosystem}</p>
              <p className="m-0 text-slate-700"><strong>År:</strong> {clickedData.data.attributes.Kartleggingsår}</p>
              
              <div className="mt-1 bg-slate-50 p-2 rounded border border-slate-100 leading-relaxed">
                <strong className="block mb-1 text-slate-800">Tilstand:</strong>
                {clickedData.data.attributes.Tilstandbeskrivelse || "Ingen beskrivelse"}
              </div>

              <div className="mt-1 bg-slate-50 p-2 rounded border border-slate-100 leading-relaxed">
                <strong className="block mb-1 text-slate-800">Naturmangfold:</strong>
                {clickedData.data.attributes.Naturmangfoldbeskrivelse || "Ingen beskrivelse"}
              </div>
              
              {clickedData.data.attributes.Faktaark && (
                <a 
                  href={clickedData.data.attributes.Faktaark} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="mt-2 text-cyan-600 hover:text-cyan-800 font-medium underline"
                >
                  Les fullt faktaark hos Miljødirektoratet
                </a>
              )}
            </div>
          </>
        ) : null}
      </div>
    </Popup>
  );
}

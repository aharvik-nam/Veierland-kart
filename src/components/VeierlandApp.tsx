import React, { useState } from 'react';
import { MapContainer, ZoomControl } from 'react-leaflet';
import { MapLayers } from './MapLayers';
import { MapFeatures } from './MapFeatures';
import { MapLegend } from './MapLegend';
import { MapClickEvents } from './MapClickEvents';
import { UserLocationControls } from './UserLocationControls';
import { WeatherWidget } from './WeatherWidget';
import { POIPanel } from './POIPanel';
import { Sidebar } from './Sidebar';
import { ALL_POIS } from '../data/veierland';
import { POI } from '../lib/types';
import { useRouteStorage } from '../hooks/useRouteStorage';

export function VeierlandApp() {
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null);
  const { routes } = useRouteStorage();

  return (
    <div className="relative w-full h-screen h-[100dvh] overflow-hidden bg-[#0a0a0a] text-slate-200 font-sans flex text-slate-200">
      <Sidebar routes={routes} />
      
      <main className="flex-1 relative bg-[#1a1a1c] overflow-hidden">
        <div className="absolute top-6 left-6 z-[1000] flex flex-col items-start gap-4 pointer-events-none">
          <div className="pointer-events-auto">
            <WeatherWidget />
          </div>
          <div className="pointer-events-auto">
            <MapLegend />
          </div>
        </div>

        <MapContainer 
          center={[59.157, 10.349]} 
          zoom={13} 
          zoomControl={false}
          className="w-full h-full z-0"
        >
          <ZoomControl position="topright" />
          <MapLayers />
          <MapFeatures pois={ALL_POIS} onPoiSelect={setSelectedPoi} />
          <MapClickEvents />
          <UserLocationControls />
        </MapContainer>

        {/* Bottom Activity Bar from Design */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-lg border border-white/10 rounded-full px-6 py-3 flex flex-row items-center gap-6 shadow-2xl z-[1000] pointer-events-none whitespace-nowrap hidden sm:flex">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
            <span className="text-[10px] sm:text-[11px] font-medium tracking-wide">SANNTID SPORING</span>
          </div>
          <div className="w-px h-4 bg-white/10"></div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] sm:text-[11px] font-medium tracking-wide text-green-400">OFFLINE BUFFERED: 100%</span>
          </div>
          <div className="w-px h-4 bg-white/10"></div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] sm:text-[11px] text-slate-400">DATA:</span>
            <span className="text-[10px] sm:text-[11px] font-mono text-white">ARTSDATABANKEN</span>
          </div>
        </div>

        {selectedPoi && (
          <POIPanel poi={selectedPoi} onClose={() => setSelectedPoi(null)} />
        )}
      </main>
    </div>
  );
}

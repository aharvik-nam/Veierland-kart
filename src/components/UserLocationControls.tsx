import React, { useEffect, useState } from 'react';
import { useMap, Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { Locate, Navigation, Save } from 'lucide-react';
import { useRouteStorage } from '../hooks/useRouteStorage';

const userIcon = L.divIcon({
  html: `<div class="relative w-6 h-6"><div class="absolute inset-0 bg-cyan-500/20 rounded-full animate-ping"></div><div class="absolute top-1 left-1 w-4 h-4 bg-cyan-500 rounded-full border-2 border-white shadow-[0_0_15px_rgba(6,182,212,0.5)]"></div></div>`,
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

export function UserLocationControls() {
  const map = useMap();
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<[number, number][]>([]);
  
  const { saveRoute } = useRouteStorage();

  useEffect(() => {
    if (!isTracking && !isRecording) return;
    
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const newPos: [number, number] = [latitude, longitude];
        setPosition(newPos);
        
        if (isTracking && !isRecording) {
            // map.setView(newPos, map.getZoom()); // Optional auto-center
        }

        if (isRecording) {
          setCurrentRoute(prev => [...prev, newPos]);
        }
      },
      (err) => console.error("Geolocation error", err),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isTracking, isRecording, map]);

  const handleSaveRoute = () => {
    if (currentRoute.length > 1) {
      saveRoute(`Tur ${new Date().toLocaleDateString()}`, currentRoute);
    }
    setIsRecording(false);
    setCurrentRoute([]);
  };

  return (
    <>
      <div className="absolute bottom-8 right-8 z-[1000] flex flex-col gap-3">
        <button 
          onClick={() => {
            if (!position) {
              navigator.geolocation.getCurrentPosition(
                p => {
                 const newPos: [number, number] = [p.coords.latitude, p.coords.longitude];
                 setPosition(newPos);
                 map.flyTo(newPos, 16);
                 setIsTracking(true);
                });
            } else {
              map.flyTo(position, 16);
            }
          }}
          className="w-12 h-12 bg-black/80 backdrop-blur-md border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors text-white"
          title="Min posisjon"
        >
          <Locate className="w-6 h-6" />
        </button>

        <button 
          onClick={() => {
            if (isRecording) {
              handleSaveRoute();
            } else {
              setIsRecording(true);
              setIsTracking(true);
            }
          }}
          className={isRecording ? "w-12 h-12 bg-red-500 rounded-xl flex items-center justify-center shadow-lg shadow-red-500/20 text-white" : "w-12 h-12 bg-black/80 backdrop-blur-md border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors text-white"}
          title={isRecording ? "Lagre spor" : "Ta opp rute"}
        >
          {isRecording ? <Save className="w-6 h-6" /> : <Navigation className="w-6 h-6" />}
        </button>
      </div>

      {position && <Marker position={position} icon={userIcon} />}
      {currentRoute.length > 0 && <Polyline positions={currentRoute} pathOptions={{ color: '#06b6d4', weight: 4 }} />}
    </>
  );
}

import React, { useEffect, useState } from 'react';
import { Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { fetchWildlife } from '../lib/api';
import { ArtskartObservation, POI } from '../lib/types';
import { useRouteStorage } from '../hooks/useRouteStorage';

// Fix typical Leaflet icon issue
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl: iconRetina,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Custom icons based on category
const createCircleIcon = (color: string) => {
  return L.divIcon({
    html: `<div style="background-color: ${color}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.4);"></div>`,
    className: '!bg-transparent !border-0',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
};

const categoryColors: Record<string, string> = {
  kultur: '#d97706', // amber
  ferge: '#2563eb',  // blue
  havn: '#0284c7',   // sky
  bad: '#059669',    // emerald
  hvalfangst: '#475569', // slate
  arkeologi: '#9333ea', // purple
  stedsnavn: '#64748b', // slate
  friluft: '#84cc16' // lime
};

export function MapFeatures({ pois, onPoiSelect }: { pois: POI[], onPoiSelect: (poi: POI) => void }) {
  const [wildlife, setWildlife] = useState<ArtskartObservation[]>([]);
  const { routes } = useRouteStorage();

  // Load wildlife (e.g., Birds initially)
  useEffect(() => {
    fetchWildlife('Fugler').then((obs) => {
      // Group by ValidScientificName to prevent massive duplicates
      const unique = new Map<string, ArtskartObservation>();
      obs.forEach(o => {
        if (!unique.has(o.ValidScientificName)) {
           // Parse coordinates
           o.Latitude = o.Latitude.replace(',', '.');
           o.Longitude = o.Longitude.replace(',', '.');
           unique.set(o.ValidScientificName, o);
        }
      });
      setWildlife(Array.from(unique.values()));
    });
  }, []);

  return (
    <>
      {/* POIs */}
      {pois.map(poi => (
        <Marker 
          key={poi.id} 
          position={poi.coordinates}
          icon={createCircleIcon(categoryColors[poi.kategori] || '#3b82f6')}
          eventHandlers={{ click: () => onPoiSelect(poi) }}
        >
          <Tooltip direction="top" offset={[0, -10]} className="font-sans font-medium text-slate-800">
            {poi.navn}
          </Tooltip>
        </Marker>
      ))}

      {/* Wildlife */}
      {wildlife.map((obs, idx) => {
        const lat = parseFloat(obs.Latitude);
        const lng = parseFloat(obs.Longitude);
        if (isNaN(lat) || isNaN(lng)) return null;

        return (
          <Marker 
            key={`${obs.TaxonId}-${idx}`} 
            position={[lat, lng]} 
            icon={createCircleIcon('#e11d48')} // rose
          >
            <Tooltip direction="top" className="font-sans text-xs">
              <span className="font-bold">{obs.PreferredPopularName || obs.ValidScientificName}</span><br/>
              <em className="text-slate-500">{obs.ValidScientificName}</em>
            </Tooltip>
          </Marker>
        );
      })}

      {/* Saved Routes Offline Cache */}
      {routes.map(r => (
        <Polyline 
          key={r.id} 
          positions={r.coordinates} 
          pathOptions={{ color: '#06b6d4', weight: 4, opacity: 0.8, dashArray: '1 12' }} 
        >
          <Tooltip>{r.name}</Tooltip>
        </Polyline>
      ))}
    </>
  );
}

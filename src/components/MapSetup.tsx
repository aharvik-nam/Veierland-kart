// Small react-leaflet "bridge" components with no visual output of their
// own — they just wire the Leaflet map instance up to plain callbacks/props,
// so VeierlandApp.tsx doesn't need direct access to the Leaflet map object
// outside of a ref. Split out since neither depends on VeierlandApp's state.
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { LAYERS } from '../lib/maplayers';

export function MapSetup({ onReady, onMapClick, onZoom, onDragStart }: { onReady: (m: L.Map) => void; onMapClick: () => void; onZoom: (z: number) => void; onDragStart: () => void }) {
  const map = useMap();
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  useEffect(() => {
    onReady(map);
    const handleClick = () => onMapClickRef.current();
    map.on('click', handleClick);
    const zoomHandler = () => onZoom(map.getZoom());
    map.on('zoomend', zoomHandler);
    // 'dragstart' fires only for user-initiated panning (mouse/touch drag),
    // not for the app's own programmatic flyTo/panTo calls — exactly the
    // signal for "the user wants to look at the map", not "we moved it for them".
    const dragHandler = () => onDragStartRef.current();
    map.on('dragstart', dragHandler);
    return () => { map.off('click', handleClick); map.off('zoomend', zoomHandler); map.off('dragstart', dragHandler); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, onReady, onZoom]);
  return null;
}

export function TileController({ layer, filterOverride }: { layer: string; filterOverride?: string }) {
  const map = useMap();
  const tileRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const cfg = LAYERS[layer];
    if (!cfg) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const tile = cfg.wms
      ? L.tileLayer.wms(cfg.url, { layers: cfg.wmsLayers ?? '', format: 'image/png', transparent: false, ...cfg.opts, zIndex: 0 } as L.WMSOptions)
      : L.tileLayer(cfg.url, { ...cfg.opts, zIndex: 0 } as L.TileLayerOptions);
    tile.addTo(map);
    tileRef.current = tile;
    const tp = document.querySelector('.leaflet-tile-pane') as HTMLElement | null;
    // filterOverride is the admin-editable version (see maplayersettings.ts) —
    // falls back to the layer's own built-in default when not loaded yet.
    if (tp) tp.style.filter = filterOverride ?? cfg.filter;
    return () => {
      if (tileRef.current) { map.removeLayer(tileRef.current); tileRef.current = null; }
    };
  }, [layer, map, filterOverride]);

  return null;
}

import React from 'react';
import { LayersControl, TileLayer, WMSTileLayer } from 'react-leaflet';

export function MapLayers() {
  return (
    <LayersControl position="topright">
      {/* Basiskart */}
      <LayersControl.BaseLayer checked name="OpenStreetMap">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
          maxZoom={19}
        />
      </LayersControl.BaseLayer>
      
      <LayersControl.BaseLayer name="Topografisk (Kartverket)">
        <TileLayer
          url="https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png"
          attribution='&copy; <a href="https://kartverket.no">Kartverket</a>'
          maxZoom={19}
        />
      </LayersControl.BaseLayer>
      
      <LayersControl.BaseLayer name="Gråtone (Kartverket)">
        <TileLayer
          url="https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png"
          attribution='&copy; <a href="https://kartverket.no">Kartverket</a>'
          maxZoom={19}
        />
      </LayersControl.BaseLayer>

      <LayersControl.BaseLayer name="Historiske amtskart (1826-1920)">
        <WMSTileLayer
          url="https://wms.geonorge.no/skwms1/wms.historiskekart"
          layers="amt"
          format="image/png"
          transparent={false}
          attribution='&copy; Kartverket – Historiske kart'
        />
      </LayersControl.BaseLayer>

      <LayersControl.BaseLayer name="Flyfoto (Norge i bilder)">
        <WMSTileLayer
          url="https://wms.geonorge.no/skwms1/wms.nib"
          layers="ortofoto"
          format="image/jpeg"
          transparent={false}
          attribution='&copy; Norge i bilder / Kartverket'
        />
      </LayersControl.BaseLayer>

      <LayersControl.BaseLayer name="Sjøkart">
        <WMSTileLayer
          url="https://wms.geonorge.no/skwms1/wms.sjokartraster2"
          layers="cells"
          format="image/png"
          transparent={false}
          attribution='&copy; Kartverket Sjødivisjon'
        />
      </LayersControl.BaseLayer>

      {/* Overlays */}
      <LayersControl.Overlay name="Dybdekurver">
        <WMSTileLayer
          url="https://wms.geonorge.no/skwms1/wms.dybdedata2"
          layers="Dybdekontur,grunne,Dybdepunkt"
          format="image/png"
          transparent={true}
          opacity={0.7}
          attribution='&copy; Kartverket Sjødivisjon'
        />
      </LayersControl.Overlay>

      {/* <LayersControl.Overlay name="Kulturminner (Riksantikvaren)">
        <WMSTileLayer
          url="https://kart.ra.no/arcgis/rest/services/Distribusjon/Kulturminner/MapServer/WMSServer"
          layers="5"
          format="image/png"
          transparent={true}
          opacity={0.9}
          attribution='&copy; Riksantikvaren'
        />
      </LayersControl.Overlay> */}
      
      <LayersControl.Overlay name="Naturtyper (Miljødirektoratet)">
        <WMSTileLayer
          url="https://kart.miljodirektoratet.no/arcgis/services/naturtyper_nin/MapServer/WMSServer"
          layers="naturtyper_nin_alle"
          format="image/png"
          transparent={true}
          opacity={0.6}
          attribution='&copy; Miljødirektoratet'
        />
      </LayersControl.Overlay>
      {/* <LayersControl.Overlay name="Skipstrafikk / AIS (Havbase)">
        <WMSTileLayer
          url="https://havbase.no/wms"
          layers="havbase"
          format="image/png"
          transparent={true}
          opacity={0.8}
          attribution='&copy; Kystverket (Havbase)'
        />
      </LayersControl.Overlay> */}
    </LayersControl>
  );
}

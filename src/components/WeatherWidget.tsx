import React, { useEffect, useState } from 'react';
import { fetchWeather } from '../lib/api';
import { WeatherData } from '../lib/types';

export function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    // Veierland approx coordinates
    fetchWeather(59.157, 10.349).then(setWeather);
  }, []);

  if (!weather) return null;

  return (
    <div className="bg-black/80 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/10 flex items-center gap-4 shadow-lg w-max">
      <div className="p-2 bg-white/5 rounded-lg flex items-center justify-center">
        <img src={weather.ikonUrl} alt={weather.symbolKode} className="w-5 h-5 drop-shadow-sm brightness-125 contrast-125" />
      </div>
      <div>
        <div className="text-[10px] uppercase text-slate-500 font-bold leading-tight">Været Nå</div>
        <div className="text-lg font-bold text-white leading-none">{weather.temperatur}°<span className="text-xs text-slate-400 font-normal ml-1">/ {weather.vind} m/s</span></div>
      </div>
    </div>
  );
}

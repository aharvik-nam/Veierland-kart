import React from 'react';
import { RouteCache } from '../lib/types';
import { Compass, Search, CheckCircle2, Navigation } from 'lucide-react';

export function Sidebar({ routes }: { routes: RouteCache[] }) {
  return (
    <aside className="w-80 bg-[#111111] border-r border-white/5 flex flex-col z-10 shrink-0 hidden md:flex">
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Compass className="w-5 h-5 text-black" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Veierland <span className="text-xs font-normal text-cyan-500 bg-cyan-500/10 px-2 py-0.5 rounded ml-2">PRO</span>
          </h1>
        </div>
        
        <div className="relative">
          <input 
            type="text" 
            placeholder="Søk etter destinasjon..." 
            className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-cyan-500 transition-colors placeholder:text-slate-500 text-white" 
          />
          <Search className="absolute left-3 top-3.5 w-4 h-4 text-slate-500" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section>
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-4 px-2">Lagrede Ruter (Offline)</h2>
          <div className="space-y-2">
            {routes.length === 0 ? (
              <div className="px-2 text-xs text-slate-500 italic">Ingen lagrede ruter.</div>
            ) : (
              routes.map(route => (
                <button key={route.id} className="w-full text-left p-3 rounded-xl bg-white/5 border border-white/5 hover:border-cyan-500/30 transition-all group">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm font-medium text-white">{route.name}</span>
                    <span className="text-[10px] text-cyan-500">{route.coordinates.length} punkter</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    Tilgjengelig offline (i cache)
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-4 px-2">System Status</h2>
          <div className="p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-300">API Tilkobling</span>
              <span className="text-xs font-mono text-cyan-500">STERK</span>
            </div>
            <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
              <div className="w-[92%] h-full bg-cyan-500"></div>
            </div>
          </div>
        </section>
      </div>

      <div className="p-6 border-t border-white/5 bg-black/20">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-500 shadow-lg shadow-cyan-500/20"></div>
          <div>
            <p className="text-sm font-semibold text-white">Besøkende</p>
            <p className="text-[10px] text-slate-500">Veierland Explore</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

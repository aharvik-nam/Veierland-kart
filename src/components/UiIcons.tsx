// Small stateless SVG icon components used across the top bar, tab bar, and
// action buttons. Split out of VeierlandApp.tsx purely to shrink that file —
// none of these take more than their own declared props.
import { WeatherIconKind } from '../lib/conditions';

export function ChevSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6"/>
    </svg>
  );
}
export function BackSvg() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6l-6 6 6 6"/>
    </svg>
  );
}
export function HeartSvg() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20s-7-4.4-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.6 12 20 12 20z"/>
    </svg>
  );
}
export function RouteSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="5" r="2.4"/>
      <path d="M8 18h6a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h2"/>
    </svg>
  );
}
export function CheckSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L19 7"/>
    </svg>
  );
}
export function UpChevSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 14l6-6 6 6"/>
    </svg>
  );
}

// ─── Tab bar icons ─────────────────────────────────────────────────────────────

export function MapTabSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z"/><path d="M9 4v14M15 6v14"/>
    </svg>
  );
}
export function PlacesTabSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-6.5-4.9-6.5-10.2A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.8C18.5 16.1 12 21 12 21z"/><circle cx="12" cy="10.6" r="2.3"/>
    </svg>
  );
}
export function TrailsTabSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 21c-4-6 4-7 5-11 .8-3.2 5.5-2.8 3.5-7"/><circle cx="17" cy="3" r="1.4"/>
    </svg>
  );
}
export function NatureTabSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21Q4 13 12 3q8 10 0 18z"/><path d="M12 3q-2 9 0 18"/>
    </svg>
  );
}
export function HistoryTabSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>
    </svg>
  );
}

// Compact sky-condition glyph for the top bar — one of a handful of icon
// buckets (see weatherIconKind()), not the ~50 distinct MET Yr symbols.
export function WeatherIcon({ kind, size = 19 }: { kind: WeatherIconKind; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const cloud = <path d="M6 15h11a3.5 3.5 0 0 0 .4-7A6 6 0 0 0 6 10.5A3.5 3.5 0 0 0 6 15z" />;
  switch (kind) {
    case 'clear':
      return <svg {...p}><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" /></svg>;
    case 'partly':
      return <svg {...p}><circle cx="8" cy="8" r="3" /><path d="M8 2.5v1.3M3.3 8h1.3M4.5 5l1 1M11.5 5l-1 1" /><path d="M8.5 17h9a3.2 3.2 0 0 0 .3-6.4A5 5 0 0 0 8.7 13" /></svg>;
    case 'cloudy':
      return <svg {...p}>{cloud}</svg>;
    case 'fog':
      return <svg {...p}>{cloud}<path d="M4 19h16M6 21.5h12" /></svg>;
    case 'rain':
      return <svg {...p}>{cloud}<path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" /></svg>;
    case 'sleet':
      return <svg {...p}>{cloud}<path d="M8 18l-1 3M16 18l-1 3M12 18v1.5M11 21l2 1.5M13 21l-2 1.5" /></svg>;
    case 'snow':
      return <svg {...p}>{cloud}<path d="M8 18v3.5M6.7 19.2l2.6 1.6M9.3 19.2l-2.6 1.6M16 18v3.5M14.7 19.2l2.6 1.6M17.3 19.2l-2.6 1.6" /></svg>;
    case 'thunder':
      return <svg {...p}>{cloud}<path d="M12.5 15l-2.5 4.5h2.5l-1 4 3.5-5h-2.5l1-3.5z" fill="currentColor" stroke="none" /></svg>;
  }
}

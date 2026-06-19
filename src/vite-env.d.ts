/// <reference types="vite/client" />

declare module '*.geojson' {
  const value: {
    type: string;
    features: Array<{
      type: string;
      properties: Record<string, unknown>;
      geometry: Record<string, unknown>;
    }>;
  };
  export default value;
}

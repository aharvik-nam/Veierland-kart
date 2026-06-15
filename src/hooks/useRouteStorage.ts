import React, { useEffect, useState } from "react";
import localForage from "localforage";
import { RouteCache } from "../lib/types";

const ROUTE_STORE_KEY = "veierland_routes";

export function useRouteStorage() {
  const [routes, setRoutes] = useState<RouteCache[]>([]);

  const loadRoutes = async () => {
    const stored = await localForage.getItem<RouteCache[]>(ROUTE_STORE_KEY);
    if (stored) {
      setRoutes(stored);
    }
  };

  useEffect(() => {
    loadRoutes();
  }, []);

  const saveRoute = async (name: string, coordinates: [number, number][]) => {
    const newRoute: RouteCache = {
      id: Date.now(),
      name,
      timestamp: Date.now(),
      coordinates,
    };
    const updated = [...routes, newRoute];
    await localForage.setItem(ROUTE_STORE_KEY, updated);
    setRoutes(updated);
  };

  const deleteRoute = async (id: number) => {
    const updated = routes.filter(r => r.id !== id);
    await localForage.setItem(ROUTE_STORE_KEY, updated);
    setRoutes(updated);
  };

  return { routes, saveRoute, deleteRoute };
}

import 'dotenv/config';
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Proxy MET Weather API due to CORS and User-Agent requirements
  app.get("/api/weather", async (req, res) => {
    try {
      const { lat, lon, altitude } = req.query;
      if (!lat || !lon) {
        return res.status(400).json({ error: "Missing lat/lon" });
      }

      const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}${altitude ? `&altitude=${altitude}` : ''}`;

      const response = await fetch(url, {
        headers: { 'User-Agent': 'VeierlandApp/1.0 kontakt@eksempel.no' }
      });

      if (!response.ok) {
        throw new Error(`MET API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      res.setHeader("Cache-Control", "public, max-age=600");
      res.json(data);
    } catch (error: any) {
      console.error("Weather Proxy Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

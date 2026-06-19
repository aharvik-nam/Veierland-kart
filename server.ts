import 'dotenv/config';
import express from "express";
import path from "path";
import crypto from "crypto";
import fs from "fs/promises";
import { createServer as createViteServer } from "vite";

const DATA_DIR = path.join(process.cwd(), 'src', 'data');
const ALLOWED_FILES = ['veierland_poi.json', 'veierland_stedsnavn.json', 'turkart.geojson'];

function getAdminToken() {
  const pw = process.env.ADMIN_PASSWORD ?? '';
  return crypto.createHash('sha256').update(`vl-admin:${pw}`).digest('hex');
}

function adminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (auth.slice(7) !== getAdminToken()) { res.status(401).json({ error: 'Invalid token' }); return; }
  next();
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON parsing middleware
  app.use(express.json());

  // Admin auth
  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body ?? {};
    const pw = process.env.ADMIN_PASSWORD ?? '';
    if (!pw) { res.status(503).json({ error: 'ADMIN_PASSWORD ikke satt' }); return; }
    if (password !== pw) { res.status(401).json({ error: 'Feil passord' }); return; }
    res.json({ token: getAdminToken() });
  });

  app.get('/api/admin/geojson/:file', adminAuth, async (req, res) => {
    const { file } = req.params;
    if (!ALLOWED_FILES.includes(file)) { res.status(400).json({ error: 'Ugyldig fil' }); return; }
    try {
      const content = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      res.setHeader('Content-Type', 'application/json');
      res.send(content);
    } catch { res.status(404).json({ error: 'Fil ikke funnet' }); }
  });

  app.put('/api/admin/geojson/:file', adminAuth, express.json({ limit: '10mb' }), async (req, res) => {
    const { file } = req.params;
    if (!ALLOWED_FILES.includes(file)) { res.status(400).json({ error: 'Ugyldig fil' }); return; }
    try {
      await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(req.body, null, 2), 'utf-8');
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Proxy MET Weather API due to CORS and User-Agent requirements
  app.get("/api/weather", async (req, res) => {
    try {
      const { lat, lon, altitude } = req.query;
      if (!lat || !lon) {
        return res.status(400).json({ error: "Missing lat/lon" });
      }

      const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}${altitude ? `&altitude=${altitude}` : ''}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'VeierlandApp/1.0 kontakt@eksempel.no'
        }
      });

      if (!response.ok) {
        throw new Error(`MET API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      // Inform browser it can cache this temporarily if needed
      res.setHeader("Cache-Control", "public, max-age=600");
      res.json(data);
    } catch (error: any) {
      console.error("Weather Proxy Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production serving
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

import 'dotenv/config';
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { orsRoute, OrsError } from "./api/_ors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Same endpoint as the Vercel function in api/route.ts.
  app.get("/api/route", async (req, res) => {
    try {
      const route = await orsRoute({
        from: req.query.from as string, to: req.query.to as string, profile: req.query.profile as string,
      });
      res.set("Cache-Control", "public, max-age=3600").json(route);
    } catch (e) {
      res.status(e instanceof OrsError ? e.status : 502).json({ error: (e as Error).message });
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

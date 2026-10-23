// Vercel function: GET /api/route?from=lat,lng&to=lat,lng&profile=foot-walking
// Proxies to openrouteservice — see api/_ors.ts.
import { orsRoute, OrsError } from './_ors';

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  try {
    const route = await orsRoute({ from: q.get('from'), to: q.get('to'), profile: q.get('profile') });
    return Response.json(route, { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } });
  } catch (e) {
    const status = e instanceof OrsError ? e.status : 502;
    return Response.json({ error: (e as Error).message }, { status });
  }
}

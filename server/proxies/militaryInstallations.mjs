/** Military-installation context proxy.
 * Outbound guard gap: Overpass requests travel through the existing Overpass proxy helper, which does not yet use the outbound guard.
 */
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fetchOverpassPayload } from './overpass.mjs';
import { clientKey, coalesceProxyRequest, makeRateLimiter, registerProxy, requiredFiniteQueryNumber } from '../shared.mjs';

const CACHE_MS = 5 * 60_000;
const STALE_MS = 60 * 60_000;
const MAX_CACHE = 80;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MILITARY_INSTALLATION_ELEMENT_CAP = 700;
const DISK_TTL_MS = 30 * 86_400_000;
const DISK_DIR = path.join(process.cwd(), '.gev-cache', 'military-installations');
const BBOX_STEP_DEG = 0.05;
const cache = new Map();
const inFlight = new Map();
const rateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 300 });

export function quantizeMilitaryInstallationBox(box, stepDeg = BBOX_STEP_DEG) {
  const snap = (value, grow) => {
    const cells = Number((value / stepDeg).toFixed(9));
    return Number(((grow > 0 ? Math.ceil(cells) : Math.floor(cells)) * stepDeg).toFixed(6));
  };
  return { south: Math.max(-90, snap(box.south, -1)), west: Math.max(-180, snap(box.west, -1)), north: Math.min(90, snap(box.north, 1)), east: Math.min(180, snap(box.east, 1)) };
}

export function militaryInstallationCacheKey(box, decimals = 3) {
  return [box.south, box.west, box.north, box.east].map((value) => value.toFixed(decimals)).join(',');
}

export async function resolveMilitaryInstallationTier({ cacheKey, memoryCache, inFlight: pending, readDisk, now = Date.now(), cacheMs = CACHE_MS }) {
  const cached = memoryCache.get(cacheKey);
  if (cached && now - cached.cachedAt <= cacheMs) return { source: 'HIT', entry: cached };
  if (pending.has(cacheKey)) return { source: 'UPSTREAM', entry: null };
  const disk = await readDisk();
  return disk ? { source: 'DISK', entry: disk } : { source: 'UPSTREAM', entry: null };
}

export function migrateMilitaryInstallationEntry(entry) {
  if (!entry?.payload || typeof entry.payload.saturated === 'boolean') return entry;
  const elements = Array.isArray(entry.payload.elements) ? entry.payload.elements : [];
  return { ...entry, payload: { ...entry.payload, saturated: elements.length >= MILITARY_INSTALLATION_ELEMENT_CAP } };
}

export function militaryInstallationDiskFresh(entry, maxAgeMs = DISK_TTL_MS, now = Date.now()) {
  return Boolean(entry && Number.isFinite(entry.cachedAt) && Array.isArray(entry.payload?.elements) && now - entry.cachedAt <= maxAgeMs);
}

export function militaryInstallationDiskPath(cacheKey, dir = DISK_DIR) {
  return path.join(dir, `${createHash('sha1').update(cacheKey).digest('hex')}.json`);
}

export async function readMilitaryInstallationDisk(cacheKey, maxAgeMs, dir = DISK_DIR) {
  try {
    const entry = JSON.parse(await fsp.readFile(militaryInstallationDiskPath(cacheKey, dir), 'utf8'));
    return militaryInstallationDiskFresh(entry, maxAgeMs) ? migrateMilitaryInstallationEntry(entry) : null;
  } catch { return null; }
}

export async function writeMilitaryInstallationDisk(cacheKey, entry, dir = DISK_DIR) {
  const target = militaryInstallationDiskPath(cacheKey, dir);
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(temp, JSON.stringify(entry));
    await fsp.rename(temp, target);
    return true;
  } catch (err) {
    console.warn('[Installations Proxy] disk cache write failed:', err?.message || err);
    await fsp.rm(temp, { force: true }).catch(() => {});
    return false;
  }
}

export function validMilitaryInstallationBox(params) {
  const south = requiredFiniteQueryNumber(params, 'south');
  const west = requiredFiniteQueryNumber(params, 'west');
  const north = requiredFiniteQueryNumber(params, 'north');
  const east = requiredFiniteQueryNumber(params, 'east');
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) return null;
  if (north - south > 10 || east - west > 10) return null;
  return { south, west, north, east };
}

function trimCache() { while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); }

export function militaryInstallationFailureReason(error) {
  if (['rate_limited', 'timeout', 'query_failed'].includes(error?.installationReason)) return error.installationReason;
  return ['AbortError', 'TimeoutError'].includes(error?.name) ? 'timeout' : 'unavailable';
}

export function militaryInstallationsProxy() {
  async function refresh(box, key) {
    const bbox = `${box.south},${box.west},${box.north},${box.east}`;
    const ql = `[out:json][timeout:20];(nwr[\"military\"~\"^(airfield|naval_base|range|barracks|base)$\"](${bbox});nwr[\"landuse\"=\"military\"](${bbox}););out center tags geom ${MILITARY_INSTALLATION_ELEMENT_CAP};`;
    const upstream = await fetchOverpassPayload(`data=${encodeURIComponent(ql)}`, MAX_RESPONSE_BYTES);
    if (upstream.status >= 400 || upstream.rateLimited || upstream.runtimeError) {
      throw Object.assign(new Error('Mapped installation upstream unavailable'), { installationReason: upstream.rateLimited ? 'rate_limited' : upstream.status === 504 ? 'timeout' : upstream.runtimeError ? 'query_failed' : 'unavailable' });
    }
    const parsed = JSON.parse(upstream.body);
    const elements = Array.isArray(parsed?.elements) ? parsed.elements.slice(0, MILITARY_INSTALLATION_ELEMENT_CAP) : [];
    const payload = { elements, saturated: elements.length >= MILITARY_INSTALLATION_ELEMENT_CAP, elementCap: MILITARY_INSTALLATION_ELEMENT_CAP, retrievedAt: new Date().toISOString(), status: 'ready' };
    const entry = { payload, cachedAt: Date.now() };
    cache.set(key, entry); trimCache(); writeMilitaryInstallationDisk(key, entry);
    return payload;
  }
  function install(middlewares) {
    middlewares.use('/api/military-installations', async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Method Not Allowed' })); return; }
      if (!rateLimiter(clientKey(req))) { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' }); res.end(JSON.stringify({ error: 'Rate limit exceeded' })); return; }
      const url = new URL(req.url, 'http://localhost');
      const requested = validMilitaryInstallationBox(url.searchParams);
      if (!requested) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'A non-dateline bbox no larger than 10 degrees is required' })); return; }
      const exact = url.searchParams.get('exact') === '1';
      const box = exact ? requested : quantizeMilitaryInstallationBox(requested);
      const key = exact ? `exact:${militaryInstallationCacheKey(box, 5)}` : militaryInstallationCacheKey(box);
      const now = Date.now();
      const cached = cache.get(key);
      const preflight = await resolveMilitaryInstallationTier({ cacheKey: key, memoryCache: cache, inFlight, readDisk: () => readMilitaryInstallationDisk(key, DISK_TTL_MS), now });
      if (preflight.source !== 'UPSTREAM') {
        if (preflight.source === 'DISK') { cache.set(key, preflight.entry); trimCache(); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-Military-Installations': preflight.source }); res.end(JSON.stringify({ ...preflight.entry.payload, status: 'cached' })); return;
      }
      const request = coalesceProxyRequest(inFlight, key, () => refresh(box, key));
      try {
        const payload = await request.promise;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-Military-Installations': request.shared ? 'INFLIGHT' : 'MISS' }); res.end(JSON.stringify(payload));
      } catch (error) {
        if (cached && now - cached.cachedAt <= STALE_MS) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Military-Installations': 'STALE' }); res.end(JSON.stringify({ ...cached.payload, status: 'stale' })); return; }
        const stale = await readMilitaryInstallationDisk(key, Infinity);
        if (stale) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Military-Installations': 'STALE-DISK' }); res.end(JSON.stringify({ ...stale.payload, status: 'stale' })); return; }
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'Mapped installation context is temporarily unavailable', reason: militaryInstallationFailureReason(error) }));
      }
    });
  }
  return { name: 'military-installations-proxy', configureServer(server) { install(server.middlewares); } };
}

/** Regional cockpit briefing proxy.
 * Outbound guard gap: Nominatim, Google News, GDELT, and Open-Meteo fetches are not yet routed through the outbound guard.
 */
import { normalizeRegionalArticles, normalizeRegionalPlace, normalizeRegionalWeather } from '../../src/data/regionalBrief.js';
import { clientKey, coalesceProxyRequest, makeRateLimiter, readResponseJsonCapped, readResponseTextCapped, requiredFiniteQueryNumber } from '../shared.mjs';

const CACHE_MS = 5 * 60_000;
const STALE_MS = 60 * 60_000;
const MAX_CACHE = 120;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const WEATHER_MAX_RESPONSE_BYTES = 512 * 1024;
const cache = new Map();
const inFlight = new Map();
const rateLimiter = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 90 });
let nominatimQueue = Promise.resolve();
let nominatimLastRequestAt = 0;

export function validRegionalPoint(params) {
  const latitude = requiredFiniteQueryNumber(params, 'latitude');
  const longitude = requiredFiniteQueryNumber(params, 'longitude');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}
function trimCache() { while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); }
async function fetchJson(url, { headers = {}, timeoutMs = 9000, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url, { signal: controller.signal, headers }); if (!response.ok) throw new Error(`Upstream returned ${response.status}`); return readResponseJsonCapped(response, maxBytes); } finally { clearTimeout(timeout); }
}
async function fetchText(url, { headers = {}, timeoutMs = 9000, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url, { signal: controller.signal, headers }); if (!response.ok) throw new Error(`Upstream returned ${response.status}`); return readResponseTextCapped(response, maxBytes); } finally { clearTimeout(timeout); }
}
function decodeRssText(value) { return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function rssTag(block, tag) { return decodeRssText(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block)?.[1] || ''); }
function normalizeRssArticles(xml, limit = 5) {
  const seen = new Set(), articles = [];
  for (const match of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) { const item = match[1], title = rssTag(item, 'title').slice(0, 180), url = rssTag(item, 'link'); let parsedUrl; try { parsedUrl = new URL(url); } catch { continue; } if (!title || !['http:', 'https:'].includes(parsedUrl.protocol)) continue; const source = rssTag(item, 'source'), signature = `${title.toLowerCase()}|${source.toLowerCase() || parsedUrl.hostname}`; if (seen.has(signature)) continue; seen.add(signature); const rawDate = rssTag(item, 'pubDate'); articles.push({ title, url: parsedUrl.href, domain: source || parsedUrl.hostname.replace(/^www\./, ''), publishedAt: Number.isNaN(Date.parse(rawDate)) ? null : new Date(rawDate).toISOString(), sourceCountry: null }); if (articles.length >= limit) break; }
  return articles;
}
function fetchPlace(point) {
  const task = nominatimQueue.then(async () => { const waitMs = Math.max(0, 1100 - (Date.now() - nominatimLastRequestAt)); if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs)); nominatimLastRequestAt = Date.now(); const params = new URLSearchParams({ format: 'jsonv2', lat: point.latitude.toFixed(5), lon: point.longitude.toFixed(5), zoom: '10', addressdetails: '1', 'accept-language': 'en' }); return normalizeRegionalPlace(await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params}`, { headers: { 'User-Agent': 'GodsEyeView/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)', Referer: 'https://github.com/bilawalsidhu/gods-eye-view' } })); });
  nominatimQueue = task.catch(() => null); return task;
}
async function fetchNews(place) {
  const query = place?.locality || place?.region || place?.country; if (!query) return { status: 'unavailable', query: null, articles: [], source: null };
  const cleanQuery = String(query).replace(/["\\]/g, ' ').trim();
  try { const xml = await fetchText(`https://news.google.com/rss/search?${new URLSearchParams({ q: cleanQuery, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`, { headers: { 'User-Agent': 'GodsEyeView/0.1' }, timeoutMs: 12_000 }); const articles = normalizeRssArticles(xml, 5); if (articles.length) return { status: 'ready', query, articles, source: 'Google News RSS' }; } catch {}
  try { const payload = await fetchJson(`https://api.gdeltproject.org/api/v2/doc/doc?${new URLSearchParams({ query: `\"${cleanQuery}\"`, mode: 'artlist', format: 'json', maxrecords: '5', sort: 'datedesc', timespan: '48h' })}`, { headers: { 'User-Agent': 'GodsEyeView/0.1' }, timeoutMs: 12_000 }); const articles = normalizeRegionalArticles(payload, 5); return { status: articles.length ? 'ready' : 'empty', query, articles, source: 'GDELT fallback' }; } catch { return { status: 'unavailable', query, articles: [], source: null }; }
}
export async function fetchRegionalWeather(point) {
  const params = new URLSearchParams({ latitude: point.latitude.toFixed(5), longitude: point.longitude.toFixed(5), current: 'temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility', timezone: 'UTC' });
  try { return normalizeRegionalWeather(await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`, { maxBytes: WEATHER_MAX_RESPONSE_BYTES })); } catch { return null; }
}
export function regionalBriefHasAnySource({ place, weather, news } = {}) { return Boolean(place || weather || (news && news.status !== 'unavailable')); }
export function regionalBriefProxy() {
  async function refresh(point, key) { const [placeResult, weatherResult] = await Promise.allSettled([fetchPlace(point), fetchRegionalWeather(point)]); const place = placeResult.status === 'fulfilled' ? placeResult.value : null, weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null, news = await fetchNews(place); if (!regionalBriefHasAnySource({ place, weather, news })) throw new Error('All regional briefing sources unavailable'); const payload = { status: place && weather && news.status !== 'unavailable' ? 'ready' : 'partial', retrievedAt: new Date().toISOString(), coordinates: point, place, placeStatus: place ? 'ready' : 'unavailable', weather, weatherStatus: weather ? 'ready' : 'unavailable', newsStatus: news.status, newsQuery: news.query, newsSource: news.source, articles: news.articles }; cache.set(key, { payload, cachedAt: Date.now() }); trimCache(); return payload; }
  return { name: 'regional-brief-proxy', configureServer(server) { server.middlewares.use('/api/regional-brief', async (req, res) => { if (req.method !== 'GET') { res.writeHead(405, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Method Not Allowed' })); return; } if (!rateLimiter(clientKey(req))) { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '10' }); res.end(JSON.stringify({ error: 'Rate limit exceeded' })); return; } const point = validRegionalPoint(new URL(req.url || '', 'http://localhost').searchParams); if (!point) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Valid latitude and longitude are required' })); return; } const key = `${(Math.round(point.latitude * 10) / 10).toFixed(1)},${(Math.round(point.longitude * 10) / 10).toFixed(1)}`, now = Date.now(), cached = cache.get(key); if (cached && now - cached.cachedAt <= CACHE_MS) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-Regional-Brief': 'HIT' }); res.end(JSON.stringify({ ...cached.payload, status: 'cached' })); return; } const request = coalesceProxyRequest(inFlight, key, () => refresh(point, key)); try { const payload = await request.promise; res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-Regional-Brief': request.shared ? 'INFLIGHT' : 'MISS' }); res.end(JSON.stringify(payload)); } catch { if (cached && now - cached.cachedAt <= STALE_MS) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Regional-Brief': 'STALE' }); res.end(JSON.stringify({ ...cached.payload, status: 'stale' })); return; } res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'Regional briefing is temporarily unavailable' })); } }); } };
}

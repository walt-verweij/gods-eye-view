/**
 * Vite configuration for God's Eye View — a cinematic geospatial app.
 *
 * Registers the dev-server proxy middlewares that bypass CORS and add
 * caching/auth for upstream APIs:
 *   1. OpenSky  — aircraft state vectors (OAuth / Basic / anon)
 *   2. CelesTrak — satellite TLE orbital elements
 *   3. Overpass  — OpenStreetMap road geometry queries
 *   4. GBFS     — bike-share station feeds
 *   5. CCTV     — traffic-camera frames, media streams, and fallback SVG
 *   6. adsb.lol — military aircraft tracking
 *   7. AIS live — AISStream websocket-backed live vessel positions
 *   8. Terrain heights — Re:Earth keyless point-height lookups (ellipsoidal ground)
 *   9. TomTom   — live traffic-flow vector tiles (budget-governed, keyless-degradable)
 *  10. NASA FIRMS — live active-fire detections (VIIRS ×3, trailing 24 h)
 *  11. Military-installation context — bounded, cached OpenStreetMap features
 *  12. Regional briefing — cached place, weather, and recent location-matched news
 *  13. Weather effects — camera-local Open-Meteo observations without news/geocoding overhead
 *  14. Rocket launches — recent Launch Library 2 mission metadata
 *  15. Radio Browser — public-domain station directory and click counting
 *
 * Also exposes Cesium and Google 3D Tiles API keys to the
 * client via `import.meta.env.*` defines.
 *
 * @module vite.config
 */

import fs from 'node:fs';
import os from 'node:os';
import { promises as fsp } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  isValidTileCoord as isValidTomTomTile,
  utcDayKey as tomtomUtcDayKey,
  normalizeBudget as normalizeTomTomBudget,
  isOverBudget as isTomTomOverBudget,
} from './src/data/tomtomTiles.js';
import { filterTrailing24h, parseFirmsCsv } from './src/data/firmsCsv.js';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import cesium from 'vite-plugin-cesium';
import { normalizeRadioCountryInput } from './src/data/radioCountry.js';
import {
  normalizeRegionalArticles,
  normalizeRegionalPlace,
  normalizeRegionalWeather,
} from './src/data/regionalBrief.js';
import { parseEnv as parseDotenvText } from 'node:util';
import { readEnvironmentSource as readPinokioEnvironmentSource } from './scripts/pinokio-environment.mjs';
import {
  admitKeySetupRequest,
  isKeySetupExternallyManaged,
  keySetupStatus,
  knownKeySetupEnvVars,
  upsertDotenvValues,
  validateKeySetupUpdates,
} from './src/keySetupCore.mjs';
import { hardenCredentialFile } from './src/keySetupHardening.mjs';
import {
  fetchTerrainChunkWithRetry,
  parseTerrainPoints,
  resolveTerrainHeightRequest,
  terrainPointKey,
  validTerrainResult,
} from './src/data/terrainHeightsProxy.js';
import { radioBrowserProxy } from './server/proxies/radio.mjs';
import { celestrakProxy } from './server/proxies/celestrak.mjs';
import { rocketLaunchesProxy } from './server/proxies/rocketLaunches.mjs';
import { tomtomProxy } from './server/proxies/tomtom.mjs';
import { firmsProxy } from './server/proxies/firms.mjs';
import { terrainHeightsProxy } from './server/proxies/terrainHeights.mjs';
import { adsbdbProxy } from './server/proxies/adsbdb.mjs';
import { overpassProxy } from './server/proxies/overpass.mjs';
import { gbfsProxy } from './server/proxies/gbfs.mjs';
import { cctvProxy } from './server/proxies/cctv.mjs';
import { adsbLolProxy } from './server/proxies/adsblol.mjs';
import { aisLiveProxy } from './server/proxies/aisLive.mjs';
import { trackBackfillProxies } from './server/proxies/trackBackfill.mjs';
import { openAiRealtimeProxy } from './server/proxies/openaiRealtime.mjs';
import { googlePlacesContextProxy } from './server/proxies/googlePlacesContext.mjs';
import { openSkyProxy } from './server/proxies/opensky.mjs';
export { fetchOverpassPayload, isOverpassBoundaryQuery, overpassPayloadIsData, readOverpassDisk, resolveOverpassPreflight, simplifyOverpassPayloadBody } from './server/proxies/overpass.mjs';
export { LL2_CACHE_TTL_MS, launchLibraryRequestHeaders } from './server/proxies/rocketLaunches.mjs';
export { adsbLolFallbackAnchor } from './server/proxies/opensky.mjs';
export { CCTV_FRAME_FETCH_TIMEOUT_MS, fetchCctvImageFromUpstream } from './server/proxies/cctv.mjs';
export { openAiRealtimeProxy } from './server/proxies/openaiRealtime.mjs';
export { googlePlacesContextProxy, keylessGooglePlacesResponse } from './server/proxies/googlePlacesContext.mjs';
import { clientKey, coalesceProxyRequest, enforceOptInRateLimit, makeOptInRateLimiter, makeRateLimiter, readRequestBodyCapped, readResponseJsonCapped, readResponseTextCapped, registerProxy, requiredFiniteQueryNumber } from './server/shared.mjs';
export { coalesceProxyRequest, readResponseJsonCapped, readResponseTextCapped, requiredFiniteQueryNumber } from './server/shared.mjs';

/** Resolve __dirname for ESM context. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Which launcher started this process, captured at MODULE LOAD — before the
 * config factory's loadEnv() copies dotenv files into process.env. Provider
 * Settings uses this to decide which credential store it owns, so it must
 * reflect the real launcher (scripts/pinokio-start.mjs sets it) and never a
 * value a project `.env` could inject.
 */
const LAUNCHER_AT_BOOT = process.env.GEV_LAUNCHER;

/**
 * Provider values present before Vite loads the checkout's dotenv files.
 * Memoized on globalThis: a panel save sets its values live on process.env and
 * then calls server.restart(), which re-evaluates this config IN-PROCESS.
 * Recomputing the snapshot there would classify the panel's own keys as
 * external (read-only) until the whole process is relaunched.
 */
const PROVIDER_ENV_AT_BOOT = globalThis.__GEV_PROVIDER_ENV_AT_BOOT ??= Object.freeze(Object.fromEntries(
  [...knownKeySetupEnvVars()].map((name) => [name, String(process.env[name] ?? '').trim()]),
));

/**
 * `dev-fresh.sh` resolves dotenv and Keychain values before it starts Vite, so
 * it supplies an explicit names-only provenance marker for values inherited
 * from its parent shell. Plain Vite launches use the raw boot snapshot above;
 * Pinokio deliberately treats its app-scoped ENVIRONMENT as authoritative.
 */
const DEV_FRESH_EXTERNAL_KEYS_AT_BOOT = new Set(
  String(process.env.GEV_KEY_SETUP_EXTERNAL_KEYS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => knownKeySetupEnvVars().has(name)),
);

import { militaryInstallationsProxy } from './server/proxies/militaryInstallations.mjs';
export { MILITARY_INSTALLATION_ELEMENT_CAP, militaryInstallationCacheKey, militaryInstallationDiskFresh, militaryInstallationDiskPath, militaryInstallationFailureReason, migrateMilitaryInstallationEntry, quantizeMilitaryInstallationBox, readMilitaryInstallationDisk, resolveMilitaryInstallationTier, validMilitaryInstallationBox, writeMilitaryInstallationDisk } from './server/proxies/militaryInstallations.mjs';

import { regionalBriefProxy } from './server/proxies/regionalBrief.mjs';
export { regionalBriefHasAnySource, validRegionalPoint } from './server/proxies/regionalBrief.mjs';
import { weatherEffectsProxy } from './server/proxies/weatherEffects.mjs';

import { keySetupEndpoint } from './server/proxies/keySetup.mjs';

export default defineConfig(({ mode }) => {
  // Load only this checkout's dotenv files. Shell/Keychain values still win,
  // and no sibling workspace is consulted implicitly.
  const loaded = loadEnv(mode, __dirname, '');
  for (const [key, val] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = val;
  }
  const env = { ...process.env };
  const localAllowedHosts = ['localhost', '127.0.0.1', '.local'];
  return {
    plugins: [
      cesium(),
     registerProxy(openSkyProxy()),
     registerProxy(celestrakProxy()),
     registerProxy(tomtomProxy()),
      registerProxy(firmsProxy()),
     registerProxy(rocketLaunchesProxy()),
     registerProxy(terrainHeightsProxy()),
     registerProxy(adsbdbProxy()),
      registerProxy(overpassProxy()),
     registerProxy(militaryInstallationsProxy()),
      registerProxy(regionalBriefProxy()),
      registerProxy(weatherEffectsProxy()),
     registerProxy(cctvProxy()),
      registerProxy(radioBrowserProxy()),
     registerProxy(gbfsProxy()),
      registerProxy(adsbLolProxy()),
      registerProxy(aisLiveProxy()),
      registerProxy(trackBackfillProxies()),
      registerProxy(openAiRealtimeProxy()),
      registerProxy(googlePlacesContextProxy()),
      registerProxy(keySetupEndpoint({
        rootDir: __dirname,
        launcherAtBoot: LAUNCHER_AT_BOOT,
        providerEnvAtBoot: PROVIDER_ENV_AT_BOOT,
        devFreshExternalKeysAtBoot: DEV_FRESH_EXTERNAL_KEYS_AT_BOOT,
      }), { preview: false }),
    ],
    server: {
      host: env.HOST || 'localhost',
      port: parseInt(env.PORT, 10) || 4173,
      // When binding to all interfaces, allow any host; otherwise restrict to local names
      allowedHosts: (env.HOST === '0.0.0.0' || env.HOST === '::')
        ? true
        : localAllowedHosts,
      fs: {
        // Pinokio keeps optional credentials in this ignored local file.
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ENVIRONMENT'],
      },
      // Framing protection belongs on the APP DOCUMENT, not on API responses:
      // a browser evaluates frame-ancestors against the framed page's own
      // navigation response. Without this, a hostile page could frame
      // `/?setup=1`, align a lure over Provider Settings, and have the framed
      // app issue a perfectly same-origin credential write that passes every
      // Host/Origin check. These headers apply to everything this dev server
      // serves, which is what makes that attack impossible rather than unlikely.
      headers: {
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
    // Expose selected API keys to the browser via import.meta.env.*
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(env.GOOGLE_MAPS_API_KEY),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(env.CESIUM_ION_TOKEN),
    },
    build: {
      // The Cesium engine bundle is inherently large; raise the warning ceiling
      // so the build log isn't dominated by an expected chunk-size notice.
      chunkSizeWarningLimit: 1500,
    },
  };
});

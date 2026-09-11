import fs from 'node:fs';
import puppeteer from 'puppeteer';

// The Austin fixtures are shared with the tracking regression harness. Keeping
// the browser smoke near the same camera target makes its one real handoff
// deterministic without reaching OpenSky or any other provider.
export const SYNTHETIC_FLIGHTS = Object.freeze([
  Object.freeze({ icao: 'aaa001', callsign: 'SYN001', lon: -97.7431, lat: 30.2672, alt: 9000, vel: 230, track: 90 }),
  Object.freeze({ icao: 'aaa002', callsign: 'SYN002', lon: -97.7600, lat: 30.2800, alt: 9500, vel: 210, track: 45 }),
  Object.freeze({ icao: 'aaa003', callsign: 'SYN003', lon: -97.7300, lat: 30.2550, alt: 8700, vel: 250, track: 135 }),
]);

/** Prefer Puppeteer's pinned Chrome-for-Testing so browser behavior is repeatable. */
export async function findChromeExecutable() {
  const linuxSystemBrowsers = process.platform === 'linux'
    ? ['/snap/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']
    : [];
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    // Chrome-for-Testing currently has no Linux ARM build. Use the host
    // Chromium only there; CI's x86 runner keeps Puppeteer's pinned browser.
    ...(process.arch === 'arm64' ? linuxSystemBrowsers : []),
    await puppeteer.executablePath().catch(() => null),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ...linuxSystemBrowsers,
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || null;
}

/** The SwiftShader launch contract used by the existing Cesium tracking harness. */
export function chromiumLaunchArgs({ headful = false } = {}) {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    ...(headful ? [] : ['--use-gl=angle', '--use-angle=swiftshader']),
    '--disable-dev-shm-usage',
    '--disable-web-security',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,800',
  ];
}

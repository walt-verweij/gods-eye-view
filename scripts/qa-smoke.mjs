#!/usr/bin/env node

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { chromiumLaunchArgs, findChromeExecutable, SYNTHETIC_FLIGHTS } from './browser-smoke-support.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keylessEnvironment = Object.fromEntries([
  'AISSTREAM_API_KEY',
  'CESIUM_ION_TOKEN',
  'FIRMS_MAP_KEY',
  'GOOGLE_MAPS_API_KEY',
  'LL2_API_TOKEN',
  'OPENAI_API_KEY',
  'OPENSKY_CLIENT_ID',
  'OPENSKY_CLIENT_SECRET',
  'TOMTOM_API_KEY',
].map((name) => [name, '']));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name, startedAt) {
  console.log(`  PASS ${name} (${Math.round(performance.now() - startedAt)} ms)`);
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(url, server) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited before startup (${server.exitCode})`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The next short retry is less brittle than parsing Vite's human output.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null && !server.signalCode) server.kill('SIGKILL');
}

async function installFixtures(page, appOrigin) {
  await page.evaluateOnNewDocument((flights, origin) => {
    const json = (body) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const requestUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const url = new URL(requestUrl, window.location.href);
      if (url.origin !== origin) return originalFetch(input, init);
      if (url.pathname === '/api/opensky') {
        return Promise.resolve(json({
          time: Math.floor(Date.now() / 1000),
          states: flights.map((flight) => [
            flight.icao, flight.callsign, 'Synthetica', Math.floor(Date.now() / 1000),
            Math.floor(Date.now() / 1000), flight.lon, flight.lat, flight.alt, false,
            flight.vel, flight.track, 0, null, null, null, false, 0,
          ]),
        }));
      }
      if (url.pathname === '/api/opensky-track') return Promise.resolve(json({ path: [] }));
      if (url.pathname === '/api/ais-live') return Promise.resolve(json({ status: 'connected', rows: [] }));
      if (url.pathname === '/api/adsblol/mil') return Promise.resolve(json({ ac: [] }));
      if (url.pathname === '/api/adsblol/trace') return Promise.resolve(json({ timestamp: 0, trace: [] }));
      if (/^\/api\/adsbdb\/(?:type|route)\//.test(url.pathname)) return Promise.resolve(json({}));
      if (url.pathname === '/api/openai/hud-summary') return Promise.resolve(json({ summary: 'Smoke fixture ready' }));
      return originalFetch(input, init);
    };
    window.addEventListener('error', (event) => {
      window.__smokeRuntimeErrors ??= [];
      window.__smokeRuntimeErrors.push(event.error?.message || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.__smokeRuntimeErrors ??= [];
      window.__smokeRuntimeErrors.push(`unhandled rejection: ${event.reason?.message || event.reason}`);
    });
  }, SYNTHETIC_FLIGHTS, appOrigin);
}

async function main() {
  const port = await findAvailablePort();
  const appUrl = `http://127.0.0.1:${port}`;
  const vitePath = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: repoRoot,
    env: { ...process.env, ...keylessEnvironment, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', (chunk) => { serverOutput += chunk; });
  server.stderr.on('data', (chunk) => { serverOutput += chunk; });
  let browser;
  const failures = [];

  try {
    let stepStartedAt = performance.now();
    await waitForServer(appUrl, server);
    const executablePath = await findChromeExecutable();
    assert(executablePath, 'Puppeteer Chrome for Testing is unavailable');
    browser = await puppeteer.launch({
      headless: 'new',
      protocolTimeout: 120_000,
      executablePath,
      args: chromiumLaunchArgs(),
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => failures.push(`uncaught exception: ${error.message}`));
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      // The smoke is deliberately hermetic: only Vite-served assets and the
      // fetch fixtures above are allowed to leave Chromium's request queue.
      if (url.origin !== appUrl) {
        await request.respond({ status: 204, contentType: 'text/plain', body: '' });
      } else {
        await request.continue();
      }
    });
    await installFixtures(page, appUrl);
    // Cesium's module graph is intentionally large. The meaningful readiness
    // condition is the viewer below, not DOMContentLoaded while modules load.
    await page.goto(`${appUrl}/?welcome=0`, { waitUntil: 'domcontentloaded', timeout: 10_000 })
      .catch((error) => {
        if (error.name !== 'TimeoutError') throw error;
      });
    await page.waitForFunction(() => (
      window.__godsEyeView?.viewer
      && window.__godsEyeView?.dataManager?.layers?.has('flights')
    ), { timeout: 150_000 }).catch(async (error) => {
      const loader = await page.evaluate(() => document.querySelector('.loader-status')?.textContent || 'no loader status');
      throw new Error(`Globe did not initialise (${loader}); ${consoleErrors.join(' | ') || error.message}`);
    });
    pass('globe initialised', stepStartedAt);

    stepStartedAt = performance.now();
    const enabled = await page.evaluate(() => window.__godsEyeView.dataManager
      .setEnabled('flights', true, { origin: 'user' }));
    assert(enabled, 'Flights layer enable was rejected');
    const fixtureStats = await page.evaluate(async () => {
      const view = window.__godsEyeView;
      const flights = view.dataManager.layers.get('flights').module;
      await flights.update(view.viewer);
      return flights.getStats();
    });
    assert(fixtureStats.count >= 1, `Flights fixture did not load: ${JSON.stringify(fixtureStats)}`);
    pass('flights toggled on from fixture', stepStartedAt);

    stepStartedAt = performance.now();
    const tracked = await page.evaluate(() => window.__godsEyeView.dataManager.layers
      .get('flights').module.trackById('aaa001', { origin: 'user' }));
    assert(tracked, 'Fixture aircraft tracking handoff was rejected');
    const handoff = await page.evaluate(() => {
      const view = window.__godsEyeView;
      return {
        trackedId: view.dataManager.layers.get('flights')?.module?.getTrackedInfo?.()?.icao24 || null,
        viewerTrackedId: view.viewer.trackedEntity?.gevTrackedId || null,
      };
    });
    assert(
      handoff.trackedId === 'aaa001' && handoff.viewerTrackedId === 'flights:aaa001',
      `Tracking handoff was not committed: ${JSON.stringify(handoff)}`,
    );
    pass('tracking handoff completed', stepStartedAt);

    stepStartedAt = performance.now();
    const cockpit = await page.evaluate(async () => {
      const view = window.__godsEyeView;
      const context = await view.styleManager.setContextMode('contacts');
      const entry = view.styleManager.controlCockpit('enter');
      return { context, entry };
    });
    assert(cockpit.context?.ok, `Contacts activation failed: ${cockpit.context?.error || 'unknown error'}`);
    assert(cockpit.entry?.ok, `Cockpit entry failed: ${cockpit.entry?.error || 'unknown error'}`);
    await page.waitForFunction(() => document.body.classList.contains('cockpit-mode'), { timeout: 30_000 });
    pass('cockpit entered', stepStartedAt);

    stepStartedAt = performance.now();
    const exited = await page.evaluate(() => window.__godsEyeView.styleManager.controlCockpit('exit'));
    assert(exited.ok, `Cockpit exit failed: ${exited.error || 'unknown error'}`);
    await page.waitForFunction(() => !document.body.classList.contains('cockpit-mode'), { timeout: 30_000 });
    pass('cockpit exited', stepStartedAt);

    stepStartedAt = performance.now();
    const contextOff = await page.evaluate(() => window.__godsEyeView.styleManager.setContextMode('off'));
    assert(contextOff.ok, `Contacts deactivation failed: ${contextOff.error || 'unknown error'}`);
    const disabled = await page.evaluate(() => window.__godsEyeView.dataManager
      .setEnabled('flights', false, { origin: 'user' }));
    assert(disabled, 'Flights layer disable was rejected');
    await page.waitForFunction(
      () => !window.__godsEyeView.dataManager.isEnabled('flights'),
      { timeout: 60_000, polling: 100 },
    );
    pass('flights toggled off', stepStartedAt);

    if (process.env.GEV_SMOKE_INJECT_CONSOLE_ERROR === '1') {
      await page.evaluate(() => console.error('smoke injected console error'));
    }
    const runtimeErrors = await page.evaluate(() => window.__smokeRuntimeErrors || []);
    failures.push(...consoleErrors.map((error) => `console.error: ${error}`));
    failures.push(...runtimeErrors.map((error) => `runtime error: ${error}`));
    assert(failures.length === 0, failures.join('\n'));
    pass('no uncaught exceptions, unhandled rejections, or console errors', stepStartedAt);
  } finally {
    await browser?.close();
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(`Smoke failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

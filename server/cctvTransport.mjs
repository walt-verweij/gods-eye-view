import http from 'node:http';
import https from 'node:https';
import { lookup as lookupDns } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { isPublicAddress } from './shared.mjs';

export const CCTV_FRAME_MAX_BYTES = 8 * 1024 * 1024;
export const CCTV_MAX_REDIRECTS = 3;

/** Return whether an address may be reached by catalog-derived CCTV sources. */
export function isPublicCctvAddress(value) {
  return isPublicAddress(value);
}

function validCctvAddress(value) {
  return isIP(String(value ?? '').trim().replace(/^\[|\]$/g, '')) !== 0;
}

export async function resolveCctvAddresses(hostname, lookupImpl = lookupDns, { allowPrivateAddress = false } = {}) {
  const resolved = await lookupImpl(hostname, { all: true, verbatim: true });
  const rows = (Array.isArray(resolved) ? resolved : [resolved])
    .map((row) => ({ address: String(row?.address || ''), family: Number(row?.family) || undefined }))
    .filter((row) => row.address);
  if (!rows.length || rows.some((row) => !validCctvAddress(row.address)
    || (!allowPrivateAddress && !isPublicCctvAddress(row.address)))) {
    throw new Error('CCTV upstream resolved to a forbidden address');
  }
  return rows;
}

function fetchPinnedCctvResponse(url, { headers, signal }, addresses) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const address = addresses[0];
    const request = transport.request(parsed, {
      method: 'GET',
      headers,
      signal,
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions?.all) callback(null, addresses);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
        else if (value !== undefined) responseHeaders.set(name, String(value));
      }
      resolve(new Response(Readable.toWeb(response), {
        status: response.statusCode || 500,
        statusText: response.statusMessage || '',
        headers: responseHeaders,
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

function validCctvUrl(value) {
  try {
    const url = new URL(String(value));
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/**
 * Resolve once per URL and pin that result into the outbound connection. Redirects
 * are deliberately manual: every new destination repeats the resolution policy.
 * `fetchImpl` is an injected test seam; production uses the pinned Node request.
 */
export async function fetchCctvResponse(value, {
  lookupImpl = lookupDns,
  fetchImpl,
  headers = {},
  signal: clientSignal,
  timeoutMs = 8_000,
  allowPrivateAddress = false,
  maxRedirects = CCTV_MAX_REDIRECTS,
} = {}) {
  let url = validCctvUrl(value);
  if (!url) throw new Error('CCTV upstream URL is invalid');
  const controller = new AbortController();
  const timeoutError = new Error('CCTV upstream fetch timed out');
  const abortFromClient = () => controller.abort(clientSignal.reason || new Error('CCTV client disconnected'));
  if (clientSignal) {
    if (clientSignal.aborted) abortFromClient();
    else clientSignal.addEventListener('abort', abortFromClient, { once: true });
  }
  const timeoutId = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  let keepClientAbort = false;
  try {
    for (let redirects = 0; ; redirects += 1) {
      const addresses = await resolveCctvAddresses(url.hostname, lookupImpl, { allowPrivateAddress });
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = fetchImpl
        ? await fetchImpl(url.href, {
          headers,
          signal: controller.signal,
          redirect: 'manual',
          resolvedAddresses: addresses,
        })
        : await fetchPinnedCctvResponse(url.href, { headers, signal: controller.signal }, addresses);
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        keepClientAbort = true;
        return response;
      }
      if (redirects >= maxRedirects) {
        try { await response.body?.cancel(); } catch { /* no-op */ }
        throw new Error('CCTV upstream redirect limit exceeded');
      }
      const location = response.headers.get('location');
      try { await response.body?.cancel(); } catch { /* no-op */ }
      url = location ? validCctvUrl(new URL(location, url).href) : null;
      if (!url) throw new Error('CCTV upstream redirect is invalid');
    }
  } catch (error) {
    if (controller.signal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (clientSignal && !keepClientAbort) clientSignal.removeEventListener('abort', abortFromClient);
  }
}

export async function readCctvFrameBody(response, maxBytes = CCTV_FRAME_MAX_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await response.body?.cancel(); } catch { /* no-op */ }
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
}

export async function fetchCctvFrame(url, options = {}) {
  try {
    const response = await fetchCctvResponse(url, options);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.startsWith('image/')) {
      try { await response.body?.cancel(); } catch { /* no-op */ }
      return null;
    }
    const body = await readCctvFrameBody(response, options.maxBytes || CCTV_FRAME_MAX_BYTES);
    return body === null ? null : { ok: true, body, contentType };
  } catch {
    return null;
  }
}

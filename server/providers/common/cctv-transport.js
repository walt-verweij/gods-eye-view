import { lookup as lookupDns } from 'node:dns/promises';
import {
  guardedFetch,
  isPublicOutboundAddress,
  resolveOutboundAddresses,
} from './outbound-guard.js';

export const CCTV_FRAME_MAX_BYTES = 8 * 1024 * 1024;
export const CCTV_MAX_REDIRECTS = 3;

/** Compatibility aliases for existing CCTV consumers. */
export const isPublicCctvAddress = isPublicOutboundAddress;

export async function resolveCctvAddresses(hostname, lookupImpl = lookupDns, { allowPrivateAddress = false } = {}) {
  return resolveOutboundAddresses(hostname, lookupImpl, { allowPrivateAddress });
}

/** CCTV's compatibility wrapper around the shared outbound destination guard. */
export async function fetchCctvResponse(value, {
  lookupImpl = lookupDns,
  fetchImpl,
  headers = {},
  signal,
  timeoutMs = 8_000,
  allowPrivateAddress = false,
  maxRedirects = CCTV_MAX_REDIRECTS,
} = {}) {
  return guardedFetch(value, {
    lookupImpl,
    fetchImpl,
    headers,
    signal,
    timeoutMs,
    allowPrivateAddress,
    maxRedirects,
    transport: 'pinned',
  });
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

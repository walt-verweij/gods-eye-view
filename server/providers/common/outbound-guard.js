import http from 'node:http';
import https from 'node:https';
import { lookup as lookupDns } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export const OUTBOUND_MAX_REDIRECTS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function isNonGlobalIpv4(address) {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const values = parts.map(Number);
  if (values.some((value) => value > 255)) return true;
  const [a, b, c] = values;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

function ipv6Number(address) {
  const pieces = address.toLowerCase().split('::');
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces[1] ? pieces[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((total, group) => (total << 16n) | BigInt(`0x${group}`), 0n);
}

/** Return whether an IP address may be contacted by a server-side provider. */
export function isPublicOutboundAddress(value) {
  const address = String(value ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(address) === 4) return !isNonGlobalIpv4(address);
  if (isIP(address) !== 6) return false;
  const numeric = ipv6Number(address);
  if (numeric === null) return false;
  const inCidr = (base, prefix) => {
    const shift = 128n - BigInt(prefix);
    return (numeric >> shift) === (ipv6Number(base) >> shift);
  };
  return inCidr('2000:0:0:0:0:0:0:0', 3)
    && !inCidr('2001:0:0:0:0:0:0:0', 23)
    && !inCidr('2001:db8:0:0:0:0:0:0', 32)
    && !inCidr('2002:0:0:0:0:0:0:0', 16)
    && !inCidr('3fff:0:0:0:0:0:0:0', 20);
}

function validAddress(value) {
  return isIP(String(value ?? '').trim().replace(/^\[|\]$/g, '')) !== 0;
}

export async function resolveOutboundAddresses(hostname, lookupImpl = lookupDns, { allowPrivateAddress = false } = {}) {
  const resolved = await lookupImpl(hostname, { all: true, verbatim: true });
  const addresses = (Array.isArray(resolved) ? resolved : [resolved])
    .map((row) => ({ address: String(row?.address || ''), family: Number(row?.family) || undefined }))
    .filter((row) => row.address);
  if (!addresses.length || addresses.some((row) => !validAddress(row.address)
    || (!allowPrivateAddress && !isPublicOutboundAddress(row.address)))) {
    throw new Error('Outbound upstream resolved to a forbidden address');
  }
  return addresses;
}

function validUrl(value) {
  try {
    const url = new URL(String(value));
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function responseFromNode(response, maxBytes) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, String(value));
  }
  const declared = Number(headers.get('content-length'));
  if (Number.isFinite(maxBytes) && declared > maxBytes) {
    response.destroy();
    throw new Error('Outbound response exceeded byte cap');
  }
  const body = Number.isFinite(maxBytes)
    ? Readable.toWeb(response).pipeThrough(new TransformStream({
      transform(chunk, controller) {
        this.size = (this.size || 0) + chunk.byteLength;
        if (this.size > maxBytes) {
          controller.error(new Error('Outbound response exceeded byte cap'));
          response.destroy();
          return;
        }
        controller.enqueue(chunk);
      },
    }))
    : Readable.toWeb(response);
  return new Response(body, { status: response.statusCode || 500, statusText: response.statusMessage || '', headers });
}

function fetchPinnedResponse(url, options, addresses, maxBytes) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const address = addresses[0];
    const request = transport.request(parsed, {
      method: options.method || 'GET',
      headers: options.headers,
      signal: options.signal,
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions?.all) callback(null, addresses);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      try { resolve(responseFromNode(response, maxBytes)); } catch (error) { reject(error); }
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

async function capInjectedResponse(response, maxBytes) {
  if (!Number.isFinite(maxBytes)) return response;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await response.body?.cancel(); } catch { /* no-op */ }
    throw new Error('Outbound response exceeded byte cap');
  }
  if (!response.body) return response;
  let size = 0;
  const body = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        controller.error(new Error('Outbound response exceeded byte cap'));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * Every caller gets DNS validation and manual redirect re-validation. The
 * default `fetch` transport calls the current `globalThis.fetch` so provider
 * test seams remain intact; it cannot pin Node's socket after validation.
 * `transport: 'pinned'` is reserved for CCTV frame/media and Radio Browser,
 * which already used raw Node requests and must retain DNS answer pinning.
 * An injected `fetchImpl` always wins over either transport for testability.
 */
export async function guardedFetch(value, options = {}) {
  const {
    lookupImpl = lookupDns,
    fetchImpl,
    transport = 'fetch',
    timeoutMs = 8_000,
    maxRedirects = OUTBOUND_MAX_REDIRECTS,
    maxBytes,
    allowPrivateAddress = false,
    signal: clientSignal,
    ...fetchOptions
  } = options;
  let url = validUrl(value);
  let requestValue = value;
  if (!url) throw new Error('Outbound upstream URL is invalid');
  const controller = new AbortController();
  const timeoutError = new Error('Outbound upstream fetch timed out');
  const abortFromClient = () => controller.abort(clientSignal.reason || new Error('Outbound client disconnected'));
  if (clientSignal) {
    if (clientSignal.aborted) abortFromClient();
    else clientSignal.addEventListener('abort', abortFromClient, { once: true });
  }
  const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(timeoutError), timeoutMs) : null;
  try {
    for (let redirects = 0; ; redirects += 1) {
      const addresses = await resolveOutboundAddresses(url.hostname, lookupImpl, { allowPrivateAddress });
      if (controller.signal.aborted) throw controller.signal.reason;
      const requestOptions = {
        ...fetchOptions,
        signal: controller.signal,
        redirect: 'manual',
        resolvedAddresses: addresses,
      };
      const response = transport === 'pinned' && !fetchImpl
        ? await fetchPinnedResponse(url.href, requestOptions, addresses, maxBytes)
        : await (fetchImpl || globalThis.fetch)(requestValue, requestOptions);
      const capped = transport === 'pinned' && !fetchImpl
        ? response
        : await capInjectedResponse(response, maxBytes);
      if (!REDIRECT_STATUS.has(capped.status)) return capped;
      if (redirects >= maxRedirects) {
        try { await capped.body?.cancel(); } catch { /* no-op */ }
        throw new Error('Outbound upstream redirect limit exceeded');
      }
      const location = capped.headers.get('location');
      try { await capped.body?.cancel(); } catch { /* no-op */ }
      url = location ? validUrl(new URL(location, url).href) : null;
      if (!url) throw new Error('Outbound upstream redirect is invalid');
      requestValue = url;
    }
  } catch (error) {
    if (controller.signal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (clientSignal) clientSignal.removeEventListener('abort', abortFromClient);
  }
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import { openAiRealtimeProxy } from '../server/providers/local.js';

function debugLogRoute() {
  const routes = new Map();
  openAiRealtimeProxy().configureServer({
    middlewares: {
      use(path, handler) {
        routes.set(path, handler);
      },
    },
  });
  return routes.get('/api/realtime/debug-log');
}

function post(route, body) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST';
    const res = {
      statusCode: 200,
      setHeader() {},
      end(responseBody = '') {
        resolve({ statusCode: this.statusCode, body: responseBody });
      },
    };
    Promise.resolve(route(req, res)).catch(reject);
  });
}

test('Realtime debug log persists only sanitized browser record fields', async (t) => {
  const writes = [];
  t.mock.method(fs, 'mkdirSync', () => {});
  t.mock.method(fs, 'appendFileSync', (_file, line) => writes.push(line));

  const response = await post(debugLogRoute(), {
    timestamp: '2026-09-12T00:00:00.000Z',
    sessionId: 'gev-test-session',
    event: 'response.done',
    status: 'connected',
    payload: {
      detail: 'allowed record data',
      Authorization: 'Bearer fixture-bearer-token',
      apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz',
      message: 'Bearer fixture-bearer-token',
      image: 'data:image/png;base64,fixture-image-data',
    },
    Authorization: 'Bearer fixture-bearer-token',
    apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz',
    ignored: 'not a browser debug record field',
  });

  assert.equal(response.statusCode, 204);
  assert.equal(writes.length, 1);
  assert.doesNotMatch(
    writes[0],
    /fixture-bearer-token|sk-proj-abcdefghijklmnopqrstuvwxyz|fixture-image-data/,
  );
  const record = JSON.parse(writes[0]);
  assert.deepEqual(
    {
      timestamp: record.timestamp,
      sessionId: record.sessionId,
      event: record.event,
      status: record.status,
      payload: record.payload,
    },
    {
      timestamp: '2026-09-12T00:00:00.000Z',
      sessionId: 'gev-test-session',
      event: 'response.done',
      status: 'connected',
      payload: {
        detail: 'allowed record data',
        Authorization: '[Redacted]',
        apiKey: '[Redacted]',
        message: 'Bearer [Redacted]',
        image: '[Redacted image data URL, 40 chars]',
      },
    },
  );
  assert.equal('ignored' in record, false);
  assert.equal('apiKey' in record, false);
  assert.equal('Authorization' in record, false);
});

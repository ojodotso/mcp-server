import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EncryptJWT } from 'jose';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

// The hosted entry point (src/http.ts) reads the token key from MCP_TOKEN_KEY, base64url of 32
// bytes, and refuses to start without it. Run as its own process through tsx.

const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
const RESOURCE_URL = 'https://mcp.ojo.so/mcp';

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

async function freePort() {
  const probe = createHttpServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function start(env: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/http.ts'], {
    cwd: APP_DIR,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, exited };
}

/** Resolves with the exit code, or 'running' if the process is still up after `ms`. */
const outcome = (exited: Promise<number | null>, ms: number) =>
  Promise.race([exited, new Promise<'running'>((resolve) => setTimeout(() => resolve('running'), ms))]);

async function waitForHealth(origin: string, ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/healthz`);
      await response.text();
      if (response.status === 200) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe('src/http.ts takes its token key from MCP_TOKEN_KEY', () => {
  // SUPABASE_PUBLIC_URL is the old design's only required variable. It is set here so that it
  // cannot stand in for the token key.
  for (const [label, value] of [
    ['unset', undefined],
    ['empty', ''],
  ] as const) {
    it(`refuses to start, exiting non-zero, when MCP_TOKEN_KEY is ${label}`, async () => {
      const env: Record<string, string> = {
        PORT: String(await freePort()),
        SUPABASE_PUBLIC_URL: 'https://project.supabase.co',
      };
      if (value !== undefined) env.MCP_TOKEN_KEY = value;
      const { exited } = start(env);

      const result = await outcome(exited, 8000);

      expect(result).not.toBe('running');
      expect(result).not.toBe(0);
    }, 15000);
  }

  it('starts with MCP_TOKEN_KEY alone and accepts an access token encrypted under that key', async () => {
    const key = new Uint8Array(randomBytes(32));
    const port = await freePort();
    start({ PORT: String(port), MCP_TOKEN_KEY: Buffer.from(key).toString('base64url') });
    const origin = `http://127.0.0.1:${port}`;

    expect(await waitForHealth(origin, 10000)).toBe(true);

    const now = Math.floor(Date.now() / 1000);
    const token = await new EncryptJWT({
      iss: 'https://ojo.so',
      aud: RESOURCE_URL,
      sub: '0b6f3c1e-4a2d-4f8e-9c5b-7d1a2e3f4a5b',
      gid: '1a2b3c4d-0000-4000-8000-00000000000a',
      iat: now - 10,
      exp: now + 3600,
      key: 'ojo_mcp_key_of_user_a_6f1d0c',
    })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .encrypt(key);

    const response = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': LATEST_PROTOCOL_VERSION,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    await response.text();

    expect(response.status).toBe(200);
  }, 20000);
});

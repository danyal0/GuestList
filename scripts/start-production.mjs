#!/usr/bin/env node
/**
 * Single-process production entry for one Railway (or Docker) service:
 *   - Nest API on INTERNAL_API_PORT (default 4000)
 *   - Next.js on INTERNAL_WEB_PORT (default 3000)
 *   - Reverse proxy on PORT (Railway's public port) routing
 *     /api, /uploads, /socket.io → API; everything else → web
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://mkeplays-production.up.railway.app';

// Defaults for a single Railway service with file-backed mock data.
process.env.DATA_SOURCE ??= 'file';
process.env.NODE_ENV ??= 'production';
process.env.PUBLIC_URL ??= PUBLIC_URL;
process.env.WEB_URL ??= PUBLIC_URL;
process.env.API_URL ??= PUBLIC_URL;
process.env.CORS_ORIGINS ??= PUBLIC_URL;
process.env.COOKIE_SECURE ??= 'true';
process.env.NEXT_PUBLIC_SITE_URL ??= PUBLIC_URL;
process.env.JWT_ACCESS_SECRET ??= 'mkeplays-dev-access-secret-change-me-32b';
process.env.JWT_REFRESH_SECRET ??= 'mkeplays-dev-refresh-secret-change-me-32b';

const PUBLIC_PORT = Number(process.env.PORT || 8080);
const API_PORT = Number(process.env.INTERNAL_API_PORT || 4000);
const WEB_PORT = Number(process.env.INTERNAL_WEB_PORT || 3000);

/** @type {{ label: string, child: import('node:child_process').ChildProcess }[]} */
const children = [];
let shuttingDown = false;

function log(message) {
  console.log(`[gatherly] ${message}`);
}

function isApiPath(urlPath) {
  const path = urlPath.split('?')[0] ?? '';
  return path.startsWith('/api') || path.startsWith('/uploads') || path.startsWith('/socket.io');
}

function spawnProcess(label, command, args, env) {
  log(`starting ${label}`);
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  children.push({ label, child });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    log(`${label} exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`);
    shutdown(typeof code === 'number' ? code : 1);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
  setTimeout(() => process.exit(code), 1500).unref();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

function waitFor(port, path, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { hostname: '127.0.0.1', port, path, timeout: 2000 },
        (res) => {
          res.resume();
          if ((res.statusCode ?? 500) < 500) {
            resolve(undefined);
            return;
          }
          retry(new Error(`HTTP ${res.statusCode}`));
        },
      );
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry(new Error('timeout'));
      });

      function retry(err) {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for 127.0.0.1:${port}${path} (${err.message})`));
          return;
        }
        setTimeout(attempt, 400);
      }
    };
    attempt();
  });
}

function proxyHttp(req, res, port) {
  const headers = { ...req.headers };
  const xff = req.headers['x-forwarded-for'];
  headers['x-forwarded-for'] = xff
    ? `${xff}, ${req.socket.remoteAddress ?? ''}`.trim()
    : (req.socket.remoteAddress ?? '');
  if (!headers['x-forwarded-proto']) {
    headers['x-forwarded-proto'] = 'https';
  }

  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    log(`proxy error → :${port}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('Bad Gateway');
  });
  req.pipe(proxyReq);
}

function proxyUpgrade(req, socket, head, port) {
  const proxySocket = net.connect(port, '127.0.0.1', () => {
    let reqHead = `${req.method} ${req.url ?? '/'} HTTP/${req.httpVersion}\r\n`;
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) reqHead += `${key}: ${item}\r\n`;
      } else {
        reqHead += `${key}: ${value}\r\n`;
      }
    }
    reqHead += '\r\n';
    proxySocket.write(reqHead);
    if (head.length) proxySocket.write(head);
    socket.pipe(proxySocket);
    proxySocket.pipe(socket);
  });
  proxySocket.on('error', () => socket.destroy());
  socket.on('error', () => proxySocket.destroy());
}

async function main() {
  // Override Railway's PORT so the API/web bind only on loopback internals.
  spawnProcess('api', 'npm', ['run', 'start:prod', '-w', 'apps/api'], {
    PORT: String(API_PORT),
  });
  // Next `output: "standalone"` — must run traced server.js, not `next start`.
  spawnProcess('web', 'npm', ['run', 'start', '-w', 'apps/web'], {
    PORT: String(WEB_PORT),
    HOSTNAME: '0.0.0.0',
    // Keep Next rewrites pointed at the internal API, not the public URL.
    API_URL: process.env.INTERNAL_API_URL || `http://127.0.0.1:${API_PORT}`,
  });

  log(`waiting for api :${API_PORT} and web :${WEB_PORT}`);
  await Promise.all([
    waitFor(API_PORT, '/api/v1/health', 180_000),
    waitFor(WEB_PORT, '/', 180_000),
  ]);

  const server = http.createServer((req, res) => {
    const targetPort = isApiPath(req.url ?? '/') ? API_PORT : WEB_PORT;
    proxyHttp(req, res, targetPort);
  });

  server.on('upgrade', (req, socket, head) => {
    const targetPort = isApiPath(req.url ?? '/') ? API_PORT : WEB_PORT;
    proxyUpgrade(req, socket, head, targetPort);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PUBLIC_PORT, '0.0.0.0', () => {
      log(`public proxy on :${PUBLIC_PORT} → web :${WEB_PORT}, api :${API_PORT}`);
      resolve(undefined);
    });
  });
}

main().catch((err) => {
  console.error('[gatherly] failed to start', err);
  shutdown(1);
});

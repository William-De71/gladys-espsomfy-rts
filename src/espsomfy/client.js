// -----------------------------------------------------------------------------
// Talking to one ESPSomfy RTS controller on the local network.
//
//   HTTP API, port 8081   `GET /discovery` (everything: shades, groups,
//                         rooms, firmware), `PUT /shadeCommand`,
//                         `/groupCommand`, `/tiltCommand`, `/setPositions`
//   socket, port 8080     the changes, pushed: `42[shadeState,{…}]`
//
// No sign-in: the firmware (2.4.x) leaves its API port open even when a PIN
// or a password protects its web pages. A refused request answers HTTP 500
// with `{"status":"ERROR","desc":"…"}`.
//
// The socket server pings every 20 s; the client pings too, so a controller
// unplugged without closing the TCP connection is noticed within a minute.
// The ESP32 serves few socket clients at once (its web page is one): the
// integration opens one per controller.
// -----------------------------------------------------------------------------

import WebSocket from 'ws';
import { parseSocketMessage } from './model.js';

export const API_PORT = 8081;
export const SOCKET_PORT = 8080;

const REQUEST_TIMEOUT_MS = 8000;
const PING_EVERY_MS = 30 * 1000;
const PONG_TIMEOUT_MS = 15 * 1000;

/** A failure: `kind` is `network` (no answer) or `controller` (refused). */
export class EspSomfyError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'EspSomfyError';
    this.kind = kind;
  }
}

/**
 * @description The default addresses of a controller.
 * @param {string} host - IPv4 address.
 * @returns {{ api: string, socket: string }} Base URLs.
 */
export const endpointsOf = (host) => ({
  api: `http://${host}:${API_PORT}`,
  socket: `ws://${host}:${SOCKET_PORT}/`,
});

/**
 * @description The HTTP API of a controller.
 * @param {object} options - Options.
 * @param {string} options.base - `http://host:8081`.
 * @param {Function} [options.fetch] - fetch (tests: a fake one).
 * @param {number} [options.timeoutMs] - Request timeout.
 * @returns {object} `{ discovery, shadeCommand, groupCommand, tiltCommand, setPositions }`.
 */
export function createApi({ base, fetch = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const request = async (method, path, body) => {
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason =
        error?.name === 'TimeoutError' ? 'no answer' : (error?.cause?.code ?? error?.message);
      throw new EspSomfyError(`${base}${path}: ${reason}`, 'network');
    }
    const raw = await response.text().catch(() => '');
    let json;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    if (!response.ok || json?.status === 'ERROR') {
      const reason = json?.desc ?? (raw.slice(0, 200) || `HTTP ${response.status}`);
      throw new EspSomfyError(String(reason), response.status === 404 ? 'network' : 'controller');
    }
    if (json === null || typeof json !== 'object') {
      throw new EspSomfyError(`${base}${path}: not a JSON answer`, 'network');
    }
    return json;
  };

  return {
    discovery: () => request('GET', '/discovery'),
    shadeCommand: (body) => request('PUT', '/shadeCommand', body),
    groupCommand: (body) => request('PUT', '/groupCommand', body),
    tiltCommand: (body) => request('PUT', '/tiltCommand', body),
    setPositions: (body) => request('PUT', '/setPositions', body),
  };
}

/**
 * @description Open the socket of a controller.
 * @param {object} options - Options.
 * @param {string} options.url - `ws://host:8080/`.
 * @param {Function} options.onEvent - `(event, data)` for each pushed event.
 * @param {Function} options.onClose - Called once when the socket is gone.
 * @param {number} [options.timeoutMs] - Opening timeout.
 * @param {number} [options.pingMs] - Liveness ping interval.
 * @returns {Promise<{ close: Function, isOpen: Function }>} The open socket.
 */
export function openSocket({
  url,
  onEvent,
  onClose,
  timeoutMs = REQUEST_TIMEOUT_MS,
  pingMs = PING_EVERY_MS,
}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: timeoutMs });
    let opened = false;
    let closed = false;
    let pingTimer = null;
    let pongTimer = null;

    const finish = () => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(pingTimer);
      clearTimeout(pongTimer);
      if (opened) {
        onClose?.();
      }
    };

    socket.on('open', () => {
      opened = true;
      pingTimer = setInterval(() => {
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => socket.terminate(), PONG_TIMEOUT_MS);
        pongTimer.unref?.();
        try {
          socket.ping();
        } catch {
          socket.terminate();
        }
      }, pingMs);
      pingTimer.unref?.();
      resolve({
        close() {
          finish();
          socket.terminate();
        },
        isOpen: () => !closed && socket.readyState === WebSocket.OPEN,
      });
    });
    socket.on('pong', () => clearTimeout(pongTimer));
    socket.on('message', (raw, isBinary) => {
      if (isBinary) {
        return;
      }
      const message = parseSocketMessage(raw.toString('utf8'));
      if (message) {
        onEvent(message.event, message.data);
      }
    });
    socket.on('error', (error) => {
      if (!opened) {
        reject(new EspSomfyError(`${url}: ${error?.code ?? error?.message}`, 'network'));
      }
    });
    socket.on('close', () => {
      if (!opened) {
        reject(new EspSomfyError(`${url}: closed`, 'network'));
      }
      finish();
    });
  });
}

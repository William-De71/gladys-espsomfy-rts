// -----------------------------------------------------------------------------
// The controllers and their connections.
//
// Each controller seen gets an entry: its address, what `GET /discovery`
// said (shades, groups, rooms, firmware) and a socket that pushes the
// changes. A dropped socket is reopened (5 s, then up to a minute apart),
// and every (re)connection reads `/discovery` again first: the shades may
// have changed while the integration was not listening.
//
// `onUpdate(entry, what, data)` tells the app what happened:
//   connection   the controller answers, or not (`entry.reachable`)
//   discovery    the whole description was read again
//   shade        a shade changed (data: the shade, and what it was before)
//   group        a group changed (data: the group)
//   command      a shade heard a radio command (data: the firmware event)
//   firmware     the firmware version or the latest one changed
// -----------------------------------------------------------------------------

import { createApi, endpointsOf, openSocket } from './espsomfy/client.js';
import { firmwareName, readDiscovery, readGroup, readShade } from './espsomfy/model.js';

const RETRY_MS = [5000, 10000, 20000, 40000, 60000];
const STRUCTURE_EVENTS = [
  'shadeAdded',
  'shadeRemoved',
  'groupAdded',
  'groupRemoved',
  'roomAdded',
  'roomRemoved',
];
const STRUCTURE_DELAY_MS = 1000;

/**
 * @description Create the hub.
 * @param {object} deps - Dependencies.
 * @param {Function} [deps.endpoints] - host -> `{ api, socket }` (tests: local ports).
 * @param {Function} [deps.fetch] - fetch for the HTTP API.
 * @param {object} deps.logger - Logger.
 * @param {Function} deps.onUpdate - `(entry, what, data)`.
 * @param {object} [deps.timings] - `{ retryMs, timeoutMs, pingMs }` (tests: short).
 * @returns {object} The hub.
 */
export function createHub({ endpoints = endpointsOf, fetch, logger, onUpdate, timings = {} }) {
  const entries = new Map(); // server id -> entry
  let stopped = true;

  const retryDelays = timings.retryMs ? [timings.retryMs] : RETRY_MS;
  const apiOf = (host) =>
    createApi({
      base: endpoints(host).api,
      ...(fetch ? { fetch } : {}),
      ...(timings.timeoutMs ? { timeoutMs: timings.timeoutMs } : {}),
    });

  const setReachable = (entry, reachable) => {
    if (entry.reachable !== reachable) {
      entry.reachable = reachable;
      onUpdate(entry, 'connection');
    }
  };

  /** Read `/discovery` into the entry. */
  const applyDiscovery = (entry, description) => {
    const previous = entry.shades;
    entry.hostname = description.hostname || entry.hostname;
    entry.version = description.version || entry.version;
    entry.latest = description.latest || entry.latest;
    entry.chipModel = description.chipModel;
    entry.connType = description.connType;
    entry.rooms = description.rooms;
    entry.groups = description.groups;
    // Keep the live state of the shades still there (the socket is fresher).
    entry.shades = new Map(
      [...description.shades].map(([id, shade]) => [
        id,
        previous?.has(id) ? { ...previous.get(id), ...shade } : shade,
      ]),
    );
    entry.ready = true;
  };

  const refresh = async (entry) => {
    const description = readDiscovery(await apiOf(entry.host).discovery());
    if (description.serverId !== entry.serverId) {
      // Another controller answers at this address now (DHCP): the scan finds ours again.
      throw new Error(`${entry.host} is now controller ${description.serverId}`);
    }
    applyDiscovery(entry, description);
    onUpdate(entry, 'discovery');
  };

  const scheduleStructure = (entry) => {
    clearTimeout(entry.structureTimer);
    entry.structureTimer = setTimeout(() => {
      entry.structureTimer = null;
      refresh(entry).catch((error) =>
        logger.info(`ESPSomfy RTS: reading ${entry.host} again failed: ${error.message}`),
      );
    }, STRUCTURE_DELAY_MS);
    entry.structureTimer.unref?.();
  };

  const onEvent = (entry, event, data) => {
    if (event === 'shadeState') {
      const id = Number(data.shadeId);
      const before = entry.shades.get(id);
      if (!before) {
        scheduleStructure(entry);
        return;
      }
      const shade = readShade(data, before);
      entry.shades.set(id, shade);
      onUpdate(entry, 'shade', { shade, before });
    } else if (event === 'groupState') {
      const id = Number(data.groupId);
      const before = entry.groups.get(id);
      if (!before) {
        scheduleStructure(entry);
        return;
      }
      const group = readGroup(data, before);
      entry.groups.set(id, group);
      onUpdate(entry, 'group', { group, before });
    } else if (event === 'shadeCommand') {
      onUpdate(entry, 'command', data);
    } else if (event === 'wifiStrength') {
      entry.network = {
        type: 'wifi',
        ssid: String(data.ssid ?? ''),
        strength: Number(data.strength),
      };
    } else if (event === 'ethernet') {
      if (data.connected) {
        entry.network = { type: 'ethernet', speed: Number(data.speed) };
      }
    } else if (event === 'fwStatus') {
      const version = firmwareName(data.fwVersion ?? data.version) || entry.version;
      const latest = firmwareName(data.latest) || entry.latest;
      if (version !== entry.version || latest !== entry.latest) {
        entry.version = version;
        entry.latest = latest;
        onUpdate(entry, 'firmware');
      }
    } else if (STRUCTURE_EVENTS.includes(event)) {
      scheduleStructure(entry);
    }
  };

  const scheduleRetry = (entry) => {
    if (stopped || entry.retryTimer || !entry.wanted) {
      return;
    }
    const delay = retryDelays[Math.min(entry.failures, retryDelays.length - 1)];
    entry.failures += 1;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      hub.connect(entry).catch(() => {});
    }, delay);
    entry.retryTimer.unref?.();
  };

  const connectOnce = async (entry) => {
    await refresh(entry);
    if (entry.socket?.isOpen()) {
      return;
    }
    const host = entry.host;
    entry.socket = await openSocket({
      url: endpoints(host).socket,
      onEvent: (event, data) => onEvent(entry, event, data),
      onClose: () => {
        entry.socket = null;
        if (stopped || !entry.wanted) {
          return;
        }
        logger.info(`ESPSomfy RTS: lost the connection to ${entry.hostname || host}`);
        setReachable(entry, false);
        scheduleRetry(entry);
      },
      ...(timings.timeoutMs ? { timeoutMs: timings.timeoutMs } : {}),
      ...(timings.pingMs ? { pingMs: timings.pingMs } : {}),
    });
    if (stopped || !entry.wanted || entry.host !== host) {
      entry.socket.close();
      entry.socket = null;
    }
  };

  const hub = {
    entries,

    /**
     * @description The entry of a controller, created when new; a new address
     * moves it (the socket is reopened there).
     * @param {string} serverId - Server id.
     * @param {string} host - IPv4 address.
     * @returns {object} The entry.
     */
    entryOf(serverId, host) {
      let entry = entries.get(serverId);
      if (!entry) {
        entry = {
          serverId,
          host,
          hostname: '',
          version: '',
          latest: '',
          rooms: new Map(),
          shades: new Map(),
          groups: new Map(),
          reachable: null,
          ready: false,
          wanted: false,
          failures: 0,
          socket: null,
          network: null,
        };
        entries.set(serverId, entry);
      } else if (host && entry.host !== host) {
        logger.info(`ESPSomfy RTS: ${entry.hostname || serverId} moved to ${host}`);
        entry.host = host;
        entry.socket?.close();
        entry.socket = null;
      }
      return entry;
    },

    /**
     * @description Read a controller at an address, without keeping anything.
     * @param {string} host - IPv4 address.
     * @returns {Promise<object>} Its description (`readDiscovery`).
     */
    probe: async (host) => readDiscovery(await apiOf(host).discovery()),

    /**
     * @description Connect a controller and keep it connected.
     * @param {object} entry - Entry.
     * @returns {Promise<void>} Resolves once connected, rejects when it does not answer.
     */
    async connect(entry) {
      entry.wanted = true;
      if (entry.connecting) {
        return entry.connecting;
      }
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
      entry.connecting = connectOnce(entry)
        .then(() => {
          entry.failures = 0;
          setReachable(entry, true);
        })
        .catch((error) => {
          logger.info(
            `ESPSomfy RTS: ${entry.hostname || entry.serverId} (${entry.host}) does not answer: ${error.message}`,
          );
          setReachable(entry, false);
          scheduleRetry(entry);
          throw error;
        })
        .finally(() => {
          entry.connecting = null;
        });
      return entry.connecting;
    },

    /** The HTTP API of a controller, for the commands. */
    api: (entry) => apiOf(entry.host),

    /** Read `/discovery` again (after a command that changes the structure). */
    refresh,

    start() {
      stopped = false;
    },

    stop() {
      stopped = true;
      for (const entry of entries.values()) {
        clearTimeout(entry.retryTimer);
        clearTimeout(entry.structureTimer);
        entry.retryTimer = null;
        entry.socket?.close();
        entry.socket = null;
      }
    },
  };
  return hub;
}

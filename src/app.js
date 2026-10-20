// -----------------------------------------------------------------------------
// The integration: every Gladys handler, registered before connect().
//
//   discovery   mediated SSDP scan (M-SEARCH for the ESPSomfy RTS device
//               type) through Gladys + the addresses of the configuration,
//               then `GET /discovery` on each controller: its shades and groups
//   states      every controller found stays connected to its socket, which
//               pushes the changes (src/hub.js); only the changes of the
//               devices the user created are published
//   commands    Gladys features, scene actions, widget buttons -> HTTP
//               requests to the controller, which sends the radio frames
//   scenes      radio frames of the Somfy remotes, sun and wind, controllers
//               lost and found -> scene events
//
// A controller is identified by its server id (end of its MAC address): when
// its address changes (DHCP), the next scan finds it again. The controllers
// seen are kept in /data so a restart connects them at once.
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  buildGroupDevice,
  buildShadeDevice,
  DEVICE_TYPES,
  FEATURE_KEYS,
  groupCommandFor,
  groupValues,
  shadeCommandFor,
  shadeValues,
} from './devices.js';
import { EspSomfyError } from './espsomfy/client.js';
import { isIpv4, ssdpScan } from './espsomfy/discovery.js';
import {
  coverState,
  directionCommand,
  flag,
  FLAGS,
  hasSunFlag,
  hasTilt,
  isAwning,
  isNewer,
  isTiltOnly,
  movement,
  normalizeServerId,
  shadeKind,
  shadeOpenness,
  SHADE_TYPES,
  targetFor,
  tiltOpenness,
  contactOn,
} from './espsomfy/model.js';
import { createHub } from './hub.js';
import { t, text, truncate, truncateAll } from './i18n.js';
import { REMOTE_BUTTONS, SCENE_ACTIONS, SCENE_TRIGGERS, SEND_COMMANDS } from './scenes.js';
import { createStatePublisher } from './states.js';
import { createStorage } from './storage.js';
import { buildOverviewWidget, buildShadeWidget, WIDGET_ACTIONS, WIDGETS } from './widgets.js';

export const ACTIONS = { TEST: 'test_connection' };

const MINUTE = 60 * 1000;
const RESCAN_SPACING_MS = MINUTE;
const OFFLINE_AFTER_MS = MINUTE;
const SAME_PRESS_MS = 1500;
const WIDGET_REFRESH_SPACING_MS = 11 * 1000;
const MAX_MESSAGE = 1800;
const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * @description Wire the integration.
 * @param {object} gladys - SDK client (or the fake one of the tests).
 * @param {object} [deps] - Dependencies.
 * @param {Function} [deps.endpoints] - host -> `{ api, socket }` (tests: local ports).
 * @param {object} [deps.storage] - src/storage.js storage.
 * @param {object} [deps.logger] - Logger.
 * @param {Function} [deps.now] - Clock (ms).
 * @param {object} [deps.timings] - `{ offlineAfterMs, retryMs, timeoutMs, pingMs }` (tests: short).
 * @returns {object} `{ start, stop, scan, … }`.
 */
export function createApp(
  gladys,
  { endpoints, storage = createStorage(), logger = sdkLogger, now = Date.now, timings = {} } = {},
) {
  const offlineAfterMs = timings.offlineAfterMs ?? OFFLINE_AFTER_MS;
  let config = normalizeConfig(gladys.config ?? {});
  let stopped = false;
  let scanning = null;
  let lastScanAt = 0;
  let scanError = null;
  let statusKey = '';
  let rescanTimer = null;
  const created = new Set(); // device external ids
  const gladysNames = new Map(); // device external id -> name in Gladys
  const widgetRefresh = new Map();
  const transports = new Map();
  const lastPress = new Map();

  const states = createStatePublisher(gladys, {
    logger,
    now,
    isCreated: (externalId) => created.has(externalId),
  });

  const safely = (task, what) =>
    Promise.resolve()
      .then(task)
      .catch((error) => logger.warn(`ESPSomfy RTS: ${what} failed: ${error?.message ?? error}`));

  const hub = createHub({
    ...(endpoints ? { endpoints } : {}),
    logger,
    onUpdate: (entry, what, data) => onControllerUpdate(entry, what, data),
    timings,
  });

  // --- Ids --------------------------------------------------------------------------------

  const idsOf = (entry, type, item) => gladys.externalIds(type, `${entry.serverId}-${item.id}`);
  const shadeId = (entry, shade) => idsOf(entry, DEVICE_TYPES.SHADE, shade).device;
  const groupId = (entry, group) => idsOf(entry, DEVICE_TYPES.GROUP, group).device;

  /**
   * @description Find what a device external id points to.
   * @param {string} externalId - Device (or feature) external id.
   * @returns {{ type: string, serverId: string, id: number }|null} The target.
   */
  const parseId = (externalId) => {
    const match = /:(shade|group):([0-9a-f]{4,12})-(\d{1,3})(?::|$)/.exec(String(externalId ?? ''));
    return match ? { type: match[1], serverId: match[2], id: Number(match[3]) } : null;
  };

  const ready = () => [...hub.entries.values()].filter((entry) => entry.ready);

  const nameOfController = (entry) => entry.hostname || `ESPSomfy RTS ${entry.serverId}`;
  const nameOf = (deviceId, item) => gladysNames.get(deviceId) || item.name;

  // --- Widgets, transports, status ---------------------------------------------------

  const refreshWidget = (key) => {
    const slot = widgetRefresh.get(key) ?? { at: 0, timer: null };
    widgetRefresh.set(key, slot);
    const wait = slot.at + WIDGET_REFRESH_SPACING_MS - now();
    if (wait <= 0) {
      slot.at = now();
      safely(() => gladys.requestWidgetRefresh(key), 'widget refresh');
    } else if (!slot.timer) {
      slot.timer = setTimeout(() => {
        slot.timer = null;
        refreshWidget(key);
      }, wait);
      slot.timer.unref?.();
    }
  };
  const refreshWidgets = () => Object.values(WIDGETS).forEach(refreshWidget);

  const createdOf = (entry) =>
    [
      ...[...entry.shades.values()].map((shade) => shadeId(entry, shade)),
      ...[...entry.groups.values()].map((group) => groupId(entry, group)),
    ].filter((deviceId) => created.has(deviceId));

  // One channel: the badge of the catalog says it all, the per-device
  // transport only tells "local" from "unreachable".
  const publishTransports = (entry, force = false) => {
    if (entry.reachable === null) {
      return;
    }
    const transport = entry.reachable ? 'local' : 'unreachable';
    const list = createdOf(entry)
      .filter((deviceId) => force || transports.get(deviceId) !== transport)
      .map((deviceId) => {
        transports.set(deviceId, transport);
        return { external_id: deviceId, transport };
      });
    if (list.length > 0) {
      safely(() => gladys.publishTransports(list), 'transport badges');
    }
  };

  function publishStatus() {
    const known = ready();
    const answering = known.filter((entry) => entry.reachable);
    let key;
    let connected = true;
    let message;
    if (scanError === 'forbidden' && known.length === 0) {
      [key, connected, message] = ['forbidden', false, t('statusScanForbidden')];
    } else if (known.length === 0) {
      [key, message] = ['none', t('statusNoController')];
    } else if (answering.length === 0) {
      [key, connected, message] = [`off:${known.length}`, false, t('statusAllOff')];
    } else {
      const shades = answering.reduce((sum, entry) => sum + entry.shades.size, 0);
      key = `ok:${answering.length}:${known.length}:${shades}`;
      message = t('statusConnected', {
        count: answering.length,
        total: known.length,
        shades,
      });
    }
    if (key !== statusKey) {
      statusKey = key;
      safely(() => gladys.setConnectionStatus(connected, message), 'status');
    }
  }

  // --- States and scene events -------------------------------------------------------

  const pushShade = (entry, shade) => {
    const ids = idsOf(entry, DEVICE_TYPES.SHADE, shade);
    for (const [key, value] of shadeValues(shade)) {
      states.push(ids.feature(key), value);
    }
  };

  const pushGroup = (entry, group) => {
    const ids = idsOf(entry, DEVICE_TYPES.GROUP, group);
    for (const [key, value] of groupValues(group)) {
      states.push(ids.feature(key), value);
    }
  };

  const pushAll = (entry) => {
    entry.shades.forEach((shade) => pushShade(entry, shade));
    entry.groups.forEach((group) => pushGroup(entry, group));
  };

  const fire = (key, data) =>
    safely(() => gladys.publishSceneEvent(key, data), `scene event ${key}`);

  const onRemoteCommand = (entry, data) => {
    // `internal`: frames the controller sent itself (a group, a scene action).
    if (data.source !== 'remote') {
      return;
    }
    const button = REMOTE_BUTTONS[String(data.cmd ?? '')];
    const shade = entry.shades.get(Number(data.shadeId));
    if (!button || !shade) {
      return;
    }
    const deviceId = shadeId(entry, shade);
    if (!created.has(deviceId)) {
      return;
    }
    // A press sends several frames: one event per press.
    const pressKey = `${deviceId}:${button}`;
    if (now() - (lastPress.get(pressKey) ?? -Infinity) < SAME_PRESS_MS) {
      return;
    }
    lastPress.set(pressKey, now());
    fire(SCENE_TRIGGERS.REMOTE_PRESSED, {
      device: deviceId,
      device_name: truncate(nameOf(deviceId, shade), 200),
      button,
      remote_address: Number(data.sourceAddress ?? data.remoteAddress ?? 0),
    });
  };

  const detectSunWind = (entry, shade, before) => {
    if (!before || !hasSunFlag(shade)) {
      return;
    }
    const deviceId = shadeId(entry, shade);
    if (!created.has(deviceId)) {
      return;
    }
    for (const [sensor, bit] of [
      ['sun', FLAGS.SUNNY],
      ['wind', FLAGS.WINDY],
    ]) {
      const was = flag(before, bit);
      const is = flag(shade, bit);
      if (was !== is) {
        fire(SCENE_TRIGGERS.SUN_WIND_CHANGED, {
          device: deviceId,
          device_name: truncate(nameOf(deviceId, shade), 200),
          sensor,
          state: is ? 'on' : 'off',
        });
      }
    }
  };

  const watchReachability = (entry) => {
    clearTimeout(entry.offlineTimer);
    entry.offlineTimer = null;
    const data = () => ({
      controller_name: truncate(nameOfController(entry), 200),
      address: entry.host,
    });
    if (entry.reachable) {
      if (entry.offlineFired) {
        entry.offlineFired = false;
        fire(SCENE_TRIGGERS.CONTROLLER_ONLINE, data());
      }
      return;
    }
    if (entry.reachable === false && !entry.offlineFired && entry.ready) {
      entry.offlineTimer = setTimeout(() => {
        entry.offlineTimer = null;
        if (!stopped && entry.reachable === false && !entry.offlineFired) {
          entry.offlineFired = true;
          fire(SCENE_TRIGGERS.CONTROLLER_OFFLINE, data());
        }
      }, offlineAfterMs);
      entry.offlineTimer.unref?.();
    }
  };

  function onControllerUpdate(entry, what, data) {
    switch (what) {
      case 'connection':
        publishTransports(entry);
        publishStatus();
        watchReachability(entry);
        break;
      case 'discovery':
        pushAll(entry);
        persist();
        publishDiscovered();
        publishStatus();
        break;
      case 'shade':
        detectSunWind(entry, data.shade, data.before);
        pushShade(entry, data.shade);
        break;
      case 'group':
        pushGroup(entry, data.group);
        break;
      case 'command':
        onRemoteCommand(entry, data);
        return;
      default:
        break;
    }
    refreshWidgets();
  }

  // --- Discovery -------------------------------------------------------------------------

  const persist = () =>
    safely(
      () =>
        storage.write(
          'controllers.json',
          Object.fromEntries(
            ready().map((entry) => [entry.serverId, { host: entry.host, name: entry.hostname }]),
          ),
        ),
      'saving the controllers',
    );

  function publishDiscovered() {
    return safely(
      () =>
        gladys.publishDiscoveredDevices(
          ready().flatMap((entry) => [
            ...[...entry.shades.values()].map((shade) =>
              buildShadeDevice(gladys, entry, shade, config.language),
            ),
            ...[...entry.groups.values()].map((group) =>
              buildGroupDevice(gladys, entry, group, config.language),
            ),
          ]),
        ),
      'discovery',
    );
  }

  const scanOnce = async () => {
    lastScanAt = now();
    const found = await ssdpScan(gladys, { logger });
    scanError = found.error;
    const targets = new Set();
    const hosts = [...new Set([...found.hosts, ...config.hosts])];
    await Promise.all(
      hosts.map(async (host) => {
        const known = [...hub.entries.values()].find((entry) => entry.host === host);
        if (known) {
          targets.add(known);
          return;
        }
        try {
          const description = await hub.probe(host);
          const entry = hub.entryOf(description.serverId, host);
          entry.hostname ||= description.hostname;
          targets.add(entry);
        } catch (error) {
          logger.info(`ESPSomfy RTS: no controller answered at ${host} (${error.message})`);
        }
      }),
    );
    // The controllers known from /data or from created devices, not found this time.
    for (const entry of hub.entries.values()) {
      if (entry.wanted && !targets.has(entry)) {
        targets.add(entry);
      }
    }
    await Promise.allSettled([...targets].map((entry) => hub.connect(entry)));
    persist();
    await publishDiscovered();
    publishStatus();
    return [...targets];
  };

  /** Run a scan, or join the one running. */
  const scan = () => {
    if (!scanning) {
      scanning = scanOnce().finally(() => {
        scanning = null;
      });
    }
    return scanning;
  };

  const scheduleRescan = () => {
    clearInterval(rescanTimer);
    rescanTimer = null;
    if (!stopped && config.rescanMs > 0) {
      rescanTimer = setInterval(() => safely(() => scan(), 'scan'), config.rescanMs);
      rescanTimer.unref?.();
    }
  };

  // --- Commands ----------------------------------------------------------------------------

  const userError = (key, vars = {}) => new Error(text(key, config.language, vars));

  /**
   * @description The shade or group of a device.
   * @param {string} externalId - Device (or feature) external id.
   * @returns {{ entry: object, type: string, item: object, deviceId: string }} The target.
   */
  const targetOf = (externalId) => {
    const parsed = parseId(externalId);
    const entry = parsed && hub.entries.get(parsed.serverId);
    const item =
      entry && (parsed.type === DEVICE_TYPES.SHADE ? entry.shades : entry.groups).get(parsed.id);
    if (!item) {
      throw userError('errorUnknownDevice');
    }
    const deviceId =
      parsed.type === DEVICE_TYPES.SHADE ? shadeId(entry, item) : groupId(entry, item);
    return { entry, type: parsed.type, item, deviceId };
  };

  const membersOf = (entry, group) =>
    group.shadeIds.map((id) => entry.shades.get(id)).filter(Boolean);

  /** Send a request built by src/devices.js, mapping errors to user texts. */
  const send = async (target, request) => {
    if (!request) {
      return null;
    }
    const { entry, item, deviceId } = target;
    try {
      return await hub.api(entry)[request.path](request.body);
    } catch (error) {
      const name = nameOf(deviceId, item);
      if (error instanceof EspSomfyError && error.kind === 'controller') {
        throw userError('errorRefused', { name, error: truncate(error.message, 200) });
      }
      throw userError('errorUnreachable', {
        name,
        controller: nameOfController(entry),
        error: truncate(error?.message ?? error, 200),
      });
    }
  };

  const requestFor = (target, key, value) => {
    try {
      return target.type === DEVICE_TYPES.SHADE
        ? shadeCommandFor(target.item, key, value)
        : groupCommandFor(target.item, key, value, membersOf(target.entry, target.item));
    } catch (error) {
      if (error instanceof RangeError) {
        throw userError('errorValue', { value: truncate(error.message, 60) });
      }
      throw error;
    }
  };

  gladys.onSetValue(async (device, feature, value) => {
    const target = targetOf(device.external_id);
    const key = String(feature.external_id).split(':').pop();
    await send(target, requestFor(target, key, value));
    if (target.type === DEVICE_TYPES.GROUP && key === FEATURE_KEYS.STATE) {
      // No feedback: the next press must reach Gladys even if equal.
      states.forget(feature.external_id);
    }
  });

  // --- Device events ---------------------------------------------------------------------------

  const trackCreated = (device) => {
    if (!device?.external_id) {
      return null;
    }
    const parsed = parseId(device.external_id);
    if (!parsed) {
      return null;
    }
    created.add(device.external_id);
    gladysNames.set(device.external_id, device.name ?? '');
    const param = (name) => device.params?.find?.((item) => item.name === name)?.value;
    const known = hub.entries.get(parsed.serverId);
    const host = known?.host ?? param('ESPSOMFY_HOST');
    if (!host || !isIpv4(host)) {
      return null;
    }
    const entry = hub.entryOf(parsed.serverId, host);
    entry.wanted = true;
    return entry;
  };

  gladys.onDeviceCreated(async (device) => {
    const entry = trackCreated(device);
    if (entry) {
      // States published before the creation were thrown away by Gladys.
      states.republish(device.external_id);
      pushAll(entry);
      publishTransports(entry, true);
      if (!entry.socket && !entry.connecting && !stopped) {
        safely(() => hub.connect(entry), 'connecting');
      }
    }
    publishStatus();
    refreshWidgets();
  });

  gladys.onDeviceUpdated(async (device) => {
    const entry = trackCreated(device);
    if (entry) {
      states.republish(device.external_id);
      pushAll(entry);
    }
    refreshWidgets();
  });

  gladys.onDeviceDeleted(async (device) => {
    if (device?.external_id) {
      created.delete(device.external_id);
      transports.delete(device.external_id);
      gladysNames.delete(device.external_id);
      states.forget(device.external_id);
    }
    publishStatus();
    refreshWidgets();
  });

  gladys.onScanRequest(async () => {
    await scan();
  });

  gladys.onConfigUpdated(async (raw) => {
    const previous = config;
    config = normalizeConfig(raw ?? {});
    if (previous.language !== config.language) {
      await publishDiscovered();
    }
    if (previous.rescanMs !== config.rescanMs) {
      scheduleRescan();
    }
    if (previous.hosts.join(',') !== config.hosts.join(',')) {
      await scan();
    }
  });

  // --- Configuration button ------------------------------------------------------------------------

  gladys.onAction(ACTIONS.TEST, async () => {
    if (scanning || now() - lastScanAt > RESCAN_SPACING_MS || ready().length === 0) {
      await scan();
    }
    const known = ready();
    if (known.length === 0) {
      return scanError === 'forbidden' ? t('statusScanForbidden') : t('testNone');
    }
    const message = {};
    for (const language of LANGUAGES) {
      const list = known
        .map((entry) => {
          const details = [entry.host];
          if (entry.version) {
            details.push(`${text('testFirmware', language)} ${entry.version}`);
          }
          details.push(
            entry.reachable
              ? text('testCounts', language, {
                  shades: entry.shades.size,
                  groups: entry.groups.size,
                })
              : text('testUnreachable', language),
          );
          return `${nameOfController(entry)} (${details.join(', ')})`;
        })
        .join(' ; ');
      message[language] = text('testOk', language, { count: known.length, list });
    }
    return truncateAll(message, MAX_MESSAGE);
  });

  // --- Scene actions -----------------------------------------------------------------------------------

  /** A command of `send_command` or of the "My" widget button, to a shade or a group. */
  const commandRequest = (target, name) => {
    const { item, type, entry } = target;
    const shades = type === DEVICE_TYPES.SHADE ? [item] : membersOf(entry, item);
    const awnings = shades.length > 0 && shades.every(isAwning);
    const reference = { type: awnings ? SHADE_TYPES.AWNING : SHADE_TYPES.ROLLER };
    let command;
    switch (name) {
      case 'open':
      case 'close':
        command = directionCommand(reference, name);
        break;
      case 'step_open':
      case 'step_close': {
        const up = directionCommand(reference, name === 'step_open' ? 'open' : 'close');
        command = up === 'up' ? 'stepup' : 'stepdown';
        break;
      }
      case 'sun_flag_on':
      case 'sun_flag_off':
        if (type === DEVICE_TYPES.SHADE ? !hasSunFlag(item) : !item.sunSensor) {
          throw userError('errorNoSunSensor', { name: nameOf(target.deviceId, item) });
        }
        command = SEND_COMMANDS[name];
        break;
      case 'my':
        command = 'my';
        break;
      default:
        throw userError('errorValue', { value: truncate(name, 60) });
    }
    if (type === DEVICE_TYPES.SHADE && ['contact'].includes(shadeKind(item))) {
      throw userError('errorNotACover', { name: nameOf(target.deviceId, item) });
    }
    return type === DEVICE_TYPES.SHADE
      ? { path: 'shadeCommand', body: { shadeId: item.id, command } }
      : { path: 'groupCommand', body: { groupId: item.id, command } };
  };

  gladys.onSceneAction(SCENE_ACTIONS.SEND_COMMAND, async (fields = {}) => {
    const target = targetOf(fields.device);
    await send(target, commandRequest(target, String(fields.command ?? '')));
    return undefined;
  });

  gladys.onSceneAction(SCENE_ACTIONS.SET_CURRENT_POSITION, async (fields = {}) => {
    const target = targetOf(fields.device);
    const { item, type, deviceId } = target;
    const kind = type === DEVICE_TYPES.SHADE ? shadeKind(item) : 'group';
    if (!['shutter', 'curtain'].includes(kind)) {
      throw userError('errorNoPosition', { name: nameOf(deviceId, item) });
    }
    const open = Number(fields.position);
    if (!Number.isFinite(open) || open < 0 || open > 100) {
      throw userError('errorValue', { value: truncate(fields.position, 60) });
    }
    // A tilt-only blind has its slats as its Gladys position.
    const body = isTiltOnly(item)
      ? { shadeId: item.id, tiltPosition: tiltOpenness(open, item) }
      : { shadeId: item.id, position: targetFor(open, item) };
    if (hasTilt(item) && Number.isFinite(Number(fields.tilt)) && fields.tilt !== '') {
      body.tiltPosition = tiltOpenness(Math.min(100, Math.max(0, Number(fields.tilt))), item);
    }
    await send(target, { path: 'setPositions', body });
    return undefined;
  });

  // --- Widgets -------------------------------------------------------------------------------------

  /** Snapshot of a shade or a group for the widgets. */
  const viewOf = ({ entry, type, item, deviceId }) => {
    const ids = idsOf(entry, type, item);
    const reachable = Boolean(entry.reachable);
    if (type === DEVICE_TYPES.GROUP) {
      return {
        kind: 'group',
        deviceId,
        name: nameOf(deviceId, item),
        reachable,
        cover: 'shutter',
        state: 0,
        moving: 0,
        position: null,
        myPosition: null,
        tilt: null,
        contact: null,
        sunFlag: item.sunSensor ? flag(item, FLAGS.SUN_FLAG) : null,
        sunny: null,
        windy: null,
        members: item.shadeIds.length,
        features: {
          state: ids.feature(FEATURE_KEYS.STATE),
          sunFlag: item.sunSensor ? ids.feature(FEATURE_KEYS.SUN_FLAG) : null,
        },
      };
    }
    const kind = shadeKind(item);
    const cover = kind !== 'contact' && kind !== 'toggle';
    const moving = movement(item);
    const sun = kind !== 'contact' && hasSunFlag(item);
    return {
      kind: 'shade',
      deviceId,
      name: nameOf(deviceId, item),
      reachable,
      cover: kind,
      state: coverState(item),
      // The firmware "up" (-1) opens, except an awning.
      moving: moving === 0 ? 0 : (isAwning(item) ? moving > 0 : moving < 0) ? 1 : -1,
      position: cover ? shadeOpenness(item) : null,
      myPosition: cover && item.myPos >= 0 ? targetFor(item.myPos, item) : null,
      tilt: cover && hasTilt(item) ? tiltOpenness(item.tiltPosition, item) : null,
      contact: kind === 'contact' ? contactOn(item) : null,
      sunFlag: sun ? flag(item, FLAGS.SUN_FLAG) : null,
      sunny: sun ? flag(item, FLAGS.SUNNY) : null,
      windy: sun ? flag(item, FLAGS.WINDY) : null,
      members: 0,
      features: {
        state: ids.feature(FEATURE_KEYS.STATE),
        position: cover ? ids.feature(FEATURE_KEYS.POSITION) : null,
        contact: kind === 'contact' ? ids.feature(FEATURE_KEYS.CONTACT) : null,
        sunFlag: sun ? ids.feature(FEATURE_KEYS.SUN_FLAG) : null,
      },
    };
  };

  gladys.onWidgetGet(WIDGETS.SHADE, async ({ settings } = {}) => {
    let view = null;
    if (settings?.device && created.has(settings.device)) {
      try {
        view = viewOf(targetOf(settings.device));
      } catch {
        view = null;
      }
    }
    return buildShadeWidget(view);
  });

  gladys.onWidgetGet(WIDGETS.OVERVIEW, async () => {
    const shades = [];
    for (const entry of ready()) {
      const items = [...entry.shades.values()].sort(
        (a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id),
      );
      for (const shade of items) {
        const deviceId = shadeId(entry, shade);
        if (created.has(deviceId)) {
          shades.push(viewOf({ entry, type: DEVICE_TYPES.SHADE, item: shade, deviceId }));
        }
      }
    }
    const controllers = ready().map((entry) => ({
      name: nameOfController(entry),
      reachable: Boolean(entry.reachable),
      version: entry.version,
      update: entry.latest && isNewer(entry.latest, entry.version) ? entry.latest : null,
      network: entry.network,
    }));
    return buildOverviewWidget({ shades, controllers });
  });

  gladys.onWidgetAction(WIDGETS.SHADE, async (actionKey, params = {}, { settings } = {}) => {
    if (actionKey !== WIDGET_ACTIONS.MY) {
      return undefined;
    }
    try {
      const target = targetOf(settings?.device ?? params.device);
      await send(target, commandRequest(target, 'my'));
      refreshWidgets();
      return truncateAll(t('widgetDone', { name: nameOf(target.deviceId, target.item) }), 200);
    } catch (error) {
      return truncateAll(
        { en: error.message, fr: error.message, de: error.message, es: error.message },
        200,
      );
    }
  });

  // --- Lifecycle -------------------------------------------------------------------------------------

  return {
    /** Restore the known controllers, connect them, then scan. */
    async start() {
      stopped = false;
      config = normalizeConfig(gladys.config ?? {});
      created.clear();
      hub.start();
      const saved = (await storage.read('controllers.json')) ?? {};
      for (const [serverId, info] of Object.entries(saved)) {
        if (normalizeServerId(serverId) === serverId && isIpv4(info?.host)) {
          const entry = hub.entryOf(serverId, info.host);
          entry.hostname ||= String(info.name ?? '');
          entry.wanted = true;
        }
      }
      (gladys.devices ?? []).forEach((device) => trackCreated(device));
      publishStatus();
      scheduleRescan();
      await scan();
    },

    async stop() {
      stopped = true;
      clearInterval(rescanTimer);
      widgetRefresh.forEach((slot) => clearTimeout(slot.timer));
      for (const entry of hub.entries.values()) {
        clearTimeout(entry.offlineTimer);
      }
      hub.stop();
      states.stop();
      await Promise.allSettled([scanning]);
    },

    scan,
    flushStates: () => states.flush(),
    hub,
  };
}

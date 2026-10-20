// A fake ESPSomfy RTS controller on real local sockets: the HTTP API (as on
// port 8081) and the socket (as on port 8080) of firmware 2.4.7, reached by
// the integration through its real code (src/espsomfy/client.js). It keeps
// the firmware conventions: positions count how far a shade went down, the
// "flip position" option reports 100 - that, "My" sends a still shade to its
// favourite position and stops a moving one, a remote press is pushed as a
// `shadeCommand` with `source: "remote"`, the controller's own frames as
// `internal`. Shades move in `moveMs` (instant by default).

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const DRY_CONTACT = 9;
const DRY_CONTACT_2 = 10;
const TOGGLES = [5, 14, 15, 16];

export class FakeController {
  /**
   * @param {object} options - `{ serverId, host, hostname, shades, groups, rooms, version, latest }`.
   */
  constructor({
    serverId = 'A1B2C3',
    host = '192.168.1.40',
    hostname = 'espsomfyrts',
    shades = [],
    groups = [],
    rooms = [],
    version = 'v2.4.7',
    latest = 'v2.4.7',
    moveMs = 0,
  } = {}) {
    Object.assign(this, { serverId, host, hostname, version, latest, moveMs, rooms });
    this.shades = shades.map((shade) => ({
      roomId: 0,
      shadeType: 0,
      tiltType: 0,
      flipPosition: false,
      raw: 0,
      tiltRaw: 0,
      myRaw: -1,
      flags: 0,
      sunSensor: false,
      remoteAddress: 1000 + shade.shadeId,
      ...shade,
      direction: 0,
      tiltDirection: 0,
    }));
    this.groups = groups.map((group) => ({ roomId: 0, flags: 0, sunSensor: false, ...group }));
    this.requests = [];
    this.sockets = new Set();
    this.refuse = null; // a path the controller answers 500 to
    this.timers = new Set();
  }

  // --- Firmware model -------------------------------------------------------------

  shade(id) {
    return this.shades.find((shade) => shade.shadeId === Number(id));
  }

  report(shade, raw) {
    return raw < 0 ? -1 : shade.flipPosition ? 100 - raw : raw;
  }

  stateOf(shade) {
    const state = {
      shadeId: shade.shadeId,
      type: shade.shadeType,
      remoteAddress: shade.remoteAddress,
      name: shade.name,
      direction: shade.direction,
      position: this.report(shade, shade.raw),
      target: this.report(shade, shade.targetRaw ?? shade.raw),
      myPos: this.report(shade, shade.myRaw),
      tiltType: shade.tiltType,
      flipCommands: false,
      flipPosition: shade.flipPosition,
      flags: shade.flags | (shade.sunSensor ? 0x02 : 0),
      sunSensor: shade.sunSensor,
      light: false,
      sortOrder: shade.sortOrder ?? shade.shadeId,
    };
    if (shade.tiltType !== 0) {
      Object.assign(state, {
        tiltDirection: shade.tiltDirection,
        tiltTarget: this.report(shade, shade.tiltRaw),
        tiltPosition: this.report(shade, shade.tiltRaw),
        myTiltPos: -1,
      });
    }
    return state;
  }

  discoveryShade(shade) {
    const { raw: _raw, tiltRaw: _tilt, myRaw: _my, targetRaw: _target, ...rest } = shade;
    return {
      ...rest,
      paired: true,
      position: this.report(shade, shade.raw),
      target: this.report(shade, shade.targetRaw ?? shade.raw),
      myPos: this.report(shade, shade.myRaw),
      tiltPosition: this.report(shade, shade.tiltRaw),
      flags: shade.flags | (shade.sunSensor ? 0x02 : 0),
      sortOrder: shade.sortOrder ?? shade.shadeId,
    };
  }

  groupState(group) {
    return {
      groupId: group.groupId,
      remoteAddress: 2000 + group.groupId,
      name: group.name,
      sunSensor: group.sunSensor,
      shades: group.linkedShades,
      flags: group.flags,
    };
  }

  discovery() {
    return {
      serverId: this.serverId,
      version: this.version,
      latest: this.latest,
      model: 'ESPSomfyRTS',
      hostname: this.hostname,
      authType: 0,
      permissions: 0,
      chipModel: 's3',
      connType: 'Wifi',
      checkForUpdate: true,
      memory: { max: 1, free: 1, min: 1, total: 1 },
      rooms: this.rooms,
      shades: this.shades.map((shade) => this.discoveryShade(shade)),
      groups: this.groups.map((group) => ({
        groupId: group.groupId,
        roomId: group.roomId,
        name: group.name,
        sunSensor: group.sunSensor,
        flags: group.flags,
        linkedShades: group.linkedShades.map((id) => ({
          shadeId: id,
          name: this.shade(id)?.name,
          shadeType: this.shade(id)?.shadeType,
        })),
      })),
    };
  }

  emit(event, data) {
    const message = `42[${event},${JSON.stringify(data)}]`;
    for (const socket of this.sockets) {
      socket.send(message);
    }
  }

  emitShade(shade) {
    this.emit('shadeState', this.stateOf(shade));
  }

  /** Move a shade towards a raw target (down %), pushing like the firmware. */
  moveTo(shade, targetRaw) {
    const target = Math.max(0, Math.min(100, targetRaw));
    if (target === shade.raw) {
      shade.direction = 0;
      this.emitShade(shade);
      return;
    }
    shade.direction = target < shade.raw ? -1 : 1;
    shade.targetRaw = target;
    const arrive = () => {
      shade.raw = target;
      shade.direction = 0;
      shade.targetRaw = target;
      this.emitShade(shade);
    };
    if (this.moveMs > 0) {
      this.emitShade(shade);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        arrive();
      }, this.moveMs);
      this.timers.add(timer);
    } else {
      arrive();
    }
  }

  /** A command, from the API (`internal`) or a remote (`remote`). */
  command(shade, name, source = 'internal') {
    const cmd = String(name).toLowerCase();
    const labels = {
      up: 'Up',
      down: 'Down',
      my: 'My',
      toggle: 'Toggle',
      sunflag: 'Sun Flag',
      flag: 'Flag',
      stepup: 'Step Up',
      stepdown: 'Step Down',
    };
    this.emit('shadeCommand', {
      shadeId: shade.shadeId,
      remoteAddress: shade.remoteAddress,
      cmd: labels[cmd] ?? name,
      source,
      rcode: 1,
      sourceAddress: source === 'remote' ? 424242 : shade.remoteAddress,
    });
    if (cmd === 'sunflag' || cmd === 'flag') {
      shade.flags = cmd === 'sunflag' ? shade.flags | 0x01 : shade.flags & ~0x01;
      this.emitShade(shade);
      return;
    }
    if ([DRY_CONTACT, DRY_CONTACT_2].includes(shade.shadeType)) {
      const on = cmd === 'toggle' ? shade.raw !== 100 : cmd === 'up';
      shade.raw = on ? 100 : 0;
      this.emitShade(shade);
      return;
    }
    if (TOGGLES.includes(shade.shadeType) && cmd === 'toggle') {
      this.moveTo(shade, shade.raw > 0 ? 0 : 100);
      return;
    }
    if (cmd === 'up') {
      this.moveTo(shade, 0);
    } else if (cmd === 'down') {
      this.moveTo(shade, 100);
    } else if (cmd === 'stepup' || cmd === 'stepdown') {
      this.moveTo(shade, shade.raw + (cmd === 'stepup' ? -10 : 10));
    } else if (cmd === 'my') {
      if (shade.direction !== 0) {
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        shade.raw = Math.round((shade.raw + (shade.targetRaw ?? shade.raw)) / 2);
        shade.targetRaw = shade.raw;
        shade.direction = 0;
        this.emitShade(shade);
      } else if (shade.myRaw >= 0) {
        this.moveTo(shade, shade.myRaw);
      }
    }
  }

  /** A Somfy remote paired with a shade is pressed. */
  pressRemote(shadeId, button) {
    this.command(this.shade(shadeId), button, 'remote');
  }

  /** The sun / wind sensor of a motor reports. */
  setWeather(shadeId, { sunny, windy }) {
    const shade = this.shade(shadeId);
    if (sunny !== undefined) shade.flags = sunny ? shade.flags | 0x20 : shade.flags & ~0x20;
    if (windy !== undefined) shade.flags = windy ? shade.flags | 0x10 : shade.flags & ~0x10;
    this.emitShade(shade);
  }

  /** A shade added in the web UI. */
  addShade(shade) {
    this.shades.push({
      roomId: 0,
      shadeType: 0,
      tiltType: 0,
      flipPosition: false,
      raw: 0,
      tiltRaw: 0,
      myRaw: -1,
      flags: 0,
      sunSensor: false,
      remoteAddress: 1000 + shade.shadeId,
      direction: 0,
      tiltDirection: 0,
      ...shade,
    });
    this.emit('shadeAdded', this.stateOf(this.shade(shade.shadeId)));
  }

  // --- HTTP API --------------------------------------------------------------------

  async handle(request, response) {
    const url = new URL(request.url, 'http://fake');
    let body = '';
    for await (const chunk of request) body += chunk;
    const json = body ? JSON.parse(body) : {};
    this.requests.push({ method: request.method, path: url.pathname, body: json });
    const send = (status, value) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    const error = (desc) => send(500, { status: 'ERROR', desc });
    if (this.refuse === url.pathname) {
      return error('Refused by the test.');
    }
    switch (url.pathname) {
      case '/discovery':
        return send(200, this.discovery());
      case '/shadeCommand': {
        const shade = this.shade(json.shadeId);
        if (!shade) return error('Shade with the specified id not found.');
        if (json.target !== undefined) {
          const target = Number(json.target);
          this.moveTo(shade, shade.flipPosition ? 100 - target : target);
        } else {
          this.command(shade, json.command ?? 'my');
        }
        return send(200, { shadeId: shade.shadeId, name: shade.name });
      }
      case '/tiltCommand': {
        const shade = this.shade(json.shadeId);
        if (!shade) return error('Shade with the specified id not found.');
        const target = Number(json.target);
        shade.tiltRaw = shade.flipPosition ? 100 - target : target;
        this.emitShade(shade);
        return send(200, { shadeId: shade.shadeId });
      }
      case '/groupCommand': {
        const group = this.groups.find((item) => item.groupId === Number(json.groupId));
        if (!group) return error('Group with the specified id not found.');
        const cmd = String(json.command ?? 'my').toLowerCase();
        if (cmd === 'sunflag' || cmd === 'flag') {
          group.flags = cmd === 'sunflag' ? group.flags | 0x01 : group.flags & ~0x01;
          this.emit('groupState', this.groupState(group));
        }
        for (const id of group.linkedShades) {
          const shade = this.shade(id);
          if (shade) this.command(shade, cmd, 'internal');
        }
        return send(200, { groupId: group.groupId });
      }
      case '/setPositions': {
        const shade = this.shade(json.shadeId);
        if (!shade) return error('An invalid shadeId was provided');
        if (json.position !== undefined) {
          shade.raw = shade.flipPosition ? 100 - json.position : json.position;
          shade.targetRaw = shade.raw;
        }
        if (json.tiltPosition !== undefined && shade.tiltType !== 0) {
          shade.tiltRaw = shade.flipPosition ? 100 - json.tiltPosition : json.tiltPosition;
        }
        this.emitShade(shade);
        return send(200, this.discoveryShade(shade));
      }
      default:
        response.writeHead(404, { 'content-type': 'text/plain' });
        return response.end('404: Service Not Found');
    }
  }

  // --- Life cycle -------------------------------------------------------------------

  async start() {
    this.api = createServer((request, response) => {
      this.handle(request, response).catch(() => {
        response.writeHead(500);
        response.end();
      });
    });
    await new Promise((resolve) => this.api.listen(0, '127.0.0.1', resolve));
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise((resolve) => this.wss.once('listening', resolve));
    this.wss.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.send('Connected');
      // The firmware sends the whole state to a new client.
      setImmediate(() => {
        if (socket.readyState !== socket.OPEN) return;
        for (const shade of this.shades)
          socket.send(`42[shadeState,${JSON.stringify(this.stateOf(shade))}]`);
        for (const group of this.groups)
          socket.send(`42[groupState,${JSON.stringify(this.groupState(group))}]`);
        socket.send(
          `42[wifiStrength,${JSON.stringify({ ssid: 'Maison', strength: -58, channel: 6 })}]`,
        );
        socket.send(
          `42[fwStatus,${JSON.stringify({ fwVersion: { name: this.version }, latest: { name: this.latest }, checkForUpdate: true, inetAvailable: true })}]`,
        );
      });
    });
    return this;
  }

  get ports() {
    return { api: this.api.address().port, socket: this.wss.address().port };
  }

  /** Unplug: every connection drops, nothing answers any more. */
  async stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    await new Promise((resolve) => this.wss?.close(() => resolve()));
    await new Promise((resolve) => {
      this.api?.closeAllConnections?.();
      this.api?.close(() => resolve());
    });
    this.api = null;
    this.wss = null;
  }
}

/**
 * @description The fake LAN: controllers by address, the SSDP answers the
 * core relays, and the `endpoints` the integration uses to reach them.
 */
export class FakeNetwork {
  constructor(controllers) {
    this.controllers = controllers;
  }

  async start() {
    await Promise.all(this.controllers.map((controller) => controller.start()));
    return this;
  }

  byHost(host) {
    return this.controllers.find((controller) => controller.host === host && controller.api);
  }

  /** host -> local URLs; an address nobody answers at -> a closed port. */
  endpoints = (host) => {
    const controller = this.byHost(host);
    if (!controller) {
      return { api: 'http://127.0.0.1:9', socket: 'ws://127.0.0.1:9/' };
    }
    const { api, socket } = controller.ports;
    return { api: `http://127.0.0.1:${api}`, socket: `ws://127.0.0.1:${socket}/` };
  };

  /**
   * What the core relays for an M-SEARCH `ssdp:all`: the three answers of
   * each controller (root, uuid, device type, as SSDP.cpp writes them) and
   * those of a TV.
   */
  ssdp() {
    const answers = this.controllers
      .filter((controller) => controller.api)
      .flatMap((controller) => {
        const uuid = `uuid:C2496952-5610-47E6-A968-2FC140${controller.serverId}`;
        return [
          `${uuid}::upnp:rootdevice`,
          uuid,
          `${uuid}::urn:schemas-rstrouse-org:device:ESPSomfyRTS:1`,
        ].map((usn) => ({
          source_ip: controller.host,
          source_port: 1900,
          headers: [
            'HTTP/1.1 200 OK',
            'EXT:',
            'CACHE-CONTROL: max-age=1800',
            'SERVER: Arduino/1.0 UPnP/1.1 ESPSomfyRTS/2.0',
            `USN: ${usn}`,
            'ST: ssdp:all',
            `LOCATION: http://${controller.host}:80/upnp.xml`,
            'BOOTID.UPNP.ORG: 1',
            'CONFIGID.UPNP.ORG: 1',
            '',
            '',
          ].join('\r\n'),
        }));
      });
    answers.push({
      source_ip: '192.168.1.60',
      source_port: 1900,
      headers:
        'HTTP/1.1 200 OK\r\nSERVER: Linux/4.4 UPnP/1.0 TV/1.0\r\nUSN: uuid:tv::urn:schemas-upnp-org:device:MediaRenderer:1\r\nST: ssdp:all\r\n\r\n',
    });
    return answers;
  }

  async stop() {
    await Promise.all(this.controllers.map((controller) => controller.stop()));
  }
}

// -----------------------------------------------------------------------------
// What an ESPSomfy RTS controller says, in plain objects.
//
// The firmware (https://github.com/rstrouse/ESPSomfy-RTS, public domain)
// describes its shades and groups in the JSON of `GET /discovery` and pushes
// their changes on its socket (`shadeState`, `groupState`…). The fields are
// not the same in both: `shadeType` / `type`, `hasLight` / `light`. This
// module reads both into one shape, and holds the position conventions.
//
// Positions. The firmware counts how far a shade went DOWN, 0 to 100 %:
// a roller shutter at 0 is open, an awning at 100 is out (open). With the
// "flip position" option of the web UI, it reports 100 - that, and it reads
// the targets it receives the same way. Gladys counts how OPEN a cover is
// (0 % = closed). Same conversions as the Home Assistant integration of the
// firmware author, so a user switching sees the same numbers.
// -----------------------------------------------------------------------------

export const SHADE_TYPES = {
  ROLLER: 0,
  BLIND: 1,
  LEFT_DRAPERY: 2,
  AWNING: 3,
  SHUTTER: 4,
  GARAGE_1: 5,
  GARAGE_3: 6,
  RIGHT_DRAPERY: 7,
  CENTER_DRAPERY: 8,
  DRY_CONTACT: 9,
  DRY_CONTACT_2: 10,
  LEFT_GATE: 11,
  CENTER_GATE: 12,
  RIGHT_GATE: 13,
  LEFT_GATE_1: 14,
  CENTER_GATE_1: 15,
  RIGHT_GATE_1: 16,
};

export const TILT_TYPES = { NONE: 0, TILT_MOTOR: 1, INTEGRATED: 2, TILT_ONLY: 3, EURO: 4 };

// Bits of `flags`.
export const FLAGS = { SUN_FLAG: 0x01, SUN_SENSOR: 0x02, WINDY: 0x10, SUNNY: 0x20 };

const DRAPERIES = [SHADE_TYPES.LEFT_DRAPERY, SHADE_TYPES.RIGHT_DRAPERY, SHADE_TYPES.CENTER_DRAPERY];
// One-button motors (garage door, gate): every press is "the button".
const TOGGLES = [
  SHADE_TYPES.GARAGE_1,
  SHADE_TYPES.LEFT_GATE_1,
  SHADE_TYPES.CENTER_GATE_1,
  SHADE_TYPES.RIGHT_GATE_1,
];
const DRY_CONTACTS = [SHADE_TYPES.DRY_CONTACT, SHADE_TYPES.DRY_CONTACT_2];

/**
 * @description What kind of Gladys device a shade becomes.
 * @param {object} shade - Shade (see `readShade`).
 * @returns {'contact'|'toggle'|'curtain'|'shutter'} The kind.
 */
export function shadeKind(shade) {
  if (DRY_CONTACTS.includes(shade.type)) {
    return 'contact';
  }
  if (TOGGLES.includes(shade.type)) {
    return 'toggle';
  }
  return DRAPERIES.includes(shade.type) ? 'curtain' : 'shutter';
}

export const isAwning = (shade) => shade.type === SHADE_TYPES.AWNING;
export const isTiltOnly = (shade) => shade.tiltType === TILT_TYPES.TILT_ONLY;
/** A lift motor with slats: a second position, the tilt. */
export const hasTilt = (shade) =>
  [TILT_TYPES.TILT_MOTOR, TILT_TYPES.INTEGRATED, TILT_TYPES.EURO].includes(shade.tiltType);
/** Sun and wind: the motors with a Somfy sun sensor, and every awning. */
export const hasSunFlag = (item) => item.sunSensor === true || isAwning(item);

const clamp = (value) => Math.min(100, Math.max(0, Math.round(Number(value))));

/**
 * @description Firmware position -> Gladys position (how open). The reverse
 * conversion is the same function.
 * @param {number} value - Position as the firmware reports it.
 * @param {object} shade - `{ flip, type }`.
 * @returns {number} 0 (closed) to 100 (open).
 */
export function openness(value, shade) {
  const down = shade.flip ? 100 - clamp(value) : clamp(value);
  return isAwning(shade) ? down : 100 - down;
}

/** Gladys position -> the target the firmware expects. */
export const targetFor = (open, shade) => openness(open, shade);

/**
 * @description Firmware tilt -> Gladys tilt (how open the slats are), and back.
 * @param {number} value - Tilt position.
 * @param {object} shade - `{ flip }`.
 * @returns {number} 0 (closed) to 100 (open).
 */
export const tiltOpenness = (value, shade) => (shade.flip ? clamp(value) : 100 - clamp(value));

const number = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const bool = (value) => value === true || value === 1 || value === 'true';

/**
 * @description Read a shade from `/discovery`, `/shades` or a socket event.
 * @param {object} json - Firmware JSON.
 * @param {object} [previous] - What was known (a socket event carries less).
 * @returns {object} The shade.
 */
export function readShade(json, previous = {}) {
  const has = (key) => json[key] !== undefined && json[key] !== null;
  const shade = { ...previous };
  shade.id = number(json.shadeId, previous.id);
  if (has('name')) shade.name = String(json.name);
  if (has('roomId')) shade.roomId = number(json.roomId);
  if (has('shadeType')) shade.type = number(json.shadeType);
  else if (has('type')) shade.type = number(json.type);
  if (has('tiltType')) shade.tiltType = number(json.tiltType);
  if (has('flipPosition')) shade.flip = bool(json.flipPosition);
  if (has('position')) shade.position = number(json.position);
  if (has('target')) shade.target = number(json.target);
  if (has('direction')) shade.direction = number(json.direction);
  if (has('myPos')) shade.myPos = number(json.myPos, -1);
  if (has('tiltPosition')) shade.tiltPosition = number(json.tiltPosition);
  if (has('tiltDirection')) shade.tiltDirection = number(json.tiltDirection);
  if (has('myTiltPos')) shade.myTiltPos = number(json.myTiltPos, -1);
  if (has('flags')) shade.flags = number(json.flags);
  if (has('sunSensor')) shade.sunSensor = bool(json.sunSensor);
  if (has('remoteAddress')) shade.remoteAddress = number(json.remoteAddress);
  if (has('sortOrder')) shade.sortOrder = number(json.sortOrder);
  shade.type ??= SHADE_TYPES.ROLLER;
  shade.tiltType ??= TILT_TYPES.NONE;
  shade.flip ??= false;
  shade.position ??= 0;
  shade.direction ??= 0;
  shade.tiltPosition ??= 0;
  shade.tiltDirection ??= 0;
  shade.flags ??= 0;
  shade.myPos ??= -1;
  shade.name ??= `Shade ${shade.id}`;
  return shade;
}

/**
 * @description Read a group. `groupState` lists its shades as numbers,
 * `/discovery` as objects.
 * @param {object} json - Firmware JSON.
 * @param {object} [previous] - What was known.
 * @returns {object} The group.
 */
export function readGroup(json, previous = {}) {
  const group = { ...previous };
  group.id = number(json.groupId, previous.id);
  if (json.name !== undefined) group.name = String(json.name);
  if (json.roomId !== undefined) group.roomId = number(json.roomId);
  if (json.flags !== undefined) group.flags = number(json.flags);
  if (json.sunSensor !== undefined) group.sunSensor = bool(json.sunSensor);
  if (json.sortOrder !== undefined) group.sortOrder = number(json.sortOrder);
  const linked = json.linkedShades ?? json.shades;
  if (Array.isArray(linked)) {
    group.shadeIds = linked
      .map((item) => number(typeof item === 'object' ? item?.shadeId : item, -1))
      .filter((id) => id > 0 && id < 255);
  }
  group.shadeIds ??= [];
  group.flags ??= 0;
  group.sunSensor ??= false;
  group.name ??= `Group ${group.id}`;
  return group;
}

/**
 * @description Is the shade moving (lift, or the slats of a tilt-only blind)?
 * @param {object} shade - Shade.
 * @returns {number} -1 going up, 1 going down, 0 still (firmware directions).
 */
export function movement(shade) {
  if (isTiltOnly(shade)) {
    return shade.tiltDirection;
  }
  return shade.direction !== 0 ? shade.direction : hasTilt(shade) ? shade.tiltDirection : 0;
}

/**
 * @description The Gladys position of a shade: the lift, or the slats of a
 * tilt-only blind.
 * @param {object} shade - Shade.
 * @returns {number} 0 to 100.
 */
export const shadeOpenness = (shade) =>
  isTiltOnly(shade) ? tiltOpenness(shade.tiltPosition, shade) : openness(shade.position, shade);

/**
 * @description The Gladys cover state: 1 open or opening, -1 closed or
 * closing, 0 stopped in between.
 * @param {object} shade - Shade.
 * @returns {-1|0|1} The state.
 */
export function coverState(shade) {
  const moving = movement(shade);
  if (moving !== 0) {
    // The firmware "up" (-1) opens, except an awning, which opens going out.
    const opening = isAwning(shade) && !isTiltOnly(shade) ? moving > 0 : moving < 0;
    return opening ? 1 : -1;
  }
  const open = shadeOpenness(shade);
  if (open >= 100) {
    return 1;
  }
  return open <= 0 ? -1 : 0;
}

/** A dry contact is on when its relay is: position above 0. */
export const contactOn = (shade) => shade.position > 0;

export const flag = (item, bit) => (Number(item.flags) & bit) === bit;

/**
 * @description The firmware command that opens or closes a cover.
 * @param {object} shade - Shade (or `{ type }` for a group of awnings).
 * @param {'open'|'close'} wanted - What Gladys asked.
 * @returns {'up'|'down'} The command.
 */
export function directionCommand(shade, wanted) {
  const up = wanted === 'open';
  return isAwning(shade) ? (up ? 'down' : 'up') : up ? 'up' : 'down';
}

/**
 * @description Read one message of the socket. The firmware speaks a
 * socket.io-like text protocol without the quotes: `42[shadeState,{…}]`, and
 * says `Connected` first.
 * @param {string} message - Text frame.
 * @returns {{ event: string, data: object }|null} The event, null for anything else.
 */
export function parseSocketMessage(message) {
  const value = String(message ?? '');
  if (!value.startsWith('42[') || !value.endsWith(']')) {
    return null;
  }
  const comma = value.indexOf(',');
  if (comma < 0) {
    return null;
  }
  const event = value.slice(3, comma).replaceAll('"', '').trim();
  try {
    const data = JSON.parse(value.slice(comma + 1, -1));
    return event && data && typeof data === 'object' ? { event, data } : null;
  } catch {
    return null;
  }
}

/**
 * @description Read the answer of `GET /discovery`.
 * @param {object} json - Firmware JSON.
 * @returns {object} The controller description.
 */
export function readDiscovery(json) {
  const serverId = normalizeServerId(json?.serverId);
  if (!serverId) {
    throw new Error('not an ESPSomfy RTS controller (no server id)');
  }
  const rooms = new Map();
  for (const room of Array.isArray(json.rooms) ? json.rooms : []) {
    if (Number(room?.roomId) > 0) {
      rooms.set(Number(room.roomId), String(room.name ?? ''));
    }
  }
  const shades = new Map();
  for (const item of Array.isArray(json.shades) ? json.shades : []) {
    const shade = readShade(item);
    if (shade.id > 0 && shade.id < 255) {
      shades.set(shade.id, shade);
    }
  }
  const groups = new Map();
  for (const item of Array.isArray(json.groups) ? json.groups : []) {
    const group = readGroup(item);
    if (group.id > 0 && group.id < 255) {
      groups.set(group.id, group);
    }
  }
  return {
    serverId,
    hostname: String(json.hostname ?? ''),
    version: firmwareName(json.version ?? json.fwVersion),
    latest: firmwareName(json.latest),
    chipModel: String(json.chipModel ?? ''),
    connType: String(json.connType ?? ''),
    rooms,
    shades,
    groups,
  };
}

/** The server id is the end of the ESP32 MAC address, in hexadecimal. */
export function normalizeServerId(value) {
  const id = String(value ?? '')
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{4,12}$/.test(id) ? id : '';
}

/** `v2.4.7`, `{ name: 'v2.4.7' }` -> `2.4.7`. */
export function firmwareName(value) {
  const name = typeof value === 'object' && value !== null ? value.name : value;
  return String(name ?? '')
    .trim()
    .replace(/^v/i, '');
}

/** Is `latest` newer than `current`? (`2.4.10` > `2.4.9`) */
export function isNewer(latest, current) {
  const parts = (value) =>
    String(value)
      .split('.')
      .map((part) => Number.parseInt(part, 10));
  const a = parts(latest);
  const b = parts(current);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) {
    return false;
  }
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }
  return false;
}

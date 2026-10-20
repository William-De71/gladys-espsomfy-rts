// -----------------------------------------------------------------------------
// From an ESPSomfy RTS shade or group to a Gladys device, and back.
//
//   roller shutter, blind, awning, shutter, garage door, gate
//                          -> shutter: state (open / stop / close) + position,
//                             + tilt for the blinds with slats
//   drapery                -> curtain: state + position
//   one-button garage door or gate (every press toggles)
//                          -> shutter: state only (no position to aim at)
//   dry contact (relay)    -> switch
//   group                  -> shutter state (a group has no position)
//   sun sensor, awning     -> + a "sun flag" switch: let the sun sensor move
//                             the motor, or not
//
// One device per shade and per group, under the server id of the controller
// (end of its MAC address): the ids survive a new IP address, a rename, a
// restore. Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import {
  contactOn,
  coverState,
  directionCommand,
  flag,
  FLAGS,
  hasSunFlag,
  hasTilt,
  isAwning,
  isTiltOnly,
  movement,
  shadeKind,
  shadeOpenness,
  SHADE_TYPES,
  targetFor,
  tiltOpenness,
} from './espsomfy/model.js';
import { text } from './i18n.js';

export const DEVICE_TYPES = { SHADE: 'shade', GROUP: 'group' };

export const FEATURE_KEYS = {
  STATE: 'state',
  POSITION: 'position',
  TILT: 'tilt',
  CONTACT: 'contact',
  SUN_FLAG: 'sun-flag',
};

export const COVER = { OPEN: 1, STOP: 0, CLOSE: -1 };

/**
 * @description The id of a shade or a group in the external ids.
 * @param {object} controller - Controller entry (`serverId`).
 * @param {object} item - Shade or group (`id`).
 * @returns {string} `<server id>-<id>`.
 */
export const platformId = (controller, item) => `${controller.serverId}-${item.id}`;

const feature = (key, language, spec) => ({
  key,
  name: text(`feature_${key}`, language),
  keep_history: true,
  ...spec,
});

const coverFeatures = (category, language, { position, tilt, feedback }) => {
  const list = [
    feature(FEATURE_KEYS.STATE, language, {
      category,
      type: TYPES.SHUTTER.STATE,
      min: -1,
      max: 1,
      read_only: false,
      has_feedback: feedback,
      keep_history: false,
    }),
  ];
  if (position) {
    list.push(
      feature(FEATURE_KEYS.POSITION, language, {
        category,
        type: TYPES.SHUTTER.POSITION,
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: true,
      }),
    );
  }
  if (tilt) {
    list.push(
      feature(FEATURE_KEYS.TILT, language, {
        category,
        type: TYPES.SHUTTER.POSITION,
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: true,
      }),
    );
  }
  return list;
};

const switchFeature = (key, language) =>
  feature(key, language, {
    category: CATEGORIES.SWITCH,
    type: TYPES.SWITCH.BINARY,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: true,
  });

/**
 * @description The features of a shade, without their external ids.
 * @param {object} shade - Shade.
 * @param {string} language - Language of the names.
 * @returns {Array<object>} Feature specs (`key` + Gladys fields).
 */
export function shadeSpecs(shade, language) {
  const kind = shadeKind(shade);
  let list;
  if (kind === 'contact') {
    list = [switchFeature(FEATURE_KEYS.CONTACT, language)];
  } else if (kind === 'toggle') {
    list = coverFeatures(CATEGORIES.SHUTTER, language, { feedback: true });
  } else {
    const category = kind === 'curtain' ? CATEGORIES.CURTAIN : CATEGORIES.SHUTTER;
    list = coverFeatures(category, language, {
      position: true,
      tilt: hasTilt(shade),
      feedback: true,
    });
  }
  if (kind !== 'contact' && hasSunFlag(shade)) {
    list.push(switchFeature(FEATURE_KEYS.SUN_FLAG, language));
  }
  return list;
}

/**
 * @description The features of a group, without their external ids.
 * @param {object} group - Group.
 * @param {string} language - Language of the names.
 * @returns {Array<object>} Feature specs.
 */
export function groupSpecs(group, language) {
  // No position, no direction: Gladys shows the buttons, nothing to read back.
  const list = coverFeatures(CATEGORIES.SHUTTER, language, { feedback: false });
  if (group.sunSensor) {
    list.push(switchFeature(FEATURE_KEYS.SUN_FLAG, language));
  }
  return list;
}

const modelOf = (shade) => {
  const name = Object.entries(SHADE_TYPES).find(([, value]) => value === shade.type)?.[0];
  return `ESPSomfy RTS ${String(name ?? 'shade')
    .toLowerCase()
    .replaceAll('_', ' ')}`;
};

const build = (gladys, controller, type, item, specs, model) => {
  const ids = gladys.externalIds(type, platformId(controller, item));
  const params = [
    { name: 'ESPSOMFY_HOST', value: controller.host },
    { name: 'ESPSOMFY_SERVER_ID', value: controller.serverId },
  ];
  const room = controller.rooms?.get(item.roomId);
  if (room) {
    params.push({ name: 'ESPSOMFY_ROOM', value: room });
  }
  return {
    name: item.name,
    external_id: ids.device,
    model,
    // Pushed over the socket of the controller: the Gladys scheduler never
    // polls these devices.
    should_poll: false,
    params,
    features: specs.map(({ key, ...spec }) => ({ ...spec, external_id: ids.feature(key) })),
  };
};

/** The Gladys device of a shade. */
export const buildShadeDevice = (gladys, controller, shade, language) =>
  build(gladys, controller, DEVICE_TYPES.SHADE, shade, shadeSpecs(shade, language), modelOf(shade));

/** The Gladys device of a group. */
export const buildGroupDevice = (gladys, controller, group, language) =>
  build(
    gladys,
    controller,
    DEVICE_TYPES.GROUP,
    group,
    groupSpecs(group, language),
    'ESPSomfy RTS group',
  );

/**
 * @description The current values of a shade, feature key -> Gladys value.
 * @param {object} shade - Shade.
 * @returns {Array<[string, number]>} The values.
 */
export function shadeValues(shade) {
  const kind = shadeKind(shade);
  const values = [];
  if (kind === 'contact') {
    values.push([FEATURE_KEYS.CONTACT, contactOn(shade) ? 1 : 0]);
    return values;
  }
  values.push([FEATURE_KEYS.STATE, coverState(shade)]);
  if (kind !== 'toggle') {
    values.push([FEATURE_KEYS.POSITION, shadeOpenness(shade)]);
    if (hasTilt(shade)) {
      values.push([FEATURE_KEYS.TILT, tiltOpenness(shade.tiltPosition, shade)]);
    }
  }
  if (hasSunFlag(shade)) {
    values.push([FEATURE_KEYS.SUN_FLAG, flag(shade, FLAGS.SUN_FLAG) ? 1 : 0]);
  }
  return values;
}

/**
 * @description The current values of a group.
 * @param {object} group - Group.
 * @returns {Array<[string, number]>} The values.
 */
export const groupValues = (group) =>
  group.sunSensor ? [[FEATURE_KEYS.SUN_FLAG, flag(group, FLAGS.SUN_FLAG) ? 1 : 0]] : [];

const asCover = (value) => {
  const number = Math.round(Number(value));
  if (![COVER.OPEN, COVER.STOP, COVER.CLOSE].includes(number)) {
    throw new RangeError(String(value));
  }
  return number;
};

const asPercent = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new RangeError(String(value));
  }
  return Math.round(number);
};

const asBinary = (value) => {
  const number = Number(value);
  if (number !== 0 && number !== 1) {
    throw new RangeError(String(value));
  }
  return number;
};

const shadeCommand = (shade, body) => ({
  path: 'shadeCommand',
  body: { shadeId: shade.id, ...body },
});
const tiltCommand = (shade, body) => ({
  path: 'tiltCommand',
  body: { shadeId: shade.id, ...body },
});

/** A one-button motor: open and close press the button only when it changes something. */
function toggleCover(shade, wanted) {
  const moving = movement(shade) !== 0;
  const state = coverState(shade);
  if (wanted === COVER.STOP) {
    return moving ? shadeCommand(shade, { command: 'toggle' }) : null;
  }
  if (!moving && state === wanted) {
    return null;
  }
  return shadeCommand(shade, { command: 'toggle' });
}

/**
 * @description The firmware request that sets a feature of a shade.
 * @param {object} shade - Shade.
 * @param {string} key - Feature key.
 * @param {number} value - Gladys value.
 * @returns {{ path: string, body: object }|null} The request, null when there
 * is nothing to do (stop a still shade, open an open gate).
 */
export function shadeCommandFor(shade, key, value) {
  const kind = shadeKind(shade);
  switch (key) {
    case FEATURE_KEYS.STATE: {
      const wanted = asCover(value);
      if (kind === 'toggle') {
        return toggleCover(shade, wanted);
      }
      if (wanted === COVER.STOP) {
        // "My" stops a moving motor, but sends a still one to its favourite position.
        return movement(shade) !== 0 ? shadeCommand(shade, { command: 'my' }) : null;
      }
      if (isTiltOnly(shade)) {
        return tiltCommand(shade, { target: tiltOpenness(wanted === COVER.OPEN ? 100 : 0, shade) });
      }
      return shadeCommand(shade, {
        command: directionCommand(shade, wanted === COVER.OPEN ? 'open' : 'close'),
      });
    }
    case FEATURE_KEYS.POSITION: {
      const open = asPercent(value);
      if (isTiltOnly(shade)) {
        return tiltCommand(shade, { target: tiltOpenness(open, shade) });
      }
      return shadeCommand(shade, { target: targetFor(open, shade) });
    }
    case FEATURE_KEYS.TILT:
      return tiltCommand(shade, { target: tiltOpenness(asPercent(value), shade) });
    case FEATURE_KEYS.CONTACT: {
      const on = asBinary(value) === 1;
      if (shade.type === SHADE_TYPES.DRY_CONTACT_2) {
        return shadeCommand(shade, { command: on ? 'up' : 'down' });
      }
      return on === contactOn(shade) ? null : shadeCommand(shade, { command: 'toggle' });
    }
    case FEATURE_KEYS.SUN_FLAG:
      return shadeCommand(shade, { command: asBinary(value) === 1 ? 'sunflag' : 'flag' });
    default:
      throw new RangeError(key);
  }
}

/**
 * @description The firmware request that sets a feature of a group.
 * @param {object} group - Group.
 * @param {string} key - Feature key.
 * @param {number} value - Gladys value.
 * @param {object[]} members - The shades of the group.
 * @returns {{ path: string, body: object }|null} The request.
 */
export function groupCommandFor(group, key, value, members) {
  const command = (name) => ({ path: 'groupCommand', body: { groupId: group.id, command: name } });
  if (key === FEATURE_KEYS.SUN_FLAG) {
    return command(asBinary(value) === 1 ? 'sunflag' : 'flag');
  }
  if (key !== FEATURE_KEYS.STATE) {
    throw new RangeError(key);
  }
  const wanted = asCover(value);
  if (wanted === COVER.STOP) {
    return members.some((shade) => movement(shade) !== 0) ? command('my') : null;
  }
  // A group of awnings opens going out, like its awnings.
  const awnings = members.length > 0 && members.every(isAwning);
  return command(
    directionCommand(
      { type: awnings ? SHADE_TYPES.AWNING : SHADE_TYPES.ROLLER },
      wanted === COVER.OPEN ? 'open' : 'close',
    ),
  );
}

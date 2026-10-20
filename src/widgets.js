// -----------------------------------------------------------------------------
// Dashboard widgets.
//
//   shade      one shade or group (setting `device`): how open it is (a live
//              gauge), what it does, its "My" favourite position, sun and
//              wind, and the buttons open / My / close (+ the sun flag).
//              "My" is what Gladys has no button for: a favourite position
//              stored in the motor itself.
//   overview   every shade added to Gladys, open or closed, at a glance,
//              and the state of the controllers (connection, firmware update)
//
// Pure: the build functions turn a snapshot into a content, so the tests and
// docs/illustrations/gen.mjs use the exact code Gladys gets. Every text is
// multi-language: Gladys caches the content per language.
// -----------------------------------------------------------------------------

import { t, truncate } from './i18n.js';

export const WIDGETS = { SHADE: 'shade', OVERVIEW: 'overview' };
export const WIDGET_ACTIONS = { MY: 'my' };
export const TTL_SECONDS = 60;
export const OVERVIEW_TTL_SECONDS = 120;

const MAX_CARDS = 8;
const MAX_CONTROLLERS = 4;

/**
 * @typedef {object} ShadeView
 * @property {'shade'|'group'} kind - Shade or group.
 * @property {string} deviceId - Gladys external id.
 * @property {string} name - Device name in Gladys.
 * @property {boolean} reachable - The controller answers.
 * @property {'shutter'|'curtain'|'toggle'|'contact'} cover - What it is.
 * @property {-1|0|1} state - Gladys cover state.
 * @property {-1|0|1} moving - 1 opening, -1 closing, 0 still.
 * @property {number|null} position - How open, 0-100 (null: no position).
 * @property {number|null} myPosition - "My" position, how open (null: none).
 * @property {number|null} tilt - How open the slats are (null: no slats).
 * @property {boolean|null} contact - Relay on (dry contact only).
 * @property {boolean|null} sunFlag - Sun flag on (null: no sun sensor).
 * @property {boolean|null} sunny - Sun detected (null: no sun sensor).
 * @property {boolean|null} windy - Wind detected (null: no sensor).
 * @property {number} members - Shades of a group.
 * @property {object} features - Feature external ids: `{ state, position, contact, sunFlag }`.
 */

const percent = (value) => `${Math.round(value)} %`;

/**
 * @description What a shade does, in words: "Open", "Closing", "Open 40 %".
 * @param {ShadeView} view - Shade.
 * @returns {{ text: object, color: string }} The text and its color.
 */
export function stateText(view) {
  if (!view.reachable) {
    return { text: t('stateUnreachable'), color: 'danger' };
  }
  if (view.cover === 'contact') {
    return view.contact
      ? { text: t('stateOn'), color: 'success' }
      : { text: t('stateOff'), color: 'neutral' };
  }
  if (view.kind === 'group') {
    return { text: t('stateGroup', { count: view.members }), color: 'info' };
  }
  if (view.moving > 0) {
    return { text: t('stateOpening'), color: 'primary' };
  }
  if (view.moving < 0) {
    return { text: t('stateClosing'), color: 'primary' };
  }
  if (view.state === 1) {
    return { text: t('stateOpen'), color: 'success' };
  }
  if (view.state === -1) {
    return { text: t('stateClosed'), color: 'neutral' };
  }
  return Number.isFinite(view.position)
    ? { text: t('stateOpenAt', { position: Math.round(view.position) }), color: 'warning' }
    : { text: t('stateStopped'), color: 'warning' };
}

const yesNo = (value, onKey, offKey, onColor) =>
  value ? { value: t(onKey), color: onColor } : { value: t(offKey), color: 'neutral' };

/**
 * @description The `shade` widget.
 * @param {ShadeView|null} view - The shade or group, null when the setting points nowhere.
 * @returns {object} The widget content.
 */
export function buildShadeWidget(view) {
  if (!view) {
    return {
      version: 1,
      ttl_seconds: TTL_SECONDS,
      components: [{ type: 'text', text: t('widgetChooseDevice'), variant: 'caption' }],
    };
  }
  const components = [{ type: 'text', text: truncate(view.name, 40), variant: 'heading' }];
  if (view.reachable && view.features.position && Number.isFinite(view.position)) {
    components.push({
      type: 'gauge',
      device_feature: view.features.position,
      // The unit comes from the feature (percent): the core drops a unit here.
      min: 0,
      max: 100,
      label: t(view.cover === 'curtain' ? 'widgetOpenCurtain' : 'widgetOpen'),
      color: 'primary',
    });
  }
  const state = stateText(view);
  const items = [{ label: t('widgetState'), value: state.text, color: state.color }];
  if (view.reachable) {
    if (Number.isFinite(view.myPosition)) {
      items.push({ label: t('widgetMy'), value: percent(view.myPosition), color: 'info' });
    }
    if (Number.isFinite(view.tilt)) {
      items.push({ label: t('widgetTilt'), value: percent(view.tilt), color: 'info' });
    }
    if (view.sunny !== null && view.sunny !== undefined) {
      items.push({ label: t('widgetSun'), ...yesNo(view.sunny, 'yes', 'no', 'warning') });
    }
    if (view.windy !== null && view.windy !== undefined) {
      items.push({ label: t('widgetWind'), ...yesNo(view.windy, 'yes', 'no', 'danger') });
    }
    if (view.sunFlag !== null && view.sunFlag !== undefined) {
      items.push({
        label: t('widgetSunFlag'),
        ...yesNo(view.sunFlag, 'sunFlagOn', 'sunFlagOff', 'success'),
      });
    }
  }
  components.push({ type: 'status', items });
  if (!view.reachable) {
    components.push({ type: 'text', text: t('widgetOffline'), variant: 'caption' });
    return { version: 1, ttl_seconds: TTL_SECONDS, components };
  }

  const { features } = view;
  if (view.cover === 'contact') {
    components.push({
      type: 'button',
      label: view.contact ? t('widgetTurnOff') : t('widgetTurnOn'),
      icon: 'power',
      style: 'primary',
      device_feature: features.contact,
      value: view.contact ? 0 : 1,
    });
  } else if (view.cover === 'toggle') {
    components.push({
      type: 'button',
      label: view.state === 1 ? t('widgetClose') : t('widgetOpenButton'),
      icon: view.state === 1 ? 'arrow-down' : 'arrow-up',
      style: 'primary',
      device_feature: features.state,
      value: view.state === 1 ? -1 : 1,
    });
  } else {
    components.push(
      {
        type: 'button',
        label: t('widgetOpenButton'),
        icon: 'arrow-up',
        style: 'secondary',
        device_feature: features.state,
        value: 1,
      },
      {
        type: 'button',
        label: t('widgetMyButton'),
        icon: 'star',
        style: 'primary',
        action: { key: WIDGET_ACTIONS.MY, params: { device: view.deviceId } },
      },
      {
        type: 'button',
        label: t('widgetClose'),
        icon: 'arrow-down',
        style: 'secondary',
        device_feature: features.state,
        value: -1,
      },
    );
  }
  if (features.sunFlag && view.sunFlag !== null && view.sunFlag !== undefined) {
    components.push({
      type: 'button',
      label: view.sunFlag ? t('widgetSunFlagOff') : t('widgetSunFlagOn'),
      icon: 'sun',
      style: 'secondary',
      device_feature: features.sunFlag,
      value: view.sunFlag ? 0 : 1,
    });
  }
  return { version: 1, ttl_seconds: TTL_SECONDS, components };
}

/**
 * @typedef {object} ControllerView
 * @property {string} name - Host name of the controller.
 * @property {boolean} reachable - It answers.
 * @property {string} version - Firmware version.
 * @property {string|null} update - Newer firmware available, null when up to date.
 * @property {{ type: string, strength?: number }|null} network - Wi-Fi or Ethernet.
 */

const networkText = (network) => {
  if (network?.type === 'wifi' && Number.isFinite(network.strength)) {
    return t('widgetWifi', { strength: network.strength });
  }
  return network?.type === 'ethernet' ? t('widgetEthernet') : t('widgetOnline');
};

/**
 * @description The `overview` widget.
 * @param {{ shades: ShadeView[], controllers: ControllerView[] }} view - Snapshot.
 * @returns {object} The widget content.
 */
export function buildOverviewWidget({ shades, controllers }) {
  const components = [];
  if (shades.length === 0) {
    components.push({
      type: 'text',
      text: controllers.length === 0 ? t('widgetNoController') : t('widgetNoShade'),
      variant: 'caption',
    });
  } else {
    const open = shades.filter(
      (view) => view.reachable && view.kind === 'shade' && (view.state === 1 || view.contact),
    ).length;
    components.push({
      type: 'text',
      text: t('widgetSummary', { open, total: shades.length }),
      variant: 'caption',
    });
    components.push({
      type: 'card-list',
      display: 'list',
      items: shades.slice(0, MAX_CARDS).map((view) => {
        const state = stateText(view);
        const item = { title: truncate(view.name, 60), subtitle: state.text };
        if (view.reachable && view.kind === 'shade' && Number.isFinite(view.position)) {
          item.badge = { text: percent(view.position), color: state.color };
          if (view.state === 0 && view.moving === 0) {
            // The badge says how much: no need to repeat it.
            item.subtitle = t('statePartly');
          }
        }
        return item;
      }),
    });
  }
  if (controllers.length > 0) {
    components.push({
      type: 'status',
      items: controllers.slice(0, MAX_CONTROLLERS).flatMap((controller) => {
        const rows = [
          {
            label: truncate(controller.name, 40),
            value: controller.reachable ? networkText(controller.network) : t('widgetOffline'),
            color: controller.reachable ? 'success' : 'danger',
          },
        ];
        if (controller.update) {
          rows.push({
            label: t('widgetFirmware'),
            value: t('widgetUpdate', { version: truncate(controller.update, 12) }),
            color: 'warning',
          });
        }
        return rows;
      }),
    });
  }
  return { version: 1, ttl_seconds: OVERVIEW_TTL_SECONDS, components };
}

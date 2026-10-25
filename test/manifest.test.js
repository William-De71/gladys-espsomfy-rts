// The manifest and the code agree: every declared action, widget, trigger and
// configuration key has its code, every version says the same thing, and the
// manifest respects what the store and the Gladys core expect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ACTIONS } from '../src/app.js';
import { SSDP_ST } from '../src/espsomfy/discovery.js';
import { DEFAULTS, LANGUAGES, RESCAN_INTERVALS } from '../src/config.js';
import {
  REMOTE_BUTTON_VALUES,
  SCENE_ACTION_OUTPUTS,
  SCENE_ACTIONS,
  SCENE_TRIGGER_DATA,
  SCENE_TRIGGERS,
  SEND_COMMAND_VALUES,
  SENSOR_STATES,
  SENSOR_VALUES,
} from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const byKey = (list) => Object.fromEntries(list.map((item) => [item.key, item]));
const values = (field) => field.options.map((option) => option.value);

test('one version everywhere, image of this repository', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-espsomfy-rts:${pkg.version}`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/William-De71\/gladys-espsomfy-rts\/main\/cover\.jpg$/,
  );
});

test('store rules: type, Gladys version, transports, categories, permissions', () => {
  assert.equal(manifest.type, 'device');
  // widgets and scene_* need 5.1.0, keywords 5.3.0; no widget form, no houses source.
  assert.equal(manifest.gladys_version, '>=5.3.0');
  // Everything stays on the local network (README "Transport").
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['lighting', 'protocols']);
  assert.equal(manifest.name, 'ESPSomfy RTS');
  // The mDNS service of the firmware (`_espsomfy_rts._tcp`) has an underscore,
  // refused by the store and the core: SSDP instead, `ssdp:all` because the
  // firmware answers a search for its own type to the multicast group.
  assert.equal(SSDP_ST, 'ssdp:all');
  assert.deepEqual(manifest.network_discovery, [{ type: 'ssdp', st: SSDP_ST }]);
  for (const key of ['location', 'containers', 'webhooks', 'network_wake']) {
    assert.equal(manifest[key], undefined, key);
  }
});

test('configuration: keys, defaults and choices of the code, no secret', () => {
  const fields = byKey(manifest.config_schema);
  assert.deepEqual(values(fields.language), LANGUAGES);
  assert.deepEqual(values(fields.rescan_interval), RESCAN_INTERVALS.map(String));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  // `text` / `password` are refused by the store.
  for (const field of manifest.config_schema) {
    assert.ok(['string', 'select', 'section'].includes(field.type), field.key);
  }
  assert.equal(fields.GLADYS_PREFER_LOCAL, undefined, 'one transport: no local preference');
});

test('configuration buttons: the keys of the code', () => {
  assert.deepEqual(
    manifest.actions.map((action) => action.key).sort(),
    Object.values(ACTIONS).sort(),
  );
});

test('scene triggers: keys, filters and variables of the code', () => {
  const triggers = byKey(manifest.scene_triggers);
  assert.deepEqual(Object.keys(triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
  for (const trigger of manifest.scene_triggers) {
    const declared = new Set([
      ...(trigger.fields ?? []).map((field) => field.key),
      ...(trigger.variables ?? []).map((variable) => variable.key),
    ]);
    assert.deepEqual(
      [...declared].sort(),
      [...SCENE_TRIGGER_DATA[trigger.key]].sort(),
      trigger.key,
    );
    const device = byKey(trigger.fields ?? []).device;
    if (device) {
      assert.equal(device.source, 'devices');
      assert.notEqual(device.required, true, 'empty: any shade');
    }
  }
  const remote = byKey(triggers.remote_pressed.fields);
  assert.deepEqual(values(remote.button), REMOTE_BUTTON_VALUES);
  const sun = byKey(triggers.sun_wind_changed.fields);
  assert.deepEqual(values(sun.sensor), SENSOR_VALUES);
  assert.deepEqual(values(sun.state), SENSOR_STATES);
});

test('scene actions: keys, fields, options and outputs of the code', () => {
  const actions = byKey(manifest.scene_actions);
  assert.deepEqual(Object.keys(actions).sort(), Object.values(SCENE_ACTIONS).sort());
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
    assert.deepEqual(
      (action.outputs ?? []).map((output) => output.key),
      SCENE_ACTION_OUTPUTS[action.key],
      action.key,
    );
    const device = byKey(action.fields).device;
    assert.equal(device.source, 'devices');
    assert.equal(device.required, true);
  }
  assert.deepEqual(values(byKey(actions.send_command.fields).command), SEND_COMMAND_VALUES);
  const position = byKey(actions.set_current_position.fields).position;
  assert.deepEqual([position.type, position.min, position.max], ['number', 0, 100]);
});

test('widgets: the keys of the code, settings without secrets', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  const widget = byKey(manifest.widgets).shade;
  assert.equal(byKey(widget.settings).device.source, 'devices');
  for (const item of manifest.widgets) {
    for (const setting of item.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
});

test('catalog fields of Gladys 5.3: search keywords and countries', () => {
  assert.ok(Array.isArray(manifest.keywords), 'keywords is a list');
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10, '1 to 10 keywords');
  for (const keyword of manifest.keywords) {
    assert.ok(
      keyword.trim().length >= 2 && keyword.trim().length <= 30,
      `"${keyword}": 2 to 30 chars`,
    );
  }
  const normalized = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'keywords are unique');
  assert.ok(!normalized.includes(manifest.name.toLowerCase()), 'the name is already searched');
  // Usable anywhere: no country restriction.
  assert.equal(manifest.countries, undefined);
});

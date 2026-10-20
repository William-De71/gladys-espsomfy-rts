// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`) and fake ESPSomfy RTS
// controllers on real local sockets (test/helpers.js): discovery, pushed
// states, commands, scene triggers and actions, widgets, lost controllers,
// restarts. Nothing leaves 127.0.0.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp } from '../src/app.js';
import { SCENE_TRIGGER_DATA } from '../src/scenes.js';
import { memoryStorage } from '../src/storage.js';
import {
  bedroomController,
  BEDROOM_ID,
  fakeClock,
  FakeNetwork,
  salonController,
  SALON_ID,
  until,
} from './helpers.js';

const CONFIG = { language: 'fr', hosts: '10.0.0.7' };
const shade = (serverId, id) => `ext:test-integration:shade:${serverId}-${id}`;
const group = (serverId, id) => `ext:test-integration:group:${serverId}-${id}`;
const SALON = shade(SALON_ID, 1);
const AWNING = shade(SALON_ID, 2);
const OFFICE = shade(SALON_ID, 3);
const CURTAIN = shade(SALON_ID, 4);
const GATE = shade(SALON_ID, 5);
const RELAY = shade(SALON_ID, 6);
const GROUND = group(SALON_ID, 1);
const BEDROOM = shade(BEDROOM_ID, 1);

/**
 * @description An integration wired to the fake Gladys and fake controllers.
 * @param {object} [options] - `{ config, create, storage, controllers, devices }`.
 * @returns {Promise<object>} `{ gladys, fake, app, network, logs, clock, salon, bedroom, stop }`.
 */
async function setup({
  config = CONFIG,
  create = true,
  storage = memoryStorage(),
  controllers,
  devices,
} = {}) {
  const list = controllers ?? [salonController(), bedroomController()];
  const network = await new FakeNetwork(list).start();
  const gladys = createFakeGladys({ config: structuredClone(config), devices });
  // The core sends the M-SEARCH on its own LAN only.
  gladys.scanNetwork = async (type) => {
    assert.equal(type, 'ssdp');
    return network.ssdp().filter((result) => result.source_ip.startsWith('192.168.'));
  };
  const logs = [];
  const log = (line) => logs.push(String(line));
  const clock = fakeClock();
  const app = createApp(gladys, {
    endpoints: network.endpoints,
    storage,
    now: clock.now,
    logger: { debug: log, info: log, warn: log, error: log },
    timings: { offlineAfterMs: 200, retryMs: 100, timeoutMs: 1000 },
  });
  try {
    await gladys.connect();
    await app.start();
    if (create) {
      for (const device of gladys.fake.discoveredDevices) {
        await gladys.fake.deviceCreated(structuredClone(device));
      }
      await app.flushStates();
    }
  } catch (error) {
    await app.stop();
    await network.stop();
    throw error;
  }
  const [salon, bedroom] = list;
  const stop = async () => {
    await app.stop();
    await network.stop();
  };
  return { gladys, fake: gladys.fake, app, network, logs, clock, salon, bedroom, stop };
}

const ok = (ack) => {
  assert.equal(ack.success, true, ack.error);
  return ack.data;
};
const deviceOf = (fake, externalId) =>
  structuredClone(fake.discoveredDevices.find((device) => device.external_id === externalId));
const featureOf = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`));
const last = (fake, externalId, key) => fake.lastState(`${externalId}:${key}`);
const setValue = (fake, externalId, key, value) => {
  const device = deviceOf(fake, externalId);
  return fake.setValue(device, featureOf(device, key), value);
};
const commands = (controller) => controller.requests.filter((request) => request.method === 'PUT');
const settle = async (app) => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await app.flushStates();
};
const keys = (device) => device.features.map((feature) => feature.external_id.split(':').pop());

test('discovery: controllers found by SSDP and by typed address, every shade and group', async () => {
  const { fake, stop } = await setup({ create: false });
  try {
    const ids = fake.discoveredDevices.map((device) => device.external_id).sort();
    assert.deepEqual(ids, [SALON, AWNING, OFFICE, CURTAIN, GATE, RELAY, GROUND, BEDROOM].sort());
    const salon = deviceOf(fake, SALON);
    assert.equal(salon.name, 'Salon');
    assert.equal(salon.model, 'ESPSomfy RTS roller');
    assert.equal(featureOf(salon, 'state').name, 'Ouvrir / fermer');
    assert.deepEqual(keys(salon), ['state', 'position']);
    assert.deepEqual(salon.params, [
      { name: 'ESPSOMFY_HOST', value: '192.168.1.40' },
      { name: 'ESPSOMFY_SERVER_ID', value: SALON_ID },
      { name: 'ESPSOMFY_ROOM', value: 'Séjour' },
    ]);
    assert.deepEqual(keys(deviceOf(fake, AWNING)), ['state', 'position', 'sun-flag']);
    assert.deepEqual(keys(deviceOf(fake, OFFICE)), ['state', 'position', 'tilt']);
    assert.equal(featureOf(deviceOf(fake, CURTAIN), 'state').category, 'curtain');
    assert.deepEqual(keys(deviceOf(fake, GATE)), ['state']);
    assert.deepEqual(keys(deviceOf(fake, RELAY)), ['contact']);
    assert.deepEqual(keys(deviceOf(fake, GROUND)), ['state']);
    // Nothing created yet: no state reaches Gladys.
    assert.equal(fake.lastState(`${SALON}:state`), undefined);
    assert.equal(fake.connectionStatus.connected, true);
    assert.match(fake.connectionStatus.message.fr, /2 contrôleur\(s\) ESPSomfy RTS sur 2/);
  } finally {
    await stop();
  }
});

test('states: positions as Gladys counts them (100 % = open), pushed by the controller', async () => {
  const { fake, app, salon, stop } = await setup();
  try {
    assert.equal(last(fake, SALON, 'state'), -1);
    assert.equal(last(fake, SALON, 'position'), 0);
    // An awning is open when it is out: retracted = closed.
    assert.equal(last(fake, AWNING, 'position'), 0);
    assert.equal(last(fake, AWNING, 'sun-flag'), 0);
    // "Flip position": the firmware reports 70, the blind is 70 % open.
    assert.equal(last(fake, OFFICE, 'position'), 70);
    assert.equal(last(fake, OFFICE, 'state'), 0);
    assert.equal(last(fake, OFFICE, 'tilt'), 50);
    assert.equal(last(fake, CURTAIN, 'state'), 1);
    assert.equal(last(fake, GATE, 'state'), -1);
    assert.equal(last(fake, RELAY, 'contact'), 0);
    assert.equal(last(fake, BEDROOM, 'position'), 100);
    assert.equal(
      fake.transports.filter((item) => item.device_external_id === SALON).at(-1).transport,
      'local',
    );

    // Moved with its Somfy remote: the controller hears it and pushes it.
    salon.pressRemote(1, 'up');
    await until(async () => {
      await app.flushStates();
      return last(fake, SALON, 'position') === 100;
    });
    assert.equal(last(fake, SALON, 'state'), 1);
    const reads = salon.requests.filter((request) => request.path === '/discovery');
    assert.ok(reads.length <= 2, 'read when connecting, never polled');
  } finally {
    await stop();
  }
});

test('commands: open, close, position, tilt, awning, flip, gate, relay, sun flag, group', async () => {
  const { fake, app, salon, stop } = await setup();
  try {
    ok(await setValue(fake, SALON, 'state', 1));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 1, command: 'up' });
    ok(await setValue(fake, SALON, 'position', 30));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 1, target: 70 });
    await settle(app);
    assert.equal(last(fake, SALON, 'position'), 30);

    // An awning opens going out (down).
    ok(await setValue(fake, AWNING, 'state', 1));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 2, command: 'down' });
    // "Flip position": the target is sent as the firmware reads it.
    ok(await setValue(fake, OFFICE, 'position', 20));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 3, target: 20 });
    ok(await setValue(fake, OFFICE, 'tilt', 80));
    assert.deepEqual(commands(salon).at(-1), {
      method: 'PUT',
      path: '/tiltCommand',
      body: { shadeId: 3, target: 80 },
    });
    await settle(app);
    assert.equal(last(fake, OFFICE, 'position'), 20);
    assert.equal(last(fake, OFFICE, 'tilt'), 80);

    // Stop on a still shade would send it to "My": nothing is sent.
    const before = commands(salon).length;
    ok(await setValue(fake, CURTAIN, 'state', 0));
    assert.equal(commands(salon).length, before);

    // A one-button gate: pressed only when it changes something.
    ok(await setValue(fake, GATE, 'state', 1));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 5, command: 'toggle' });
    await settle(app);
    assert.equal(last(fake, GATE, 'state'), 1);
    const pressed = commands(salon).length;
    ok(await setValue(fake, GATE, 'state', 1));
    assert.equal(commands(salon).length, pressed, 'already open');

    ok(await setValue(fake, RELAY, 'contact', 1));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 6, command: 'toggle' });
    ok(await setValue(fake, AWNING, 'sun-flag', 1));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 2, command: 'sunflag' });
    await settle(app);
    assert.equal(last(fake, RELAY, 'contact'), 1);
    assert.equal(last(fake, AWNING, 'sun-flag'), 1);

    ok(await setValue(fake, GROUND, 'state', -1));
    assert.deepEqual(commands(salon).at(-1), {
      method: 'PUT',
      path: '/groupCommand',
      body: { groupId: 1, command: 'down' },
    });

    const refused = await setValue(fake, SALON, 'position', 150);
    assert.equal(refused.success, false);
    assert.match(refused.error, /Valeur non prise en charge/);
  } finally {
    await stop();
  }
});

test('stop: "My" only while the shade moves', async () => {
  const salon = salonController({ moveMs: 400 });
  const { fake, app, stop } = await setup({ controllers: [salon, bedroomController()] });
  try {
    ok(await setValue(fake, SALON, 'state', 1));
    await until(() => app.hub.entries.get(SALON_ID).shades.get(1).direction === -1);
    await app.flushStates();
    assert.equal(last(fake, SALON, 'state'), 1, 'opening');
    ok(await setValue(fake, SALON, 'state', 0));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 1, command: 'my' });
    await settle(app);
    assert.equal(last(fake, SALON, 'state'), 0);
    assert.equal(last(fake, SALON, 'position'), 50);
  } finally {
    await stop();
  }
});

test('a controller refusing a command: the error says it', async () => {
  const { fake, salon, stop } = await setup();
  try {
    salon.refuse = '/shadeCommand';
    const ack = await setValue(fake, SALON, 'state', 1);
    assert.equal(ack.success, false);
    assert.match(ack.error, /Le contrôleur a refusé la commande pour Salon : Refused by the test/);
  } finally {
    await stop();
  }
});

test('scene trigger: a press on a Somfy remote, once per press, never the controller itself', async () => {
  const { fake, salon, clock, stop } = await setup();
  try {
    salon.pressRemote(1, 'my');
    await until(() => fake.sceneEvents.length === 1);
    const event = fake.sceneEvents[0];
    assert.equal(event.key, 'remote_pressed');
    assert.deepEqual(event.data, {
      device: SALON,
      device_name: 'Salon',
      button: 'my',
      remote_address: 424242,
    });
    assert.deepEqual(Object.keys(event.data).sort(), [...SCENE_TRIGGER_DATA.remote_pressed].sort());
    // The repeated frames of the same press.
    salon.pressRemote(1, 'my');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(fake.sceneEvents.length, 1);
    clock.advance(2000);
    salon.pressRemote(1, 'down');
    await until(() => fake.sceneEvents.length === 2);
    assert.equal(fake.sceneEvents[1].data.button, 'down');
    // A command sent through the API (a scene, Gladys) is "internal".
    ok(await fake.sceneAction('send_command', { device: SALON, command: 'my' }));
    ok(await setValue(fake, SALON, 'state', 1));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(fake.sceneEvents.length, 2);
  } finally {
    await stop();
  }
});

test('scene trigger: sun and wind of a sensor, on each change', async () => {
  const { fake, salon, stop } = await setup();
  try {
    salon.setWeather(2, { sunny: true });
    await until(() => fake.sceneEvents.length === 1);
    assert.deepEqual(fake.sceneEvents[0].data, {
      device: AWNING,
      device_name: 'Store terrasse',
      sensor: 'sun',
      state: 'on',
    });
    salon.setWeather(2, { sunny: true });
    salon.setWeather(2, { windy: true });
    await until(() => fake.sceneEvents.length === 2);
    assert.deepEqual(
      [fake.sceneEvents[1].data.sensor, fake.sceneEvents[1].data.state],
      ['wind', 'on'],
    );
  } finally {
    await stop();
  }
});

test('a controller lost then back: badges, triggers, status, states again', async () => {
  const { fake, app, network, bedroom, stop } = await setup();
  try {
    await bedroom.stop();
    await until(() => fake.sceneEvents.some((event) => event.key === 'controller_offline'));
    const offline = fake.sceneEvents.find((event) => event.key === 'controller_offline');
    assert.deepEqual(offline.data, { controller_name: 'somfy-etage', address: '10.0.0.7' });
    assert.equal(
      fake.transports.filter((item) => item.device_external_id === BEDROOM).at(-1).transport,
      'unreachable',
    );
    assert.equal(
      fake.transports.filter((item) => item.device_external_id === SALON).at(-1).transport,
      'local',
    );
    const widget = ok(
      await fake.widgetGet('shade', { settings: { device: BEDROOM }, language: 'fr' }),
    ).content;
    assert.deepEqual(validateWidgetContent(widget), []);
    assert.ok(JSON.stringify(widget).includes('Injoignable'));
    const failed = await setValue(fake, BEDROOM, 'state', 1);
    assert.match(failed.error, /Chambre : le contrôleur somfy-etage ne répond pas/);

    bedroom.shades[0].raw = 50;
    await bedroom.start();
    await until(() => fake.sceneEvents.some((event) => event.key === 'controller_online'));
    await until(async () => {
      await app.flushStates();
      return last(fake, BEDROOM, 'position') === 50;
    });
    assert.equal(
      fake.transports.filter((item) => item.device_external_id === BEDROOM).at(-1).transport,
      'local',
    );
    assert.ok(network.byHost('10.0.0.7'));
  } finally {
    await stop();
  }
});

test('scene actions: "My", steps, sun flag, groups, current position', async () => {
  const { fake, app, salon, stop } = await setup();
  try {
    ok(await fake.sceneAction('send_command', { device: SALON, command: 'my' }));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 1, command: 'my' });
    await settle(app);
    assert.equal(last(fake, SALON, 'position'), 40, 'the "My" position: 60 % down');

    ok(await fake.sceneAction('send_command', { device: SALON, command: 'step_open' }));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 1, command: 'stepup' });
    ok(await fake.sceneAction('send_command', { device: AWNING, command: 'step_open' }));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 2, command: 'stepdown' });
    ok(await fake.sceneAction('send_command', { device: AWNING, command: 'sun_flag_off' }));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 2, command: 'flag' });
    ok(await fake.sceneAction('send_command', { device: GROUND, command: 'open' }));
    assert.deepEqual(commands(salon).at(-1).body, { groupId: 1, command: 'up' });

    const noSensor = await fake.sceneAction('send_command', {
      device: SALON,
      command: 'sun_flag_on',
    });
    assert.equal(noSensor.success, false);
    assert.match(noSensor.error, /Salon n’a pas de capteur soleil/);
    const relay = await fake.sceneAction('send_command', { device: RELAY, command: 'open' });
    assert.match(relay.error, /Arrosage est un relais/);

    ok(await fake.sceneAction('set_current_position', { device: OFFICE, position: 25, tilt: 10 }));
    assert.deepEqual(commands(salon).at(-1), {
      method: 'PUT',
      path: '/setPositions',
      body: { shadeId: 3, position: 25, tiltPosition: 10 },
    });
    await settle(app);
    assert.equal(last(fake, OFFICE, 'position'), 25);
    assert.equal(last(fake, OFFICE, 'tilt'), 10);
    const gate = await fake.sceneAction('set_current_position', { device: GATE, position: 0 });
    assert.match(gate.error, /Portail n’a pas de position à régler/);
    const unknown = await fake.sceneAction('send_command', {
      device: shade(SALON_ID, 99),
      command: 'my',
    });
    assert.match(unknown.error, /inconnu de son contrôleur/);
  } finally {
    await stop();
  }
});

test('a tilt-only blind: its slats are its position, commands and corrections', async () => {
  const salon = salonController({
    shades: [{ shadeId: 9, name: 'Lames', shadeType: 1, tiltType: 3, tiltRaw: 100 }],
    groups: [],
  });
  const { fake, app, stop } = await setup({ controllers: [salon, bedroomController()] });
  const SLATS = shade(SALON_ID, 9);
  try {
    assert.deepEqual(keys(deviceOf(fake, SLATS)), ['state', 'position']);
    assert.equal(last(fake, SLATS, 'position'), 0, 'slats closed');
    ok(await setValue(fake, SLATS, 'position', 40));
    assert.deepEqual(commands(salon).at(-1), {
      method: 'PUT',
      path: '/tiltCommand',
      body: { shadeId: 9, target: 60 },
    });
    await settle(app);
    assert.equal(last(fake, SLATS, 'position'), 40);
    ok(await fake.sceneAction('set_current_position', { device: SLATS, position: 25 }));
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 9, tiltPosition: 75 });
    await settle(app);
    assert.equal(last(fake, SLATS, 'position'), 25);
  } finally {
    await stop();
  }
});

test('widgets: one shade with its buttons, a group, the overview, "My"', async () => {
  const { fake, app, salon, stop } = await setup();
  try {
    const get = async (key, device, language = 'fr') =>
      ok(await fake.widgetGet(key, { settings: { device }, language })).content;
    const office = await get('shade', OFFICE);
    assert.deepEqual(validateWidgetContent(office), []);
    const gauge = office.components.find((component) => component.type === 'gauge');
    assert.equal(gauge.device_feature, `${OFFICE}:position`);
    const buttons = office.components.filter((component) => component.type === 'button');
    assert.deepEqual(
      buttons.map((button) => button.device_feature ?? button.action.key),
      [`${OFFICE}:state`, 'my', `${OFFICE}:state`],
    );
    assert.ok(JSON.stringify(office).includes('Ouvert à 70 %'));

    const awning = await get('shade', AWNING, 'en');
    assert.deepEqual(validateWidgetContent(awning), []);
    assert.equal(
      awning.components.filter((component) => component.type === 'button').at(-1).device_feature,
      `${AWNING}:sun-flag`,
    );
    for (const device of [GATE, RELAY, GROUND, 'ext:test-integration:shade:a1b2c3-99']) {
      assert.deepEqual(validateWidgetContent(await get('shade', device)), [], device);
    }

    const overview = ok(await fake.widgetGet('overview', { settings: {}, language: 'fr' })).content;
    assert.deepEqual(validateWidgetContent(overview), []);
    const cards = overview.components.find((component) => component.type === 'card-list');
    assert.equal(cards.items.length, 7);
    assert.equal(cards.items[0].title, 'Salon');
    assert.equal(cards.items[0].subtitle.fr, 'Fermé');

    const toast = ok(
      await fake.widgetAction('shade', 'my', { device: SALON }, { settings: { device: SALON } }),
    );
    assert.equal(toast.message.fr, '« My » envoyé à Salon.');
    assert.deepEqual(commands(salon).at(-1).body, { shadeId: 1, command: 'my' });
    await settle(app);
    assert.equal(last(fake, SALON, 'position'), 40);
  } finally {
    await stop();
  }
});

test('overview: a firmware update is shown', async () => {
  const salon = salonController({ latest: 'v2.4.8' });
  const { fake, stop } = await setup({ controllers: [salon, bedroomController()] });
  try {
    const overview = ok(await fake.widgetGet('overview', { settings: {}, language: 'fr' })).content;
    assert.deepEqual(validateWidgetContent(overview), []);
    assert.ok(JSON.stringify(overview).includes('2.4.8 disponible'));
  } finally {
    await stop();
  }
});

test('configuration button: every controller, its shades and groups', async () => {
  const { fake, stop } = await setup({ create: false });
  try {
    const message = ok(await fake.action('test_connection', {})).message;
    assert.match(message.fr, /^2 contrôleur\(s\) trouvé\(s\) : /);
    assert.match(
      message.fr,
      /somfy-rdc \(192\.168\.1\.40, micrologiciel 2\.4\.7, 6 volet\(s\), 1 groupe\(s\)\)/,
    );
    assert.match(
      message.en,
      /somfy-etage \(10\.0\.0\.7, firmware 2\.4\.7, 1 shade\(s\), 0 group\(s\)\)/,
    );
  } finally {
    await stop();
  }
});

test('nothing on the network: the status and the button say so', async () => {
  const { fake, stop } = await setup({
    controllers: [],
    config: { language: 'en' },
    create: false,
  });
  try {
    assert.deepEqual(fake.discoveredDevices, []);
    assert.match(fake.connectionStatus.message.en, /No ESPSomfy RTS controller found yet/);
    const message = ok(await fake.action('test_connection', {})).message;
    assert.match(message.en, /No ESPSomfy RTS controller found/);
  } finally {
    await stop();
  }
});

test('restart: the controllers of /data and of the created devices connect without a scan', async () => {
  const storage = memoryStorage();
  const first = await setup({ storage });
  const devices = first.fake.discoveredDevices.map((device) => structuredClone(device));
  assert.ok(storage.files['controllers.json'][SALON_ID]);
  await first.stop();

  const { fake, app, stop } = await setup({ storage, devices, create: false });
  try {
    fake.devices = devices;
    await until(() => [...app.hub.entries.values()].every((entry) => entry.reachable));
    await app.flushStates();
    assert.equal(last(fake, SALON, 'position'), 0);
    assert.equal(last(fake, BEDROOM, 'position'), 100);
  } finally {
    await stop();
  }
});

test('a shade added in the web UI of the controller appears in Discover', async () => {
  const { fake, salon, stop } = await setup();
  try {
    salon.addShade({ shadeId: 7, name: 'Cuisine', shadeType: 0, raw: 100 });
    await until(() =>
      fake.discoveredDevices.some((device) => device.external_id === shade(SALON_ID, 7)),
    );
  } finally {
    await stop();
  }
});

test('the language of the configuration names the features', async () => {
  const { fake, stop } = await setup({ create: false });
  try {
    await fake.configUpdated({ ...CONFIG, language: 'de' });
    assert.equal(featureOf(deviceOf(fake, SALON), 'state').name, 'Öffnen / schließen');
    assert.equal(featureOf(deviceOf(fake, AWNING), 'sun-flag').name, 'Sonnensensor aktiv');
  } finally {
    await stop();
  }
});

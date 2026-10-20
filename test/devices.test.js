// Shades and groups -> Gladys devices, and the firmware conventions. The
// Discover tab pitfalls of the Gladys core are checked here: a single invalid
// feature makes the whole discovery list refused, a missing min / max /
// read_only / has_feedback only fails when the user clicks "Add", and a
// category/type pair the front does not label shows "Device (undefined)".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { normalizeConfig } from '../src/config.js';
import {
  buildGroupDevice,
  buildShadeDevice,
  groupCommandFor,
  shadeCommandFor,
  shadeValues,
} from '../src/devices.js';
import { parseHosts, ssdpHosts } from '../src/espsomfy/discovery.js';
import {
  coverState,
  isNewer,
  openness,
  parseSocketMessage,
  readDiscovery,
  readGroup,
  readShade,
  shadeKind,
  targetFor,
} from '../src/espsomfy/model.js';
import { createStatePublisher } from '../src/states.js';
import { fakeClock, salonController, silentLogger } from './helpers.js';

// Pairs labeled by the Gladys front (deviceFeatureCategory in
// front/src/config/i18n/en.json, checked on master 2026-10-20).
const LABELED = {
  shutter: new Set(['state', 'position']),
  curtain: new Set(['state', 'position']),
  switch: new Set(['binary']),
};

/** The controller entry the hub fills, from a fake controller. */
function entryOf(controller = salonController()) {
  const description = readDiscovery(controller.discovery());
  return { ...description, host: controller.host };
}

const allDevices = (gladys, entry, language) => [
  ...[...entry.shades.values()].map((shade) => buildShadeDevice(gladys, entry, shade, language)),
  ...[...entry.groups.values()].map((group) => buildGroupDevice(gladys, entry, group, language)),
];

test('every feature: labeled pair, bounds, read_only, has_feedback; no polling', () => {
  const gladys = createFakeGladys();
  for (const device of allDevices(gladys, entryOf(), 'en')) {
    assert.equal(device.should_poll, false, 'pushed over the socket');
    assert.equal(device.poll_frequency, undefined);
    for (const feature of device.features) {
      const where = feature.external_id;
      assert.ok(
        LABELED[feature.category]?.has(feature.type),
        `${where} ${feature.category}/${feature.type}`,
      );
      for (const field of ['min', 'max', 'read_only', 'has_feedback', 'keep_history']) {
        assert.notEqual(feature[field], undefined, `${where} ${field}`);
      }
      assert.ok(feature.min <= feature.max, where);
      assert.ok(feature.name.length > 0, where);
    }
  }
});

test('the whole discovery list is accepted by the fake Gladys, in every language', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  for (const language of ['en', 'fr', 'de', 'es']) {
    const devices = allDevices(gladys, entryOf(), language);
    const result = await gladys.publishDiscoveredDevices(devices);
    assert.equal(result.count, devices.length);
  }
});

test('discovery baseline (0.1.0): external ids and compared fields never change', () => {
  // Changing a feature key, category, type, unit, min, max or step forces
  // users to delete and recreate their devices: update the baseline only on
  // purpose (UPDATE_BASELINE=1 npm test), with a migration note in the docs.
  const file = new URL('./fixtures/discovery.baseline.json', import.meta.url);
  const gladys = createFakeGladys();
  const describe = (device) => ({
    external_id: device.external_id,
    should_poll: device.should_poll,
    features: device.features.map((feature) => ({
      external_id: feature.external_id,
      category: feature.category,
      type: feature.type,
      unit: feature.unit ?? null,
      min: feature.min,
      max: feature.max,
      step: feature.step ?? null,
      read_only: feature.read_only,
    })),
  });
  const current = allDevices(gladys, entryOf(), 'en').map(describe);
  if (process.env.UPDATE_BASELINE) {
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  }
  assert.deepEqual(current, JSON.parse(readFileSync(file, 'utf8')));
});

test('kinds: covers, curtains, one-button motors, relays', () => {
  const kinds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((type) =>
    shadeKind({ type }),
  );
  assert.deepEqual(kinds, [
    'shutter',
    'shutter',
    'curtain',
    'shutter',
    'shutter',
    'toggle',
    'shutter',
    'curtain',
    'curtain',
    'contact',
    'contact',
    'shutter',
    'shutter',
    'shutter',
    'toggle',
    'toggle',
    'toggle',
  ]);
});

test('positions: Gladys counts how open, the firmware how far down (flip, awning)', () => {
  const roller = { type: 0, flip: false };
  const flipped = { type: 0, flip: true };
  const awning = { type: 3, flip: false };
  const flippedAwning = { type: 3, flip: true };
  assert.equal(openness(0, roller), 100);
  assert.equal(openness(100, roller), 0);
  assert.equal(openness(30, roller), 70);
  assert.equal(openness(30, flipped), 30);
  assert.equal(openness(100, awning), 100, 'an awning out is open');
  assert.equal(openness(20, flippedAwning), 80);
  // The reverse conversion is the same function.
  for (const shade of [roller, flipped, awning, flippedAwning]) {
    for (const value of [0, 15, 50, 100]) {
      assert.equal(openness(targetFor(value, shade), shade), value);
    }
  }
  assert.equal(openness(140, roller), 0, 'clamped');
});

test('cover state: moving, open, closed, in between; tilt-only blinds', () => {
  const base = { type: 0, flip: false, tiltType: 0, direction: 0, tiltDirection: 0 };
  assert.equal(coverState({ ...base, position: 0 }), 1);
  assert.equal(coverState({ ...base, position: 100 }), -1);
  assert.equal(coverState({ ...base, position: 40 }), 0);
  assert.equal(coverState({ ...base, position: 40, direction: -1 }), 1, 'going up opens');
  assert.equal(coverState({ ...base, type: 3, position: 40, direction: -1 }), -1, 'awning in');
  const tiltOnly = { ...base, tiltType: 3, position: 0, tiltPosition: 100 };
  assert.equal(coverState(tiltOnly), -1, 'slats closed');
  assert.deepEqual(
    shadeValues(readShade({ shadeId: 1, shadeType: 1, tiltType: 3, tiltPosition: 100 })),
    [
      ['state', -1],
      ['position', 0],
    ],
  );
});

test('commands: the firmware requests of every feature', () => {
  const read = (json) => readShade({ shadeId: 4, name: 'X', direction: 0, ...json });
  const roller = read({ shadeType: 0, position: 100 });
  assert.deepEqual(shadeCommandFor(roller, 'state', 1).body, { shadeId: 4, command: 'up' });
  assert.deepEqual(shadeCommandFor(roller, 'state', -1).body, { shadeId: 4, command: 'down' });
  assert.equal(shadeCommandFor(roller, 'state', 0), null, 'still: nothing to stop');
  assert.deepEqual(shadeCommandFor({ ...roller, direction: 1 }, 'state', 0).body, {
    shadeId: 4,
    command: 'my',
  });
  assert.deepEqual(shadeCommandFor(roller, 'position', 25).body, { shadeId: 4, target: 75 });
  const tiltOnly = read({ shadeType: 1, tiltType: 3 });
  assert.deepEqual(shadeCommandFor(tiltOnly, 'position', 30), {
    path: 'tiltCommand',
    body: { shadeId: 4, target: 70 },
  });
  assert.deepEqual(shadeCommandFor(tiltOnly, 'state', 1).body, { shadeId: 4, target: 0 });
  const relay2 = read({ shadeType: 10, position: 0 });
  assert.deepEqual(shadeCommandFor(relay2, 'contact', 1).body, { shadeId: 4, command: 'up' });
  const relay = read({ shadeType: 9, position: 100 });
  assert.equal(shadeCommandFor(relay, 'contact', 1), null, 'already on');
  assert.throws(() => shadeCommandFor(roller, 'position', 101), RangeError);
  assert.throws(() => shadeCommandFor(roller, 'state', 2), RangeError);
  assert.throws(() => shadeCommandFor(roller, 'contact', 'x'), RangeError);

  const group = readGroup({ groupId: 2, name: 'G', linkedShades: [{ shadeId: 4 }] });
  assert.deepEqual(groupCommandFor(group, 'state', 1, [roller]).body, {
    groupId: 2,
    command: 'up',
  });
  const awning = read({ shadeType: 3 });
  assert.deepEqual(groupCommandFor(group, 'state', 1, [awning]).body, {
    groupId: 2,
    command: 'down',
  });
  assert.equal(groupCommandFor(group, 'state', 0, [roller]), null);
  assert.deepEqual(groupCommandFor(group, 'sun-flag', 0, []).body, { groupId: 2, command: 'flag' });
});

test('socket messages: socket.io-like frames without quotes', () => {
  assert.deepEqual(parseSocketMessage('42[shadeState,{"shadeId":1,"name":"A, B"}]'), {
    event: 'shadeState',
    data: { shadeId: 1, name: 'A, B' },
  });
  assert.equal(parseSocketMessage('Connected'), null);
  assert.equal(parseSocketMessage('42[broken,{]'), null);
  assert.equal(parseSocketMessage('42[noComma]'), null);
});

test('discovery: server id, firmware, rooms; groups as numbers or objects', () => {
  const entry = entryOf();
  assert.equal(entry.serverId, 'a1b2c3');
  assert.equal(entry.version, '2.4.7');
  assert.equal(entry.rooms.get(1), 'Séjour');
  assert.deepEqual(entry.groups.get(1).shadeIds, [1, 3]);
  assert.deepEqual(readGroup({ groupId: 1, shades: [3, 0, 255, 1] }).shadeIds, [3, 1]);
  assert.throws(() => readDiscovery({ model: 'nope' }), /server id/);
  assert.ok(isNewer('2.4.10', '2.4.9'));
  assert.ok(!isNewer('2.4.7', '2.4.7'));
  assert.ok(!isNewer('main', '2.4.7'));
});

test('SSDP: the answers for the ESPSomfy RTS device type only; typed addresses', () => {
  const answer = (ip, server, usn) => ({
    source_ip: ip,
    source_port: 1900,
    headers: `HTTP/1.1 200 OK\r\nSERVER: ${server}\r\nUSN: ${usn}\r\nST: ssdp:all\r\n\r\n`,
  });
  const esp = 'Arduino/1.0 UPnP/1.1 ESPSomfyRTS/2.0';
  assert.deepEqual(
    ssdpHosts([
      answer('192.168.1.40', esp, 'uuid:C2496952::upnp:rootdevice'),
      answer('192.168.1.40', esp, 'uuid:C2496952::urn:schemas-rstrouse-org:device:ESPSomfyRTS:1'),
      answer('192.168.1.42', 'other', 'uuid:x::urn:schemas-rstrouse-org:device:ESPSomfyRTS:1'),
      answer('192.168.1.60', 'Linux UPnP/1.0 TV/1.0', 'uuid:tv::upnp:rootdevice'),
      answer('fe80::1', esp, 'uuid:C2496952'),
      { source_ip: '192.168.1.41' },
    ]),
    ['192.168.1.40', '192.168.1.42'],
  );
  assert.deepEqual(parseHosts('192.168.1.40, 10.0.0.7;bad 300.1.1.1 192.168.1.40'), [
    '192.168.1.40',
    '10.0.0.7',
  ]);
  assert.deepEqual(normalizeConfig({ hosts: '10.0.0.7', rescan_interval: '15', language: 'de' }), {
    hosts: ['10.0.0.7'],
    rescanMs: 15 * 60 * 1000,
    language: 'de',
  });
  assert.equal(normalizeConfig({ rescan_interval: '7', language: 'it' }).language, 'en');
});

test('states: only the created devices, coalesced, paused on 429', async () => {
  const clock = fakeClock();
  const sent = [];
  let refuse = false;
  const gladys = {
    publishChangedStates: async (states) => {
      if (refuse) {
        throw Object.assign(new Error('too many'), { status: 429 });
      }
      sent.push(...states);
      return { count: states.length };
    },
    forgetPublishedStates() {},
  };
  const publisher = createStatePublisher(gladys, {
    logger: silentLogger,
    now: clock.now,
    isCreated: (id) => id === 'dev',
  });
  publisher.push('dev:position', 10);
  publisher.push('dev:position', 20);
  publisher.push('other:position', 30);
  await publisher.flush();
  assert.deepEqual(sent, [{ device_feature_external_id: 'dev:position', state: 20 }]);
  refuse = true;
  publisher.push('dev:state', 1);
  await publisher.flush();
  refuse = false;
  assert.equal(await publisher.flush(), 0, 'paused');
  clock.advance(31 * 1000);
  assert.equal(await publisher.flush(), 1);
  publisher.stop();
});

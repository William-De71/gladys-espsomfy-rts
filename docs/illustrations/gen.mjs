// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake ESPSomfy RTS controller of the tests (real local sockets),
// on a made-up sunny afternoon: the terrace awning is out, its sun sensor sees
// the sun, the bedroom shutter is closed.
// A gauge bound to a device feature shows the last published state, as the
// Gladys front does (the core fills it in from the feature).
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { memoryStorage } = await load('src/storage.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { FakeController, FakeNetwork } = await load('test/helpers.js');

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };

const NAMES = {
  living: { en: 'Living room', fr: 'Salon', de: 'Wohnzimmer', es: 'Salón' },
  terrace: {
    en: 'Terrace awning',
    fr: 'Store terrasse',
    de: 'Terrassenmarkise',
    es: 'Toldo terraza',
  },
  office: { en: 'Office blind', fr: 'Bureau', de: 'Büro-Jalousie', es: 'Estor despacho' },
  bedroom: { en: 'Bedroom', fr: 'Chambre', de: 'Schlafzimmer', es: 'Dormitorio' },
  kitchen: { en: 'Kitchen', fr: 'Cuisine', de: 'Küche', es: 'Cocina' },
  gate: { en: 'Gate', fr: 'Portail', de: 'Tor', es: 'Portón' },
};

/**
 * @description One language: the awning widget and the overview.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const name = (key) => NAMES[key][language];
  const controller = new FakeController({
    serverId: 'A1B2C3',
    host: '192.168.1.40',
    hostname: 'somfy-rdc',
    shades: [
      { shadeId: 1, name: name('living'), shadeType: 0, raw: 0, myRaw: 60 },
      {
        shadeId: 2,
        name: name('terrace'),
        shadeType: 3,
        raw: 65,
        myRaw: 50,
        sunSensor: true,
        flags: 0x01 | 0x20,
      },
      { shadeId: 3, name: name('office'), shadeType: 1, tiltType: 1, raw: 100, tiltRaw: 40 },
      { shadeId: 4, name: name('bedroom'), shadeType: 0, raw: 100 },
      { shadeId: 5, name: name('kitchen'), shadeType: 0, raw: 45 },
      { shadeId: 6, name: name('gate'), shadeType: 15, raw: 100 },
    ],
  });
  const network = await new FakeNetwork([controller]).start();
  const gladys = createFakeGladys({ config: { language } });
  gladys.scanNetwork = async () => network.ssdp();
  const app = createApp(gladys, {
    endpoints: network.endpoints,
    storage: memoryStorage(),
    logger: silent,
  });
  await gladys.connect();
  await app.start();
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  await app.flushStates();
  const awning = gladys.fake.discoveredDevices.find((device) =>
    device.external_id.endsWith('-2'),
  ).external_id;
  const get = async (key, settings) =>
    (await gladys.fake.widgetGet(key, { settings, language })).data.content;
  const shade = await get('shade', { device: awning });
  const overview = await get('overview', {});
  for (const component of shade.components) {
    if (component.type === 'gauge' && component.device_feature) {
      component.value = gladys.fake.lastState(component.device_feature);
      component.unit = '%';
    }
  }
  await app.stop();
  await network.stop();
  return { shade, overview };
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: { shade: card('shade'), overview: card('overview') },
  }),
);

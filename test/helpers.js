// Test helpers: a clock, a silent logger, waiting, and a fake LAN of
// ESPSomfy RTS controllers on real local sockets (test/helpers/fake-controller.js)
// that the integration reaches through its real code. Nothing leaves 127.0.0.1.

import { FakeController, FakeNetwork } from './helpers/fake-controller.js';

export { FakeController, FakeNetwork };

export const SALON_ID = 'a1b2c3';
export const BEDROOM_ID = 'd4e5f6';

export function fakeClock(start = Date.parse('2026-10-20T18:00:00Z')) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * @description Wait until a condition holds (real sockets take a few ms).
 * @param {Function} condition - `() => boolean`.
 * @param {number} [timeoutMs] - Give up after.
 * @returns {Promise<void>} Resolves when true, rejects on timeout.
 */
export async function until(condition, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The controller of the ground floor: one shade of every kind, a group. */
export const salonController = (options = {}) =>
  new FakeController({
    serverId: 'A1B2C3',
    host: '192.168.1.40',
    hostname: 'somfy-rdc',
    rooms: [{ roomId: 1, name: 'Séjour', sortOrder: 0 }],
    shades: [
      // Closed roller shutter, "My" at 60 % down (40 % open).
      { shadeId: 1, name: 'Salon', roomId: 1, shadeType: 0, raw: 100, myRaw: 60 },
      // Retracted awning with a Somfy sun and wind sensor.
      { shadeId: 2, name: 'Store terrasse', shadeType: 3, raw: 0, sunSensor: true },
      // Venetian blind with a tilt motor, "flip position" on.
      {
        shadeId: 3,
        name: 'Bureau',
        shadeType: 1,
        tiltType: 1,
        flipPosition: true,
        raw: 30,
        tiltRaw: 50,
      },
      // Open drapery.
      { shadeId: 4, name: 'Rideau', shadeType: 2, raw: 0 },
      // One-button gate, closed.
      { shadeId: 5, name: 'Portail', shadeType: 15, raw: 100 },
      // Dry contact (relay), off.
      { shadeId: 6, name: 'Arrosage', shadeType: 9, raw: 0 },
    ],
    groups: [{ groupId: 1, name: 'Rez-de-chaussée', linkedShades: [1, 3] }],
    ...options,
  });

/** A controller on another subnet: typed in the configuration, no SSDP. */
export const bedroomController = (options = {}) =>
  new FakeController({
    serverId: 'D4E5F6',
    host: '10.0.0.7',
    hostname: 'somfy-etage',
    shades: [{ shadeId: 1, name: 'Chambre', shadeType: 0, raw: 0 }],
    ...options,
  });

// -----------------------------------------------------------------------------
// Integration configuration: the `config_schema` values of the manifest,
// normalized so the rest of the code never deals with strings from a form or
// `undefined`.
// -----------------------------------------------------------------------------

import { parseHosts } from './espsomfy/discovery.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
export const RESCAN_INTERVALS = [0, 15, 60];

// Defaults: they MUST stay consistent with the `default` values of the
// manifest `config_schema` (test/manifest.test.js checks it).
export const DEFAULTS = {
  hosts: '',
  rescan_interval: '60',
  language: 'en',
};

const pick = (value, allowed, fallback) => {
  const number = Number(value ?? fallback);
  return allowed.includes(number) ? number : Number(fallback);
};

/**
 * @description Normalize the raw configuration.
 * @param {object} raw - `gladys.config` or the `onConfigUpdated` payload.
 * @returns {{ hosts: string[], rescanMs: number, language: string }} The configuration.
 */
export function normalizeConfig(raw = {}) {
  return {
    hosts: parseHosts(raw.hosts ?? DEFAULTS.hosts),
    rescanMs: pick(raw.rescan_interval, RESCAN_INTERVALS, DEFAULTS.rescan_interval) * 60 * 1000,
    language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULTS.language,
  };
}

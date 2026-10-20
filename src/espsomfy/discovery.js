// -----------------------------------------------------------------------------
// Finding the controllers on the local network.
//
// An ESPSomfy RTS controller answers SSDP (the "SSDP broadcast" option of its
// web page, on by default). It also announces the mDNS service
// `_espsomfy_rts._tcp`, but neither the store nor the Gladys core accept an
// underscore in a service name (RFC 6763): SSDP it is.
//
// The search target is `ssdp:all`: to an M-SEARCH for its own device type
// (`urn:schemas-rstrouse-org:device:ESPSomfyRTS:1`) the firmware answers to
// the multicast group (SSDP.cpp), which the one-shot socket of the core
// never hears; to `ssdp:all` it answers to the sender. The answers of the
// other devices of the network are dropped here: an ESPSomfy RTS answer
// says `SERVER: Arduino/1.0 UPnP/1.1 ESPSomfyRTS/2.0`, and the USN of one
// of them names the device type.
//
// The integration container sits behind the Docker bridge, where multicast
// never reaches the LAN: the M-SEARCH goes through the mediated scan of
// Gladys (the core sends it on the host network and relays the raw
// answers). The answer gives the address only; `GET /discovery` on it then
// gives the server id.
//
// The addresses typed in the configuration are tried directly: controllers
// on another subnet, a network that filters multicast, SSDP turned off.
// -----------------------------------------------------------------------------

export const SSDP_ST = 'ssdp:all';
export const DEVICE_TYPE = 'urn:schemas-rstrouse-org:device:ESPSomfyRTS:1';
// MX of the M-SEARCH: the firmware answers after 0 to MX - 2 s.
export const SCAN_SECONDS = 5;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export const isIpv4 = (value) =>
  IPV4.test(String(value)) &&
  String(value)
    .split('.')
    .every((octet) => Number(octet) <= 255);

/**
 * @description The controllers of an SSDP scan: the addresses whose answers
 * come from ESPSomfy RTS.
 * @param {Array} results - `scanNetwork('ssdp')` results.
 * @returns {string[]} IPv4 addresses, deduplicated.
 */
export function ssdpHosts(results) {
  const hosts = new Set();
  for (const result of Array.isArray(results) ? results : []) {
    const headers = String(result?.headers ?? '');
    // The core relays every answer to the M-SEARCH: keep those of ESPSomfy RTS.
    const server = /^SERVER:\s*(.+?)\s*$/im.exec(headers)?.[1] ?? '';
    const usn = /^USN:\s*(.+?)\s*$/im.exec(headers)?.[1] ?? '';
    const ours = /\bESPSomfyRTS\//i.test(server) || usn.includes(DEVICE_TYPE);
    if (ours && isIpv4(result.source_ip)) {
      hosts.add(result.source_ip);
    }
  }
  return [...hosts];
}

/**
 * @description Run the mediated SSDP scan.
 * @param {object} gladys - SDK client.
 * @param {object} [options] - `{ logger, timeoutSeconds }`.
 * @returns {Promise<{ hosts: string[], error: string|null }>} The addresses
 * found and why the scan failed, if it did.
 */
export async function ssdpScan(gladys, { logger, timeoutSeconds = SCAN_SECONDS } = {}) {
  try {
    const results = await gladys.scanNetwork('ssdp', { timeoutSeconds });
    return { hosts: ssdpHosts(results), error: null };
  } catch (error) {
    if (error?.status === 403) {
      logger?.warn(
        'ESPSomfy RTS: Gladys refused the network scan (reinstall the integration to accept its network discovery)',
      );
      return { hosts: [], error: 'forbidden' };
    }
    if (error?.status === 429 || error?.status === 409) {
      return { hosts: [], error: 'busy' };
    }
    logger?.warn(`ESPSomfy RTS: network scan failed: ${error?.message ?? error}`);
    return { hosts: [], error: 'failed' };
  }
}

/**
 * @description Parse the addresses typed in the configuration.
 * @param {string} value - `192.168.1.20, 192.168.1.21`.
 * @returns {string[]} The valid IPv4 addresses, deduplicated.
 */
export function parseHosts(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter(isIpv4),
    ),
  ];
}

# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the Somfy RTS motors driven by
an **ESPSomfy RTS** controller (an ESP32 with a 433 MHz radio, firmware
[rstrouse/ESPSomfy-RTS](https://github.com/rstrouse/ESPSomfy-RTS)): a Node.js
service (Node 22+, ESM, no build step; dependencies: the SDK and `ws`) in its
own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the controllers **on the local network only** (`transports: ["local"]`).

A **device integration** (`type: "device"`, Gladys 5.1.0+: widgets and
scenes). The client in `src/espsomfy/` was written from the source code of the
firmware (`Web.cpp`, `Sockets.cpp`, `Somfy.cpp`, `SSDP.cpp`) and of its
[Home Assistant integration](https://github.com/rstrouse/ESPSomfy-RTS-HA),
both in the public domain (The Unlicense).

## Commands

```bash
npm install
npm test                                  # node --test, never leaves 127.0.0.1
node --test test/app.test.js              # one file
node --test --test-name-pattern "widgets" # tests whose name matches
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check
docs/illustrations/render.sh              # widget illustrations (Chrome, ImageMagick, Pillow)
scripts/build-cover.sh                    # cover.jpg from cover.svg (Inkscape, ImageMagick)
```

## Architecture

```
index.js                     SDK wiring only: createApp(gladys) + connect + start
src/app.js                   every handler: discovery, commands, scene events and actions, widgets, status
src/hub.js                   the controllers: /discovery, socket, events -> entries, reconnection
src/devices.js               shade / group -> Gladys device (features), values, firmware requests
src/states.js                state publication: created devices only, coalesced, 240/min, 429 pause
src/scenes.js                scene trigger / action keys, event data, remote buttons, commands
src/widgets.js               the `shade` and `overview` widgets (pure, reused by docs/illustrations)
src/i18n.js                  runtime texts in en / fr / de / es
src/storage.js               JSON file in /data (controllers.json)
src/config.js                config_schema -> { hosts, rescanMs, language }
src/espsomfy/client.js       HTTP API (:8081) and socket (:8080, ping) of a controller
src/espsomfy/model.js        firmware JSON -> shades, groups; positions, states, socket frames
src/espsomfy/discovery.js    mediated SSDP scan, typed addresses
test/helpers/                fake controller (real HTTP server + ws server) and fake LAN
.github/scripts/release.mjs  version, changelog, version files, PR title checks
```

## Rules

- **External ids are forever**: `ext:{selector}:shade:{server id}-{shade id}`
  and `ext:{selector}:group:{server id}-{group id}` (server id lowercased),
  `…:<feature key>` (`state`, `position`, `tilt`, `contact`, `sun-flag`).
  Config, action, field, widget, trigger, variable, output keys and the select
  values (`up`, `down`, `my`…, `sun`, `wind`, `on`, `off`, `open`,
  `step_open`, `sun_flag_on`…) too.
- **Positions**: Gladys counts how open (0 % closed); the firmware counts how
  far down (an awning: how far out), and reports `100 - x` with "flip
  position". `openness()` converts both ways; never change it without the
  baseline of the Home Assistant integration in mind (same numbers for users).
- **Feature fields** compared by the Discover "Update" (category, type, unit,
  min, max, step, features added or removed): the baseline pins them.
- **No polling**: the controller pushes over its socket; `/discovery` is read
  when connecting, after a structure event (`shadeAdded`…) and by the scans.
- **Scene events**: one per transition or press; `remote_pressed` only for
  `source: "remote"` (the frames the controller sends itself are `internal`),
  deduplicated 1.5 s per shade and button.
- **Stop**: "My" stops a moving motor but sends a still one to its favourite
  position: the `state` 0 command is sent only while the shade moves.
- **The container rootfs is read-only**: the only writable folder is /data.
- **Widget content**: after any change, run `docs/illustrations/render.sh` and
  look at the four images. Budget: 2 texts, 1 focal, 6 tiles, 1 status, 4
  buttons.
- **User-facing text** exists in en, fr, de and es: manifest, `src/i18n.js`,
  `docs/*.md`, `README*.md`. `test/i18n.test.js` checks it.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, `package-lock.json` or the manifest, nor the `docker_image`
  tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English.

## Pitfalls

- The firmware announces the mDNS service `_espsomfy_rts._tcp`, but the store
  and the Gladys core refuse an underscore in a service name: discovery is an
  SSDP M-SEARCH (its "SSDP broadcast" option, on by default), then
  `GET /discovery` for the id. The search target is `ssdp:all`: the firmware
  answers a search for its own device type to the multicast group, never
  heard by the core; the answers are filtered on `SERVER: … ESPSomfyRTS/2.0`
  or on the device type in the USN.
- `parseMdnsTxt` of the SDK lowercases the TXT keys (`serverId` → `serverid`),
  in case mDNS comes back one day.
- The socket frames have no quotes around the event: `42[shadeState,{…}]`;
  the first message is the text `Connected`; a new client gets the state of
  every shade and group.
- The HTTP API answers errors as HTTP 500 `{"status":"ERROR","desc":"…"}`; it
  has no authentication even when a PIN protects the web page (`isAuthenticated`
  is never called in 2.4.7).
- A group has no position nor direction: its `state` has no feedback, "stop"
  is sent only when one of its shades moves.
- One-button motors (garage1, gates1) only understand "toggle": open / close
  press it only when the state differs.
- Gladys does not send the user's language with a scan or a command: feature
  names and scene errors use the `language` setting.
- Never tested on a real controller: when a user reports a difference, fix the
  fake controller in `test/helpers/` first, then the code.

// -----------------------------------------------------------------------------
// Runtime texts, in the four languages of the Gladys UI.
//
// `t(key, vars)` returns a multi-language object `{ en, fr, de, es }`
// (configuration button, widgets, connection status); `text(key, language,
// vars)` returns one string (feature names, scene action errors: Gladys does
// not send the language of the user with a scan, a command or a scene
// action, see `language` in config.js).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const MESSAGES = {
  // --- Feature names -----------------------------------------------------------
  feature_state: {
    en: 'Open / close',
    fr: 'Ouvrir / fermer',
    de: 'Öffnen / schließen',
    es: 'Abrir / cerrar',
  },
  feature_position: { en: 'Position', fr: 'Position', de: 'Position', es: 'Posición' },
  feature_tilt: { en: 'Slats', fr: 'Lames', de: 'Lamellen', es: 'Lamas' },
  feature_contact: { en: 'Relay', fr: 'Relais', de: 'Relais', es: 'Relé' },
  'feature_sun-flag': {
    en: 'Sun sensor active',
    fr: 'Capteur soleil actif',
    de: 'Sonnensensor aktiv',
    es: 'Sensor de sol activo',
  },

  // --- Connection status (Integrations page) -----------------------------------
  statusConnected: {
    en: '{count} of {total} ESPSomfy RTS controller(s) connected, {shades} shade(s).',
    fr: '{count} contrôleur(s) ESPSomfy RTS sur {total} connecté(s), {shades} volet(s).',
    de: '{count} von {total} ESPSomfy-RTS-Controller(n) verbunden, {shades} Antrieb(e).',
    es: '{count} de {total} controlador(es) ESPSomfy RTS conectado(s), {shades} persiana(s).',
  },
  statusNoController: {
    en: 'No ESPSomfy RTS controller found yet. Type its address in the configuration if the search does not find it.',
    fr: 'Aucun contrôleur ESPSomfy RTS trouvé pour l’instant. Saisissez son adresse dans la configuration si la recherche ne le trouve pas.',
    de: 'Noch kein ESPSomfy-RTS-Controller gefunden. Geben Sie seine Adresse in der Konfiguration ein, falls die Suche ihn nicht findet.',
    es: 'Aún no se ha encontrado ningún controlador ESPSomfy RTS. Escriba su dirección en la configuración si la búsqueda no lo encuentra.',
  },
  statusAllOff: {
    en: 'No ESPSomfy RTS controller answers: powered and on the network?',
    fr: 'Aucun contrôleur ESPSomfy RTS ne répond : alimenté et sur le réseau ?',
    de: 'Kein ESPSomfy-RTS-Controller antwortet: Strom und Netzwerk vorhanden?',
    es: 'Ningún controlador ESPSomfy RTS responde: ¿alimentado y en la red?',
  },
  statusScanForbidden: {
    en: 'Gladys refused the network search: reinstall the integration and accept its network discovery, or type the address of the controller.',
    fr: 'Gladys a refusé la recherche réseau : réinstallez l’intégration en acceptant sa découverte réseau, ou saisissez l’adresse du contrôleur.',
    de: 'Gladys hat die Netzwerksuche abgelehnt: Installieren Sie die Integration neu und erlauben Sie die Netzwerkerkennung, oder geben Sie die Adresse des Controllers ein.',
    es: 'Gladys rechazó la búsqueda en la red: reinstale la integración aceptando su detección de red, o escriba la dirección del controlador.',
  },

  // --- Configuration button ----------------------------------------------------
  testOk: {
    en: '{count} controller(s) found: {list}.',
    fr: '{count} contrôleur(s) trouvé(s) : {list}.',
    de: '{count} Controller gefunden: {list}.',
    es: '{count} controlador(es) encontrado(s): {list}.',
  },
  testNone: {
    en: 'No ESPSomfy RTS controller found. Check that it is powered and on the same network as Gladys, or type its address in the configuration.',
    fr: 'Aucun contrôleur ESPSomfy RTS trouvé. Vérifiez qu’il est alimenté et sur le même réseau que Gladys, ou saisissez son adresse dans la configuration.',
    de: 'Kein ESPSomfy-RTS-Controller gefunden. Prüfen Sie, ob er Strom hat und im selben Netzwerk wie Gladys ist, oder geben Sie seine Adresse in der Konfiguration ein.',
    es: 'No se ha encontrado ningún controlador ESPSomfy RTS. Compruebe que está alimentado y en la misma red que Gladys, o escriba su dirección en la configuración.',
  },
  testFirmware: { en: 'firmware', fr: 'micrologiciel', de: 'Firmware', es: 'firmware' },
  testCounts: {
    en: '{shades} shade(s), {groups} group(s)',
    fr: '{shades} volet(s), {groups} groupe(s)',
    de: '{shades} Antrieb(e), {groups} Gruppe(n)',
    es: '{shades} persiana(s), {groups} grupo(s)',
  },
  testUnreachable: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },

  // --- Errors (scene actions, commands) ----------------------------------------
  errorUnknownDevice: {
    en: 'This shade is unknown to its ESPSomfy RTS controller: run a search in the Discover tab.',
    fr: 'Ce volet est inconnu de son contrôleur ESPSomfy RTS : lancez une recherche dans l’onglet Découverte.',
    de: 'Dieser Antrieb ist seinem ESPSomfy-RTS-Controller unbekannt: Starten Sie eine Suche im Tab Erkennung.',
    es: 'Esta persiana es desconocida para su controlador ESPSomfy RTS: lance una búsqueda en la pestaña Descubrir.',
  },
  errorRefused: {
    en: 'The controller refused the command for {name}: {error}',
    fr: 'Le contrôleur a refusé la commande pour {name} : {error}',
    de: 'Der Controller hat den Befehl für {name} abgelehnt: {error}',
    es: 'El controlador rechazó la orden para {name}: {error}',
  },
  errorUnreachable: {
    en: '{name}: the controller {controller} does not answer ({error}).',
    fr: '{name} : le contrôleur {controller} ne répond pas ({error}).',
    de: '{name}: Der Controller {controller} antwortet nicht ({error}).',
    es: '{name}: el controlador {controller} no responde ({error}).',
  },
  errorValue: {
    en: 'Value not supported: {value}',
    fr: 'Valeur non prise en charge : {value}',
    de: 'Wert nicht unterstützt: {value}',
    es: 'Valor no admitido: {value}',
  },
  errorNoSunSensor: {
    en: '{name} has no sun sensor.',
    fr: '{name} n’a pas de capteur soleil.',
    de: '{name} hat keinen Sonnensensor.',
    es: '{name} no tiene sensor de sol.',
  },
  errorNotACover: {
    en: '{name} is a relay, not a shade: use its device feature.',
    fr: '{name} est un relais, pas un volet : utilisez sa fonctionnalité d’appareil.',
    de: '{name} ist ein Relais, kein Antrieb: Nutzen Sie seine Gerätefunktion.',
    es: '{name} es un relé, no una persiana: use su función de dispositivo.',
  },
  errorNoPosition: {
    en: '{name} has no position to set.',
    fr: '{name} n’a pas de position à régler.',
    de: '{name} hat keine einstellbare Position.',
    es: '{name} no tiene posición que ajustar.',
  },

  // --- Widgets: states ---------------------------------------------------------
  stateUnreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  stateOn: { en: 'On', fr: 'Allumé', de: 'Ein', es: 'Encendido' },
  stateOff: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  stateGroup: {
    en: 'Group of {count}',
    fr: 'Groupe de {count}',
    de: 'Gruppe aus {count}',
    es: 'Grupo de {count}',
  },
  stateOpening: { en: 'Opening…', fr: 'Ouverture…', de: 'Öffnet…', es: 'Abriendo…' },
  stateClosing: { en: 'Closing…', fr: 'Fermeture…', de: 'Schließt…', es: 'Cerrando…' },
  stateOpen: { en: 'Open', fr: 'Ouvert', de: 'Offen', es: 'Abierta' },
  stateClosed: { en: 'Closed', fr: 'Fermé', de: 'Geschlossen', es: 'Cerrada' },
  stateOpenAt: {
    en: 'Open {position} %',
    fr: 'Ouvert à {position} %',
    de: 'Zu {position} % offen',
    es: 'Abierta al {position} %',
  },
  statePartly: { en: 'Partly open', fr: 'Entrouvert', de: 'Teilweise offen', es: 'Entreabierta' },
  stateStopped: { en: 'Stopped', fr: 'Arrêté', de: 'Gestoppt', es: 'Detenida' },

  // --- Widgets: labels and buttons ---------------------------------------------
  widgetChooseDevice: {
    en: 'Choose a shade or a group in the settings of this widget.',
    fr: 'Choisissez un volet ou un groupe dans les réglages de ce widget.',
    de: 'Wählen Sie einen Antrieb oder eine Gruppe in den Einstellungen dieses Widgets.',
    es: 'Elija una persiana o un grupo en los ajustes de este widget.',
  },
  widgetOpen: { en: 'Open', fr: 'Ouverture', de: 'Öffnung', es: 'Apertura' },
  widgetOpenCurtain: { en: 'Open', fr: 'Ouverture', de: 'Öffnung', es: 'Apertura' },
  widgetState: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  widgetMy: {
    en: '“My” position',
    fr: 'Position « My »',
    de: '„My“-Position',
    es: 'Posición «My»',
  },
  widgetTilt: { en: 'Slats', fr: 'Lames', de: 'Lamellen', es: 'Lamas' },
  widgetSun: { en: 'Sun', fr: 'Soleil', de: 'Sonne', es: 'Sol' },
  widgetWind: { en: 'Wind', fr: 'Vent', de: 'Wind', es: 'Viento' },
  widgetSunFlag: {
    en: 'Sun sensor',
    fr: 'Capteur soleil',
    de: 'Sonnensensor',
    es: 'Sensor de sol',
  },
  yes: { en: 'Detected', fr: 'Détecté', de: 'Erkannt', es: 'Detectado' },
  no: { en: 'No', fr: 'Non', de: 'Nein', es: 'No' },
  sunFlagOn: { en: 'Active', fr: 'Actif', de: 'Aktiv', es: 'Activo' },
  sunFlagOff: { en: 'Ignored', fr: 'Ignoré', de: 'Ignoriert', es: 'Ignorado' },
  widgetOffline: {
    en: 'The controller does not answer.',
    fr: 'Le contrôleur ne répond pas.',
    de: 'Der Controller antwortet nicht.',
    es: 'El controlador no responde.',
  },
  widgetOpenButton: { en: 'Open', fr: 'Ouvrir', de: 'Öffnen', es: 'Abrir' },
  widgetClose: { en: 'Close', fr: 'Fermer', de: 'Schließen', es: 'Cerrar' },
  widgetMyButton: { en: 'My', fr: 'My', de: 'My', es: 'My' },
  widgetTurnOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  widgetTurnOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  widgetSunFlagOn: {
    en: 'Sun sensor on',
    fr: 'Activer le soleil',
    de: 'Sonne aktivieren',
    es: 'Activar el sol',
  },
  widgetSunFlagOff: {
    en: 'Sun sensor off',
    fr: 'Ignorer le soleil',
    de: 'Sonne ignorieren',
    es: 'Ignorar el sol',
  },
  widgetWifi: {
    en: 'Online · Wi-Fi {strength} dBm',
    fr: 'En ligne · Wi-Fi {strength} dBm',
    de: 'Online · WLAN {strength} dBm',
    es: 'En línea · Wi-Fi {strength} dBm',
  },
  widgetEthernet: {
    en: 'Online · Ethernet',
    fr: 'En ligne · Ethernet',
    de: 'Online · Ethernet',
    es: 'En línea · Ethernet',
  },
  widgetOnline: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  widgetNoController: {
    en: 'No ESPSomfy RTS controller found yet.',
    fr: 'Aucun contrôleur ESPSomfy RTS trouvé pour l’instant.',
    de: 'Noch kein ESPSomfy-RTS-Controller gefunden.',
    es: 'Aún no se ha encontrado ningún controlador ESPSomfy RTS.',
  },
  widgetNoShade: {
    en: 'No shade added yet: Integrations → ESPSomfy RTS → Discover.',
    fr: 'Aucun volet ajouté : Intégrations → ESPSomfy RTS → Découverte.',
    de: 'Noch kein Antrieb hinzugefügt: Integrationen → ESPSomfy RTS → Erkennung.',
    es: 'Ninguna persiana añadida: Integraciones → ESPSomfy RTS → Descubrir.',
  },
  widgetSummary: {
    en: '{open} open out of {total}',
    fr: '{open} ouvert(s) sur {total}',
    de: '{open} von {total} offen',
    es: '{open} abierta(s) de {total}',
  },
  widgetFirmware: { en: 'Firmware', fr: 'Micrologiciel', de: 'Firmware', es: 'Firmware' },
  widgetUpdate: {
    en: '{version} available',
    fr: '{version} disponible',
    de: '{version} verfügbar',
    es: '{version} disponible',
  },
  widgetDone: {
    en: '“My” sent to {name}.',
    fr: '« My » envoyé à {name}.',
    de: '„My“ an {name} gesendet.',
    es: '«My» enviado a {name}.',
  },
};

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
  );
}

/**
 * @description A runtime text in the four languages.
 * @param {string} key - Message key.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function t(key, vars = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, text(key, language, vars)]));
}

/**
 * @description A runtime text in one language (English when unknown).
 * @param {string} key - Message key.
 * @param {string} language - Language code.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {string} The text.
 */
export function text(key, language, vars = {}) {
  const message = MESSAGES[key];
  if (!message) {
    throw new Error(`Unknown message ${key}`);
  }
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const resolved = Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, pick(value, lang)]),
  );
  return fill(message[lang], resolved);
}

/**
 * @description One language of a value that may be multi-language.
 * @param {*} value - A string, a number or `{ en, fr, ... }`.
 * @param {string} language - Language code.
 * @returns {*} The value in that language.
 */
export function pick(value, language) {
  if (value && typeof value === 'object') {
    return value[language] ?? value.en;
  }
  return value;
}

/**
 * @description Cut a text to a maximum length, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - Maximum length.
 * @returns {string} The text, at most `max` characters.
 */
export function truncate(value, max) {
  const string = String(value ?? '');
  return string.length <= max ? string : `${string.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @description Cut every language of a multi-language text.
 * @param {object} message - `{ en, fr, ... }`.
 * @param {number} max - Maximum length.
 * @returns {object} The message.
 */
export function truncateAll(message, max) {
  return Object.fromEntries(
    Object.entries(message).map(([language, value]) => [language, truncate(value, max)]),
  );
}

export const MESSAGE_KEYS = Object.keys(MESSAGES);
export const MESSAGES_FOR_TESTS = MESSAGES;

// -----------------------------------------------------------------------------
// Scene triggers and actions (manifest `scene_triggers`, `scene_actions`).
//
// Triggers: one event per transition, never a snapshot.
//
//   remote_pressed       a Somfy remote (or wall switch, or Situo) paired
//                        with a shade was pressed: the controller hears the
//                        radio frame. The press of a button, not a state:
//                        "My" on the living-room remote can start a scene.
//   sun_wind_changed     the Somfy sun and wind sensor of a motor says sun
//                        or wind came, or went
//   controller_offline   a controller stopped answering for a minute
//   controller_online    it answers again (after an offline event only)
//
// Actions: operations with parameters, which a device feature cannot carry.
//
//   send_command          "My" (favourite position), a step, the sun flag…
//                         to a shade or a group
//   set_current_position  tell the controller where a shade really is,
//                         without moving it (after a remote it does not hear)
//
// A scene action goes out through the controller itself: the radio frames it
// sends are "internal", never a remote press, so no action triggers a scene.
// -----------------------------------------------------------------------------

export const SCENE_TRIGGERS = {
  REMOTE_PRESSED: 'remote_pressed',
  SUN_WIND_CHANGED: 'sun_wind_changed',
  CONTROLLER_OFFLINE: 'controller_offline',
  CONTROLLER_ONLINE: 'controller_online',
};

// The data keys of each event, as declared in the manifest (fields and variables).
export const SCENE_TRIGGER_DATA = {
  [SCENE_TRIGGERS.REMOTE_PRESSED]: ['device', 'device_name', 'button', 'remote_address'],
  [SCENE_TRIGGERS.SUN_WIND_CHANGED]: ['device', 'device_name', 'sensor', 'state'],
  [SCENE_TRIGGERS.CONTROLLER_OFFLINE]: ['controller_name', 'address'],
  [SCENE_TRIGGERS.CONTROLLER_ONLINE]: ['controller_name', 'address'],
};

// Button names of the firmware (`translateSomfyCommand`) -> filter values.
// Stored by the scenes: permanent.
export const REMOTE_BUTTONS = {
  Up: 'up',
  Down: 'down',
  My: 'my',
  'My+Up': 'my_up',
  'My+Down': 'my_down',
  'Up+Down': 'up_down',
  'My+Up+Down': 'my_up_down',
  Prog: 'prog',
  'Step Up': 'step_up',
  'Step Down': 'step_down',
  Toggle: 'toggle',
  Favorite: 'favorite',
  Stop: 'stop',
};
export const REMOTE_BUTTON_VALUES = [...new Set(Object.values(REMOTE_BUTTONS))];

export const SENSOR_VALUES = ['sun', 'wind'];
export const SENSOR_STATES = ['on', 'off'];

export const SCENE_ACTIONS = {
  SEND_COMMAND: 'send_command',
  SET_CURRENT_POSITION: 'set_current_position',
};

// The outputs each action returns, as declared in the manifest.
export const SCENE_ACTION_OUTPUTS = {
  [SCENE_ACTIONS.SEND_COMMAND]: [],
  [SCENE_ACTIONS.SET_CURRENT_POSITION]: [],
};

// Values of the command select of `send_command` -> firmware command, and
// whether it needs a group-capable target. Stored by the scenes: permanent.
export const SEND_COMMANDS = {
  my: 'my',
  open: 'open',
  close: 'close',
  step_open: 'step_open',
  step_close: 'step_close',
  sun_flag_on: 'sunflag',
  sun_flag_off: 'flag',
};
export const SEND_COMMAND_VALUES = Object.keys(SEND_COMMANDS);

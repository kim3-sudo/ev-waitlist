// The two EVSE profiles the simulator can act as, and the OCPP 1.6J messages each
// one answers (see https://ocpp.md/ocpp-1.6j/ for the message reference).
//
// The Core profile is mandatory for every OCPP 1.6J charge point, so the basic EVSE
// answers all of it. The full-featured EVSE also answers the optional feature
// profiles. Any other message gets a NotSupported (or NotImplemented) error back.

export const DEFAULT_PROFILE = 'basic';

export const PROFILES = {
  basic: {
    label: 'Basic EVSE',
    summary:
      'Core profile only, the minimum every OCPP 1.6J charge point supports. Status, faults and charging are set by hand, and no meter values are sent.',
    // Reported in SupportedFeatureProfiles.
    featureProfiles: 'Core',
  },
  full: {
    label: 'Full-featured EVSE',
    summary:
      'Core plus the optional feature profiles: meter values while charging, automatic status changes, faults, reservations, charging profiles, a local authorization list, firmware and diagnostics, and triggered messages.',
    featureProfiles: 'Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger',
  },
};

// Messages the central system sends to a charge point, in the Core profile.
const CORE_MESSAGES = [
  'ChangeAvailability',
  'ChangeConfiguration',
  'ClearCache',
  'DataTransfer',
  'GetConfiguration',
  'RemoteStartTransaction',
  'RemoteStopTransaction',
  'Reset',
  'UnlockConnector',
];

// Messages from the optional feature profiles that the full-featured EVSE answers.
const FULL_MESSAGES = [
  // Reservation
  'ReserveNow',
  'CancelReservation',
  // LocalAuthListManagement
  'SendLocalList',
  'GetLocalListVersion',
  // FirmwareManagement
  'UpdateFirmware',
  'GetDiagnostics',
  // RemoteTrigger
  'TriggerMessage',
  // SmartCharging
  'SetChargingProfile',
  'ClearChargingProfile',
  'GetCompositeSchedule',
];

export const PROFILE_MESSAGES = {
  basic: new Set(CORE_MESSAGES),
  full: new Set([...CORE_MESSAGES, ...FULL_MESSAGES]),
};

export function isProfile(name) {
  return Object.hasOwn(PROFILES, name);
}

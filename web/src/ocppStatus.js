// OCPP 1.6 ChargePointStatus values (connector status), with human-readable
// explanations for the two audiences that see them: EV drivers on the public
// waitlist page, and CPOs (charge point operators) on the admin dashboard.
export const OCPP_STATUS_LABELS = {
  SuspendedEV: 'Suspended by EV',
  SuspendedEVSE: 'Suspended by EVSE',
};

export const OCPP_STATUS_INFO = {
  Available: {
    driver: 'Free and ready to charge.',
    cpo: 'Connector is idle and available to accept a new session.',
  },
  Preparing: {
    driver: 'Getting ready — plug in to start charging.',
    cpo: 'Authorized and connector occupied, but the transaction has not started yet.',
  },
  Charging: {
    driver: 'Your car is charging.',
    cpo: 'Transaction active and energy is flowing to the vehicle.',
  },
  SuspendedEVSE: {
    driver: 'The charger has paused power delivery — this is not caused by your car.',
    cpo: 'Session active but the EVSE is withholding power (e.g. smart charging limit or local power constraint).',
  },
  SuspendedEV: {
    driver: 'Your car has paused charging.',
    cpo: 'Session active and the EVSE is ready to deliver power, but the vehicle is not drawing any (e.g. charging complete).',
  },
  Finishing: {
    driver: 'Session ending — please unplug soon.',
    cpo: 'Transaction has stopped, but the connector is not yet free (cable or vehicle still present).',
  },
  Reserved: {
    driver: 'Reserved for another driver right now.',
    cpo: 'Held via a Reserve Now command for a specific driver.',
  },
  Unavailable: {
    driver: 'Taken out of service — not usable right now.',
    cpo: 'Taken out of service (via Change Availability or at the station\'s own discretion); will not accept new sessions.',
  },
  Faulted: {
    driver: 'Out of order.',
    cpo: 'Reporting an error condition; unavailable for charging until the fault is resolved.',
  },
};

export function ocppStatusLabel(status) {
  return OCPP_STATUS_LABELS[status] ?? status;
}

export function ocppStatusDescription(status, audience) {
  return OCPP_STATUS_INFO[status]?.[audience] ?? null;
}

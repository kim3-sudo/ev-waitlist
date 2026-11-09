import { prisma } from '../db.js';

// The admin side speaks OCPP 1.6 method names and fields. A charge point that connected with OCPP
// 2.0.1 gets the matching 2.0.1 message, translated here. Commands with no 2.0.1 equivalent in this
// version of the server are refused with a clear message instead of being sent in the wrong shape.
//
// This server handles one EVSE per charge point, so a 1.6 connector number is the 2.0.1 connector on
// EVSE 1, and connector 0 (the whole charge point) is EVSE 0 where the message needs an EVSE.

export const OCPP20 = 'ocpp2.0.1';

const UNSUPPORTED = (method) =>
  ({ unsupported: `${method} is not available for OCPP 2.0.1 charge points in this version of the server.` });

const EVSE = 1;
const ID_TOKEN_TYPE = 'ISO14443';

// Request IDs for the 2.0.1 messages that carry one. Kept positive and below 2^31.
let requestCounter = Math.floor(Date.now() / 1000) % 1000000;
function nextRequestId() {
  requestCounter = (requestCounter + 1) % 2147483646;
  return requestCounter + 1;
}

const PURPOSE_TO_20 = {
  ChargePointMaxProfile: 'ChargingStationMaxProfile',
  TxDefaultProfile: 'TxDefaultProfile',
  TxProfile: 'TxProfile',
};

// Translates an outbound command. Returns { method, params } to send, or { unsupported: message }.
export async function toOcpp20(station, method, params = {}) {
  switch (method) {
    case 'RemoteStopTransaction': {
      // 2.0.1 names the session with the charge point's own text ID, saved when the session started.
      const tx = await prisma.transaction.findFirst({
        where: { stationId: station.id, ocppTransactionId: Number(params.transactionId), stoppedAt: null },
      });
      if (!tx?.ocppTransactionRef) return { unsupported: 'This session has no OCPP 2.0.1 transaction ID to stop it with.' };
      return { method: 'RequestStopTransaction', params: { transactionId: tx.ocppTransactionRef } };
    }
    case 'UnlockConnector':
      return { method: 'UnlockConnector', params: { evseId: EVSE, connectorId: Number(params.connectorId) } };
    case 'Reset':
      // 2.0.1 restarts "Immediate" or "OnIdle"; a hard and a soft restart both become Immediate here.
      return { method: 'Reset', params: { type: 'Immediate' } };
    case 'TriggerMessage':
      return {
        method: 'TriggerMessage',
        params: {
          requestedMessage: params.requestedMessage,
          ...(params.connectorId && { evse: { id: EVSE, connectorId: Number(params.connectorId) } }),
        },
      };
    case 'ChangeAvailability': {
      const connectorId = Number(params.connectorId);
      return {
        method: 'ChangeAvailability',
        params: {
          operationalStatus: params.type === 'Operative' ? 'Operative' : 'Inoperative',
          ...(connectorId > 0 && { evse: { id: EVSE, connectorId } }),
        },
      };
    }
    case 'ClearCache':
      return { method: 'ClearCache', params: {} };
    case 'UpdateFirmware':
      return {
        method: 'UpdateFirmware',
        params: {
          requestId: nextRequestId(),
          ...(params.retries !== undefined && { retries: params.retries }),
          ...(params.retryInterval !== undefined && { retryInterval: params.retryInterval }),
          firmware: {
            location: params.location,
            retrieveDateTime: params.retrieveDate,
          },
        },
      };
    case 'GetDiagnostics':
      // A diagnostics log is a GetLog request for the DiagnosticsLog type in 2.0.1.
      return {
        method: 'GetLog',
        params: {
          log: {
            remoteLocation: params.location,
            ...(params.startTime && { oldestTimestamp: params.startTime }),
            ...(params.stopTime && { latestTimestamp: params.stopTime }),
          },
          logType: 'DiagnosticsLog',
          requestId: nextRequestId(),
          ...(params.retries !== undefined && { retries: params.retries }),
          ...(params.retryInterval !== undefined && { retryInterval: params.retryInterval }),
        },
      };
    case 'SetChargingProfile': {
      const profile = params.csChargingProfiles ?? {};
      const schedule = profile.chargingSchedule ?? {};
      return {
        method: 'SetChargingProfile',
        params: {
          evseId: Number(params.connectorId ?? 0),
          chargingProfile: {
            id: profile.chargingProfileId,
            stackLevel: profile.stackLevel ?? 0,
            chargingProfilePurpose: PURPOSE_TO_20[profile.chargingProfilePurpose] ?? profile.chargingProfilePurpose,
            chargingProfileKind: profile.chargingProfileKind ?? 'Absolute',
            chargingSchedule: [
              {
                id: 1,
                chargingRateUnit: schedule.chargingRateUnit ?? 'A',
                chargingSchedulePeriod: (schedule.chargingSchedulePeriod ?? []).map((p) => ({
                  startPeriod: p.startPeriod,
                  limit: p.limit,
                })),
              },
            ],
          },
        },
      };
    }
    case 'ClearChargingProfile':
      return {
        method: 'ClearChargingProfile',
        params: {
          ...(params.id !== undefined && { chargingProfileId: params.id }),
          chargingProfileCriteria: {
            ...(params.chargingProfilePurpose && { chargingProfilePurpose: PURPOSE_TO_20[params.chargingProfilePurpose] }),
            ...(params.connectorId !== undefined && { evseId: Number(params.connectorId) }),
          },
        },
      };
    case 'SendLocalList':
      return {
        method: 'SendLocalList',
        params: {
          versionNumber: params.listVersion,
          updateType: params.updateType,
          localAuthorizationList: (params.localAuthorizationList ?? []).map((e) => ({
            idToken: { idToken: e.idTag, type: ID_TOKEN_TYPE },
            idTokenInfo: { status: e.idTagInfo?.status ?? 'Accepted' },
          })),
        },
      };
    case 'GetLocalListVersion':
      return { method: 'GetLocalListVersion', params: {} };
    case 'ChangeConfiguration':
    case 'GetConfiguration':
    case 'ReserveNow':
    case 'CancelReservation':
      return UNSUPPORTED(method);
    default:
      return UNSUPPORTED(method);
  }
}

// Brings a 2.0.1 answer into the shape the admin side reads.
export function fromOcpp20Result(method, result) {
  if (!result || typeof result !== 'object') return result;
  if (method === 'GetLocalListVersion') return { listVersion: result.versionNumber };
  return result;
}

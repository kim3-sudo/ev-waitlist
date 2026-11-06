import { prisma } from '../db.js';
import { callStation } from './stationCommands.js';
import { recordStationEvent } from './stationEvents.js';
import { getPaymentSettings } from './payments/paymentSettingsService.js';
import { ENERGY } from './meterService.js';

// Configuration that the software reads and sets on each charge point.
//
// After every BootNotification the server reads the charge point's configuration,
// saves it on the station (so the station page can show it while the charge point is
// offline), and sets its meter sampling to the site's interval. A charge point with no
// meter (no MeterValuesSampledData key, or a refused change) is badged as having none.

export const METER_SAMPLE_TYPES = 'Energy.Active.Import.Register,Power.Active.Import,Current.Import,Voltage,SoC,Temperature';
const FALLBACK_SAMPLE_TYPES = 'Energy.Active.Import.Register,Power.Active.Import';

// Reads the whole configuration and saves it on the station. Returns { ok, saved } or { ok: false, message }.
export async function refreshConfiguration(station) {
  const outcome = await callStation(station, 'GetConfiguration', {});
  if (!outcome.ok) return outcome;
  const saved = {
    keys: (outcome.result?.configurationKey ?? []).map(({ key, value, readonly }) => ({
      key,
      value: value ?? '',
      readonly: Boolean(readonly),
    })),
    unknownKeys: outcome.result?.unknownKey ?? [],
    at: new Date().toISOString(),
  };
  await prisma.station.update({
    where: { id: station.id },
    data: { configurationJson: JSON.stringify(saved), configurationAt: new Date(saved.at) },
  });
  return { ok: true, saved };
}

async function setMeterStatus(stationId, meterStatus) {
  await prisma.station.update({ where: { id: stationId }, data: { meterStatus } });
}

// Sets the meter sampling after a boot, and records the outcome.
export async function configureMetering(station) {
  const refreshed = await refreshConfiguration(station);
  if (!refreshed.ok) {
    await recordStationEvent(station.id, 'CONFIG', `Could not read the configuration: ${refreshed.message}`);
    return;
  }
  await recordStationEvent(station.id, 'CONFIG', `Read ${refreshed.saved.keys.length} configuration settings.`);

  const byKey = Object.fromEntries(refreshed.saved.keys.map((k) => [k.key, k]));
  const sampled = byKey.MeterValuesSampledData;
  if (!sampled) {
    await setMeterStatus(station.id, 'NONE');
    await recordStationEvent(station.id, 'CONFIG', 'This charge point does not report meter values, so there are no live readings.');
    return;
  }
  if (sampled.readonly) {
    const reports = sampled.value.split(',').includes(ENERGY);
    await setMeterStatus(station.id, reports ? 'CONFIGURED' : 'NONE');
    await recordStationEvent(
      station.id,
      'CONFIG',
      reports
        ? 'The meter sampling is fixed on this charge point; it already reports energy.'
        : 'The meter sampling is fixed on this charge point and does not report energy.',
    );
    return;
  }

  const { meterSampleSeconds } = await getPaymentSettings();
  const interval = byKey.MeterValueSampleInterval;
  if (interval && !interval.readonly) {
    await setKey(station, 'MeterValueSampleInterval', String(meterSampleSeconds));
  }

  let outcome = await setKey(station, 'MeterValuesSampledData', METER_SAMPLE_TYPES);
  if (outcome === 'Rejected') outcome = await setKey(station, 'MeterValuesSampledData', FALLBACK_SAMPLE_TYPES);

  const stop = byKey.StopTxnSampledData;
  if (stop && !stop.readonly) {
    await setKey(station, 'StopTxnSampledData', ENERGY);
  }

  const configured = outcome === 'Accepted' || outcome === 'RebootRequired';
  await setMeterStatus(station.id, configured ? 'CONFIGURED' : 'NONE');
  if (!configured) {
    await recordStationEvent(station.id, 'CONFIG', `The charge point refused meter sampling (${outcome ?? 'no answer'}).`);
  }
}

// Sends ChangeConfiguration for one key and records it. Returns the status, or null when
// the charge point didn't answer.
async function setKey(station, key, value) {
  const outcome = await callStation(station, 'ChangeConfiguration', { key, value });
  const status = outcome.ok ? outcome.result?.status : null;
  await recordStationEvent(
    station.id,
    'CONFIG',
    `Set ${key} to ${value}: ${status ?? outcome.message ?? 'no answer'}`,
  );
  return status;
}

// Takes out of service again any connector an admin has taken out of service, after the
// charge point restarts (a restart brings every connector back into service).
export async function reapplyAvailability(station) {
  const connectors = await prisma.connector.findMany({
    where: { stationId: station.id, connectorId: { gt: 0 }, operative: false },
  });
  for (const connector of connectors) {
    const outcome = await callStation(station, 'ChangeAvailability', {
      connectorId: connector.connectorId,
      type: 'Inoperative',
    });
    await recordStationEvent(
      station.id,
      'COMMAND',
      `Kept connector ${connector.connectorId} out of service after restart: ${outcome.ok ? outcome.result?.status : outcome.message}`,
      { connectorId: connector.connectorId },
    );
  }
}

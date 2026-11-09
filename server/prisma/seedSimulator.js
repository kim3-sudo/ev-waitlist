import '../src/loadRootEnv.js';
import { PrismaClient } from '@prisma/client';
import { ensureDefaultTenant } from '../src/db.js';
import { DEFAULT_TENANT_ID } from '../src/tenancy/context.js';

// Creates (or fills in) a station for the charge point simulator so it can
// connect. The station goes in the default site. Safe to run repeatedly.
// Blank details are filled in, so the station shows on the charger locator map.
// The map position comes from SIM_LATITUDE and SIM_LONGITUDE (defaults: London).
//   node prisma/seedSimulator.js <identity> <connectorCount>
const prisma = new PrismaClient();
const identity = process.argv[2] ?? 'SIM-001';
const connectorCount = Number(process.argv[3] ?? 2);
const latitude = Number(process.env.SIM_LATITUDE ?? 51.5074);
const longitude = Number(process.env.SIM_LONGITUDE ?? -0.1278);

// A complete connector, so the station is publishable on the locator.
const SIM_CONNECTOR = {
  standard: 'IEC_62196_T2',
  format: 'SOCKET',
  powerType: 'AC_3_PHASE',
  maxVoltage: 400,
  maxAmperage: 32,
};

await ensureDefaultTenant();
let station = await prisma.station.findUnique({ where: { identity } });
if (!station) {
  station = await prisma.station.create({
    data: {
      tenantId: DEFAULT_TENANT_ID,
      identity,
      name: `Simulator ${identity}`,
      vendor: 'Simulator',
      model: 'OCPP 1.6J',
      location: 'Local',
      latitude,
      longitude,
    },
  });
} else if (station.latitude == null || station.longitude == null) {
  station = await prisma.station.update({ where: { id: station.id }, data: { latitude, longitude } });
}

const existing = await prisma.connector.findMany({ where: { stationId: station.id, connectorId: { gt: 0 } } });
const have = new Set(existing.map((c) => c.connectorId));
const missing = [];
for (let i = 1; i <= connectorCount; i += 1) {
  if (!have.has(i)) missing.push({ stationId: station.id, connectorId: i, status: 'Unavailable', ...SIM_CONNECTOR });
}
// Connectors that exist without details get the same ones.
for (const c of existing) {
  if (c.standard == null || c.format == null || c.powerType == null || c.maxVoltage == null || c.maxAmperage == null) {
    await prisma.connector.update({
      where: { stationId_connectorId: { stationId: station.id, connectorId: c.connectorId } },
      data: { ...SIM_CONNECTOR, standard: c.standard ?? SIM_CONNECTOR.standard, format: c.format ?? SIM_CONNECTOR.format, powerType: c.powerType ?? SIM_CONNECTOR.powerType, maxVoltage: c.maxVoltage ?? SIM_CONNECTOR.maxVoltage, maxAmperage: c.maxAmperage ?? SIM_CONNECTOR.maxAmperage },
    });
  }
}
if (missing.length) await prisma.connector.createMany({ data: missing });

console.log(`Simulator station ready: ${identity} (${connectorCount} connector${connectorCount === 1 ? '' : 's'})`);
await prisma.$disconnect();

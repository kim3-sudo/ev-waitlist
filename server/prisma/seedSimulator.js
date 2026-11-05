import '../src/loadRootEnv.js';
import { PrismaClient } from '@prisma/client';

// Creates (or fills in) a station for the charge point simulator so it can
// connect. Safe to run repeatedly.
//   node prisma/seedSimulator.js <identity> <connectorCount>
const prisma = new PrismaClient();
const identity = process.argv[2] ?? 'SIM-001';
const connectorCount = Number(process.argv[3] ?? 2);

let station = await prisma.station.findUnique({ where: { identity } });
if (!station) {
  station = await prisma.station.create({
    data: { identity, name: `Simulator ${identity}`, vendor: 'Simulator', model: 'OCPP 1.6J', location: 'Local' },
  });
}

const existing = await prisma.connector.findMany({ where: { stationId: station.id, connectorId: { gt: 0 } } });
const have = new Set(existing.map((c) => c.connectorId));
const missing = [];
for (let i = 1; i <= connectorCount; i += 1) {
  if (!have.has(i)) missing.push({ stationId: station.id, connectorId: i, status: 'Unavailable' });
}
if (missing.length) await prisma.connector.createMany({ data: missing });

console.log(`Simulator station ready: ${identity} (${connectorCount} connector${connectorCount === 1 ? '' : 's'})`);
await prisma.$disconnect();

import { prisma } from '../../src/db.js';

// Wipes all app tables between tests. Children first so this works
// regardless of whether SQLite FK cascades are active.
export async function resetDb() {
  await prisma.$transaction([
    prisma.lineCutterReport.deleteMany(),
    prisma.reservation.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.queueEntry.deleteMany(),
    prisma.connector.deleteMany(),
    prisma.station.deleteMany(),
    prisma.zone.deleteMany(),
    prisma.admin.deleteMany(),
    prisma.settings.deleteMany(),
    prisma.samlConfig.deleteMany(),
  ]);
}

import { prisma } from '../db.js';

// The charge point reported that its diagnostics upload failed. The newest open request for that
// charge point is marked failed, so the admin list does not show it as waiting forever.
export async function markLatestDiagnosticsFailed(stationId) {
  const open = await prisma.diagnosticsLog.findFirst({
    where: { stationId, status: 'REQUESTED' },
    orderBy: { requestedAt: 'desc' },
  });
  if (!open) return null;
  return prisma.diagnosticsLog.update({ where: { id: open.id }, data: { status: 'FAILED' } });
}

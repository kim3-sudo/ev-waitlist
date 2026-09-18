import { Router } from 'express';
import { prisma } from '../db.js';

export const adminReportsRouter = Router();

function serialize(report) {
  return {
    id: report.id,
    status: report.status,
    note: report.note,
    createdAt: report.createdAt,
    station: { id: report.station.id, name: report.station.name },
    queueEntry: {
      id: report.queueEntry.id,
      name: report.queueEntry.name,
      contact: report.queueEntry.contact,
      status: report.queueEntry.status,
    },
  };
}

adminReportsRouter.get('/', async (req, res) => {
  const reports = await prisma.lineCutterReport.findMany({
    include: { station: true, queueEntry: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(reports.map(serialize));
});

adminReportsRouter.patch('/:id', async (req, res) => {
  const { status } = req.body ?? {};
  if (!['OPEN', 'RESOLVED', 'DISMISSED'].includes(status)) {
    return res.status(400).json({ error: 'status must be OPEN, RESOLVED, or DISMISSED' });
  }

  const existing = await prisma.lineCutterReport.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Report not found' });

  const report = await prisma.lineCutterReport.update({
    where: { id: req.params.id },
    data: { status },
    include: { station: true, queueEntry: true },
  });
  res.json(serialize(report));
});

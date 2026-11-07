import { readPageRequest, afterPosition, pageOf } from '../pagination.js';
import { Router } from 'express';
import { prisma } from '../db.js';

export const adminComplaintsRouter = Router();

function serialize(complaint) {
  return {
    id: complaint.id,
    status: complaint.status,
    note: complaint.note,
    createdAt: complaint.createdAt,
    resolvedAt: complaint.resolvedAt,
    station: { id: complaint.station.id, name: complaint.station.name },
    queueEntry: {
      id: complaint.queueEntry.id,
      name: complaint.queueEntry.name,
      contact: complaint.queueEntry.contact,
      status: complaint.queueEntry.status,
    },
  };
}

adminComplaintsRouter.get('/', async (req, res) => {
  const page = readPageRequest(req.query);
  if (page.error) return res.status(400).json({ error: page.error });
  const rows = await prisma.lineCuttingComplaint.findMany({
    where: afterPosition(page.position, 'createdAt', { date: true }),
    include: { station: true, queueEntry: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: page.limit + 1,
  });
  const result = pageOf(rows, page.limit, (c) => ({ v: c.createdAt.toISOString(), i: c.id }));
  res.json({ data: result.data.map(serialize), nextCursor: result.nextCursor });
});

adminComplaintsRouter.patch('/:id', async (req, res) => {
  const { status } = req.body ?? {};
  if (!['OPEN', 'RESOLVED', 'DISMISSED'].includes(status)) {
    return res.status(400).json({ error: 'status must be OPEN, RESOLVED, or DISMISSED' });
  }

  const existing = await prisma.lineCuttingComplaint.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Complaint not found' });

  const complaint = await prisma.lineCuttingComplaint.update({
    where: { id: req.params.id },
    data: {
      status,
      resolvedAt: status === 'OPEN' ? null : (existing.resolvedAt ?? new Date()),
    },
    include: { station: true, queueEntry: true },
  });
  res.json(serialize(complaint));
});

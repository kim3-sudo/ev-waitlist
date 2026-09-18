import { Router } from 'express';
import { prisma } from '../db.js';

export const adminZonesRouter = Router();

function serialize(zone) {
  return {
    id: zone.id,
    name: zone.name,
    createdAt: zone.createdAt,
    stations: zone.stations.map((s) => ({ id: s.id, name: s.name, identity: s.identity })),
    waitingCount: zone._count.queueEntries,
  };
}

const withRelations = {
  stations: { orderBy: { name: 'asc' } },
  _count: { select: { queueEntries: { where: { status: 'WAITING' } } } },
};

adminZonesRouter.get('/', async (req, res) => {
  const zones = await prisma.zone.findMany({ include: withRelations, orderBy: { name: 'asc' } });
  res.json(zones.map(serialize));
});

adminZonesRouter.post('/', async (req, res) => {
  const { name } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const zone = await prisma.zone.create({ data: { name: name.trim() }, include: withRelations });
    res.status(201).json(serialize(zone));
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: `A zone named "${name}" already exists` });
    res.status(400).json({ error: err.message });
  }
});

adminZonesRouter.put('/:id', async (req, res) => {
  const { name } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const zone = await prisma.zone.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
      include: withRelations,
    });
    res.json(serialize(zone));
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: `A zone named "${name}" already exists` });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Zone not found' });
    res.status(400).json({ error: err.message });
  }
});

adminZonesRouter.delete('/:id', async (req, res) => {
  const zone = await prisma.zone.findUnique({
    where: { id: req.params.id },
    include: withRelations,
  });
  if (!zone) return res.status(404).json({ error: 'Zone not found' });

  if (zone.stations.length > 0) {
    return res.status(400).json({ error: 'Remove all charge points from this zone before deleting it' });
  }
  if (zone._count.queueEntries > 0) {
    return res.status(400).json({ error: "Can't delete a zone with people currently waiting" });
  }

  await prisma.zone.delete({ where: { id: zone.id } });
  res.status(204).end();
});

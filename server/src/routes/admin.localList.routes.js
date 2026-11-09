import { Router } from 'express';
import { prisma } from '../db.js';
import { LOCAL_LIST_MAX, LOCAL_LIST_STATUSES, pushLocalListEverywhere } from '../services/localList.js';

// The site's local authorization list: ID tags that charge points may accept offline (ACCEPTED), or
// refuse everywhere (BLOCKED). Mounted behind stations.view (reads) and stations.manage (changes).
export const adminLocalListRouter = Router();

const ID_TAG = /^[A-Za-z0-9._:-]{1,36}$/;
const NOTE_MAX = 200;

function serialize(e) {
  return { id: e.id, idTag: e.idTag, status: e.status, note: e.note, updatedAt: e.updatedAt };
}

// Changes are pushed to connected charge points straight away. A failed push does not undo the change;
// the next change or a manual send brings the charge points up to date.
async function pushQuietly() {
  await pushLocalListEverywhere().catch((err) => console.error('[local-list] push failed:', err.message));
}

function entryFields(body, { partial = false } = {}) {
  const value = {};
  if (!partial || body.idTag !== undefined) {
    const idTag = String(body.idTag ?? '').trim();
    if (!ID_TAG.test(idTag)) return { error: 'ID tag must be 1 to 36 letters, digits, or the characters . _ : -' };
    value.idTag = idTag;
  }
  if (!partial || body.status !== undefined) {
    const status = body.status ?? 'ACCEPTED';
    if (!LOCAL_LIST_STATUSES.includes(status)) return { error: 'Status must be ACCEPTED or BLOCKED' };
    value.status = status;
  }
  if (body.note !== undefined) {
    const note = String(body.note ?? '').trim();
    if (note.length > NOTE_MAX) return { error: `Note must be ${NOTE_MAX} characters or fewer` };
    value.note = note || null;
  }
  return { value };
}

adminLocalListRouter.get('/', async (_req, res) => {
  const rows = await prisma.localListEntry.findMany({ orderBy: [{ idTag: 'asc' }], take: 1000 });
  res.json({ data: rows.map(serialize), limit: LOCAL_LIST_MAX, count: rows.length });
});

adminLocalListRouter.post('/', async (req, res) => {
  const parsed = entryFields(req.body ?? {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const existing = await prisma.localListEntry.findFirst({ where: { idTag: parsed.value.idTag } });
  if (existing) return res.status(409).json({ error: `The ID tag ${parsed.value.idTag} is already on the list` });
  const created = await prisma.localListEntry.create({ data: parsed.value });
  await pushQuietly();
  res.status(201).json(serialize(created));
});

adminLocalListRouter.patch('/:id', async (req, res) => {
  const existing = await prisma.localListEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  const parsed = entryFields(req.body ?? {}, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const updated = await prisma.localListEntry.update({ where: { id: existing.id }, data: parsed.value });
  await pushQuietly();
  res.json(serialize(updated));
});

adminLocalListRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.localListEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  await prisma.localListEntry.delete({ where: { id: existing.id } });
  await pushQuietly();
  res.status(204).end();
});

import { Router } from 'express';
import { prisma } from '../db.js';
import { encryptSecret } from '../utils/secretBox.js';
import { EVENT_TYPES, newSecret, parseEvents, urlProblem } from '../services/webhooks.js';

// Webhook endpoints and their delivery log. Mounted behind integrations.manage.
export const adminWebhooksRouter = Router();

function serialize(e) {
  return {
    id: e.id,
    url: e.url,
    events: e.events,
    active: e.active,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

adminWebhooksRouter.get('/events', (_req, res) => res.json({ data: EVENT_TYPES }));

adminWebhooksRouter.get('/', async (_req, res) => {
  const rows = await prisma.webhookEndpoint.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  res.json({ data: rows.map(serialize) });
});

// The secret is returned here, and never again. Store it with the receiving system.
adminWebhooksRouter.post('/', async (req, res) => {
  const problem = urlProblem(req.body?.url);
  if (problem) return res.status(400).json({ error: problem });
  const events = parseEvents(req.body?.events ?? '*');
  if (events.error) return res.status(400).json({ error: events.error });
  const secret = newSecret();
  const created = await prisma.webhookEndpoint.create({
    data: { url: String(req.body.url).trim(), events: events.value, secret: encryptSecret(secret), active: true },
  });
  res.status(201).json({ ...serialize(created), secret });
});

adminWebhooksRouter.patch('/:id', async (req, res) => {
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Endpoint not found' });
  const data = {};
  if (req.body?.url !== undefined) {
    const problem = urlProblem(req.body.url);
    if (problem) return res.status(400).json({ error: problem });
    data.url = String(req.body.url).trim();
  }
  if (req.body?.events !== undefined) {
    const events = parseEvents(req.body.events);
    if (events.error) return res.status(400).json({ error: events.error });
    data.events = events.value;
  }
  if (req.body?.active !== undefined) {
    if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'active must be true or false' });
    data.active = req.body.active;
  }
  const updated = await prisma.webhookEndpoint.update({ where: { id: existing.id }, data });
  res.json(serialize(updated));
});

adminWebhooksRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Endpoint not found' });
  await prisma.webhookEndpoint.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// Sends a test event to one endpoint through the normal delivery path.
adminWebhooksRouter.post('/:id/test', async (req, res) => {
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Endpoint not found' });
  await prisma.webhookDelivery.create({
    data: {
      endpointId: existing.id,
      eventId: `evt_test_${Date.now()}`,
      eventType: 'webhook.test',
      payload: JSON.stringify({ id: `evt_test_${Date.now()}`, type: 'webhook.test', createdAt: new Date().toISOString(), data: { message: 'This is a test event.' } }),
    },
  });
  res.status(202).json({ message: 'A test event is queued. Check the delivery log for the result.' });
});

// Recent deliveries, optionally for one endpoint.
adminWebhooksRouter.get('/deliveries', async (req, res) => {
  const where = req.query.endpointId ? { endpointId: String(req.query.endpointId) } : {};
  const rows = await prisma.webhookDelivery.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 200,
  });
  res.json({
    data: rows.map((d) => ({
      id: d.id,
      endpointId: d.endpointId,
      eventType: d.eventType,
      eventId: d.eventId,
      status: d.status,
      attempts: d.attempts,
      lastStatusCode: d.lastStatusCode,
      lastError: d.lastError,
      nextAttemptAt: d.nextAttemptAt,
      deliveredAt: d.deliveredAt,
      createdAt: d.createdAt,
    })),
  });
});

// Puts a failed delivery back in the queue, with its attempts reset.
adminWebhooksRouter.post('/deliveries/:id/retry', async (req, res) => {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: req.params.id } });
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  if (delivery.status === 'DELIVERED') return res.status(409).json({ error: 'This event was already delivered' });
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  res.status(202).json({ message: 'The delivery is queued again.' });
});


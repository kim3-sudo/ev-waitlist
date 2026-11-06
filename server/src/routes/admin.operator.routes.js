import { Router } from 'express';
import { rawPrisma } from '../db.js';

// Mounted behind sites.manage and requireInstanceAdmin. The operator is the
// company that runs this installation. Its country code and party ID are used by
// OCPI (roaming), so they stay blank until the operator sets them.
export const adminOperatorRouter = Router();

const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const PARTY_PATTERN = /^[A-Z0-9]{3}$/;

function operatorView(op) {
  return { name: op.name, countryCode: op.countryCode, partyId: op.partyId };
}

adminOperatorRouter.get('/', async (req, res) => {
  const op = await rawPrisma.operator.findUnique({ where: { id: 'singleton' } });
  res.json(operatorView(op));
});

adminOperatorRouter.put('/', async (req, res) => {
  const body = req.body ?? {};
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  const countryCode = typeof body.countryCode === 'string' ? body.countryCode.trim().toUpperCase() : undefined;
  const partyId = typeof body.partyId === 'string' ? body.partyId.trim().toUpperCase() : undefined;

  if (name !== undefined && name.length > 120) return res.status(400).json({ error: 'name must be 120 characters at most' });
  if (countryCode !== undefined && countryCode !== '' && !COUNTRY_PATTERN.test(countryCode)) {
    return res.status(400).json({ error: 'countryCode must be two letters, for example GB or NL' });
  }
  if (partyId !== undefined && partyId !== '' && !PARTY_PATTERN.test(partyId)) {
    return res.status(400).json({ error: 'partyId must be three letters or numbers' });
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (countryCode !== undefined) data.countryCode = countryCode;
  if (partyId !== undefined) data.partyId = partyId;

  const op = await rawPrisma.operator.update({ where: { id: 'singleton' }, data });
  res.json(operatorView(op));
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeTax, normalizeTaxRule, ruleCovers } from '../src/services/tax.js';

const rule = (overrides = {}) => ({
  id: overrides.id ?? `r-${Math.random()}`,
  name: 'Sales tax',
  rateBasisPoints: 2000,
  mode: 'EXCLUSIVE',
  appliesTo: 'ALL',
  scope: 'SITE',
  zoneId: null,
  stationId: null,
  validFrom: null,
  validUntil: null,
  priority: 100,
  enabled: true,
  jurisdiction: null,
  ...overrides,
});

describe('computeTax', () => {
  it('adds an exclusive rate on top of the price', () => {
    const out = computeTax(1000, [rule({ rateBasisPoints: 2000 })]);
    assert.equal(out.netCents, 1000);
    assert.equal(out.taxCents, 200);
    assert.equal(out.grossCents, 1200);
  });

  it('takes an inclusive rate out of the price, which stays the same', () => {
    // 1200 includes 20%: the tax is 1200 * 2000 / 12000 = 200, and the net is 1000.
    const out = computeTax(1200, [rule({ mode: 'INCLUSIVE', rateBasisPoints: 2000 })]);
    assert.equal(out.netCents, 1000);
    assert.equal(out.taxCents, 200);
    assert.equal(out.grossCents, 1200);
  });

  it('combines inclusive rules first, then adds exclusive rules to the net', () => {
    // 5% inside 1050 is 50, so the net is 1000. A 10% exclusive rule adds 100 on the net.
    const out = computeTax(1050, [
      rule({ id: 'a', name: 'Inside', mode: 'INCLUSIVE', rateBasisPoints: 500, priority: 1 }),
      rule({ id: 'b', name: 'On top', mode: 'EXCLUSIVE', rateBasisPoints: 1000, priority: 2 }),
    ]);
    assert.equal(out.netCents, 1000);
    assert.equal(out.taxCents, 150);
    assert.equal(out.grossCents, 1100);
    assert.deepEqual(out.lines.map((l) => [l.name, l.taxCents]), [['Inside', 50], ['On top', 100]]);
  });

  it('gives each exclusive rule its own tax, without compounding them', () => {
    const out = computeTax(1000, [
      rule({ id: 'a', name: 'State', rateBasisPoints: 600 }),
      rule({ id: 'b', name: 'City', rateBasisPoints: 200 }),
    ]);
    assert.equal(out.taxCents, 60 + 20);
    assert.equal(out.grossCents, 1080);
  });

  it('rounds each tax to the nearest cent, halves up', () => {
    assert.equal(computeTax(333, [rule({ rateBasisPoints: 1000 })]).taxCents, 33); // 33.3
    assert.equal(computeTax(335, [rule({ rateBasisPoints: 1000 })]).taxCents, 34); // 33.5
  });

  it('gives no tax with no rules, and for a zero price', () => {
    assert.deepEqual(
      { ...computeTax(900, []) },
      { netCents: 900, taxCents: 0, grossCents: 900, lines: [] },
    );
    assert.equal(computeTax(0, [rule()]).taxCents, 0);
  });

  it('keeps the inclusive share exact when the split does not divide evenly', () => {
    const out = computeTax(1000, [
      rule({ id: 'a', name: 'A', mode: 'INCLUSIVE', rateBasisPoints: 1000, priority: 1 }),
      rule({ id: 'b', name: 'B', mode: 'INCLUSIVE', rateBasisPoints: 1000, priority: 2 }),
      rule({ id: 'c', name: 'C', mode: 'INCLUSIVE', rateBasisPoints: 1000, priority: 3 }),
    ]);
    const inside = Math.round((1000 * 3000) / 13000);
    assert.equal(out.taxCents, inside);
    assert.equal(out.netCents + out.taxCents, 1000);
  });
});

describe('ruleCovers', () => {
  const at = new Date('2026-11-09T12:00:00Z');

  it('covers a site-wide rule for any charge point', () => {
    assert.equal(ruleCovers(rule(), { stationId: 's1', zoneId: null, pricingModel: 'ENERGY', at }), true);
  });

  it('covers a zone rule only for charge points in that zone', () => {
    const r = rule({ scope: 'ZONE', zoneId: 'z1' });
    assert.equal(ruleCovers(r, { stationId: 's1', zoneId: 'z1', pricingModel: 'TIME', at }), true);
    assert.equal(ruleCovers(r, { stationId: 's1', zoneId: 'z2', pricingModel: 'TIME', at }), false);
    assert.equal(ruleCovers(r, { stationId: 's1', zoneId: null, pricingModel: 'TIME', at }), false);
  });

  it('covers a charge-point rule only for that charge point', () => {
    const r = rule({ scope: 'STATION', stationId: 's1' });
    assert.equal(ruleCovers(r, { stationId: 's1', zoneId: null, pricingModel: 'TIME', at }), true);
    assert.equal(ruleCovers(r, { stationId: 's2', zoneId: null, pricingModel: 'TIME', at }), false);
  });

  it('matches energy-only and time-only rules to the pricing model', () => {
    const energy = rule({ appliesTo: 'ENERGY' });
    assert.equal(ruleCovers(energy, { stationId: 's', zoneId: null, pricingModel: 'ENERGY', at }), true);
    assert.equal(ruleCovers(energy, { stationId: 's', zoneId: null, pricingModel: 'TIME', at }), false);
  });

  it('respects the validity window, which starts inclusive and ends exclusive', () => {
    const r = rule({ validFrom: new Date('2026-11-01T00:00:00Z'), validUntil: new Date('2026-12-01T00:00:00Z') });
    const ctx = { stationId: 's', zoneId: null, pricingModel: 'ENERGY' };
    assert.equal(ruleCovers(r, { ...ctx, at: new Date('2026-11-01T00:00:00Z') }), true);
    assert.equal(ruleCovers(r, { ...ctx, at: new Date('2026-12-01T00:00:00Z') }), false);
    assert.equal(ruleCovers(r, { ...ctx, at: new Date('2026-10-31T23:59:59Z') }), false);
  });

  it('skips disabled rules', () => {
    assert.equal(ruleCovers(rule({ enabled: false }), { stationId: 's', zoneId: null, pricingModel: 'ENERGY', at }), false);
  });
});

describe('normalizeTaxRule', () => {
  const good = { name: 'VAT', rateBasisPoints: 2000 };

  it('accepts a complete rule and fills in the defaults', () => {
    const out = normalizeTaxRule(good);
    assert.equal(out.error, undefined);
    assert.equal(out.value.mode, 'EXCLUSIVE');
    assert.equal(out.value.appliesTo, 'ALL');
    assert.equal(out.value.scope, 'SITE');
  });

  it('rejects a rate outside 0 to 100%', () => {
    assert.match(normalizeTaxRule({ ...good, rateBasisPoints: 10001 }).error, /Rate must be/);
    assert.match(normalizeTaxRule({ ...good, rateBasisPoints: 12.5 }).error, /Rate must be/);
  });

  it('rejects unknown modes, scopes and what they apply to', () => {
    assert.ok(normalizeTaxRule({ ...good, mode: 'ADDED' }).error);
    assert.ok(normalizeTaxRule({ ...good, appliesTo: 'FEES' }).error);
    assert.ok(normalizeTaxRule({ ...good, scope: 'COUNTRY' }).error);
  });

  it('needs a zone or charge point for the narrower scopes, and drops them for a site rule', () => {
    assert.match(normalizeTaxRule({ ...good, scope: 'ZONE' }).error, /zone/);
    assert.match(normalizeTaxRule({ ...good, scope: 'STATION' }).error, /charge point/);
    const site = normalizeTaxRule({ ...good, zoneId: 'z1' });
    assert.equal(site.value.zoneId, null);
  });

  it('rejects a validity window that ends before it starts', () => {
    const out = normalizeTaxRule({ ...good, validFrom: '2026-12-01', validUntil: '2026-11-01' });
    assert.match(out.error, /after valid from/);
  });

  it('rejects a name that is blank', () => {
    assert.match(normalizeTaxRule({ ...good, name: '  ' }).error, /Name is required/);
  });
});

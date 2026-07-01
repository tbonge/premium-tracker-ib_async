import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const fixturePath = path.resolve('tests/calculation-fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const nearlyEqual = (actual, expected) => Math.abs(actual - expected) < 0.000001;

const calculate = fixture => {
  const contracts = Math.abs(fixture.contracts);
  const width = fixture.longStrike == null ? null : Math.abs(fixture.shortStrike - fixture.longStrike);
  const maxLoss = width == null ? null : Math.max(0, width * contracts * fixture.multiplier - fixture.netCredit);
  const assignmentExposure = fixture.cashSettled || fixture.kind.includes('call')
    ? null
    : fixture.shortStrike * contracts * fixture.multiplier;
  const premiumPerShare = fixture.netCredit / (contracts * fixture.multiplier);
  const breakeven = fixture.kind.includes('put')
    ? fixture.shortStrike - premiumPerShare
    : fixture.shortStrike + premiumPerShare;
  return { maxLoss, assignmentExposure, breakeven };
};

const failures = [];
for (const fixture of fixtures) {
  const actual = calculate(fixture);
  for (const [field, expectedKey] of [
    ['maxLoss', 'expectedMaxLoss'],
    ['assignmentExposure', 'expectedAssignmentExposure'],
    ['breakeven', 'expectedBreakeven'],
  ]) {
    const expected = fixture[expectedKey];
    const value = actual[field];
    const pass = expected == null ? value == null : nearlyEqual(value, expected);
    if (!pass) {
      failures.push(`${fixture.name}: ${field} expected ${expected}, got ${value}`);
    }
  }
}

if (failures.length) {
  console.error('Calculation fixture validation failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Validated ${fixtures.length} calculation fixtures.`);

import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateChart, checkClearance } from '../src/validate';
const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run validate -- chart.json');
  process.exit(1);
}
try {
  const chart = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true });
  const structure = ajv.compile(
    JSON.parse(fs.readFileSync(new URL('../public/chart.schema.json', import.meta.url), 'utf8')),
  );
  if (!structure(chart)) throw Error(ajv.errorsText(structure.errors));
  validateChart(chart);
  const overlap = checkClearance(chart);
  if (overlap) throw Error(overlap + ' glyphs overlap routes');
  console.log(
    'Valid chart v11: ' +
      chart.events.length +
      ' events, ' +
      chart.duets.length +
      ' duets, ' +
      chart.forks.length +
      ' forks.',
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

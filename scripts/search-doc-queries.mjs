/* global process, console, fetch, URLSearchParams */
// Runs the 313-row query list (data/search-evaluation/park-queries-313.json) against a live API.
// Each row has full sentences and keyword variants; a query passes when one of the row's
// `relevant` places is in the first 5 results. Rows marked `none` (needs with no place in the
// data: ATM, lockers, ...) pass when at most 2 places come back.
//
//   node scripts/search-doc-queries.mjs [--api http://localhost:3000] [--lat 10.763 --lng 106.636] [--only 1-14] [--verbose]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const api = opt('api', 'http://localhost:3000');
const lat = opt('lat');
const lng = opt('lng');
const [from, to] = (opt('only', '0-9999') ?? '').split('-').map(Number);
const verbose = args.includes('--verbose');
const { rows } = JSON.parse(
  readFileSync(
    new URL('../data/search-evaluation/park-queries-313.json', import.meta.url),
    'utf8',
  ),
);

async function top(text) {
  const params = new URLSearchParams({ q: text, locale: 'vi' });
  if (lat && lng) {
    params.set('lat', lat);
    params.set('lng', lng);
  }
  const response = await fetch(`${api}/v1/search?${params}`);
  return response.ok ? (await response.json()).items : [];
}

const totals = { sentence: [0, 0], keyword: [0, 0] };
for (const row of rows.filter((r) => r.n >= from && r.n <= to)) {
  const misses = [];
  for (const [kind, list] of [
    ['sentence', row.queries],
    ['keyword', row.keywords],
  ]) {
    for (const text of list) {
      const items = await top(text);
      const ok = row.none
        ? items.length <= 2
        : items.slice(0, 5).some((item) => row.relevant.includes(item.slug));
      totals[kind][1] += 1;
      if (ok) totals[kind][0] += 1;
      else
        misses.push(
          `[${kind}] "${text}" → ${
            items
              .slice(0, 3)
              .map((i) => i.name)
              .join(' · ') || '(nothing)'
          }`,
        );
    }
  }
  if (misses.length && (verbose || true)) {
    console.log(`#${row.n}`);
    for (const miss of misses) console.log(`   ${miss}`);
  }
}
const pct = ([ok, all]) => `${ok}/${all} (${Math.round((100 * ok) / all)}%)`;
console.log(
  `\nsentences ${pct(totals.sentence)} · keywords ${pct(totals.keyword)}`,
);

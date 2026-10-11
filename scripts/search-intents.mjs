/* global process, console, fetch, URLSearchParams */
// Runs the park search intents (data/search-evaluation/park-intents.json) against a live API and
// reports, per need, how many keyword queries put a right place in the top 5.
//
//   node scripts/search-intents.mjs [--api http://localhost:3000] [--lat 10.7645 --lng 106.6375] [--verbose]
//
// A query passes when one of the intent's `relevant` slugs is among the first 5 results; a
// "nonsense" intent passes when nothing (or at most 2 places) comes back. With --lat/--lng the
// position is sent, so "nearest" intents are also checked to be sorted by distance.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const api = opt('api', 'http://localhost:3000');
const lat = opt('lat');
const lng = opt('lng');
const verbose = args.includes('--verbose');
const dataset = JSON.parse(
  readFileSync(
    new URL('../data/search-evaluation/park-intents.json', import.meta.url),
    'utf8',
  ),
);

const known = new Set(
  (await (await fetch(`${api}/v1/pois`)).json()).items.map((p) => p.slug),
);
let failedQueries = 0;
let total = 0;
for (const intent of dataset.intents) {
  const missing = intent.relevant.filter((slug) => !known.has(slug));
  if (missing.length) console.log(`! ${intent.id}: unknown slugs ${missing}`);
  let passed = 0;
  let count = 0;
  const failures = [];
  for (const locale of ['vi', 'en']) {
    for (const text of intent.queries[locale]) {
      const params = new URLSearchParams({ q: text, locale });
      if (lat && lng) {
        params.set('lat', lat);
        params.set('lng', lng);
      }
      const response = await fetch(`${api}/v1/search?${params}`);
      const items = response.ok ? (await response.json()).items : [];
      const top = items.slice(0, 5);
      const ok =
        intent.relevant.length === 0
          ? items.length <= 2
          : top.some((item) => intent.relevant.includes(item.slug));
      count += 1;
      if (ok) passed += 1;
      else failures.push({ locale, text, top: top.map((i) => i.name) });
    }
  }
  total += count;
  failedQueries += count - passed;
  console.log(
    `${passed === count ? 'OK  ' : 'MISS'} ${intent.id.padEnd(18)} ${passed}/${count}`,
  );
  if (verbose || passed < count) {
    for (const failure of failures) {
      console.log(
        `       [${failure.locale}] "${failure.text}" → ${failure.top.slice(0, 3).join(' · ') || '(nothing)'}`,
      );
    }
  }
}
console.log(
  `\n${total - failedQueries}/${total} queries put a right place in the top 5`,
);

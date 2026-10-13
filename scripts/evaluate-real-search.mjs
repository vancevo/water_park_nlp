/* global console, process, fetch */
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';

const read = (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
const judgments = read(
  new URL('../data/search-catalog/queries.json', import.meta.url),
);
const catalogue = read(
  new URL('../data/pois/damsen-pois.json', import.meta.url),
).pois;
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:3000';
const assertGate = process.argv.includes('--assert');
const queries = [
  ...catalogue.map((poi) => ({
    id: `exact-${String(poi.number).padStart(2, '0')}`,
    text: poi.nameVi,
    caseType: 'exact',
    expectedTopK: 1,
    relevant: [{ slug: poi.slug, grade: 3 }],
  })),
  ...judgments.queries,
];

const dcg = (grades) =>
  grades.reduce(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
const aggregate = {
  recallAt3: 0,
  mrr: 0,
  ndcgAt5: 0,
  positive: 0,
  zeroCorrect: 0,
  zeroTotal: 0,
  exactTop1: 0,
  exactTotal: 0,
};
const failures = [];
const cases = new Map();

for (const query of queries) {
  const params = new URLSearchParams({
    q: query.text,
    locale: 'vi',
    limit: '10',
  });
  const response = await fetch(`${apiUrl}/v1/search?${params}`);
  if (!response.ok)
    throw new Error(`${query.id}: search answered ${response.status}`);
  const items = (await response.json()).items;
  const slugs = items.map((item) => item.slug);
  const grades = new Map(query.relevant.map((item) => [item.slug, item.grade]));
  const row = cases.get(query.caseType) ?? { count: 0, topKPassed: 0 };
  row.count += 1;
  const topKPassed =
    query.expectedTopK === 0
      ? slugs.length === 0
      : slugs.slice(0, query.expectedTopK).some((slug) => grades.has(slug));
  if (topKPassed) row.topKPassed += 1;
  cases.set(query.caseType, row);
  if (!topKPassed)
    failures.push({
      id: query.id,
      text: query.text,
      expectedTopK: query.expectedTopK,
      expected: [...grades.keys()],
      actual: slugs.slice(0, Math.max(3, query.expectedTopK)),
    });

  if (query.relevant.length === 0) {
    aggregate.zeroTotal += 1;
    if (slugs.length === 0) aggregate.zeroCorrect += 1;
    continue;
  }
  aggregate.positive += 1;
  const relevant = new Set(grades.keys());
  aggregate.recallAt3 +=
    slugs.slice(0, 3).filter((slug) => relevant.has(slug)).length /
    relevant.size;
  const first = slugs.findIndex((slug) => relevant.has(slug));
  aggregate.mrr += first < 0 ? 0 : 1 / (first + 1);
  const actualGrades = slugs.slice(0, 5).map((slug) => grades.get(slug) ?? 0);
  const idealGrades = query.relevant
    .map((item) => item.grade)
    .sort((left, right) => right - left)
    .slice(0, 5);
  const ideal = dcg(idealGrades);
  aggregate.ndcgAt5 += ideal === 0 ? 0 : dcg(actualGrades) / ideal;
  if (query.caseType === 'exact') {
    aggregate.exactTotal += 1;
    if (slugs[0] === query.relevant[0].slug) aggregate.exactTop1 += 1;
  }
}

const ratio = (value, total) =>
  total === 0 ? 0 : Number((value / total).toFixed(4));
const report = {
  datasetId: judgments.datasetId,
  queryCount: queries.length,
  metrics: {
    recallAt3: ratio(aggregate.recallAt3, aggregate.positive),
    mrr: ratio(aggregate.mrr, aggregate.positive),
    ndcgAt5: ratio(aggregate.ndcgAt5, aggregate.positive),
    exactNameRecallAt1: ratio(aggregate.exactTop1, aggregate.exactTotal),
    zeroResultAccuracy: ratio(aggregate.zeroCorrect, aggregate.zeroTotal),
  },
  casePassRate: Object.fromEntries(
    [...cases.entries()].map(([name, value]) => [
      name,
      ratio(value.topKPassed, value.count),
    ]),
  ),
  failures,
};
console.log(JSON.stringify(report, null, 2));

const scenicPassed = !failures.some((item) => item.id === 'intent-scenic-001');
if (
  assertGate &&
  (!scenicPassed ||
    report.metrics.exactNameRecallAt1 < 1 ||
    report.metrics.recallAt3 < 0.9 ||
    report.metrics.mrr < 0.85 ||
    report.metrics.zeroResultAccuracy < 0.8)
) {
  process.exitCode = 1;
}

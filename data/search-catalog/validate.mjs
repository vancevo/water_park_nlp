/* global console, process */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const metadata = read(join(here, 'poi-search-metadata.json'));
const judgments = read(join(here, 'queries.json'));
const catalogue = read(join(here, '..', 'pois', 'damsen-pois.json')).pois;
const errors = [];
const expectedSlugs = new Set(catalogue.map((poi) => poi.slug));
const actualSlugs = metadata.pois.map((poi) => poi.slug);
const forbidden = /đảo\s+thần\s+tài/iu;

if (metadata.locale !== 'vi') errors.push('metadata locale must be vi');
if (metadata.pois.length !== 50)
  errors.push(`expected 50 metadata records, got ${metadata.pois.length}`);
if (new Set(actualSlugs).size !== actualSlugs.length)
  errors.push('metadata slugs must be unique');
for (const slug of expectedSlugs) {
  if (!actualSlugs.includes(slug)) errors.push(`missing metadata: ${slug}`);
}
for (const slug of actualSlugs) {
  if (!expectedSlugs.has(slug)) errors.push(`unknown metadata slug: ${slug}`);
}
for (const poi of metadata.pois) {
  for (const field of [
    'aliases',
    'activities',
    'attributes',
    'audiences',
    'intentPhrases',
  ]) {
    const values = poi[field];
    if (!Array.isArray(values) || values.length === 0 || values.length > 20) {
      errors.push(`${poi.slug}: ${field} must contain 1..20 values`);
      continue;
    }
    if (
      values.some(
        (value) =>
          typeof value !== 'string' ||
          value.trim() !== value ||
          value.length === 0 ||
          value.length > 200,
      )
    )
      errors.push(`${poi.slug}: invalid ${field} value`);
    if (new Set(values.map((value) => value.toLocaleLowerCase('vi'))).size !== values.length)
      errors.push(`${poi.slug}: duplicate ${field} value`);
  }
  if (forbidden.test(JSON.stringify(poi)))
    errors.push(`${poi.slug}: forbidden retired place name`);
}

const queryIds = judgments.queries.map((query) => query.id);
if (new Set(queryIds).size !== queryIds.length)
  errors.push('query ids must be unique');
for (const query of judgments.queries) {
  if (!query.text?.trim()) errors.push(`${query.id}: empty text`);
  if (!Number.isInteger(query.expectedTopK) || query.expectedTopK < 0 || query.expectedTopK > 10)
    errors.push(`${query.id}: expectedTopK must be 0..10`);
  if (!Array.isArray(query.relevant)) errors.push(`${query.id}: relevant must be an array`);
  if (query.caseType === 'zero_result' && query.relevant.length !== 0)
    errors.push(`${query.id}: zero-result query has judgments`);
  if (query.caseType !== 'zero_result' && query.relevant.length === 0)
    errors.push(`${query.id}: positive query has no judgments`);
  const relevantSlugs = query.relevant.map((item) => item.slug);
  if (new Set(relevantSlugs).size !== relevantSlugs.length)
    errors.push(`${query.id}: duplicate judgment`);
  for (const item of query.relevant) {
    if (!expectedSlugs.has(item.slug)) errors.push(`${query.id}: unknown slug ${item.slug}`);
    if (![1, 2, 3].includes(item.grade)) errors.push(`${query.id}: grade must be 1..3`);
  }
}
if (forbidden.test(JSON.stringify(judgments)))
  errors.push('query judgments contain the retired place name');

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `PASS: ${metadata.pois.length}/50 metadata records, ${judgments.queries.length} authored + ${catalogue.length} exact-name queries`,
  );
}

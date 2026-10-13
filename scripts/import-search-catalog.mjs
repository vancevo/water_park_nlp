/* global process */
// Upsert the versioned, search-only metadata for the 50 published park POIs.
// This is intentionally independent from visitor-facing descriptions and does
// not bypass the POI content workflow.
import { readFileSync } from 'node:fs';
import { Console } from 'node:console';
import { fileURLToPath, URL } from 'node:url';

import pg from 'pg';

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
const dryRun = process.argv.includes('--dry-run');
const catalogPath = fileURLToPath(
  new URL('../data/search-catalog/poi-search-metadata.json', import.meta.url),
);
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://damsen:damsen_local_only@127.0.0.1:64321/damsen',
  max: 1,
});

try {
  const slugs = catalog.pois.map((poi) => poi.slug);
  const existing = await pool.query(
    `SELECT slug FROM pois WHERE slug = ANY($1::text[]) ORDER BY slug`,
    [slugs],
  );
  const found = new Set(existing.rows.map((row) => row.slug));
  const missing = slugs.filter((slug) => !found.has(slug));
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.length} catalogue POIs; run npm run seed:park first: ${missing.join(', ')}`,
    );
  }
  if (dryRun) {
    logger.log(
      `dry run: would upsert ${catalog.pois.length} ${catalog.locale} search metadata rows (${catalog.datasetId}@${catalog.version})`,
    );
  } else {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const poi of catalog.pois) {
        await client.query(
          `INSERT INTO poi_search_metadata
             (poi_id, locale, aliases, activities, attributes, audiences, intent_phrases)
           SELECT p.id, $2, $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]
           FROM pois p WHERE p.slug = $1
           ON CONFLICT (poi_id, locale) DO UPDATE SET
             aliases = EXCLUDED.aliases,
             activities = EXCLUDED.activities,
             attributes = EXCLUDED.attributes,
             audiences = EXCLUDED.audiences,
             intent_phrases = EXCLUDED.intent_phrases,
             updated_at = now()`,
          [
            poi.slug,
            catalog.locale,
            poi.aliases,
            poi.activities,
            poi.attributes,
            poi.audiences,
            poi.intentPhrases,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    logger.log(
      `done: ${catalog.pois.length} ${catalog.locale} search metadata rows upserted (${catalog.datasetId}@${catalog.version})`,
    );
  }
} finally {
  await pool.end();
}

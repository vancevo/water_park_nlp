/* global process, fetch */
// Loads the written content of the 79 places (data/pois/poi-content.source.txt) into the
// existing places through the admin API: name, short and long description of the VI
// translation, and the narration text as a VI narration (transcript; audio can be generated
// later with the existing "Tạo audio AI" flow). The English narration of the same places
// (data/pois/poi-content.en.txt, rows `number|Vietnamese name|text`) is added the same way as
// an EN narration; an existing EN narration is never overwritten.
//
//   ADMIN_PASSWORD=... node scripts/import-poi-content.mjs              # dry run (default)
//   ADMIN_PASSWORD=... node scripts/import-poi-content.mjs --apply
//   ADMIN_PASSWORD=... node scripts/import-poi-content.mjs --rollback .import-reports/<backup>.json
//
// Safe by construction:
// - places are matched to the source rows by normalised name AND map number (slug `pNN-`);
//   anything missing, duplicated or inconsistent is reported and left alone (no fuzzy match);
// - only the VI name/short/long text changes; ids, positions, entrances, category and every
//   flag stay as they are; the EN translation is kept;
// - a place already carrying the same text is not touched (no new version) and a place that
//   already has a published VI narration keeps it (reported, never overwritten);
// - the text of every place is saved before changing it (--rollback puts it back);
// - running it again changes nothing.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { Console } from 'node:console';
import { URL } from 'node:url';

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const rollbackFile = args.includes('--rollback')
  ? args[args.indexOf('--rollback') + 1]
  : null;
const api = process.env.API_URL ?? 'http://localhost:3000';
const REPORTS = new URL('../.import-reports/', import.meta.url);
const SOURCE = new URL('../data/pois/poi-content.source.txt', import.meta.url);
const SOURCE_EN = new URL('../data/pois/poi-content.en.txt', import.meta.url);
const LIMITS = { name: 200, short: 500 };

let token = '';
async function call(method, path, body, expected) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (expected !== undefined && response.status !== expected) {
    throw Object.assign(
      new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`),
      { status: response.status },
    );
  }
  return text ? JSON.parse(text) : null;
}

/** The admin API lists a place's translations as an array. */
const viOf = (poi) => poi.translations?.find((item) => item.locale === 'vi');

/** Same text, whatever the Unicode form, spacing, dash style or case. */
export const norm = (value) =>
  value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

export function parseSource(text) {
  const rows = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    if (parts.length !== 7) {
      throw new Error(
        `line ${index + 1}: expected 7 fields, got ${parts.length}`,
      );
    }
    const [number, name, category, short, long, narration, source] = parts;
    rows.push({
      line: index + 1,
      mapNumber: number ? Number(number) : null,
      name,
      category,
      short,
      long,
      narration,
      source,
    });
  }
  return rows;
}

/** English narrations keyed like the source rows: `number|Vietnamese name` -> text. */
export function parseEnglish(text) {
  const byKey = new Map();
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    if (parts.length !== 3) {
      throw new Error(
        `EN line ${index + 1}: expected 3 fields, got ${parts.length}`,
      );
    }
    const [number, name, narration] = parts;
    if (narration.trim().length < 20) {
      throw new Error(`EN line ${index + 1}: narration too short`);
    }
    byKey.set(
      `${number ? Number(number) : ''}|${norm(name)}`,
      narration.trim(),
    );
  }
  return byKey;
}

export function validateRows(rows) {
  const errors = [];
  const keys = new Set();
  for (const row of rows) {
    const label = `line ${row.line} (${row.name})`;
    for (const field of ['name', 'short', 'long', 'narration']) {
      if (!row[field]?.trim()) errors.push(`${label}: empty ${field}`);
    }
    if (row.name.length > LIMITS.name) errors.push(`${label}: name too long`);
    if (row.short.length > LIMITS.short)
      errors.push(`${label}: short too long`);
    if (row.narration.length < 20) errors.push(`${label}: narration too short`);
    const key = `${row.mapNumber ?? ''}|${norm(row.name)}`;
    if (keys.has(key)) errors.push(`${label}: duplicate key`);
    keys.add(key);
  }
  return errors;
}

/** Matches each source row to exactly one existing place, or says why not. */
export function matchRows(rows, pois) {
  const slugNumber = (slug) => {
    const m = /^p(\d{2})-/.exec(slug);
    return m ? Number(m[1]) : null;
  };
  return rows.map((row) => {
    const byName = pois.filter(
      (poi) => norm(viOf(poi)?.name ?? '') === norm(row.name),
    );
    const candidates = byName.filter((poi) =>
      row.mapNumber === null
        ? slugNumber(poi.slug) === null
        : slugNumber(poi.slug) === row.mapNumber,
    );
    if (candidates.length === 1) return { row, poi: candidates[0] };
    if (candidates.length > 1) return { row, error: 'ambiguous', candidates };
    if (row.mapNumber !== null) {
      const byNumber = pois.filter(
        (poi) => slugNumber(poi.slug) === row.mapNumber,
      );
      return {
        row,
        error: byNumber.length
          ? `number ${row.mapNumber} exists as "${viOf(byNumber[0])?.name}" (name differs)`
          : 'no place with this number',
      };
    }
    return {
      row,
      error: byName.length
        ? 'name exists only with a map number'
        : 'no such place',
    };
  });
}

const pick = (translation) => ({
  name: translation?.name ?? '',
  short: translation?.shortDescription ?? '',
  long: translation?.longDescription ?? '',
});

function diffFields(current, row) {
  const changed = [];
  if (norm(current.name) !== norm(row.name) || current.name !== row.name)
    changed.push('name');
  if (current.short !== row.short) changed.push('short');
  if (current.long !== row.long) changed.push('long');
  return changed;
}

async function publishText(poi, vi) {
  const translations = poi.translations.map((item) =>
    item.locale === 'vi'
      ? {
          locale: 'vi',
          name: vi.name,
          shortDescription: vi.short,
          longDescription: vi.long,
        }
      : {
          locale: item.locale,
          name: item.name,
          shortDescription: item.shortDescription,
          longDescription: item.longDescription,
        },
  );
  await call('PATCH', `/v1/admin/pois/${poi.id}`, { translations }, 200);
  const submitted = await call(
    'POST',
    `/v1/admin/pois/${poi.id}/submit`,
    {},
    200,
  );
  await call(
    'POST',
    `/v1/admin/content/${submitted.pendingVersionId}/approve`,
    {},
    200,
  );
}

async function publicNarration(poiId, locale = 'vi') {
  const response = await fetch(
    `${api}/v1/pois/${poiId}/narration?locale=${locale}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`narration lookup ${response.status}`);
  const narration = await response.json();
  // The API answers with another language when the asked one is missing: that is not a hit.
  return narration.resolvedLocale === locale ? narration : null;
}

async function main() {
  if (!process.env.ADMIN_PASSWORD) {
    throw new Error(
      'ADMIN_PASSWORD is required (the admin of the running API).',
    );
  }
  const login = await call(
    'POST',
    '/v1/auth/login',
    {
      email: process.env.ADMIN_EMAIL ?? 'admin@damsen.local',
      password: process.env.ADMIN_PASSWORD,
    },
    200,
  );
  token = login.accessToken;
  const pois = await call('GET', '/v1/admin/pois', undefined, 200);

  if (rollbackFile) {
    const backup = JSON.parse(readFileSync(rollbackFile, 'utf8'));
    let restored = 0;
    for (const entry of backup.pois) {
      const poi = pois.find((item) => item.id === entry.id);
      if (!poi) continue;
      if (diffFields(pick(viOf(poi)), entry.vi).length === 0) continue;
      await publishText(poi, entry.vi);
      restored += 1;
    }
    logger.log(
      `rollback: restored the VI text of ${restored} places (narrations added by the import stay).`,
    );
    return;
  }

  const rows = parseSource(readFileSync(SOURCE, 'utf8'));
  const errors = validateRows(rows);
  if (errors.length) {
    errors.forEach((message) => logger.error(`ERROR ${message}`));
    throw new Error(`${errors.length} problem(s) in the source file`);
  }
  const english = parseEnglish(readFileSync(SOURCE_EN, 'utf8'));
  for (const row of rows) {
    const key = `${row.mapNumber ?? ''}|${norm(row.name)}`;
    if (!english.has(key)) errors.push(`${row.name}: no English narration`);
  }
  if (errors.length) {
    errors.forEach((message) => logger.error(`ERROR ${message}`));
    throw new Error(`${errors.length} problem(s) in the source files`);
  }
  const matches = matchRows(rows, pois);
  const unmatched = matches.filter((m) => !m.poi);
  const matched = matches.filter((m) => m.poi);
  const usedIds = matched.map((m) => m.poi.id);
  if (new Set(usedIds).size !== usedIds.length) {
    throw new Error('two source rows matched the same place');
  }

  const plan = [];
  for (const { row, poi } of matched) {
    const current = pick(viOf(poi));
    const changed = diffFields(current, row);
    const narration = await publicNarration(poi.id);
    const englishText = english.get(`${row.mapNumber ?? ''}|${norm(row.name)}`);
    const englishExists = Boolean(await publicNarration(poi.id, 'en'));
    plan.push({
      englishText,
      englishExists,
      poi,
      row,
      current,
      changed,
      narration: narration
        ? {
            exists: true,
            hasAudio: Boolean(narration.audio),
            same: narration.transcript === row.narration,
          }
        : { exists: false },
      blocked: poi.status === 'pending_review' ? 'pending_review' : null,
    });
  }

  const toUpdate = plan.filter((item) => item.changed.length && !item.blocked);
  const narrationsToAdd = plan.filter(
    (item) => !item.narration.exists && !item.blocked,
  );
  const narrationsKept = plan.filter((item) => item.narration.exists);
  const englishToAdd = plan.filter(
    (item) => !item.englishExists && !item.blocked,
  );
  logger.log(
    `source rows: ${rows.length} | matched 1-1: ${matched.length} | unmatched: ${unmatched.length}`,
  );
  for (const { row, error } of unmatched)
    logger.log(`  UNMATCHED line ${row.line} "${row.name}": ${error}`);
  for (const item of plan.filter((p) => p.blocked))
    logger.log(`  BLOCKED ${item.poi.slug}: ${item.blocked}`);
  logger.log(
    `text to update: ${toUpdate.length} places (${plan.length - toUpdate.length} already identical)`,
  );
  logger.log(`narrations to add: ${narrationsToAdd.length}`);
  logger.log(`English narrations to add: ${englishToAdd.length}`);
  for (const item of narrationsKept) {
    logger.log(
      `  KEEP existing VI narration of ${item.poi.slug} (${item.narration.hasAudio ? 'with audio' : 'text only'}, ${item.narration.same ? 'same text' : 'different text: not overwritten'})`,
    );
  }

  mkdirSync(REPORTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    mapping: matches.map((m) => ({
      contentLine: m.row.line,
      mapNumber: m.row.mapNumber,
      name: m.row.name,
      poiId: m.poi?.id ?? null,
      slug: m.poi?.slug ?? null,
      error: m.error ?? null,
    })),
    updates: toUpdate.map((item) => ({
      slug: item.poi.slug,
      fields: item.changed,
    })),
    narrationsToAdd: narrationsToAdd.map((item) => item.poi.slug),
    englishToAdd: englishToAdd.map((item) => item.poi.slug),
    narrationsKept: narrationsKept.map((item) => item.poi.slug),
  };
  const reportFile = new URL(
    `poi-content-${report.mode}-${stamp}.json`,
    REPORTS,
  );
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  logger.log(`report: ${reportFile.pathname}`);

  if (!apply) {
    logger.log('Dry run only. Add --apply to write.');
    if (unmatched.length) process.exitCode = 1;
    return;
  }
  if (unmatched.length) {
    logger.log(
      'Applying only the matched places; fix the unmatched ones and run again.',
    );
  }

  const backupFile = new URL(`poi-content-backup-${stamp}.json`, REPORTS);
  writeFileSync(
    backupFile,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        pois: toUpdate.map((i) => ({
          id: i.poi.id,
          slug: i.poi.slug,
          vi: i.current,
        })),
      },
      null,
      2,
    ),
  );
  logger.log(`backup of the previous text: ${backupFile.pathname}`);

  let updated = 0;
  const failures = [];
  for (const item of toUpdate) {
    try {
      await publishText(item.poi, item.row);
      updated += 1;
    } catch (error) {
      failures.push(`${item.poi.slug}: ${error.message}`);
    }
  }
  let added = 0;
  for (const item of narrationsToAdd) {
    try {
      const draft = await call(
        'POST',
        `/v1/admin/pois/${item.poi.id}/narrations`,
        { locale: 'vi', transcript: item.row.narration },
        201,
      );
      await call('POST', `/v1/admin/narrations/${draft.id}/submit`, {}, 200);
      await call('POST', `/v1/admin/narrations/${draft.id}/approve`, {}, 200);
      added += 1;
    } catch (error) {
      failures.push(`narration ${item.poi.slug}: ${error.message}`);
    }
  }
  let addedEnglish = 0;
  for (const item of englishToAdd) {
    try {
      const draft = await call(
        'POST',
        `/v1/admin/pois/${item.poi.id}/narrations`,
        { locale: 'en', transcript: item.englishText },
        201,
      );
      await call('POST', `/v1/admin/narrations/${draft.id}/submit`, {}, 200);
      await call('POST', `/v1/admin/narrations/${draft.id}/approve`, {}, 200);
      addedEnglish += 1;
    } catch (error) {
      failures.push(`English narration ${item.poi.slug}: ${error.message}`);
    }
  }
  logger.log(
    `done: ${updated} places updated, ${added} narrations added, ${addedEnglish} English narrations added, ${failures.length} failure(s)`,
  );
  failures.forEach((message) => logger.error(`  FAILED ${message}`));
  if (failures.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop())
) {
  await main();
}

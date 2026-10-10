/* global console */
// Storage backup/restore for narration audio (C07 / AI08, ADR 0013).
//
// Narration audio lives only in object storage; the database keeps the key,
// MIME type, size and sha256 of every attached file. This script uses those
// records to back up, audit and restore the audio, and runs the object-loss
// drill that ADR 0013 deferred until real storage existed (B03).
//
// Modes (first argument):
//   audit    read-only: every referenced object exists with the recorded
//            size, sha256 (bytes re-hashed) and MIME type
//   backup   copy every referenced object to the backup bucket (idempotent)
//   restore  re-create MISSING/CORRUPT objects from the backup bucket, then audit
//   drill    backup → delete N objects from the PRIMARY bucket → audit must
//            detect exactly them → restore → audit must be clean; reports RTO.
//            Destructive: refuses to run unless STORAGE_DRILL_CONFIRM=delete-objects
//            and never on a bucket whose name contains "prod".
//
// Env: DATABASE_URL, S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY,
//      S3_SECRET_KEY, BACKUP_S3_BUCKET (default `${S3_BUCKET}-backup`),
//      STORAGE_DRILL_LOSE (objects to delete in a drill, default 1),
//      STORAGE_DRILL_REPORT (optional JSON report path).
// Objects are copied by GET + PUT with the same Content-Type, `sha256`
// metadata and x-amz-checksum-sha256 the worker/API used at upload, so the
// API's verifyAudioObject accepts a restored object exactly like the original.
// Logs carry object keys and codes only — never transcript text or audio.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import pg from 'pg';

const env = process.env;
const mode = process.argv[2];
const MODES = ['audit', 'backup', 'restore', 'drill'];
if (!MODES.includes(mode)) {
  console.error(
    `usage: node scripts/storage-restore-drill.mjs <${MODES.join('|')}>`,
  );
  process.exit(2);
}
const required = (name) => {
  const value = env[name]?.trim();
  if (!value) {
    console.error(`${name} is required`);
    process.exit(2);
  }
  return value;
};

const primary = required('S3_BUCKET');
const backup = env.BACKUP_S3_BUCKET?.trim() || `${primary}-backup`;
if (backup === primary) {
  console.error('BACKUP_S3_BUCKET must differ from S3_BUCKET');
  process.exit(2);
}
const s3 = new S3Client({
  endpoint: required('S3_ENDPOINT'),
  region: env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: required('S3_ACCESS_KEY'),
    secretAccessKey: required('S3_SECRET_KEY'),
  },
});
const pool = new pg.Pool({
  connectionString: required('DATABASE_URL'),
  max: 2,
});
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const log = (line) => console.log(line);

/** Every audio file the database says must exist (any narration status). */
async function references() {
  const { rows } = await pool.query(`
    SELECT DISTINCT audio_object_key AS key, audio_mime_type AS mime,
      audio_size_bytes::bigint AS size, audio_sha256 AS sha256
    FROM poi_narrations
    WHERE audio_object_key IS NOT NULL
    ORDER BY audio_object_key`);
  return rows.map((row) => ({ ...row, size: Number(row.size) }));
}

async function read(bucket, key) {
  try {
    const out = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return {
      body: Buffer.from(await out.Body.transformToByteArray()),
      contentType: out.ContentType,
    };
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404)
      return null;
    throw error;
  }
}

async function write(bucket, ref, body) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: ref.key,
      Body: body,
      ContentType: ref.mime,
      ContentLength: body.length,
      ChecksumSHA256: Buffer.from(ref.sha256, 'hex').toString('base64'),
      Metadata: { sha256: ref.sha256 },
    }),
  );
}

/** Problem with one object in a bucket, or null when it matches the record. */
async function check(bucket, ref) {
  const object = await read(bucket, ref.key);
  if (!object) return 'missing';
  if (object.body.length !== ref.size) return 'size_mismatch';
  if (sha256(object.body) !== ref.sha256) return 'sha256_mismatch';
  if (object.contentType && object.contentType !== ref.mime)
    return 'mime_mismatch';
  return null;
}

async function audit(bucket, refs) {
  const problems = [];
  for (const ref of refs) {
    const problem = await check(bucket, ref);
    if (problem) problems.push({ key: ref.key, problem });
  }
  return problems;
}

async function ensureBucket(bucket) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    log(`created backup bucket ${bucket}`);
  }
}

async function runBackup(refs) {
  await ensureBucket(backup);
  let copied = 0;
  let current = 0;
  const failed = [];
  for (const ref of refs) {
    if ((await check(backup, ref)) === null) {
      current += 1;
      continue;
    }
    const object = await read(primary, ref.key);
    if (!object || sha256(object.body) !== ref.sha256) {
      // Never back up a missing/corrupt primary over a good backup.
      failed.push({
        key: ref.key,
        problem: object ? 'sha256_mismatch' : 'missing',
      });
      continue;
    }
    await write(backup, ref, object.body);
    copied += 1;
  }
  log(
    `backup: ${copied} copied, ${current} already current, ${failed.length} not backed up`,
  );
  return { copied, current, failed };
}

async function runRestore(refs) {
  const damaged = await audit(primary, refs);
  const restored = [];
  const unrecoverable = [];
  for (const { key, problem } of damaged) {
    const ref = refs.find((r) => r.key === key);
    const copy = await read(backup, key);
    if (!copy || sha256(copy.body) !== ref.sha256) {
      unrecoverable.push({
        key,
        problem,
        backup: copy ? 'corrupt' : 'missing',
      });
      continue;
    }
    await write(primary, ref, copy.body);
    restored.push({ key, problem });
  }
  log(
    `restore: ${restored.length} restored, ${unrecoverable.length} unrecoverable`,
  );
  return { damaged, restored, unrecoverable };
}

async function main() {
  const refs = await references();
  log(
    `${refs.length} audio object(s) referenced by narrations · primary=${primary} backup=${backup}`,
  );
  const report = {
    mode,
    primary,
    backup,
    referenced: refs.length,
    startedAt: new Date().toISOString(),
  };

  if (mode === 'audit') {
    report.problems = await audit(primary, refs);
    report.pass = report.problems.length === 0;
    for (const p of report.problems) log(`  ${p.problem}: ${p.key}`);
  } else if (mode === 'backup') {
    report.backup = await runBackup(refs);
    report.pass = report.backup.failed.length === 0;
  } else if (mode === 'restore') {
    report.restore = await runRestore(refs);
    report.problemsAfter = await audit(primary, refs);
    report.pass =
      report.restore.unrecoverable.length === 0 &&
      report.problemsAfter.length === 0;
  } else {
    if (env.STORAGE_DRILL_CONFIRM !== 'delete-objects') {
      console.error(
        'drill deletes objects: set STORAGE_DRILL_CONFIRM=delete-objects (non-production only)',
      );
      process.exit(2);
    }
    if (/prod/iu.test(primary)) {
      console.error(
        `refusing to run a destructive drill on bucket "${primary}"`,
      );
      process.exit(2);
    }
    if (refs.length === 0) {
      console.error(
        'no narration audio to drill with; generate or upload one first',
      );
      process.exit(2);
    }
    const before = await audit(primary, refs);
    if (before.length > 0) {
      console.error(
        `primary is not clean before the drill (${before.length} problem(s)); run restore/audit first`,
      );
      process.exit(1);
    }
    report.backup = await runBackup(refs);
    const lose = Math.min(
      refs.length,
      Math.max(1, Number(env.STORAGE_DRILL_LOSE ?? 1)),
    );
    const victims = refs.slice(0, lose).map((ref) => ref.key);
    const lostAt = Date.now();
    for (const key of victims) {
      await s3.send(new DeleteObjectCommand({ Bucket: primary, Key: key }));
    }
    log(`drill: deleted ${victims.length} object(s) from ${primary}`);
    const detected = await audit(primary, refs);
    const detectedKeys = detected.map((d) => d.key).sort();
    report.detection = {
      victims,
      detected: detectedKeys,
      exact:
        JSON.stringify(detectedKeys) === JSON.stringify([...victims].sort()),
    };
    report.restore = await runRestore(refs);
    report.problemsAfter = await audit(primary, refs);
    report.rtoMs = Date.now() - lostAt;
    report.pass =
      report.backup.failed.length === 0 &&
      report.detection.exact &&
      report.restore.unrecoverable.length === 0 &&
      report.problemsAfter.length === 0;
    log(
      `drill: detection ${report.detection.exact ? 'exact' : 'WRONG'}, restore+verify in ${report.rtoMs} ms`,
    );
  }

  if (env.STORAGE_DRILL_REPORT) {
    await writeFile(
      env.STORAGE_DRILL_REPORT,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    log(`report: ${env.STORAGE_DRILL_REPORT}`);
  }
  log(report.pass ? `PASS ${mode}` : `FAIL ${mode}`);
  process.exitCode = report.pass ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(
    `storage ${mode} aborted: ${error?.name ?? 'Error'} ${error?.$metadata?.httpStatusCode ?? ''}`.trim(),
  );
  process.exitCode = 2;
} finally {
  await pool.end();
}

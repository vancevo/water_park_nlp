import type { TtsJobStatus } from '../tts/types.js';

/**
 * Artifact/job retention selection (AI08). Pure policy: decide which TERMINAL
 * TTS jobs are past their retention window. Deletion itself is an operational
 * step (see the runbook) — this only computes the plan, deterministically, with
 * an injected `now`.
 *
 * In-flight jobs (`queued`/`running`) are never expired. Dead-lettered jobs are
 * kept for their own, usually longer, window for post-mortem.
 */

export interface RetentionPolicy {
  succeededMaxAgeDays: number;
  failedMaxAgeDays: number;
  cancelledMaxAgeDays: number;
  deadLetterMaxAgeDays: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  succeededMaxAgeDays: 180,
  failedMaxAgeDays: 30,
  cancelledMaxAgeDays: 30,
  deadLetterMaxAgeDays: 90,
};

export interface RetainableJob {
  id: string;
  status: TtsJobStatus;
  deadLettered: boolean;
  updatedAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function maxAgeDays(
  job: RetainableJob,
  policy: RetentionPolicy,
): number | null {
  if (job.deadLettered) return policy.deadLetterMaxAgeDays;
  switch (job.status) {
    case 'succeeded':
      return policy.succeededMaxAgeDays;
    case 'failed':
      return policy.failedMaxAgeDays;
    case 'cancelled':
      return policy.cancelledMaxAgeDays;
    default:
      return null; // queued / running — never expired
  }
}

export function isExpired(
  job: RetainableJob,
  policy: RetentionPolicy,
  now: Date,
): boolean {
  const days = maxAgeDays(job, policy);
  if (days === null) return false;
  return now.getTime() - job.updatedAt.getTime() > days * DAY_MS;
}

/** Ids of jobs past retention, oldest first. */
export function selectExpiredJobs(
  jobs: readonly RetainableJob[],
  policy: RetentionPolicy,
  now: Date,
): string[] {
  return jobs
    .filter((job) => isExpired(job, policy, now))
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .map((job) => job.id);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadRetentionPolicy(
  env: NodeJS.ProcessEnv = process.env,
): RetentionPolicy {
  return {
    succeededMaxAgeDays: positiveInt(
      env.TTS_RETENTION_SUCCEEDED_DAYS,
      DEFAULT_RETENTION_POLICY.succeededMaxAgeDays,
    ),
    failedMaxAgeDays: positiveInt(
      env.TTS_RETENTION_FAILED_DAYS,
      DEFAULT_RETENTION_POLICY.failedMaxAgeDays,
    ),
    cancelledMaxAgeDays: positiveInt(
      env.TTS_RETENTION_CANCELLED_DAYS,
      DEFAULT_RETENTION_POLICY.cancelledMaxAgeDays,
    ),
    deadLetterMaxAgeDays: positiveInt(
      env.TTS_RETENTION_DEAD_LETTER_DAYS,
      DEFAULT_RETENTION_POLICY.deadLetterMaxAgeDays,
    ),
  };
}

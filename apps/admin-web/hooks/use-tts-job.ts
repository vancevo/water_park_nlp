'use client';

import type { NarrationLocaleCode } from '@damsen/shared-types';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  ttsRequestErrorMessage,
  type TtsGenerationPort,
} from '@/lib/tts-generation';
import {
  inFlightTtsJob,
  isTtsJobInFlight,
  rememberTtsJob,
  nextPollDelayMs,
  shouldPoll,
  trackingStateFor,
  ttsJobReducer,
} from '@/lib/tts-job-machine';

/**
 * Drives one narration's TTS job through the port: resume (latest job) →
 * create → poll until a terminal status → cancel/retry. Polling stops on
 * unmount and never runs against a terminal job; responses that arrive after
 * the narration changed or the component unmounted are dropped. Calls
 * `onSucceeded` once per job seen succeeding on this page so the caller can
 * reload the draft, which then carries the generated audio and its
 * `audioGeneratedBy` provenance (contract v1.1).
 */
export function useTtsJob(
  port: TtsGenerationPort | null,
  narrationId: string | undefined,
  onSucceeded: () => void,
) {
  const [state, dispatch] = useReducer(ttsJobReducer, narrationId, (id) =>
    trackingStateFor(inFlightTtsJob(id)),
  );
  const notified = useRef(new Set<string>());
  const onSucceededRef = useRef(onSucceeded);
  useEffect(() => {
    onSucceededRef.current = onSucceeded;
  }, [onSucceeded]);

  // Bumped whenever the narration changes or the hook unmounts; pending
  // create/cancel responses from an older epoch are ignored.
  const epoch = useRef(0);
  const trackedNarration = useRef(narrationId);
  useEffect(() => {
    if (trackedNarration.current !== narrationId) {
      trackedNarration.current = narrationId;
      epoch.current += 1;
      dispatch({ type: 'reset', job: inFlightTtsJob(narrationId) });
    }
  }, [narrationId]);
  useEffect(() => {
    const current = epoch;
    return () => {
      current.current += 1;
    };
  }, []);

  // v1.1: ask the server for the narration's latest job so tracking survives a
  // page reload (the in-memory registry only covers remounts). A failure here
  // is not shown: the editor can still create a job, and the server rejects a
  // duplicate with 409 TTS_JOB_IN_PROGRESS.
  useEffect(() => {
    if (!port?.latest || !narrationId) return;
    const started = epoch.current;
    let cancelled = false;
    port
      .latest(narrationId)
      .then((job) => {
        if (cancelled || epoch.current !== started || !job) return;
        // A job that already finished before this mount was not produced by
        // this page; do not reload the draft for it.
        if (job.status === 'succeeded') notified.current.add(job.id);
        dispatch({ type: 'job_restored', job });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [port, narrationId]);

  useEffect(() => rememberTtsJob(state.job), [state.job]);

  const jobId = state.job?.id;
  const polling = port !== null && shouldPoll(state);
  useEffect(() => {
    if (!polling || !port || !jobId) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const job = await port.get(jobId);
        if (!cancelled) dispatch({ type: 'job_received', job });
      } catch (cause) {
        if (!cancelled)
          dispatch({
            type: 'poll_failed',
            error: ttsRequestErrorMessage(cause),
          });
      }
    }, nextPollDelayMs(state.pollAttempt));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [polling, port, jobId, state.pollAttempt]);

  useEffect(() => {
    const job = state.job;
    if (job?.status === 'succeeded' && !notified.current.has(job.id)) {
      notified.current.add(job.id);
      onSucceededRef.current();
    }
  }, [state.job]);

  const generate = useCallback(
    async (locale: NarrationLocaleCode) => {
      if (!port || !narrationId) return;
      const started = epoch.current;
      dispatch({ type: 'create_requested' });
      try {
        const job = await port.create(narrationId, { locale });
        if (epoch.current === started) dispatch({ type: 'job_received', job });
        else rememberTtsJob(job); // still in flight server-side
      } catch (cause) {
        if (epoch.current === started)
          dispatch({
            type: 'request_failed',
            error: ttsRequestErrorMessage(cause),
          });
      }
    },
    [port, narrationId],
  );

  const cancel = useCallback(async () => {
    if (!port || !jobId) return;
    const started = epoch.current;
    dispatch({ type: 'cancel_requested' });
    try {
      const job = await port.cancel(jobId);
      if (epoch.current === started) dispatch({ type: 'job_received', job });
      else rememberTtsJob(job);
    } catch (cause) {
      if (epoch.current === started)
        dispatch({
          type: 'request_failed',
          error: ttsRequestErrorMessage(cause),
        });
    }
  }, [port, jobId]);

  const resume = useCallback(() => dispatch({ type: 'resume_polling' }), []);

  return {
    state,
    inFlight: isTtsJobInFlight(state),
    generate,
    cancel,
    resume,
  };
}

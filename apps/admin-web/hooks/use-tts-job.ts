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
 * Drives one narration's TTS job through the port: create → poll until a
 * terminal status → cancel/retry. Polling stops on unmount and never runs
 * against a terminal job; responses that arrive after the narration changed or
 * the component unmounted are dropped. Calls `onSucceeded` once per succeeded
 * job so the caller can reload the draft (which carries the generated audio
 * once the backend attaches it — not yet at I01, see I02-3).
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

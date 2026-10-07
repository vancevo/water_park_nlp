'use client';

import type { NarrationLocaleCode } from '@damsen/shared-types';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  ttsRequestErrorMessage,
  type TtsGenerationPort,
} from '@/lib/tts-generation';
import {
  initialTtsJobState,
  nextPollDelayMs,
  shouldPoll,
  ttsJobReducer,
} from '@/lib/tts-job-machine';

/**
 * Drives one narration's TTS job through the port: create → poll until a
 * terminal status → cancel/retry. Polling stops on unmount and never runs
 * against a terminal job. Calls `onSucceeded` once per succeeded job so the
 * caller can reload the draft that now carries the generated audio.
 */
export function useTtsJob(
  port: TtsGenerationPort | null,
  narrationId: string | undefined,
  onSucceeded: () => void,
) {
  const [state, dispatch] = useReducer(ttsJobReducer, initialTtsJobState);
  const notified = useRef(new Set<string>());
  const onSucceededRef = useRef(onSucceeded);
  useEffect(() => {
    onSucceededRef.current = onSucceeded;
  }, [onSucceeded]);

  useEffect(() => dispatch({ type: 'reset' }), [narrationId]);

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
      dispatch({ type: 'create_requested' });
      try {
        dispatch({
          type: 'job_received',
          job: await port.create(narrationId, { locale }),
        });
      } catch (cause) {
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
    dispatch({ type: 'cancel_requested' });
    try {
      dispatch({ type: 'job_received', job: await port.cancel(jobId) });
    } catch (cause) {
      dispatch({
        type: 'request_failed',
        error: ttsRequestErrorMessage(cause),
      });
    }
  }, [port, jobId]);

  const resume = useCallback(() => dispatch({ type: 'resume_polling' }), []);

  return { state, generate, cancel, resume };
}

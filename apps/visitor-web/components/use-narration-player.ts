'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ListenHistory } from '@/lib/listen-history';
import { pickSpeechVoice } from '@/lib/narration-locales';
import {
  NarrationPlayer,
  type PlayerState,
  type SpeechLike,
} from '@/lib/narration-player';

const SERVER_STATE: PlayerState = {
  status: 'idle',
  active: null,
  pending: null,
  version: 0,
};

/** Browser voice (Web Speech) for places without an audio file. */
function createBrowserSpeech(): SpeechLike | null {
  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    !('SpeechSynthesisUtterance' in window)
  ) {
    return null;
  }
  const synthesis = window.speechSynthesis;
  // Browsers load their voice list late (Chrome returns [] at first): keep it warm so the
  // right voice exists by the time someone presses Listen, instead of the system default
  // (which can be Vietnamese reading English).
  let voices = synthesis.getVoices();
  const refreshVoices = () => {
    const next = synthesis.getVoices();
    if (next.length > 0) voices = next;
  };
  synthesis.addEventListener?.('voiceschanged', refreshVoices);
  /** Waits (briefly) for the voice list when it is still empty. */
  const voicesReady = (): Promise<void> => {
    refreshVoices();
    if (voices.length > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        synthesis.removeEventListener?.('voiceschanged', done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 1500);
      synthesis.addEventListener?.('voiceschanged', done);
    });
  };
  const say = (
    text: string,
    lang: string,
    handlers: Parameters<SpeechLike['speak']>[2],
  ) => {
    refreshVoices();
    const voice = pickSpeechVoice(voices, lang);
    // Never let the system default voice read a language it was not made for (a Vietnamese
    // voice reading English): with no voice for the language, say nothing and report it.
    if (!voice && (voices.length > 0 || !lang.toLowerCase().startsWith('vi'))) {
      handlers.onError();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang ?? lang;
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    utterance.onstart = handlers.onStart;
    utterance.onend = handlers.onEnd;
    utterance.onerror = (event) => {
      // `canceled`/`interrupted` come from our own stop(): not a failure.
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        handlers.onError();
      }
    };
    synthesis.cancel();
    synthesis.speak(utterance);
  };
  let latest = 0;
  return {
    speak(text, lang, handlers) {
      refreshVoices();
      if (voices.length > 0) {
        if (!pickSpeechVoice(voices, lang)) return false;
        say(text, lang, handlers);
        return true;
      }
      // No voice list yet: wait for it, so the language still gets its own voice.
      const ticket = ++latest;
      void voicesReady().then(() => {
        if (ticket === latest) say(text, lang, handlers);
      });
      return true;
    },
    cancel() {
      latest += 1; // a speech still waiting for the voice list is dropped too
      synthesis.cancel();
    },
  };
}

/** The app's single narration player (created in the browser) and its live state. */
export function useNarrationPlayer(): {
  player: NarrationPlayer | null;
  state: PlayerState;
  speechSupported: boolean;
} {
  const [player] = useState<NarrationPlayer | null>(() =>
    typeof window === 'undefined'
      ? null
      : new NarrationPlayer({
          history: new ListenHistory(),
          createAudio: () => new Audio(),
          speech: createBrowserSpeech(),
        }),
  );
  const state = useSyncExternalStore(
    player?.subscribe ?? (() => () => {}),
    player?.getSnapshot ?? (() => SERVER_STATE),
    () => SERVER_STATE,
  );
  // One player for the page's life: nothing keeps playing after it goes away.
  useEffect(() => () => player?.stop(), [player]);
  const [speechSupported, setSpeechSupported] = useState(false);
  useEffect(() => {
    setSpeechSupported(createBrowserSpeech() !== null);
  }, []);
  return { player, state, speechSupported };
}

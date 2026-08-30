"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Voice memo via the Web Speech API — browser-native and free, which is what
 * makes it the MVP choice. It's Chrome/Safari-only, so the button hides
 * itself where the API is missing rather than offering something that won't
 * work. Whisper remains the fallback if accents or noise prove to be a
 * problem in real use; that decision needs real recordings first.
 */
export function VoiceMemoButton({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ??
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    setSupported(true);
    const instance = new SpeechRecognition();
    instance.continuous = true;
    instance.interimResults = false;
    instance.lang = "en-US";

    instance.onresult = (event: any) => {
      const text = Array.from(event.results as ArrayLike<any>)
        .slice(event.resultIndex)
        .map((r: any) => r[0].transcript)
        .join(" ")
        .trim();
      if (text) onTranscript(text);
    };
    instance.onend = () => setListening(false);
    instance.onerror = () => setListening(false);

    recognition.current = instance;
    return () => instance.abort();
  }, [onTranscript]);

  if (!supported) return null;

  return (
    <button
      type="button"
      className={`btn-sm ${listening ? "btn-teal" : "btn-secondary"}`}
      onClick={() => {
        if (listening) {
          recognition.current?.stop();
          setListening(false);
        } else {
          recognition.current?.start();
          setListening(true);
        }
      }}
    >
      {listening ? "◼ Stop recording" : "🎙 Record a voice memo"}
    </button>
  );
}

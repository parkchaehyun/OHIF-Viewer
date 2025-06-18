import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseRecorderResult {
  recording: boolean;
  audioBlob: Blob | null;
  volume: number; // Current microphone volume (0-100+)
  start: () => void;
  stop: () => Promise<Blob | null>;
}

export interface RecorderOptions {
  onAutoStop?: () => void; // Callback when silence is detected
  silenceDuration?: number; // Milliseconds of silence before auto-stopping
  volumeThreshold?: number; // How quiet "silence" is (0-100 scale)
}

export function useRecorder({
  onAutoStop,
  silenceDuration = 1500, // 1.5 seconds of silence
  volumeThreshold = 5, // A volume level of 5 or less is considered silence
}: RecorderOptions = {}): UseRecorderResult {
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [volume, setVolume] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // --- Refs for silence detection ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const onAutoStopRef = useRef(onAutoStop);

  // Keep the onAutoStop callback fresh without re-triggering effects
  useEffect(() => {
    onAutoStopRef.current = onAutoStop;
  }, [onAutoStop]);

  const cleanupSilenceDetection = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setVolume(0);
  }, []);

  const start = useCallback(async () => {
    if (recording) {
      console.warn('Recording is already in progress.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Setup MediaRecorder to capture audio
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // --- Setup Silence Detection using Web Audio API ---
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.85;
      source.connect(analyser); // Connect the microphone source to the analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkForSilence = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        setVolume(average); // Update volume for UI feedback

        if (average > volumeThreshold) {
          // Speech is detected, so clear any existing silence timer
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else {
          // Silence is detected, so start a timer if one isn't already running
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              console.log('Silence detected for the specified duration, auto-stopping.');
              onAutoStopRef.current?.(); // Trigger the auto-stop callback
            }, silenceDuration);
          }
        }
        // Continue checking on the next animation frame
        animationFrameRef.current = requestAnimationFrame(checkForSilence);
      };

      recorder.start();
      setRecording(true);
      // Start the silence detection loop
      animationFrameRef.current = requestAnimationFrame(checkForSilence);
    } catch (err) {
      console.error('Error starting recording:', err);
    }
  }, [recording, cleanupSilenceDetection, silenceDuration, volumeThreshold]);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise(resolve => {
      // First, stop all silence detection to prevent race conditions
      cleanupSilenceDetection();

      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        setRecording(false);
        return resolve(null);
      }

      // This onstop event will fire after the last chunk is received
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);

        // Stop the microphone stream tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }

        mediaRecorderRef.current = null;
        setRecording(false);
        resolve(blob);
      };

      recorder.stop();
    });
  }, [cleanupSilenceDetection]);

  // General cleanup effect for when the component unmounts
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      cleanupSilenceDetection();
    };
  }, [cleanupSilenceDetection]);

  return { recording, audioBlob, volume, start, stop };
}

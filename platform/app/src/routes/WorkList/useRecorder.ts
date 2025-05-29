import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseRecorderResult {
  recording: boolean;
  audioBlob: Blob | null;
  start: () => void;
  stop: () => Promise<Blob | null>;
}

export function useRecorder(): UseRecorderResult {
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // 녹음 시작
  const start = useCallback(async () => {
    if (recording) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    // 초기 onstop은 그냥 blob 세팅만 하고, Promise resolve는 stop() 에서 처리
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      setAudioBlob(blob);
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  }, [recording]);

  // 녹음 중지 (Promise로 Blob 반환)
  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise(resolve => {
      const recorder = mediaRecorderRef.current;
      const stream = streamRef.current;
      if (!recorder) {
        return resolve(null);
      }

      // 녹음 끝났을 때 호출될 콜백 재정의
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);

        // MediaStream 트랙 모두 정지
        if (stream) {
          stream.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
        mediaRecorderRef.current = null;
        setRecording(false);

        resolve(blob);
      };

      recorder.stop();
    });
  }, []);

  // 언마운트 시에도 꼭 정지
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return { recording, audioBlob, start, stop };
}

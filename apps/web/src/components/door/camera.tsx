'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buttonClass } from '../button';
import { Icon } from '../icons';

type CameraState = 'idle' | 'starting' | 'on' | 'denied' | 'unavailable';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorClass = {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};
type Decode = (video: HTMLVideoElement) => Promise<string | null>;

const PREF_KEY = 'gp.door.camera';
const TICK_MS = 160;
/** jsQR works on a downscaled frame: fast on older phones, still reads a pass at arm's length. */
const FRAME_MAX = 720;

function savePref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Storage can be blocked; the camera then just asks to be started each time.
  }
}

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * The browser's own QR detector where there is one (Chrome on Android), otherwise jsQR on
 * canvas frames (iPhone Safari and the rest), loaded only when the camera starts.
 */
async function createDecoder(): Promise<Decode> {
  const BD = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (BD) {
    try {
      const formats = (await BD.getSupportedFormats?.()) ?? ['qr_code'];
      if (formats.includes('qr_code')) {
        const detector = new BD({ formats: ['qr_code'] });
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
      }
    } catch {
      // Fall through to jsQR.
    }
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!ctx || !video.videoWidth) return null;
    const scale = Math.min(1, FRAME_MAX / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const frame = ctx.getImageData(0, 0, w, h);
    return jsQR(frame.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/**
 * The rear camera, reading QR codes continuously while `paused` is false. Each read is passed
 * to `onCode`; the parent decides what to do with repeats.
 */
export function Camera({ paused, onCode }: { paused: boolean; onCode: (text: string) => void }) {
  const t = useTranslations('door.camera');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(paused);
  const onCodeRef = useRef(onCode);
  const [state, setState] = useState<CameraState>('idle');

  useEffect(() => {
    pausedRef.current = paused;
    onCodeRef.current = onCode;
  });

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }
    setState('starting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      stream.current = media;
      const el = video.current;
      if (!el) return stop();
      el.srcObject = media;
      await el.play();
      const decode = await createDecoder();
      setState('on');
      savePref(true);
      const tick = async () => {
        if (!stream.current) return;
        if (!pausedRef.current && el.readyState >= 2) {
          try {
            const text = await decode(el);
            if (text && !pausedRef.current) onCodeRef.current(text);
          } catch {
            // A frame that fails to decode is simply skipped.
          }
        }
        timer.current = setTimeout(tick, TICK_MS);
      };
      void tick();
    } catch (err) {
      stop();
      const name = err instanceof DOMException ? err.name : '';
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
    }
  }, [stop]);

  useEffect(() => {
    if (readPref()) void start();
    return stop;
  }, [start, stop]);

  const turnOff = () => {
    stop();
    savePref(false);
    setState('idle');
  };

  const on = state === 'on' || state === 'starting';
  return (
    <div className="door-camera">
      <div className={`door-viewfinder ${on ? 'is-on' : ''}`}>
        <video ref={video} muted playsInline aria-hidden="true" />
        {on && <span className="door-frame" aria-hidden="true" />}
        {!on && (
          <div className="door-camera-idle">
            <Icon name="qr" />
            {state === 'denied' && <p>{t('denied')}</p>}
            {state === 'unavailable' && <p>{t('unavailable')}</p>}
            <button
              type="button"
              className={buttonClass('primary')}
              onClick={() => void start()}
              disabled={state === 'unavailable'}
            >
              <Icon name="scan" />
              {t('start')}
            </button>
          </div>
        )}
      </div>
      {on && (
        <div className="door-camera-foot">
          <p>{t('hint')}</p>
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={turnOff}>
            {t('stop')}
          </button>
        </div>
      )}
    </div>
  );
}

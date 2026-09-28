'use client';

import { useEffect } from 'react';

/**
 * Tells the server a person opened the invitation. It runs only in a browser that executes the
 * page's script and keeps it visible for a moment, which link-preview bots don't do.
 */
export function OpenBeacon({ token }: { token: string }) {
  useEffect(() => {
    let sent = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      if (sent) return;
      sent = true;
      void fetch(`/api/v1/public/i/${token}/opened`, {
        method: 'POST',
        keepalive: true,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      }).catch(() => undefined);
    };
    const arm = () => {
      if (document.visibilityState === 'visible' && !timer) timer = setTimeout(send, 1200);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') arm();
      else if (timer && !sent) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    arm();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer) clearTimeout(timer);
    };
  }, [token]);
  return null;
}

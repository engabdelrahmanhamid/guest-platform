'use client';

import { useEffect, useState } from 'react';

function parts(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return {
    days: Math.floor(minutes / 1440),
    hours: Math.floor((minutes % 1440) / 60),
    minutes: minutes % 60,
  };
}

/**
 * Days, hours and minutes to the start. Rendered on the server first (so it shows without
 * JavaScript) and refreshed once a minute. Hidden once the event has started.
 */
export function Countdown({
  startsAt,
  serverNow,
  title,
  labels,
}: {
  startsAt: string;
  serverNow: number;
  title: string;
  labels: { days: string; hours: string; minutes: string };
}) {
  const start = new Date(startsAt).getTime();
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (start <= now) return null;
  const p = parts(start - now);
  const fmt = new Intl.NumberFormat('ar-SA-u-nu-latn');
  return (
    <div className="inv-countdown" role="timer" aria-label={title}>
      <p className="inv-countdown-title">{title}</p>
      <div className="inv-countdown-cells">
        {(['days', 'hours', 'minutes'] as const).map((k) => (
          <span key={k} className="inv-countdown-cell">
            <strong>{fmt.format(p[k])}</strong>
            <span>{labels[k]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

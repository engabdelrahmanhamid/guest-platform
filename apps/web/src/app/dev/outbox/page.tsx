import { notFound } from 'next/navigation';
import { getDevOutbox } from '@/lib/server';

export const dynamic = 'force-dynamic';

/**
 * Development only: account emails (verification, password reset) land here instead of a mail
 * provider, so their links never reach the logs. 404 in production.
 */
export default function DevOutboxPage() {
  const outbox = getDevOutbox();
  if (!outbox) notFound();
  const mails = [...outbox.sent].reverse();
  return (
    <main className="page container">
      <h1>Dev outbox</h1>
      {mails.length === 0 && <p className="muted">Empty.</p>}
      <ul className="list">
        {mails.map((m, i) => (
          <li key={i} className="ltr">
            <strong>{m.kind}</strong> → {m.to}
            <br />
            <a href={m.link}>{m.link}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}

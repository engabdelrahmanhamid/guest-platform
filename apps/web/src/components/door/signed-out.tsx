import { getTranslations } from 'next-intl/server';
import { DoorShell } from './door-shell';
import { Icon } from '../icons';

/** A device with no valid door session: how to get in, and nothing about any event. */
export async function SignedOut() {
  const t = await getTranslations('door.signedOut');
  return (
    <DoorShell>
      <main className="door-entry">
        <section className="door-entry-card" aria-labelledby="entry-h">
          <span className="door-entry-glyph is-muted">
            <Icon name="key" />
          </span>
          <h1 id="entry-h">{t('title')}</h1>
          <p className="door-entry-body">{t('body')}</p>
        </section>
      </main>
    </DoorShell>
  );
}

import {
  getStaffLink,
  guardPublicRequest,
  isDomainError,
  isStaffLinkToken,
  noteUnknownToken,
} from '@gp/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/button';
import { DoorShell } from '@/components/door/door-shell';
import { Icon } from '@/components/icons';
import { publicClient } from '@/lib/public';
import { getCoreContext } from '@/lib/server';
import { redeemAction } from './actions';

export const dynamic = 'force-dynamic';

// Link previews see a generic title only: no event or staff name.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('door.link');
  return {
    title: { absolute: t('metaTitle') },
    robots: { index: false, follow: false },
    referrer: 'origin',
    openGraph: { title: t('metaTitle') },
  };
}

/**
 * A staff member's one-time access link. Opening it only shows who it is for; nothing is used up
 * until Continue is tapped on the device that will scan.
 */
export default async function StaffLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isStaffLinkToken(token)) notFound();
  const ctx = getCoreContext();
  const client = await publicClient();
  const t = await getTranslations('door.link');
  try {
    await guardPublicRequest(ctx.db, 'view', client, token, ctx.now());
  } catch (err) {
    if (isDomainError(err, 'rate_limited')) {
      return <Notice icon="clock" title={t('busyTitle')} body={t('busyBody')} />;
    }
    throw err;
  }
  const link = await getStaffLink(ctx, token);
  if (!link) {
    await noteUnknownToken(ctx.db, client, ctx.now());
    notFound();
  }
  if (link.state !== 'ready') {
    return (
      <Notice
        icon={link.state === 'used' ? 'phone' : 'ban'}
        title={t(`${link.state}Title`)}
        body={t(`${link.state}Body`)}
      />
    );
  }
  return (
    <DoorShell>
      <main className="door-entry">
        <section className="door-entry-card" aria-labelledby="entry-h">
          <span className="door-entry-glyph">
            <Icon name="scan" />
          </span>
          <p className="door-entry-kicker">{t('title')}</p>
          <h1 id="entry-h">{t('event', { event: link.eventName ?? '' })}</h1>
          <p className="door-entry-who">
            {t('as', { name: link.staffName ?? '' })}
            {link.isSupervisor && <span className="tag tag-accent">{t('supervisor')}</span>}
          </p>
          <p className="door-entry-body">{t('body')}</p>
          <form action={redeemAction.bind(null, token)}>
            <button type="submit" className={buttonClass('primary', undefined, true)}>
              {t('continue')}
            </button>
          </form>
        </section>
      </main>
    </DoorShell>
  );
}

function Notice({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <DoorShell>
      <main className="door-entry">
        <section className="door-entry-card" aria-labelledby="entry-h">
          <span className="door-entry-glyph is-muted">
            <Icon name={icon} />
          </span>
          <h1 id="entry-h">{title}</h1>
          <p className="door-entry-body">{body}</p>
        </section>
      </main>
    </DoorShell>
  );
}

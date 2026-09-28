import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { Icon } from '@/components/icons';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations();
  const points = ['panelPoint1', 'panelPoint2', 'panelPoint3'] as const;
  return (
    <div className="auth">
      <aside className="auth-panel">
        <Brand name={t('app.name')} />
        <div>
          <h2>{t('auth.panelTitle')}</h2>
          <ul>
            {points.map((p) => (
              <li key={p}>
                <Icon name="checkCircle" />
                {t(`auth.${p}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="foot">{t('auth.panelFoot')}</p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <Brand name={t('app.name')} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

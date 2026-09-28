import {
  DESIGN_BODY_MAX,
  DESIGN_COLORS,
  DESIGN_TITLE_MAX,
  getInvitationDesign,
  INVITATION_TEMPLATES,
  isEditable,
} from '@gp/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/button';
import { ActionForm, Field, SubmitButton, TextArea } from '@/components/forms';
import { Icon } from '@/components/icons';
import { loadEventView } from '@/lib/events';
import { getCoreContext } from '@/lib/server';
import { imageAction, saveDesignAction } from './actions';

export const metadata: Metadata = { title: 'الدعوة' };

const TOGGLES = [
  'showDate',
  'showTime',
  'showVenue',
  'showAddress',
  'showMap',
  'showDescription',
  'showCountdown',
] as const;

/**
 * The invitation's look: one of four templates, a colour, images, wording and which details
 * show. A live phone preview sits beside the form. No free layout by design.
 */
export default async function InvitationDesignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { principal, view } = await loadEventView(id);
  if (view.membership.role !== 'owner') notFound();
  const t = await getTranslations('design');
  const { event: e, design } = await getInvitationDesign(getCoreContext(), principal.user.id, id);
  const editable = isEditable(e) && !e.disabledAt;
  const custom = !(DESIGN_COLORS as readonly string[]).includes(design.primaryColor);
  const previewSrc = `/events/${id}/preview?embed=1&v=${encodeURIComponent(
    [
      design.template,
      design.primaryColor,
      e.coverImageKey,
      e.logoKey,
      e.updatedAt.getTime(),
      sp.done,
    ].join('.'),
  )}`;

  return (
    <div className="stack-lg design-page">
      <div className="page-head">
        <div className="titles">
          <h2 className="t-title">{t('title')}</h2>
          <p className="t-support">{t('subtitle')}</p>
        </div>
        <a
          href={`/events/${id}/preview`}
          target="_blank"
          rel="noopener"
          className={buttonClass('secondary')}
        >
          <Icon name="eye" />
          {t('openPreview')}
        </a>
      </div>

      {sp.done && t.has(`done.${sp.done}`) && (
        <p role="status" className="alert alert-ok">
          <Icon name="checkCircle" />
          <span className="grow">{t(`done.${sp.done}`)}</span>
        </p>
      )}
      {!editable && (
        <p className="alert alert-neutral">
          <Icon name="info" />
          <span className="grow">{t('readOnly')}</span>
        </p>
      )}

      <div className="design-layout">
        <div className="design-controls stack-lg">
          <ActionForm action={saveDesignAction.bind(null, id)} className="form design-form">
            <fieldset className="panel design-block" disabled={!editable}>
              <legend className="t-card">{t('template.title')}</legend>
              <div className="template-grid">
                {INVITATION_TEMPLATES.map((tpl) => (
                  <label key={tpl} className={`template-card template-${tpl}`}>
                    <input
                      type="radio"
                      name="template"
                      value={tpl}
                      defaultChecked={design.template === tpl}
                    />
                    <span className="template-swatch" aria-hidden="true">
                      <span className="ts-cover" />
                      <span className="ts-line" />
                      <span className="ts-line short" />
                      <span className="ts-btn" />
                    </span>
                    <span className="template-name">{t(`template.${tpl}.name`)}</span>
                    <span className="template-hint">{t(`template.${tpl}.hint`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="panel design-block" disabled={!editable}>
              <legend className="t-card">{t('color.title')}</legend>
              <div className="swatches" role="radiogroup" aria-label={t('color.title')}>
                {DESIGN_COLORS.map((c) => (
                  <label key={c} className="swatch" style={{ '--sw': c } as React.CSSProperties}>
                    <input
                      type="radio"
                      name="colorChoice"
                      value={c}
                      defaultChecked={design.primaryColor === c}
                      aria-label={c}
                    />
                  </label>
                ))}
                <label className="swatch swatch-custom">
                  <input
                    type="radio"
                    name="colorChoice"
                    value="custom"
                    defaultChecked={custom}
                    aria-label={t('color.custom')}
                  />
                  <span>{t('color.custom')}</span>
                  <input
                    type="color"
                    name="customColor"
                    defaultValue={design.primaryColor}
                    aria-label={t('color.pick')}
                  />
                </label>
              </div>
              <p className="field-hint">{t('color.hint')}</p>
            </fieldset>

            <fieldset className="panel design-block" disabled={!editable}>
              <legend className="t-card">{t('wording.title')}</legend>
              <Field
                name="title"
                label={t('wording.headline')}
                hint={t('wording.headlineHint')}
                defaultValue={design.customTitle ?? ''}
                placeholder={e.name}
                maxLength={DESIGN_TITLE_MAX}
              />
              <TextArea
                name="bodyText"
                label={t('wording.message')}
                hint={t('wording.messageHint')}
                defaultValue={design.bodyText ?? ''}
                rows={3}
                maxLength={DESIGN_BODY_MAX}
              />
            </fieldset>

            <fieldset className="panel design-block" disabled={!editable}>
              <legend className="t-card">{t('show.title')}</legend>
              <div className="toggle-grid">
                {TOGGLES.map((k) => (
                  <label key={k} className="toggle">
                    <input type="checkbox" name={k} defaultChecked={design[k]} />
                    <span>{t(`show.${k}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {editable && (
              <div className="form-actions">
                <SubmitButton>{t('save')}</SubmitButton>
              </div>
            )}
          </ActionForm>

          <section className="panel design-block" aria-labelledby="images-h">
            <h3 id="images-h" className="t-card">
              {t('images.title')}
            </h3>
            <p className="field-hint">{t('images.hint')}</p>
            {(['cover', 'logo'] as const).map((kind) => {
              const key = kind === 'cover' ? e.coverImageKey : e.logoKey;
              return (
                <ActionForm
                  key={kind}
                  action={imageAction.bind(null, id, kind)}
                  className="image-row"
                >
                  <div className={`image-thumb image-thumb-${kind}`}>
                    {key ? <img src={`/media/${key}`} alt="" /> : <Icon name="frame" />}
                  </div>
                  <div className="grow stack-sm">
                    <p className="image-label">{t(`images.${kind}`)}</p>
                    <p className="field-hint">{t(`images.${kind}Rules`)}</p>
                    {editable && (
                      <div className="row-tight wrap">
                        <input
                          type="file"
                          name="file"
                          accept="image/jpeg,image/png,image/webp"
                          aria-label={t(`images.${kind}`)}
                        />
                        <SubmitButton variant="secondary" size="sm">
                          <Icon name="upload" />
                          {key ? t('images.replace') : t('images.upload')}
                        </SubmitButton>
                        {key && (
                          <button
                            type="submit"
                            name="op"
                            value="remove"
                            className={buttonClass('ghost', 'sm')}
                          >
                            <Icon name="trash" />
                            {t('images.remove')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </ActionForm>
              );
            })}
          </section>
        </div>

        <aside className="design-preview" aria-label={t('preview')}>
          <div className="phone-frame">
            <iframe src={previewSrc} title={t('preview')} loading="lazy" />
          </div>
          <p className="field-hint center">{t('previewHint')}</p>
        </aside>
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { consultOpen, type ConsultCatDetail } from '@/components/mal/types';
import { CSL_DESC, SAFE_CONSULT } from '@/components/mal/copy';
import '@/styles/mal.css';
import { getTranslations } from 'next-intl/server';

interface DirEntry { id: string; displayName: string; intro?: string | null; contactPhone: string; websiteUrl?: string | null; sido: string }
interface DirList { adLabel: string; note: string; entries: DirEntry[] }

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('consult'))('detail.title') };
}

const LIST = '/mall?axis=consult';

/**
 * SB-MAL-CSL-025 — 상담 업종 상세 (v10.24 · 시안 #/mal/consult/{code})
 *                  법률 · 세무 사무소 보기 (월 정액 노출형 · D019 — 시안에서는 「CSL-050 제안」 화면, 같은 주소라 한 화면으로 등록)
 *
 * 10/7 지시 「생활금융 부분(리스트 및 상세 보기 · 상담하기)을 작동 가능하게」 · 답 「상세 보기 = 업종 상세」.
 * 목록의 줄 → **이 화면(상세)** → 맨 아래 줄의 「상담 신청」 → 신청서(/mal/consult/{code}/apply · SB-MAL-CSL-030).
 *
 *  · 숫자(인증업체 수 · 받는 지역 · 진행 규칙)는 전부 GET /consult/categories/{code} 그대로입니다 — 화면에 적어 둔 숫자가 없습니다.
 *  · 업체 이름 · 연락처는 보여 주지 않습니다. 어느 업체에 갈지는 서버가 1곳으로 정합니다(소비자가 고르는 화면이 아닙니다).
 *  · 받을 업체가 0곳이면 「상담 신청」을 막고 까닭을 적습니다 — 신청해도 아무도 받지 않습니다(규칙은 D018 그대로).
 *  · 법률 · 세무는 상담 신청을 받지 않습니다 — 같은 주소에서 「광고」 표시와 함께 사무소 목록을 보여 줍니다(전과 같음).
 */
export default async function ConsultDetailPage({ params }: Props) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  /* 코드 모양이 아니면 서버에 묻지 않습니다(서버도 같은 규칙으로 404) */
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) notFound();
  const c = await apiGet<ConsultCatDetail>(`/consult/categories/${encodeURIComponent(code)}`, 60).catch(() => null);
  if (!c) notFound();
  const t = await getTranslations('consult');

  if (c.status === 'APPROVED' && c.consultMode === 'LISTING_FEE') {
    const dir = await apiGet<DirList>(`/consult/directory/${encodeURIComponent(c.code)}`, 60).catch(() => null);
    return (
      <><div className="mal mal-narrow mal-proto" data-consult-dir={c.code}>
        <BackBar href="/mal/consult" label={t('common.consultName')} wrap={false} />
        <div className="page-head mal-head">
          <h1>{c.name}</h1>
          <p className="mal-desc">{t.rich('detail.dirDesc', { strong: (x) => <strong>{x}</strong> })}</p>
        </div>
        <div className="mal-warn ok">
          <b>{t('detail.dirWarnB')}</b>{' '}
          {t('detail.dirWarn', { label: dir?.adLabel ?? t('common.ad') })}
        </div>
        <section className="mal-panel" aria-labelledby="dir-h">
          <div className="mal-sh2"><b id="dir-h">{t('detail.dirCount', { n: String(dir ? dir.entries.length : 0) })}</b><span className="mal-ls">{dir?.adLabel ?? t('common.ad')}</span></div>
          {!dir || dir.entries.length === 0 ? (
            <p className="mal-empty">{t('detail.dirEmpty')}</p>
          ) : (
            <ul className="mal-rows">
              {dir.entries.map((e) => (
                <li key={e.id} className="mal-row" data-dir-entry={e.id}>
                  <div className="mal-row-l">
                    <span className="mal-tag">{dir.adLabel}</span>
                    <b>{e.displayName}</b>
                    <span className="mal-ls">{[e.intro, e.sido].filter(Boolean).join(' · ')}</span>
                  </div>
                  <div className="mal-row-r">
                    {e.websiteUrl && <a className="mal-btn ghost" href={e.websiteUrl} target="_blank" rel="noopener noreferrer nofollow sponsored">{t('detail.homepage')}</a>}
                    <a className="mal-btn" href={`tel:${e.contactPhone.replace(/[^0-9]/g, '')}`}>{e.contactPhone}</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="mal-ls">{t('detail.dirFoot')}</p>
        <div className="mal-act">
          <a className="mal-btn ghost" href={LIST}>{t('common.otherCats')}</a>
          <a className="mal-btn ghost" href="/partner/listings">{t('detail.dirApply')}</a>
        </div>
      </div><i hidden data-root-end="" /></>
    );
  }

  const open = consultOpen(c);
  const gated = c.publishMode === 'GATED';
  const ru = c.rules;
  const why = c.status === 'PENDING' ? t('common.whyPending')
    : gated ? t('common.whyGated') : t('common.whyNone');
  const desc = CSL_DESC[c.code];
  return (
    <><div className="mal mal-narrow mal-cd mal-proto" data-consult-detail={c.code} data-consult-mode={open ? 'open' : c.status === 'PENDING' ? 'hold' : 'none'}>
      <BackBar href="/mal/consult" label={t('common.consultName')} wrap={false} />
      <section className="mal-panel mal-cd-panel" aria-labelledby="cd-h">
        <header className="mal-cd-head">
          <div className="mal-cd-tags">
            <span className={`mal-tag${gated ? ' gated' : ''}`}>{gated ? t('common.tagGated') : t('common.tagGeneral')}</span>
            <span className="mal-tag">{t('detail.leadType')}</span>
          </div>
          <h1 id="cd-h">{c.name}</h1>
          {desc && <p className="mal-cd-desc">{t(desc)}</p>}
          <p className="mal-ls">
            {gated ? t('detail.gatedLead') : t('detail.generalLead')}
          </p>
        </header>

        <div className="mal-cd-stats" role="group" aria-label={t('detail.glance')}>
          <div className="cell"><div className="k">{t('detail.statPartners')}</div><div className="v">{t('detail.places', { n: String(c.partnerCount) })}</div></div>
          <div className="cell"><div className="k">{t('detail.statRegions')}</div><div className="v">{t('detail.places', { n: String(c.regions.length) })}</div></div>
          <div className="cell"><div className="k">{t('detail.statDeliver')}</div><div className="v">{ru ? t('detail.deliverOnly', { n: String(ru.deliverTo) }) : '—'}</div></div>
        </div>

        <section className="mal-cd-sec" aria-labelledby="cd-reg-h">
          <h2 id="cd-reg-h">{t('detail.statRegions')}</h2>
          {c.regions.length === 0 ? (
            <p className="mal-empty">{t('detail.regionsEmpty')}</p>
          ) : (
            <>
              <ul className="mal-cd-regions">
                {c.regions.map((r) => <li key={r.sido}><b>{r.sido}</b><span>{t('detail.places', { n: String(r.partnerCount) })}</span></li>)}
              </ul>
              <p className="mal-ls">{t('detail.regionsNote')}</p>
            </>
          )}
        </section>

        {ru && (
          <section className="mal-cd-sec" aria-labelledby="cd-step-h">
            <h2 id="cd-step-h">{t('detail.stepsH')}</h2>
            <ol className="mal-steps mal-cd-steps">
              <li className="on"><span className="n">1</span><div><b>{t('detail.step1B')}</b><p>{t('detail.step1P')}</p></div></li>
              <li><span className="n">2</span><div><b>{t('detail.step2B')}</b><p>{t('detail.step2P', { min: String(ru.otpMinutes) })}</p></div></li>
              <li><span className="n">3</span><div><b>{t('detail.step3B', { n: String(ru.deliverTo) })}</b><p>{t('detail.step3P')}</p></div></li>
            </ol>
          </section>
        )}

        <section className="mal-cd-sec" aria-labelledby="cd-note-h">
          <h2 id="cd-note-h">{t('detail.notesH')}</h2>
          <ul className="mal-cd-notes">
            <li>{t.rich('detail.note1', { b: (x) => <b>{x}</b> })}</li>
            {SAFE_CONSULT.slice(1).map((x) => <li key={x}>{t(x)}</li>)}
            {ru && <li>{t('detail.dailyLimit', { n: String(ru.dailyLimit) })}</li>}
            {ru && <li>{t('detail.viewTtl', { h: String(ru.viewTtlHours) })}</li>}
          </ul>
        </section>

        <div className="mal-cd-bar">
          <a className="mal-btn ghost" href={LIST}>{t('detail.toList')}</a>
          <span className="sp" />
          {open ? (
            <a className="mal-btn mal-cd-go" href={`/mal/consult/${encodeURIComponent(c.code)}/apply`}>
              <span>{t('common.apply')}</span><small>{t('detail.goSub')}</small>
            </a>
          ) : (
            <>
              <span className="mal-ls">{why}</span>
              <button className="mal-btn mal-cd-go" type="button" disabled><span>{t('detail.hold')}</span><small>{t('detail.holdSub')}</small></button>
            </>
          )}
        </div>
      </section>
    </div><i hidden data-root-end="" /></>
  );
}

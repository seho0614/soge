import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, Empty, Note, Pgh, S2, Tw } from '@/components/partner/ui';
import { ServiceWizard, type WizCategory } from '@/components/partner/ServiceTools';
import { ServiceForm } from './ServiceForm';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partnerOps.svcNew'))('title') };
}

interface Forms {
  forms: Array<{ form: string; label: string; steps: string[]; categories: string[] }>;
  categories: WizCategory[];
  rates: Array<{ grade: string; label: string; rate: number }>;
  blocks: Array<{ kind: string; label: string }>;
  note: string;
}

/**
 * SB-PTC-CTR-210 서비스 등록 — v10.31 (W5 · 10/10 시안 기준 scPtnReg) 「카테고리를 고르면 등록 화면이 정해집니다」
 *   안내 → 「등록 방식 · 해당 카테고리 · 단계 · 순서」 표(서버의 업종 → 등록 방식) → 위자드(매트릭스 견적 7단계 · 그 밖 3단계).
 *   등록 방식이 정해지지 않은 업종은 시안대로 진행되지 않습니다(고를 수 없음). 업종 없이 서비스명 · 설명만 내던 개발의 간단 등록은
 *   아래 「간단 등록」으로 남깁니다(개발에만 있던 기능 — 유지).
 */
export default async function NewServicePage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('partnerOps.svcNew');
  const f = await apiGet<Forms>('/partner/service-forms', 0).catch(() => null);

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      <Note kind="info"><b>{f?.note ?? t('noteFb')}</b></Note>
      {f ? (
        <Tw head={[t('th.form'), t('th.cats'), t('th.steps'), t('th.order')]}>
          {f.forms.map((x) => (
            <tr key={x.form}>
              <td><b>{x.label}</b></td>
              <td>{x.categories.length ? x.categories.join(' · ') : <span className="pt-ls">— ({t('noCat')})</span>}</td>
              <td>{t('stepsN', { n: String(x.steps.length) })}</td>
              <td>{x.steps.join(' → ')}</td>
            </tr>
          ))}
          {f.categories.some((c) => !c.form) && (
            <tr><td><b>{t('undecided')}</b></td><td>{f.categories.filter((c) => !c.form).map((c) => c.name).join(' · ')}</td><td><Bg tone="no">—</Bg></td><td>{t('undecidedNote')}</td></tr>
          )}
        </Tw>
      ) : <Empty>{t('loadFail')}</Empty>}

      {/* v10.32 — 시안 「매트릭스 견적 7단계」 펼친 단계 목록. 단계 이름은 서버 등록 방식(service-forms)의 순서 그대로 */}
      {(() => {
        const mx = f?.forms.find((x) => /매트릭스/.test(x.label)) ?? null;
        return mx ? (
          <section data-matrix-steps="">
            <S2>{mx.label} {t('stepsN', { n: String(mx.steps.length) })}</S2>
            <ol className="pt-nsteps">
              {mx.steps.map((st, i) => <li key={st}><span className="n">{i + 1}</span><div><b>{st}</b></div></li>)}
            </ol>
          </section>
        ) : null;
      })()}

      <S2>{t('title')}</S2>
      {f ? <ServiceWizard categories={f.categories} rates={f.rates} blocks={f.blocks} /> : null}

      <Note kind="warn">{t.rich('bannedNote', { b: (c) => <b>{c}</b> })}</Note>

      <details className="pt-fset" style={{ marginTop: 14 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>{t('simpleSummary')}</summary>
        <div style={{ marginTop: 12 }}><ServiceForm /></div>
      </details>
      <div className="pt-dact">
        <Link className="pt-bp" href="/partner/services">{t('toServices')}</Link>
        <Link className="pt-bo" href="/partner/regions">{t('toRegions')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

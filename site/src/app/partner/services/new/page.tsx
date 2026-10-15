import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, Empty, Note, Pgh, S2, Tw } from '@/components/partner/ui';
import { ServiceWizard, type WizCategory } from '@/components/partner/ServiceTools';
import { ServiceForm } from './ServiceForm';

export const metadata: Metadata = { title: '서비스 등록' };

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
  const f = await apiGet<Forms>('/partner/service-forms', 0).catch(() => null);

  return (
    <><Pgh title="서비스 등록" sub="카테고리를 고르면 등록 화면이 정해집니다. 규제 업종은 접수 방식이 고정됩니다." />
      <Note kind="info"><b>{f?.note ?? '카테고리가 등록 화면을 정합니다.'}</b></Note>
      {f ? (
        <Tw head={['등록 방식', '해당 카테고리', '단계', '순서']}>
          {f.forms.map((x) => (
            <tr key={x.form}>
              <td><b>{x.label}</b></td>
              <td>{x.categories.length ? x.categories.join(' · ') : <span className="pt-ls">— (해당 업종 없음)</span>}</td>
              <td>{x.steps.length}단계</td>
              <td>{x.steps.join(' → ')}</td>
            </tr>
          ))}
          {f.categories.some((c) => !c.form) && (
            <tr><td><b>미정</b></td><td>{f.categories.filter((c) => !c.form).map((c) => c.name).join(' · ')}</td><td><Bg tone="no">—</Bg></td><td>폼 유형이 지정되지 않아 등록 · 단가 입력이 막혀 있습니다</td></tr>
          )}
        </Tw>
      ) : <Empty>등록 방식을 불러오지 못했습니다.</Empty>}

      {/* v10.32 — 시안 「매트릭스 견적 7단계」 펼친 단계 목록. 단계 이름은 서버 등록 방식(service-forms)의 순서 그대로 */}
      {(() => {
        const mx = f?.forms.find((x) => /매트릭스/.test(x.label)) ?? null;
        return mx ? (
          <section data-matrix-steps="">
            <S2>{mx.label} {mx.steps.length}단계</S2>
            <ol className="pt-nsteps">
              {mx.steps.map((st, i) => <li key={st}><span className="n">{i + 1}</span><div><b>{st}</b></div></li>)}
            </ol>
          </section>
        ) : null;
      })()}

      <S2>서비스 등록</S2>
      {f ? <ServiceWizard categories={f.categories} rates={f.rates} blocks={f.blocks} /> : null}

      <Note kind="warn"><b>금칙어가 있으면 등록되지 않습니다.</b> &lsquo;원금 보장&rsquo; &lsquo;100% 성공&rsquo; 같은 확정 결과를 약속하는 표현은 자동으로 걸리고, 반려 사유에 어느 표현인지 그대로 나옵니다.</Note>

      <details className="pt-fset" style={{ marginTop: 14 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>간단 등록(업종 없이 서비스명 · 설명만)</summary>
        <div style={{ marginTop: 12 }}><ServiceForm /></div>
      </details>
      <div className="pt-dact">
        <Link className="pt-bp" href="/partner/services">내 서비스로</Link>
        <Link className="pt-bo" href="/partner/regions">서비스 지역 설정</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

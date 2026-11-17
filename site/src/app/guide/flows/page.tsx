import type { Metadata } from 'next';
import Link from 'next/link';
import { getMessages, getTranslations } from 'next-intl/server';
import { BackBar } from '@/components/common/BackBar';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('policy'))('flows.title') };
}

/* 흐름마다 바로 가기 주소 — 글은 사전 policy.flows.items.<키> · 단계는 번호 열쇠("1", "2" …)의 글자(사전 값은 모두 글자 — 옛 번역 시험) */
const FLOWS = [
  ['join', '/signup'], ['earn', '/money'], ['consult', '/mall?axis=consult'], ['buy', '/health'],
  ['support', '/support/new'], ['partner', '/partner/apply'], ['affiliate', '/partners'],
] as const;

/**
 * SB-HOM-ETC-050 이용 흐름 (v10.343 · docs/476)
 *   대표 11/17 「업무별 워크 플로우 작성」 → 흐름표 → 「다음개발」 ④ 회원용 이용 흐름. 회원 · 파트너가 자주 하는 일 일곱 가지 — 단계(번호 = 순서) · 바로 가기.
 *   상담 신청 바로 가기는 안심소개 상담 축 주소(리드관을 켜면 그 주소가 /lead 로 넘어감).
 */
export default async function FlowsPage() {
  const t = await getTranslations('policy');
  const items = ((await getMessages()) as unknown as { policy: { flows: { items: Record<string, { steps: Record<string, string> }> } } }).policy.flows.items;
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-ETC-050" style={{ maxWidth: 1000 }}>
      <BackBar href="/guide" label={t('flows.back')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{t('flows.title')}</h1>
        <p>{t('flows.intro')}</p>
      </div>
      {FLOWS.map(([k, href]) => {
        const steps = Object.values(items[k]?.steps || {});
        return (
          <section key={k} className="w1-panel" style={{ marginTop: 14 }} data-guide-flow={k}>
            <h2 className="w1-s2" style={{ marginTop: 0 }}>{t(`flows.items.${k}.t`)} <small className="w1-ls">{t('flows.who')}: {t(`flows.items.${k}.who`)}</small></h2>
            <ol className="w1-flow">
              {steps.map((s, i) => <li key={i}><span className="n">{i + 1}</span><div><p style={{ margin: 0 }}>{s}</p></div></li>)}
            </ol>
            <p><Link className="w1-bo" href={href} data-guide-flow-go={k}>{t('flows.go')} →</Link></p>
          </section>
        );
      })}
    </div>
  );
}

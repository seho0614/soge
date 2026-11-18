import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
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

interface DictFlow { t: string; who: string; steps: Record<string, string> }
interface DbFlow { code: string; titleKo: string; whoKo: string; stepsKo: string[]; titleEn: string | null; whoEn: string | null; stepsEn: string[] | null; href: string }
interface Shown { code: string; title: string; who: string; steps: string[]; href: string }

/**
 * SB-HOM-ETC-050 이용 흐름 (v10.343 · docs/476)
 *   대표 11/17 「업무별 워크 플로우 작성」 → 흐름표 → 「다음개발」 ④ 회원용 이용 흐름. 회원 · 파트너가 자주 하는 일 일곱 가지 — 단계(번호 = 순서) · 바로 가기.
 *   상담 신청 바로 가기는 안심소개 상담 축 주소(리드관을 켜면 그 주소가 /lead 로 넘어감).
 * v10.347 (D233 · docs/481) — 글은 운영 화면 관 관리 › 「이용 흐름」에서 고친 DB 판(GET /guide/flows)을 읽습니다.
 *   영어 화면에서 DB 영어 칸이 비면 사전 영어 글(같은 코드) → 없으면 한국어. API 를 못 읽으면 사전 글 일곱 가지(v10.343 그대로).
 */
export default async function FlowsPage() {
  const t = await getTranslations('policy');
  const [locale, msgs, db] = await Promise.all([
    getLocale(), getMessages(),
    apiGet<{ rows: DbFlow[] }>('/guide/flows').then((r) => r.rows).catch(() => null),
  ]);
  const items = (msgs as unknown as { policy: { flows: { items: Record<string, DictFlow> } } }).policy.flows.items;
  const dictSteps = (k: string) => Object.values(items[k]?.steps || {});
  const shown: Shown[] = db && db.length
    ? db.map((f) => locale === 'ko'
      ? { code: f.code, title: f.titleKo, who: f.whoKo, steps: f.stepsKo, href: f.href }
      : {
        code: f.code, href: f.href,
        title: f.titleEn ?? items[f.code]?.t ?? f.titleKo,
        who: f.whoEn ?? items[f.code]?.who ?? f.whoKo,
        steps: f.stepsEn ?? (items[f.code] ? dictSteps(f.code) : f.stepsKo),
      })
    : FLOWS.map(([k, href]) => ({ code: k, title: items[k]?.t ?? k, who: items[k]?.who ?? '', steps: dictSteps(k), href }));
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-ETC-050" data-guide-flows-src={db && db.length ? 'db' : 'dict'} style={{ maxWidth: 1000 }}>
      <BackBar href="/guide" label={t('flows.back')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{t('flows.title')}</h1>
        <p>{t('flows.intro')}</p>
      </div>
      {shown.map((f) => (
        <section key={f.code} className="w1-panel" style={{ marginTop: 14 }} data-guide-flow={f.code}>
          <h2 className="w1-s2" style={{ marginTop: 0 }}>{f.title} <small className="w1-ls">{t('flows.who')}: {f.who}</small></h2>
          <ol className="w1-flow">
            {f.steps.map((s, i) => <li key={i}><span className="n">{i + 1}</span><div><p style={{ margin: 0 }}>{s}</p></div></li>)}
          </ol>
          <p><Link className="w1-bo" href={f.href} data-guide-flow-go={f.code}>{t('flows.go')} →</Link></p>
        </section>
      ))}
    </div>
  );
}

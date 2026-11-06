import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { ManualBody, manualChapters } from '@/components/guide/ManualBody';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('policy'))('meta.manual') };
}

interface Manual { title: string; version: number; updatedAt: string; body: string }

/**
 * SB-HOM-ETC-040 사용자 설명서 (v10.203 · D180 · docs/324)
 *   운영 화면 「사용자 설명서」의 지금 판(GET /help/manual) — AI 상담이 읽는 것과 같은 글.
 *   절 제목마다 #m번호(AI 상담 답의 출처 링크) · 장마다 #c번호(위 목차).
 */
export default async function ManualPage() {
  const [tr, locale] = await Promise.all([getTranslations('policy'), getLocale()]);
  const m = await apiGet<Manual>('/help/manual', 60).catch(() => null);
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-ETC-040" style={{ maxWidth: 860 }}>
      <BackBar href="/guide" label={tr('manual.back')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{tr('manual.title')}</h1>
        {m && <p data-manual-version={m.version}>{tr('manual.updated', { version: m.version, date: new Date(m.updatedAt).toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US') })}</p>}
      </div>
      {locale !== 'ko' && <div className="w1-nt" style={{ marginBottom: 10 }}>{tr('manual.koOnly')}</div>}
      {!m ? <div className="w1-empty">{tr('manual.empty')}</div> : (
        <>
          <nav className="w1-toc" aria-label={tr('manual.toc')} data-manual-toc="">
            {manualChapters(m.body).map((c) => <a key={c.id} href={`#${c.id}`}>{c.title}</a>)}
          </nav>
          <ManualBody body={m.body} />
        </>
      )}
      <div className="w1-nt" style={{ marginTop: 16 }}>{tr('manual.ai')}</div>
    </div>
  );
}

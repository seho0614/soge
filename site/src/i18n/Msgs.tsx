/**
 * 화면 전용 사전 묶음 내려보내기 (v10.97 · 2-2 · docs/155)
 *
 *   <Msgs ns={['main']}><HomeView … /></Msgs>
 *   레이아웃은 공통 묶음(GLOBAL_NS)만 브라우저로 보냅니다. 화면 전용 묶음(PAGE)을 쓰는 브라우저 부품은
 *   그 부품을 그리는 서버 화면에서 이것으로 감쌉니다. 서버 부품(getTranslations)은 감쌀 필요가 없습니다.
 */
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { GLOBAL_NS, pick, type PageNs } from './messages';

export async function Msgs({ ns, children }: { ns: PageNs[]; children: React.ReactNode }) {
  const all = await getMessages();
  return <NextIntlClientProvider messages={pick(all, [...GLOBAL_NS, ...ns])}>{children}</NextIntlClientProvider>;
}

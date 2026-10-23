import { SubTabs, type SubTab } from '../../components/SubTabs';
import { useHashSub } from '../../lib/hashSub';
import { LeadAssign } from './LeadAssign';
import type { View, Tab2 } from './partners/shared';
import { PartnerDetail } from './partners/PartnerDetail';
import { PartnerList } from './partners/PartnerList';
import { Apply } from './partners/Apply';
import { Services } from './partners/Services';
import { Rejects } from './partners/Rejects';
import { Wallet } from './partners/Wallet';

const TABS: SubTab<Tab2>[] = [
  { key: 'list', label: '파트너사 목록', screen: 'SB-ADM-PTN-010' },
  { key: 'apply', label: '입점 신청', screen: 'SB-ADM-PTN-020' },
  { key: 'services', label: '서비스 검수', screen: 'SB-ADM-PTN-030' },
  { key: 'medical', label: '의료 심의', screen: 'SB-ADM-PTN-040', out: true },
  { key: 'rejects', label: '리드 반려', screen: 'SB-ADM-PTN-050' },
  { key: 'leads', label: '리드 배정', screen: 'SB-ADM-PTN-090' },
  { key: 'cats', label: '카테고리 마스터', screen: 'SB-ADM-PTN-060', out: true },
  { key: 'quals', label: '자격 심사', screen: 'SB-ADM-PTN-070', out: true },
  { key: 'wallet', label: '리드 이용료 · 정산', screen: 'SB-ADM-PTN-080' },
];

const OUT: Record<string, string> = { medical: 'quals/medical', cats: 'quals/cats', quals: 'quals/pending' };

/**
 * SB-ADM-PTN-010 파트너사 목록
 * SB-ADM-PTN-020 입점 신청 승인 (T-01)
 * SB-ADM-PTN-030 서비스 검수 승인 (T-02)
 * SB-ADM-PTN-090 리드 배정 (D008) — LeadAssign.tsx
 * SB-ADM-PTN-050 리드 반려 인정 / 기각 (T-04)
 * SB-ADM-PTN-080 소개캐시 입금 확인 · 리드 등급 비율
 *
 * 파트너가 리드를 못 받는 이유는 넷입니다 — 승인 · 서비스 · 지역 · 미납.
 * 여기서 앞의 둘을 풉니다. 미납은 자동으로 멈추고 자동으로 풀립니다.
 *
 * 카테고리 마스터(T-05 · T-06, SB-ADM-PTN-060)와 규제 자격 심사(T-21, SB-ADM-PTN-070)는
 * 같은 API 를 쓰는 "자격 심사" 탭에 있습니다 — 두 곳에 두지 않습니다.
 *
 * v10.86 (리팩토링) — 하위 화면은 partners/ 폴더(화면 하나 = 파일 하나), 같이 쓰는 형식 · 표는 partners/shared.ts. 이 파일은 탭 전환만 합니다.
 */
export function Partners({ onGo }: { onGo?: (tab: string) => void }) {
  const [view, setView] = useHashSub<View>('list', ['list', 'apply', 'services', 'leads', 'rejects', 'wallet', 'detail']);
  const pick = (k: Tab2) => { if (OUT[k]) { if (onGo) onGo(OUT[k]!); } else setView(k as View); };
  const tabs = TABS.filter((t) => !OUT[t.key] || onGo);
  /* v10.32 — SB-ADM-PTN-011 파트너사 상세는 목록 안에 펼치지 않고 자기 주소(#/partners/detail/<id>)로 따로 엽니다(시안 admptnd) */
  const openDetail = (id: string) => {
    history.pushState(null, '', `#/partners/detail/${id}`);
    window.dispatchEvent(new Event('bo-sub'));
    window.scrollTo(0, 0);
  };
  const detailId = view === 'detail' ? (location.hash.replace(/^#\/?/, '').split('/')[2] ?? '') : '';
  return (
    <section>
      <SubTabs tabs={tabs} value={view === 'detail' ? 'list' : view} onChange={pick} />
      {view === 'list' && <PartnerList onGo={(v) => pick(v as Tab2)} onOpen={openDetail} />}
      {view === 'detail' && (/^[0-9a-f-]{36}$/i.test(detailId)
        ? <PartnerDetail key={detailId} id={detailId} onClose={() => setView('list')} onGo={(v) => pick(v)} />
        : <><p className="ad-empty">고른 파트너사가 없습니다 — 목록에서 「상세」를 누르십시오.</p>
            <div className="ad-dact"><button className="btn-plain" data-ptn-close="" onClick={() => setView('list')}>← 파트너사 목록</button></div></>)}
      {view === 'apply' && <Apply />}
      {view === 'services' && <Services />}
      {view === 'leads' && <LeadAssign />}
      {view === 'rejects' && <Rejects />}
      {view === 'wallet' && <Wallet onGo={onGo} />}
    </section>
  );
}

import { useState } from 'react';
import { SubTabs, type SubTab } from '../../components/SubTabs';
import { siteHref } from '../../lib/siteUrl';
import { Applications } from './affiliates/Applications';
import { Products } from './affiliates/Products';
import { Goals } from './affiliates/Goals';
import { Materials } from './affiliates/Materials';
import { Guides } from './affiliates/Guides';
import { Settlements } from './affiliates/Settlements';

type View = 'apply' | 'products' | 'goals' | 'materials' | 'settle';

const TABS: SubTab<View>[] = [
  { key: 'apply', label: '입점 심사', screen: 'SB-AFF-APL-010' },
  { key: 'products', label: '제휴상품 · 단가', screen: 'SB-AFF-PRD-010' },
  { key: 'goals', label: '목표 설정', screen: 'SB-AFF-GOL-010' },
  { key: 'materials', label: '마케팅자료 · 가이드', screen: 'SB-AFF-MTR-010' },
  { key: 'settle', label: '트랙별 정산', screen: 'SB-AFF-STL-010' },
];

/**
 * SB-AFF-APL-010 파트너 입점 심사
 * SB-AFF-PRD-010 제휴상품 · 단가
 * SB-AFF-GOL-010 목표 설정 · 지급
 * SB-AFF-MTR-010 마케팅자료 심의 · 등록 · 파트너가이드 등록 (D007 — 파일 올리기)
 * SB-AFF-STL-010 트랙별 정산 배치
 *
 * 파트너는 제휴상품 링크를 뿌리고 **건당 정액 수수료**를 받습니다.
 * 소개비(당사자끼리 직접 · 플랫폼 공제 0원, INV-9)와 달리 제휴수수료는
 * **회사가 파트너에게 지급하는 마케팅비**입니다. 화면에 늘 병기합니다.
 */
export function Affiliates({ onGo }: { onGo?: (tab: string) => void }) {
  const [view, setView] = useState<View>('apply');
  return (
    <section>
      <SubTabs tabs={TABS} value={view} onChange={setView} />
      {/* v10.31 — 시안 「파트너가 보는 화면 열기」(사용자 웹 제휴 파트너스 화면 · 새 창) */}
      <div className="ad-dact end" style={{ marginTop: 0 }}>
        <a className="btn-plain btn-sm" href={siteHref('/partners')} target="_blank" rel="noreferrer" data-open-partner-view>파트너가 보는 화면 열기</a>
      </div>
      <p className="hint"><b>제휴수수료는 회사가 파트너에게 주는 마케팅비입니다.</b> 소개비(당사자끼리 직접 · 공제 0원)와 섞지 않습니다.</p>
      {view === 'apply' && <Applications />}
      {view === 'products' && <Products />}
      {view === 'goals' && <Goals />}
      {view === 'materials' && <><Materials /><Guides /></>}
      {view === 'settle' && <Settlements onGo={onGo} />}
    </section>
  );
}

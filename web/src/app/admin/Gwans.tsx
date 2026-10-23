import { useState } from 'react';
import { tokenRoles } from '../../lib/api';
import { SubTabs, type SubTab } from '../../components/SubTabs';
import { useHashSub } from '../../lib/hashSub';
import { GwanList } from './gwans/GwanList';
import { GwanNew } from './gwans/GwanNew';
import type { STab } from './gwans/shared';
import { GwanSettings } from './gwans/GwanSettings';
import { GwanScope } from './gwans/GwanScope';

type View = 'list' | 'new' | 'settings' | 'scope';

/**
 * SB-ADM-SIT-010 관 목록 · 현황
 * SB-ADM-GWN-010 관 관리 (순서 · 로그인 랜딩)
 * SB-ADM-SIT-020 새 관 만들기
 * SB-ADM-SIT-030 관 설정 (8개 탭)
 * SB-ADM-SIT-060 공유 경계 · 영향 범위
 *
 * 관 계층은 메인의 첫인상을 정합니다.
 * '소개하고 벌기'가 상위이고 나머지가 그 아래 품목별 갈래입니다.
 *
 * ── 역할 (서버 실측 2026-10-02) ─────────────────────────────────────
 * 순서 · 랜딩 · 관리 목록(`/admin/gwans/manage`)은 ADMIN 이 부를 수 있고,
 * 그 밖의 관 API(목록 · 상세 · 생성 · 설정 · 공유 경계)는 SUPER 만 됩니다.
 * 운영(ADMIN) 계정에게는 관리 목록만 보여 줍니다 — 나머지는 눌러도 403 입니다.
 *
 * 관 노출 전환(숨기기 · 노출하기)은 **메인 운영 › 관 노출**(SB-ADM-MAIN-020)
 * 한 곳에서만 합니다. 두 곳에 두면 어느 쪽에서 바꿨는지 추적이 갈립니다.
 *
 * v10.86 (리팩토링) — 하위 화면은 gwans/ 폴더(화면 하나 = 파일 하나), 같이 쓰는 형식 · 표는 gwans/shared.ts. 이 파일은 탭 전환만 합니다.
 */
export function Gwans({ onGo }: { onGo?: (tab: string) => void }) {
  const isSuper = tokenRoles().includes('SUPER');
  const [view, setView] = useHashSub<View>('list', ['list', 'new', 'settings', 'scope']);
  const [code, setCode] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [stab, setStab] = useState<STab>('basic');

  const tabs: SubTab<View>[] = [
    { key: 'list', label: '관 목록', screen: 'SB-ADM-SIT-010' },
    { key: 'new', label: '새 관 만들기', screen: 'SB-ADM-SIT-020', hidden: !isSuper },
    { key: 'settings', label: '관 설정', screen: 'SB-ADM-SIT-030', hidden: !isSuper },
    { key: 'scope', label: '공유 경계', screen: 'SB-ADM-SIT-060', hidden: !isSuper },
  ];
  const open = (c: string, t: STab = 'basic') => { setCode(c); setCreated(null); setStab(t); setView('settings'); };
  const onCreated = (c: string) => { setCode(c); setCreated(c); setView('settings'); };

  return (
    <section>
      <SubTabs tabs={tabs} value={view} onChange={setView} />
      {view === 'list' && <GwanList isSuper={isSuper} onOpen={open} onGo={onGo} onNew={() => setView('new')} />}
      {view === 'new' && isSuper && <GwanNew onCreated={onCreated} onCancel={() => setView('list')} />}
      {view === 'settings' && isSuper && <GwanSettings key={`${code}-${stab}`} code={code} created={created} initialTab={stab} onPick={(c) => { setCreated(null); setCode(c); }} onGo={onGo} />}
      {view === 'scope' && isSuper && <GwanScope />}
    </section>
  );
}

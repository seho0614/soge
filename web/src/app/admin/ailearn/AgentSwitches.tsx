import { useState } from 'react';
import { useApi } from '../../../lib/useApi';
import { api, tokenRoles } from '../../../lib/api';
import { useAct } from '../../../lib/act';
import { Flash } from '../../../components/Flash';
import { ErrorView } from '../../../components/ErrorView';
import type { RolloutStep } from './AgentRollout';

/**
 * v10.129 (docs/194) — AI 운영 › AI 에이전트 › 「AI 스위치」 (SB-ADM-AGT-010 안의 한 구역)
 *
 * 전에는 AI 전체 · 월 상한 · 통로 스위치를 운영 화면에서 바꿀 길이 없어(DB 로만) 키를 넣어도 AI 를 켤 수 없었습니다.
 *   바꾸기는 최고 관리자(SUPER)만 — 서버도 막습니다(AI_SETTING_SUPER · 대표 승인 2026-10-27). 운영자(ADMIN)는 보기만.
 *   AI 전체를 켜려면 AI 키 · 월 상한 > 0 이 먼저(서버 SWITCH_PREREQ). 저장은 PATCH /admin/site-settings(감사 SITE_SETTING_UPDATE).
 * 켜기 전 처리방침 · 고지(docs/176 · 170 §2 · 165 §2)는 대표 · 법무 일 — 확인 창으로 한 번 더 묻습니다.
 */

interface Setting { key: string; value: string | null }
interface Sw { key: string; label: string; what: string; confirm: string }

const SWITCHES: Sw[] = [
  { key: 'agent.enabled', label: 'AI 전체', what: '꺼져 있으면 아래 기능이 모두 AI 를 부르지 않습니다. 월 상한에 닿으면 저절로 꺼집니다.',
    confirm: 'AI 전체를 켤까요? 아래에서 켠 기능만 AI 를 부르고, 부를 때마다 비용이 듭니다(월 상한까지).' },
  { key: 'i18n.auto_translate.enabled', label: '등록 글 자동 번역', what: '매물 · 요청 글을 1분마다 영어로 번역합니다(금칙어 · 연락처 다시 검사).',
    confirm: '등록 글 자동 번역을 켤까요? 새로 올라온 매물 · 요청 글을 AI 로 번역합니다.' },
  { key: 'i18n.board_on_view', label: '소개광장 볼 때 번역', what: '영어 화면에서 손님이 「번역 보기」를 누를 때만 번역합니다(하루 한도 있음).',
    confirm: '소개광장 볼 때 번역을 켤까요? 영어 화면에서 「번역 보기」를 누르면 AI 가 번역합니다.' },
  { key: 'agent.review_shadow.enabled', label: 'AI 검수 보조', what: '검수 대기 글에 AI 의견만 붙습니다 — 승인 · 반려는 사람이 합니다.',
    confirm: 'AI 검수 보조를 켤까요? 개인정보처리방침에 「외부 AI 처리 위탁(Anthropic)」 고지를 반영했는지 먼저 확인하십시오(docs/165 §2).' },
  { key: 'agent.chat.enabled', label: 'AI 상담', what: '손님 화면에 「AI 상담」 단추가 생깁니다(하루 한도 · 연락처는 가려 저장 · 5년 보관).',
    confirm: 'AI 상담을 켤까요? 개인정보처리방침에 「AI 상담 대화 5년 보관 · 국외 이전(Anthropic) · AI 고지」를 반영했는지 먼저 확인하십시오(docs/170 §2).' },
  /* v10.137 (D133 · docs/204) — AI 상담 3단계. AI 상담이 켜져 있어야 동작 · 로그인 회원에게만 */
  { key: 'agent.chat.member_lookup.enabled', label: 'AI 상담 — 내 정보 조회', what: '로그인한 회원이 자기 주문 · 반품 · 검수 · 문의 · 구독 상태를 물으면 AI 가 본인 것만 읽어 답합니다(읽기만 · 바꾸지 않음 · 부른 기록은 상담 기록에).',
    confirm: '내 정보 조회를 켤까요? ① 2단계를 1주 써 본 결과(답 비율 · 넘김) ② 개인정보처리방침 제6조 ④ 줄(내 정보 조회) 게시 — 둘 다 확인하셨습니까?(docs/204)' },
  /* v10.139 (D135 · docs/209) — AI 상담 4단계. 내 정보 조회가 켜져 있어야 동작 · 초안만(접수는 회원이 신청 화면에서) */
  { key: 'agent.chat.drafts.enabled', label: 'AI 상담 — 신청서 초안', what: '회원이 문의 · 건강몰 취소 · 반품 · 교환을 원하면 AI 가 신청서 초안을 만들어 카드로 보여 줍니다. 접수는 회원이 신청 화면에서 직접 합니다(AI 는 접수하지 않음 · 초안은 7일 뒤 비움).',
    confirm: '신청서 초안을 켤까요? ① 내 정보 조회를 며칠 써 본 결과(상담 기록의 「조회」 줄) ② 법무의 고지 확인 — 둘 다 확인하셨습니까?(docs/209)' },
];

export function AgentSwitches({ onChanged }: { onChanged?: () => void }) {
  const r = useApi<Setting[]>('/admin/site-settings');
  const ro = useApi<RolloutStep[]>('/admin/agent/rollout');   // v10.147 — 앞 단계 기준 전이면 켤 때 경고(막지는 않음)
  const a = useAct();
  const [cap, setCap] = useState<string | null>(null);
  const isSuper = tokenRoles().includes('SUPER');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return null;
  const val = (k: string) => r.data!.find((s) => s.key === k)?.value ?? '';
  const capNow = val('agent.monthly_cap_usd') || '0';
  const save = (key: string, value: string, ok: string, after?: () => void) =>
    void a.run(key, () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }),
      () => { after?.(); r.reload(); ro.reload(); onChanged?.(); }, ok);
  const flip = (s: Sw) => {
    const on = val(s.key) === 'on';
    /* AI 전체를 켤 때 이미 켜져 있는 기능을 알림 — 상한에 닿아 저절로 꺼진 뒤라면 켜는 즉시 그 기능들이 다시 부름 */
    const already = SWITCHES.filter((x) => x.key !== 'agent.enabled' && val(x.key) === 'on').map((x) => x.label);
    const ask = s.key === 'agent.enabled' && !on
      ? `${s.confirm}\n\n지금 켜져 있는 기능: ${already.length ? already.join(' · ') + ' — 켜는 즉시 AI 를 부릅니다.' : '없음'}`
      : s.confirm;
    const wait = ro.data?.find((x) => x.switchKey === s.key && x.state === 'WAIT');
    const warn = wait ? `⚠ 아직 앞 단계 기준을 넘지 않았습니다(AI 켜기 단계 ${wait.step - 1}번까지 확인). 그래도 켤까요?\n\n` : '';
    if (!window.confirm(on ? `${s.label}을(를) 끌까요? 바로 AI 를 부르지 않습니다.` : warn + ask)) return;
    save(s.key, on ? 'off' : 'on', `${s.label} — ${on ? '껐습니다' : '켰습니다'}.`);
  };
  const saveCap = () => {
    const v = (cap ?? capNow).trim();
    if (!/^[0-9]{1,6}(\.[0-9]{1,2})?$/.test(v)) { a.setErr('월 상한은 달러 숫자로 넣으십시오(예: 10 · 0 이면 아무것도 부르지 않음).'); return; }
    save('agent.monthly_cap_usd', v, `월 상한을 $${v} 로 정했습니다.`, () => setCap(null));
  };

  return (
    <div data-agent-switches>
      <h3 className="sec">AI 스위치 {!isSuper && <small className="muted">— 바꾸기는 최고 관리자만</small>}</h3>
      <p className="hint">순서: ① AI 키 → ② 월 상한(0 보다 큰 달러) → ③ AI 전체 켜기 → ④ 쓸 기능만 켜기. 켜기 전 처리방침 · 고지 반영은 대표 · 법무가 확인합니다.</p>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl">
        <thead><tr><th>기능</th><th>지금</th><th>설명</th><th></th></tr></thead>
        <tbody>
          <tr data-agent-cap>
            <td><b>월 상한(달러)</b></td><td>${capNow}</td>
            <td className="muted">0 이면 아무것도 부르지 않습니다. 닿으면 AI 전체가 저절로 꺼지고 운영 경보가 뜹니다.</td>
            <td>{isSuper && <>
              <input value={cap ?? capNow} onChange={(e) => setCap(e.target.value)} size={7} inputMode="decimal" aria-label="월 상한(달러)" />{' '}
              <button className="btn-sm" disabled={a.busy === 'agent.monthly_cap_usd'} onClick={saveCap}>저장</button>
            </>}</td>
          </tr>
          {SWITCHES.map((s) => {
            const on = val(s.key) === 'on';
            return (
              <tr key={s.key} data-agent-switch={s.key}>
                <td><b>{s.label}</b></td><td>{on ? <span className="good">켜짐</span> : '꺼짐'}</td>
                <td className="muted">{s.what}</td>
                <td>{isSuper && <button className={on ? 'btn-sm ghost' : 'btn-sm'} disabled={a.busy === s.key} onClick={() => flip(s)}>{on ? '끄기' : '켜기'}</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

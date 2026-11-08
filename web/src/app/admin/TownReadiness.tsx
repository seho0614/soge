import { useApi } from '../../lib/useApi';
import { ymdKst } from '../../lib/format';

/**
 * v10.210 (D187 · docs/335) — 소개광장 › 「동네 인증 준비 상태」 (보기 ADMIN · SUPER)
 *
 *   켜려면 ① 위치기반서비스 이용약관(LOCATION) 게시 · 시행 ② 위치기반서비스사업 신고번호 ③ 카카오 REST 키.
 *   ①② 가 없으면 DB 가 스위치(community.town_verify) 켜기를 막음 · ③ 이 없으면 켜도 인증이 「준비 중」.
 *   약관 초안에 남은 〔…〕 칸은 법무에 넘길 목록 — 남아 있으면 게시가 막힘(TERM_HOLES).
 *   v10.212 — 〔시행일〕은 세지 않음(게시 때 채워짐 · 약관 표 〔미확정〕과 같은 수).
 */
interface Readiness {
  switchOn: boolean;
  terms: { published: boolean; version: string | null; effectiveFrom: string | null; draft: { version: string; status: string; holes: string[] } | null };
  reportNo: { set: boolean }; kakao: { set: boolean }; canTurnOn: boolean; ready: boolean;
}

export function TownReadiness() {
  const q = useApi<Readiness>('/admin/community/town-verify/readiness', []);
  const r = q.data;
  if (!r) return null;
  const row = (key: string, label: string, ok: boolean, now: string, fix: string) => (
    <tr key={key} data-town-ready-row={key} data-ok={ok ? 'y' : 'n'}><td>{label}</td><td>{ok ? '✓' : '✗'}</td><td>{now}</td><td className="muted">{ok ? '' : fix}</td></tr>
  );
  return (
    <div className="card" data-town-ready={r.ready ? 'y' : 'n'} data-town-switch={r.switchOn ? 'on' : 'off'}>
      <h3 className="sec">동네 인증 준비 상태 <small className="dim">위치기반서비스 — 신고 · 약관 게시 전에는 켤 수 없음(docs/335)</small></h3>
      <p className="hint">
        스위치 <b>{r.switchOn ? '켜짐' : '꺼짐'}</b> — {r.ready ? '모두 갖춰졌습니다.' : r.canTurnOn ? '약관 · 신고번호는 있습니다 — 카카오 키를 넣어야 인증이 됩니다.' : '✗ 줄이 남아 있어 스위치를 켤 수 없습니다(DB 가 막음).'}
      </p>
      <table className="tbl">
        <thead><tr><th>항목</th><th></th><th>지금</th><th>채우는 곳</th></tr></thead>
        <tbody>
          {row('terms', '위치기반서비스 이용약관', r.terms.published,
            r.terms.published ? `${r.terms.version} 시행 중${r.terms.effectiveFrom ? `(${ymdKst(r.terms.effectiveFrom)}부터)` : ''}` : r.terms.draft ? `${r.terms.draft.version} ${r.terms.draft.status === 'DRAFT' ? '초안' : '법무 검토'}` : '없음',
            '법무 확인 → 약관 관리에서 LOCATION 게시')}
          {row('report', '위치기반서비스사업 신고번호', r.reportNo.set, r.reportNo.set ? '있음' : '없음', '방송통신위원회 신고 뒤 사이트 설정 community.lbs_report_no')}
          {row('kakao', '카카오 REST 키', r.kakao.set, r.kakao.set ? '있음' : '없음', '외부 연동 › 연동 키 › 지도(KAKAO_REST_KEY)')}
        </tbody>
      </table>
      {r.terms.draft && r.terms.draft.holes.length > 0 && (
        <p className="hint" data-town-holes={r.terms.draft.holes.length}>약관 초안 {r.terms.draft.version}에 채우지 않은 칸 {r.terms.draft.holes.length}개 — {r.terms.draft.holes.join(' · ')} <span className="dim">(〔시행일〕은 게시 때 정한 날로 채워져 세지 않음 · 약관 표의 〔미확정〕과 같은 수)</span></p>
      )}
    </div>
  );
}

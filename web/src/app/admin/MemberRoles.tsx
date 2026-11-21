import { GRANTABLE, ROLE_LABEL } from './RoleAdmin';

/**
 * v10.333 (docs/464) 회원 상세 권한 → v10.563 (D291 · docs/705) 보기만.
 *   대표 11/21 A안 「회원 관리 · 직원 권한 관리 분리」 — 역할을 주는 곳이 두 곳(회원 상세 · 권한 계층 › 권한 관리)이던 것을 「직원 · 권한 › 역할 주기」 한 곳으로.
 *   여기서는 가진 운영 역할만 보이고 링크로 보냅니다(직원 대장 연결 · 외부 역할 기한 검사는 역할 주기 쪽 서버가 함).
 */
export function MemberRoles({ name, roles }: { accountId: string; name: string; roles: string[]; onDone: () => void }) {
  /* v10.563 (D291 · docs/705) — 회원 · 직원 분리 A안: 회원 상세는 보기만 · 역할 주기는 「직원 · 권한 › 역할 주기」 한 곳(직원 대장 연결 · 외부 역할 기한 검사가 거기 있음) */
  const staff = roles.filter((r) => GRANTABLE.includes(r) || r === 'PAYOUT');
  return (
    <div className="card" data-member-roles="view">
      <h3 className="sec">운영 역할</h3>
      <p>
        {staff.length === 0 && <span className="muted">운영 역할 없음 — 회원입니다.</span>}
        {staff.map((r) => <span key={r} className={`badge ${r === 'SUPER' ? 'badge-urgent' : 'badge-verified'}`} style={{ marginRight: 8 }}>{ROLE_LABEL[r] ?? r}</span>)}
      </p>
      <p className="muted">
        {staff.length > 0 ? `${name} 님은 운영자입니다 — 계정 상태(정지 · 정상)는 최고 관리자(SUPER)만 바꿉니다. ` : ''}
        역할 주기 · 거두기는 <a href="#/roles" data-member-roles-go="roles">직원 · 권한 › 역할 주기</a>에서, 운영자 확인은 <a href="#/staff-list" data-member-roles-go="staff-list">직원 · 권한 › 운영자 목록</a>에서 합니다.
      </p>
    </div>
  );
}

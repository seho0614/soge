import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { MfaSetup, type MfaStatus } from '../../components/MfaGate';

const MODE: Record<string, string> = { off: '쓰지 않음', SUPER: '최고 관리자만', ALL: '운영 역할 모두' };

/**
 * SB-ADM-MFA-010 내 2단계 인증 (v10.180 · D169 · docs/281)
 *
 * 설정이 꺼져 있어도 미리 등록할 수 있습니다(켜기 전 SUPER 가 먼저 등록해야 켜짐 — MFA_ENROLL_FIRST).
 * 다시 등록(휴대폰 바꿈 · 분실)은 최고 관리자가 회원 상세 「2단계 초기화」로 지운 뒤.
 */
export function MyMfa() {
  const q = useApi<MfaStatus>('/auth/mfa');
  const [setup, setSetup] = useState(false);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const s = q.data;
  return (
    <section data-my-mfa="">
      <table className="tbl"><tbody>
        <tr><th>지금 설정</th><td data-mfa-mode={s.mode}>{MODE[s.mode] ?? s.mode} · 번호를 넣으면 {s.hours}시간 동안 다시 묻지 않음</td></tr>
        <tr><th>나에게 필요</th><td>{s.required ? '예' : '아니오'}</td></tr>
        <tr><th>내 등록</th><td data-mfa-enrolled={s.enrolled ? '1' : '0'}>{s.enrolled ? `등록함 · 남은 예비 번호 ${s.backupLeft ?? 0}개` : '등록 안 함'}</td></tr>
        {s.lockedUntil && <tr><th>잠금</th><td className="warn-text">번호가 여러 번 틀려 {ymdhm(s.lockedUntil)} 까지 막힘</td></tr>}
      </tbody></table>
      {!s.enrolled && (setup
        ? <div className="card pad" style={{ maxWidth: 520 }}><MfaSetup onDone={() => { setSetup(false); q.reload(); }} /></div>
        : <p><button className="btn-ok" onClick={() => setSetup(true)} data-mfa-start="">2단계 인증 등록</button></p>)}
      {s.enrolled && (s.backupLeft ?? 0) <= 3 && <p className="warn-text">예비 번호가 {s.backupLeft ?? 0}개 남았습니다 — 최고 관리자에게 초기화를 요청해 다시 등록하면 새 예비 번호 10개를 받습니다.</p>}
      <div className="ad-nt info">휴대폰을 바꾸거나 잃어버렸으면 최고 관리자가 회원 상세 「2단계 초기화」로 지운 뒤 다시 등록합니다. 아무도 들어오지 못할 때는 서버에서 deploy/aws/mfa-reset.sh(docs/281).</div>
    </section>
  );
}

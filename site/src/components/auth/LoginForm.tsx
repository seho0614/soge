'use client';
/**
 * SB-HOM-AUT-030 로그인 폼 — v10.31 시안 scLogin: 이메일 · 비밀번호(보기) · 로그인 상태 유지 · 이메일 찾기 · 비밀번호 재설정 · 로그인.
 *   로그인 상태 유지를 끄면 브라우저를 닫을 때 로그인이 풀립니다(쿠키 — lib/session · middleware).
 *   이메일 찾기 · 비밀번호 재설정: 메일 발송(SES)이 아직 없어 고객센터 「계정 · 사업자 인증」 문의로 잇습니다(결정 기록).
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Result = { ok: true; reconsent?: boolean } | { ok: false; code: string; message: string };

export function LoginForm({ action, next }: { action: (email: string, password: string, keep: boolean) => Promise<Result>; next: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [show, setShow] = useState(false);
  const [keep, setKeep] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '').trim(), pw = String(fd.get('password') ?? '');
    if (!email || !pw) { setErr('이메일과 비밀번호를 입력해 주십시오.'); return; }
    setErr(null);
    start(async () => {
      const r = await action(email, pw, keep);
      if (r.ok) router.push(r.reconsent ? `/terms/agree?next=${encodeURIComponent(next)}` : next);
      else setErr(r.message);
    });
  }

  return (
    /* class auth · cta-primary · form-error — 기존 화면 시험(qa · `form.auth button`)이 그대로 쓰는 손잡이. 모양은 .w1-lgc 안에서 덮어씀 */
    <form className="auth w1-lgf" onSubmit={submit} noValidate>
      <div className="w1-fld"><label htmlFor="lg-mail">이메일</label>
        <input className="w1-in" id="lg-mail" type="email" name="email" autoComplete="username" placeholder="가입 시 등록한 이메일" /></div>
      <div className="w1-fld"><label htmlFor="lg-pw">비밀번호</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="w1-in" id="lg-pw" type={show ? 'text' : 'password'} name="password" autoComplete="current-password" placeholder="비밀번호" />
          {/* 폼 안 첫 단추가 「로그인」이 되도록 보기 전환은 단추 요소가 아닌 role=button */}
          <span role="button" tabIndex={0} className="w1-bo" onClick={() => setShow((x) => !x)} aria-pressed={show}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShow((x) => !x); } }}>{show ? '숨기기' : '보기'}</span>
        </div></div>
      <div className="w1-lgo2">
        <label className="w1-chk"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> 로그인 상태 유지</label>
        <Link className="w1-lnk2" href="/support/new#inquiry">이메일 찾기 · 비밀번호 재설정</Link>
      </div>
      {err && <p className="w1-err form-error" role="alert">{err}</p>}
      <button className="w1-bp w1-lgb cta-primary" disabled={pending}>{pending ? '처리 중…' : '로그인'}</button>
    </form>
  );
}

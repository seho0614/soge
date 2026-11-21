'use client';
/**
 * SB-MYP-SCX-010 회원 2단계 인증 (v10.592 · docs/734) — 켜기(비밀값 → 앱 번호 → 예비 번호 10개 한 번) · 끄기(비밀번호 + 번호)
 *   서버 액션 memberMfaSetup · memberMfaEnable · memberMfaDisable · 글자는 서버 화면이 넘김(이 부품에는 한글 없음)
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { memberMfaDisable, memberMfaEnable, memberMfaSetup } from '@/lib/scxAuth';

type Status = { available: boolean; staff: boolean; enrolled: boolean; backupLeft: number | null; hasPassword: boolean; lockedUntil: string | null };
export interface MfaLabels {
  title: string; why: string; on: string; off: string; staff: string; needPw: string; start: string; secret: string; uri: string; code: string; enable: string;
  backup: string; backupLeft: string; disable: string; password: string; codeOrBackup: string; disableConfirm: string; working: string; cancel: string; locked: string;
}

export function MemberMfa({ status: s, labels: L }: { status: Status; labels: MfaLabels }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [off, setOff] = useState(false);

  const go = (fn: () => Promise<void>) => { setErr(null); setNote(null); start(fn); };

  return (
    <div data-scx-mfa={s.enrolled ? 'on' : 'off'}>
      <h2 className="my-st2">{L.title}</h2>
      <div className="my-nt info">{L.why}</div>
      {err && <div className="my-nt warn" role="alert" data-scx-mfa-err="">{err}</div>}
      {note && <div className="my-nt ok" role="status" data-scx-mfa-done="">{note}</div>}
      {s.lockedUntil && <div className="my-nt warn">{L.locked}</div>}
      {codes && (
        <div className="my-nt warn" data-scx-mfa-codes={String(codes.length)}>
          <b>{L.backup}</b>
          <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{codes.join('\n')}</pre>
        </div>
      )}
      {s.staff ? <div className="my-nt plain">{L.staff}</div>
        : s.enrolled ? (
          <>
            <div className="my-nt ok">{L.on}{s.backupLeft != null && <> · {L.backupLeft} {s.backupLeft}</>}</div>
            {!off ? <div className="my-btns"><button className="my-bo" type="button" onClick={() => setOff(true)} data-scx-mfa-off="">{L.disable}</button></div> : (
              <form className="card p2pad p2form" data-scx-mfa-off-form="" onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const pw = String(fd.get('password') ?? ''), code = String(fd.get('code') ?? '').trim();
                if (!pw || !code || !confirm(L.disableConfirm)) return;
                go(async () => {
                  const r = await memberMfaDisable(pw, code);
                  if (!r.ok) { setErr(r.message); return; }
                  setNote(r.note ?? null); setOff(false); router.refresh();
                });
              }}>
                <label className="fld"><span>{L.password}</span><input name="password" type="password" autoComplete="current-password" maxLength={100} /></label>
                <label className="fld"><span>{L.codeOrBackup}</span><input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={11} /></label>
                <div className="my-btns"><button className="my-bp" type="submit" disabled={pending}>{pending ? L.working : L.disable}</button>{' '}
                  <button className="my-bo" type="button" onClick={() => setOff(false)}>{L.cancel}</button></div>
              </form>
            )}
          </>
        ) : !s.hasPassword ? <div className="my-nt plain">{L.needPw}</div>
        : !setup ? (
          <>
            <div className="my-nt plain">{L.off}</div>
            <div className="my-btns"><button className="my-bp" type="button" disabled={pending} data-scx-mfa-start="" onClick={() => go(async () => {
              const r = await memberMfaSetup();
              if (!r.ok) { setErr(r.message); return; }
              setSetup({ secret: r.secret ?? '', uri: r.uri ?? '' });
            })}>{pending ? L.working : L.start}</button></div>
          </>
        ) : (
          <form className="card p2pad p2form" data-scx-mfa-enable="" onSubmit={(e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
            if (!/^\d{6}$/.test(code)) return;
            go(async () => {
              const r = await memberMfaEnable(code);
              if (!r.ok) { setErr(r.message); return; }
              setCodes(r.backupCodes ?? []); setNote(r.note ?? null); setSetup(null); router.refresh();
            });
          }}>
            <div className="my-nt info">{L.secret}</div>
            <p><code data-scx-mfa-secret="" style={{ wordBreak: 'break-all' }}>{setup.secret}</code></p>
            {setup.uri && <p><a className="my-bo" href={setup.uri}>{L.uri}</a></p>}
            <label className="fld"><span>{L.code}</span><input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label>
            <div className="my-btns"><button className="my-bp" type="submit" disabled={pending}>{pending ? L.working : L.enable}</button>{' '}
              <button className="my-bo" type="button" onClick={() => setSetup(null)}>{L.cancel}</button></div>
          </form>
        )}
    </div>
  );
}

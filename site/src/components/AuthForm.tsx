'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export interface Field {
  name: string; label: string; type?: string;
  placeholder?: string; hint?: string; autoComplete?: string;
}

type Result = { ok: true; reconsent?: boolean } | { ok: false; code: string; message: string };

/**
 * 인증 폼 공통.
 *
 * 서버 오류를 그대로 보여 줍니다 — 422 message 는 사용자에게 보여도 되는 문장입니다.
 * 403 은 code 에 따라 유도 화면으로 보냅니다.
 */
export interface ConsentTerm { code: string; title: string; isRequired: boolean }

export function AuthForm({ fields, submitLabel, action, next, footer, consent }: {
  fields: Field[];
  submitLabel: string;
  action: (data: Record<string, string>) => Promise<Result>;
  next: string;
  footer?: React.ReactNode;
  /** v10.27 (G-188) — 가입 약관 동의(시안 가입 4단계). 주면 「전체 동의 · 필수 · 선택」 칸을 그리고 agreedTerms 로 넘깁니다. */
  consent?: ConsentTerm[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const terms = consent ? [...consent].sort((a, b) => Number(b.isRequired) - Number(a.isRequired)) : [];
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const all = terms.length > 0 && terms.every((t) => ok[t.code]);
  const reqDone = terms.every((t) => !t.isRequired || ok[t.code]);
  function toggleAll() {
    const v = !all;
    setOk(Object.fromEntries(terms.map((t) => [t.code, v])));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries(
      fields.map((f) => [f.name, String(fd.get(f.name) ?? '')]),
    );
    if (consent) {
      if (!reqDone) {
        setErr({ code: 'REQUIRED_TERM', message: '필수 약관에 모두 동의해 주십시오.' });
        return;
      }
      data.agreedTerms = terms.filter((t) => ok[t.code]).map((t) => t.code).join(',');
    }
    setErr(null);
    start(async () => {
      const r = await action(data);
      /* v10.28 — 동의하지 않은 필수 약관이 있으면 로그인 직후 동의 화면으로(다 마치면 가려던 곳으로) */
      if (r.ok) router.push(r.reconsent ? `/terms/agree?next=${encodeURIComponent(next)}` : next);
      else setErr({ code: r.code, message: r.message });
    });
  }

  return (
    <form className="auth" onSubmit={submit}>
      {fields.map((f) => (
        <label key={f.name} className="fld">
          <span>{f.label}</span>
          <input
            name={f.name} type={f.type ?? 'text'}
            placeholder={f.placeholder} autoComplete={f.autoComplete} required
          />
          {f.hint && <em>{f.hint}</em>}
        </label>
      ))}

      {consent && terms.length > 0 && (
        <fieldset className="consent" data-consent>
          <legend>약관 동의</legend>
          <label className="consent-all">
            <input type="checkbox" checked={all} onChange={toggleAll} data-consent-all />
            <b>전체 동의</b> <span className="dim">필수 항목과 선택 항목에 모두 동의합니다.</span>
          </label>
          <ul>
            {terms.map((t) => (
              <li key={t.code}>
                <label>
                  <input type="checkbox" checked={!!ok[t.code]} data-consent-term={t.code}
                         onChange={(e) => setOk({ ...ok, [t.code]: e.target.checked })} />
                  {t.title} <em className={t.isRequired ? 'req' : 'opt'}>[{t.isRequired ? '필수' : '선택'}]</em>
                </label>
                <a href={`/terms/${t.code}`} target="_blank" rel="noopener noreferrer">보기 ›</a>
              </li>
            ))}
          </ul>
          <p className="dim">선택 항목은 동의하지 않으셔도 가입하실 수 있고, 마이페이지에서 언제든 바꾸실 수 있습니다.</p>
        </fieldset>
      )}

      {err && (
        <p className="form-error" role="alert">
          {err.message}
          {/* 계정 존재 여부를 구분하지 않으므로 안내는 한 문장입니다 */}
        </p>
      )}

      <button className="cta-primary" disabled={pending || (!!consent && terms.length > 0 && !reqDone)}>
        {pending ? '처리 중…' : submitLabel}
      </button>
      {footer}
    </form>
  );
}

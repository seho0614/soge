'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

interface Term {
  code: string; title: string; version: string;
  isRequired: boolean; agreed: boolean; effectiveFrom: string | null;
}

/**
 * 필수와 선택을 나눠 보여 줍니다.
 *
 * 하나로 묶어 "전체 동의"만 두면, 선택 항목까지 사실상 강제가 되고
 * **그 동의는 무효로 다뤄질 위험이 있습니다.**
 */
export function AgreeForm({ terms, next }: { terms: Term[]; next?: string | null }) {
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(terms.map((t) => [t.code, t.agreed])),
  );
  /* v10.28 (재동의) — 선택 항목은 **누가 바꾼 것만** 보냅니다. 전에는 화면의 체크 상태를 모두 보내, 예전 판에 동의해 둔 선택 항목
   * (마케팅 등 — 판이 바뀌어 「동의 안 함」으로 보임)이 필수 재동의를 하는 김에 「거부」로 기록될 수 있었습니다. 선택 약관은 지금 상태 그대로(10/9 답). */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const tr = useTranslations('policy');

  const required = terms.filter((t) => t.isRequired);
  const optional = terms.filter((t) => !t.isRequired);
  const canSubmit = required.every((t) => checked[t.code]);

  async function submit() {
    setErr(null); setOk(null);
    const res = await fetch('/api/v1/terms/agree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: terms.filter((t) => t.isRequired || touched[t.code]).map((t) => ({ code: t.code, agreed: !!checked[t.code] })),
      }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(b.message ?? tr('agree.form.saveFail')); return; }
    setOk(b.note ?? tr('agree.form.saved'));
    /* v10.28 — 동의 화면으로 보내져 왔으면(?next=) 가려던 곳으로 */
    start(() => { if (next) router.push(next); else router.refresh(); });
  }

  const row = (t: Term) => (
    /* v10.31 — 줄 배치 고침(전: 공용 .fld.row 를 써서 체크 칸이 가운데 위로 뜨고 글자는 오른쪽 끝 · 「전문 보기」가 아래로 늘어남 — 결함 하) */
    <label key={t.code} className="w1-agr">
      <input
        type="checkbox"
        checked={!!checked[t.code]}
        onChange={(e) => { setChecked((p) => ({ ...p, [t.code]: e.target.checked })); setTouched((p) => ({ ...p, [t.code]: true })); }}
        data-agree-term={t.code}
      />
      <span>
        {t.isRequired ? <b>{tr('agree.form.req')} </b> : `${tr('agree.form.opt')} `}
        {t.title}
      </span>
      <Link className="w1-bo sm" href={`/terms/${t.code}`} /* 20260930 — 소문자로 보내 약관 전문이 404 였습니다 */>
        {tr('agree.form.view')}
      </Link>
    </label>
  );

  return (
    <section>
      {required.length > 0 && (
        <>
          <h2>{tr('agree.form.reqH')}</h2>
          {required.map(row)}
          <p className="hint">
            {tr('agree.form.reqHint')}
          </p>
        </>
      )}

      {optional.length > 0 && (
        <>
          <h2>{tr('agree.form.optH')}</h2>
          {optional.map(row)}
          <p className="hint">
            {tr('agree.form.optHint')}
          </p>
        </>
      )}

      <button className="btn-primary" onClick={submit} disabled={pending || !canSubmit} data-agree-submit>
        {pending ? tr('agree.form.saving') : tr('agree.form.submit')}
      </button>

      {!canSubmit && (
        <p className="hint">{tr('agree.form.needAll')}</p>
      )}
      {err && <div className="notice warn">{err}</div>}
      {ok && <div className="ok-note">{ok}</div>}
    </section>
  );
}

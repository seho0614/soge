'use client';
import { useEffect, useState } from 'react';
import type { Gwan } from '@/lib/types';
import type { CodeEntry, FormCopy } from '@/lib/content';
import { RegisterTabs } from './RegisterTabs';

/**
 * 관을 고른 뒤 역할 탭으로 들어갑니다.
 *
 * 관별 문구는 서버에서 받습니다 — 새 관이 생겨도 화면을 고치지 않습니다.
 */
export function RegisterPicker({ gwans, categories, roles, messages }: {
  gwans: Gwan[];
  categories: { id: string; name: string; gwanCode: string }[];
  roles: CodeEntry[];
  messages: Record<string, string>;
}) {
  const [code, setCode] = useState(gwans[0]?.code ?? 'MNY');
  const [copy, setCopy] = useState<FormCopy[]>([]);

  useEffect(() => {
    fetch(`/api/v1/gwans/${code}/form-copy`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setCopy)
      .catch(() => setCopy([]));
  }, [code]);

  const gwan = gwans.find((g) => g.code === code);
  if (!gwan) return <p className="empty">등록 가능한 관이 없습니다.</p>;

  return (
    <>
      <div className="gwan-pick">
        {gwans.map((g) => (
          <button key={g.code} className={g.code === code ? 'on' : ''} onClick={() => setCode(g.code)}>
            {g.name}
          </button>
        ))}
      </div>
      <RegisterTabs
        gwan={gwan}
        categories={categories.filter((c) => c.gwanCode === code).map((c) => ({ id: c.id, name: c.name }))}
        copy={copy}
        roles={roles}
        messages={messages}
      />
    </>
  );
}

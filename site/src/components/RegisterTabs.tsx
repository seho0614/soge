'use client';
import { useState } from 'react';
import type { Gwan } from '@/lib/types';
import { ListingForm } from './ListingForm';
import type { CodeEntry, FormCopy } from '@/lib/content';

export type Role = 'OFFER' | 'REQUEST';

/**
 * SB-BIZ-REG-010 역할 탭.
 *
 * 프로토타입의 의도를 그대로 옮겼습니다.
 *   · 탭 노출 조건은 관의 상태입니다. 중지된 관은 탭을 띄우지 않습니다
 *   · 관마다 등록 폼이 다릅니다 — 소개창업은 "사업 기회" 등록입니다
 *   · 안내 문구는 코드가 아니라 설정에서 옵니다
 */
export function RegisterTabs({ gwan, categories, copy, roles, messages, sections, note, cancel }: {
  gwan: Gwan;
  categories: { id: string; name: string }[];
  copy: FormCopy[];
  roles: CodeEntry[];
  messages: Record<string, string>;
  /** 공유 파일 — v10.31 (w2): 시안 두 판 폼(ListingForm sections) */
  sections?: boolean;
  /** v10.32 (추가) — 폼 끝의 검수 안내 띠 · 등록 취소(ListingForm 으로 그대로 넘김) */
  note?: React.ReactNode;
  cancel?: React.ReactNode;
}) {
  const [role, setRole] = useState<Role>('OFFER');

  // 관이 중지 상태면 등록 자체를 열지 않습니다
  if (!gwan.isActive) {
    return (
      <div className="notice">
        <strong>{gwan.name}</strong> 은(는) 현재 등록을 받지 않습니다.
      </div>
    );
  }

  const HINT: Record<string, string> = {
    OFFER: '내가 가진 것을 소개해 소개비를 받습니다',
    REQUEST: '필요한 것을 올리면 소개자가 제안합니다',
  };
  const TABS = roles.map((r) => ({ key: r.code as Role, label: r.label, hint: HINT[r.code] ?? '' }));

  return (
    <>
      <div className="role-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key} role="tab"
            aria-selected={role === t.key}
            className={role === t.key ? 'on' : ''}
            onClick={() => setRole(t.key)}
          >
            <strong>{t.label}</strong>
            <span>{t.hint}</span>
          </button>
        ))}
      </div>

      {copy.find((c) => c.role === role)?.notice && (
        <div className="notice">{copy.find((c) => c.role === role)!.notice}</div>
      )}

      <ListingForm gwan={gwan} role={role} categories={categories} copy={copy} messages={messages} sections={sections} note={note} cancel={cancel} />
    </>
  );
}

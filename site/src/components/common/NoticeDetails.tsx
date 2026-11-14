'use client';
/**
 * v10.293 (docs/415) — 공지 한 건(펼치기). 로그인한 사람이 펼치면 읽음 기록(POST /me/notices/{id}/read · 판매자센터와 같은 표 notice_reads).
 *   고객센터 › 공지사항 · 제휴 파트너센터 › 공지사항 · 안심 파트너센터 › 공지 · 알림이 같이 씀.
 *   한 화면에서 한 번만 보냄 · 실패해도 화면은 그대로 · 「새 글」(최근 30일 · 아직 안 펼친 것)은 기록되면 지움
 *   v10.294 — 기록되면 머리줄 공지 점을 다시 셈(창 이벤트 sgb:notice-read · UniHeader 가 받음).
 */
import { useRef, useState, type ReactNode } from 'react';

export function NoticeDetails({ id, summary, children, unread = false, newLabel, login = true }: {
  id: string; summary: ReactNode; children: ReactNode; unread?: boolean; newLabel: string; login?: boolean;
}) {
  const [isNew, setNew] = useState(unread);
  const sent = useRef(false);
  return (
    <details data-notice-read={id} data-notice-unread={isNew ? '1' : '0'} onToggle={(e) => {
      if (!(e.currentTarget as HTMLDetailsElement).open || sent.current || !login) return;
      sent.current = true;
      void fetch(`/api/v1/me/notices/${id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then((r) => { if (r.ok) { setNew(false); window.dispatchEvent(new Event('sgb:notice-read')); } })
        .catch(() => undefined);
    }}>
      <summary>{isNew && <><span className="nt-new" data-notice-new="">{newLabel}</span>{' '}</>}{summary}</summary>
      {children}
    </details>
  );
}

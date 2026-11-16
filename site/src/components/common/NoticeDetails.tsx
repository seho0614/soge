'use client';
/**
 * v10.293 (docs/415) — 공지 한 건(펼치기). 로그인한 사람이 펼치면 읽음 기록(POST /me/notices/{id}/read · 판매자센터와 같은 표 notice_reads).
 *   고객센터 › 공지사항 · 제휴 파트너센터 › 공지사항 · 안심 파트너센터 › 공지 · 알림이 같이 씀.
 *   한 화면에서 한 번만 보냄 · 실패해도 화면은 그대로 · 「새 글」(최근 30일 · 아직 안 펼친 것)은 기록되면 지움
 *   v10.294 — 기록되면 머리줄 공지 점을 다시 셈(창 이벤트 sgb:notice-read · UniHeader 가 받음).
 *   v10.322 (docs/449) — 주소 끝이 #n-<id> 면(알림 · 메인 띠 · 고정 줄에서 옴) 그 공지를 펼친 채 보여 줌 → 펼친 것과 같아 읽음 기록.
 *   v10.328 (docs/456) — 「모두 읽음」 뒤 화면 새로 읽기(router.refresh)로 unread 가 바뀌면 「새 글」도 따라 지움.
 *   v10.330 (docs/459) — readPath: 읽음 기록 주소(판매자센터 소개몰 공지는 /api/v1/me/health/seller/notices/{id}/read · 비우면 공통).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function NoticeDetails({ id, summary, children, unread = false, newLabel, login = true, readPath }: {
  id: string; summary: ReactNode; children: ReactNode; unread?: boolean; newLabel: string; login?: boolean; readPath?: string;
}) {
  const [isNew, setNew] = useState(unread);
  useEffect(() => { setNew(unread); }, [unread]);
  const sent = useRef(false);
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const openIfHash = () => {
      const d = box.current;
      if (!d || window.location.hash !== `#n-${id}`) return;
      if (!d.open) d.open = true;   // toggle 이벤트가 읽음 기록을 보냄
      d.scrollIntoView({ block: 'start' });
    };
    openIfHash();
    window.addEventListener('hashchange', openIfHash);
    return () => window.removeEventListener('hashchange', openIfHash);
  }, [id]);
  return (
    <details ref={box} data-notice-read={id} data-notice-unread={isNew ? '1' : '0'} onToggle={(e) => {
      if (!(e.currentTarget as HTMLDetailsElement).open || sent.current || !login) return;
      sent.current = true;
      void fetch(readPath ?? `/api/v1/me/notices/${id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then((r) => { if (r.ok) { setNew(false); window.dispatchEvent(new Event('sgb:notice-read')); } })
        .catch(() => undefined);
    }}>
      <summary>{isNew && <><span className="nt-new" data-notice-new="">{newLabel}</span>{' '}</>}{summary}</summary>
      {children}
    </details>
  );
}

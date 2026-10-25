'use client';
/**
 * v10.101 (2-5b) — 화면이 뜬 뒤 창 제목을 바꿉니다(없는 주소 화면 — metadata 가 쓰이지 않는 곳).
 *   제목 글은 서버 부품이 사전에서 꺼내 넘깁니다(이 부품은 사전을 쓰지 않아 <Msgs> 가 필요 없음).
 */
import { useEffect } from 'react';

export function DocTitle({ title }: { title: string }) {
  useEffect(() => { document.title = title; }, [title]);
  return null;
}

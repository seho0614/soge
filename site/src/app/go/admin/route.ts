/**
 * v10.31 — 시안 머리줄 「관리자 페이지」 단추의 목적지. 운영 화면(BO · sgb/web)은 따로 떠 있어 그 주소로 보냅니다.
 *   주소는 환경변수 BO_URL(예: https://admin.sogaebank.com). 없으면 개발 기본값(vite 5173).
 *   여기서는 권한을 판정하지 않습니다 — 단추는 운영 역할에게만 보이고, 실제 권한 검사는 BO 와 서버 API 가 합니다.
 * v10.158 (docs/240) — 운영(production)에서 BO_URL 이 비어 있으면 localhost 로 보내지 않고 503 안내(10/30 운영 사고 · 단추가 localhost:5173 으로 감).
 *   precheck · postcheck 도 BO_URL 을 확인합니다.
 */
import { NextResponse } from 'next/server';

export function GET() {
  const set = (process.env.BO_URL || '').trim();
  if (!set && process.env.NODE_ENV === 'production') {
    return new NextResponse('운영 화면 주소(BO_URL)가 설정되지 않았습니다 — 서버 .env 에 BO_URL=https://admin.… 을 넣고 사용자 웹을 다시 띄우십시오.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return NextResponse.redirect(set || 'http://localhost:5173', 302);
}

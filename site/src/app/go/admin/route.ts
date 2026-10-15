/**
 * v10.31 — 시안 머리줄 「관리자 페이지」 단추의 목적지. 운영 화면(BO · sgb/web)은 따로 떠 있어 그 주소로 보냅니다.
 *   주소는 환경변수 BO_URL(예: https://admin.sogaebank.com). 없으면 개발 기본값(vite 5173).
 *   여기서는 권한을 판정하지 않습니다 — 단추는 운영 역할에게만 보이고, 실제 권한 검사는 BO 와 서버 API 가 합니다.
 */
import { NextResponse } from 'next/server';

export function GET() {
  const url = process.env.BO_URL || 'http://localhost:5173';
  return NextResponse.redirect(url, 302);
}

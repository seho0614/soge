'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * 없는 주소(404) — v10.25 (G-166)
 *
 * 전에는 이 파일이 없어 Next 의 영어 기본 화면(「404 This page could not be found.」)이 나왔습니다.
 * 응답 코드는 404 그대로이고, 머리줄 · 바닥줄은 주소에 맞는 것이 그대로 붙습니다(소개몰 · 소개광장 주소면 두 관 전용).
 *
 * 창 제목은 화면이 뜬 뒤에 바꿉니다 — 이 파일의 metadata 내보내기는 없는 주소 화면에 쓰이지 않고(제목이 「소개뱅크」로 남음),
 * <title> 을 본문에 두면 머리에 제목이 두 개가 됩니다.
 */
export default function NotFound() {
  useEffect(() => { document.title = '없는 주소 · 소개뱅크'; }, []);
  return (
    <article className="doc" data-notfound>
      <h1>없는 주소입니다</h1>
      <p>주소가 바뀌었거나 지워진 화면입니다. 주소를 다시 확인해 주십시오.</p>
      <p><Link className="btn-sm" href="/">홈으로</Link></p>
    </article>
  );
}

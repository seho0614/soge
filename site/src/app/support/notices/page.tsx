import { redirect } from 'next/navigation';

/**
 * v10.279 (D210 · docs/408) 고객센터 › 공지사항 → v10.321 (docs/448) 공지는 한 곳 — 소개광장 › 공지로 넘김.
 *   공지 목록 · 펼치기 · 읽음 기록 · 첨부는 소개광장 공지(components/community/PlazaNotices · NoticeDetails · NoticeFiles)가 같은 부품으로 보여 줌.
 *   옛 알림 주소(/support/notices)도 이 화면을 거쳐 소개광장 공지로 감.
 */
export default function SupportNoticesPage() {
  redirect('/community?board=NOTICE');
}

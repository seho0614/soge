/**
 * v10.173 (D162 · docs/266) — 사용자 웹 맨 위 안내 한 줄(사이트 설정 site.notice_bar · 영어 화면은 site.notice_bar_en, 비면 한국어).
 *   간주 모드(시험 결제 · 시험 본인인증)로 공개한 동안 「시범 운영 중」 같은 안내를 운영 화면에서 켜고 끕니다. 빈 값이면 그리지 않음.
 */
export function NoticeBar({ settings, locale }: { settings: Record<string, string | null>; locale: string }) {
  const ko = (settings['site.notice_bar'] ?? '').trim();
  const en = (settings['site.notice_bar_en'] ?? '').trim();
  const text = locale === 'ko' ? ko : en || ko;
  if (!text) return null;
  return <div className="site-notice-bar" role="note" data-notice-bar="">{text}</div>;
}

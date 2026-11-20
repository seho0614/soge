import { getTranslations } from 'next-intl/server';
import { apiGetPublic } from '@/lib/api';
import { socErrKey } from '@/lib/socialAuth';

/**
 * v10.498 (D272 · docs/636) 로그인 화면 간편 로그인 단추 — 켜진 업체만(GET /auth/social/providers · 30초) · 꺼져 있으면 아무것도 그리지 않음
 *   단추는 링크(/login/social/{p}?next=…) — 시작 처리기가 묶음 쿠키 · state · PKCE 를 준비하고 업체로 보냄
 *   ?social_error=코드 로 돌아오면 그 뜻을 한 줄(서버 코드 → 사전 열쇠 · lib/socialAuth)
 */
export async function SocialButtons({ next, error }: { next: string; error?: string | null }) {
  const [t, p] = await Promise.all([getTranslations('upt'),
    apiGetPublic<{ items: Array<{ provider: 'KAKAO' | 'NAVER'; path: string }> }>('/auth/social/providers', 30).catch(() => ({ items: [] as Array<{ provider: 'KAKAO' | 'NAVER'; path: string }> }))]);
  if (!p.items.length && !error) return null;
  const q = `?next=${encodeURIComponent(next)}`;
  return (
    <div className="upt-soc" data-social-buttons={String(p.items.length)}>
      {error && <div className="w1-jc w" role="alert" data-social-error={error.slice(0, 40)}>{t(socErrKey(error))}</div>}
      {p.items.length > 0 && <div className="upt-soc-or"><span>{t('socialOr')}</span></div>}
      {p.items.map((x) => (
        <a key={x.provider} className={`upt-soc-btn upt-soc-${x.path}`} href={`/login/social/${x.path}${q}`} data-social={x.provider}>
          {x.provider === 'KAKAO' ? t('kakaoLogin') : t('naverLogin')}
        </a>
      ))}
      {p.items.length > 0 && <p className="w1-nt3">{t('socialNote')}</p>}
    </div>
  );
}

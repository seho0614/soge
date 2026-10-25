'use client';
/**
 * v10.29 — 제휴 대시보드 「빠른 홍보하기」 (시안 scP2Dsh — 링크 칸 + 「복사하기」 + 색 단추 6개)
 *
 * 시안은 단추 6개를 그림 한 장으로 붙였습니다. 여기서는 같은 색 · 글자의 진짜 단추로 그립니다.
 *   내 소개링크 생성 → /partners/links#new
 *   카톡 공유        → v10.31 (W5): 카카오 JavaScript 키(NEXT_PUBLIC_KAKAO_JS_KEY)가 있으면 카카오 공유(Kakao.Share · 텍스트 + 링크)로 바로 보냅니다.
 *                      키가 없으면 기기 공유 창(Web Share) · 그것도 없으면 주소를 복사하고 카톡에 붙이시라고 알림
 *   밴드 공유        → 네이버 밴드 공유 주소(band.us/plugin/share) 새 창
 *   문자 공유        → sms: 로 문자 앱 열기
 *   홍보문구 복사    → 마케팅자료실(심의 통과 문구만 씁니다 — 직접 만든 문구는 회사가 한 말이 됩니다)
 *   쇼츠용 영상 받기 → 마케팅자료실(영상 자료)
 * 공유할 주소는 실제 링크(첫 번째 사용 중 링크의 /r/{코드})입니다. 링크가 없으면 공유 단추는 꺼 두고 만들기로 안내합니다.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

const IC = {
  lnk: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  talk: <path d="M12 4C7 4 3 7.1 3 11c0 2.4 1.6 4.6 4 5.9L6 21l4.3-2.6c.6.1 1.1.1 1.7.1 5 0 9-3.1 9-7s-4-7.5-9-7.5z" />,
  band: <><rect x="4" y="3" width="16" height="18" rx="4" /><path d="M9 7v10h4a3 3 0 0 0 0-6H9" /></>,
  sms: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 10h.01M12 10h.01M16 10h.01" /></>,
  copy: <><rect x="8" y="3" width="12" height="16" rx="2" /><path d="M4 7v12a2 2 0 0 0 2 2h10" /><path d="M11 8h6M11 12h6" /></>,
  play: <><circle cx="12" cy="12" r="10" /><path d="M10 8l6 4-6 4z" /></>,
};
const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? '';
const KAKAO_SDK = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
type KakaoT = { isInitialized: () => boolean; init: (k: string) => void; Share: { sendDefault: (o: Record<string, unknown>) => void } };
let kakaoP: Promise<KakaoT> | null = null;
function loadKakao(): Promise<KakaoT> {
  const w = window as unknown as { Kakao?: KakaoT };
  if (w.Kakao) return Promise.resolve(w.Kakao);
  kakaoP ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = KAKAO_SDK; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => (w.Kakao ? resolve(w.Kakao) : reject(new Error('SDK')));
    s.onerror = () => { kakaoP = null; reject(new Error('SDK')); };
    document.head.appendChild(s);
  });
  return kakaoP;
}
const Svg = ({ d }: { d: React.ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>{d}</svg>
);

export function P2Promo({ url, label }: { url: string | null; label?: string | null }) {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useTranslations('partner.p2.promo');
  const text = label ? t('shareTextL', { label }) : t('shareText');
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3000); };

  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); flash(t('copied')); }
    catch { flash(t('copyBlocked')); }
  }
  async function talk() {
    if (!url) return;
    if (KAKAO_KEY) {
      try {
        const K = await loadKakao();
        if (!K.isInitialized()) K.init(KAKAO_KEY);
        K.Share.sendDefault({ objectType: 'text', text, link: { webUrl: url, mobileWebUrl: url }, buttonTitle: t('kakaoButton') });
        return;
      } catch { /* 카카오 SDK 를 못 받으면 아래 기기 공유로 */ }
    }
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: t('shareTitle'), text, url }); return; } catch { return; /* 닫음 */ }
    }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); flash(t('copiedTalk')); }
    catch { flash(t('noShare')); }
  }
  const off = !url;
  const offTitle = t('offTitle');
  const band = url ? `https://band.us/plugin/share?body=${encodeURIComponent(`${text}\n${url}`)}&route=${encodeURIComponent(url)}` : undefined;
  const sms = url ? `sms:?&body=${encodeURIComponent(`${text} ${url}`)}` : undefined;

  return (
    <div className="p2promo" data-p2-promo>
      <div className="p2url">
        <div className="box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6E7A96" strokeWidth="2" aria-hidden>{IC.lnk}</svg>
          {url ? <span data-testid="share-url">{url}</span> : <span>{t('noLink')}</span>}
        </div>
        <button type="button" className="p2dark" onClick={() => void copy()} disabled={off} title={off ? offTitle : undefined}>{t('copy')}</button>
      </div>
      <div className="p2qbtns">
        <Link className="q blue" href="/partners/links#new"><Svg d={IC.lnk} /><b>{t('newLink')}</b><span>{t('newLinkSub')}</span></Link>
        <button type="button" className="q yellow" onClick={() => void talk()} disabled={off} title={off ? offTitle : undefined}><Svg d={IC.talk} /><b>{t('talk')}</b><span>{t('talkSub')}</span></button>
        {band
          ? <a className="q green" href={band} target="_blank" rel="noopener noreferrer"><Svg d={IC.band} /><b>{t('band')}</b><span>{t('bandSub')}</span></a>
          : <button type="button" className="q green" disabled title={offTitle}><Svg d={IC.band} /><b>{t('band')}</b><span>{t('bandSub')}</span></button>}
        {sms
          ? <a className="q purple" href={sms}><Svg d={IC.sms} /><b>{t('sms')}</b><span>{t('smsSub')}</span></a>
          : <button type="button" className="q purple" disabled title={offTitle}><Svg d={IC.sms} /><b>{t('sms')}</b><span>{t('smsSub')}</span></button>}
        <Link className="q dark" href="/partners/materials"><Svg d={IC.copy} /><b>{t('copyText')}</b><span>{t('copyTextSub')}</span></Link>
        <Link className="q red" href="/partners/materials"><Svg d={IC.play} /><b>{t('shorts')}</b><span>{t('shortsSub')}</span></Link>
      </div>
      {msg && <p className="p2msg" role="status">{msg}</p>}
    </div>
  );
}

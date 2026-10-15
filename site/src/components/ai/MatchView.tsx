'use client';
/**
 * v10.31 — SB-AIS-REC-010 AI 추천 결과(시안 scAiRec): 가중치 밀대 5개(기본값으로) · 스폰서 칸(점수 밖) · 후보 카드(항목별 점수 막대 · 총점 · 성사 · 평균 응답 · 인증).
 *   항목 점수는 서버가 실제 자료로 냅니다(GET /ai/recommend/request). 밀대를 움직이면 이 화면에서 바로 다시 줄 세웁니다(시안 그대로 — 저장하지 않음).
 *   광고는 점수에 넣지 않고 순위에도 끼지 않습니다(표시광고법). 노출 · 클릭은 기록합니다(과금 근거).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GWAN_PATH } from '@/lib/format';

export interface Weight { code: string; name: string; weight: number }
export interface Cand {
  company: string; region: string | null; verified: boolean; listingId: string; listingTitle: string; categoryName: string;
  scores: Record<string, number>; total: number; deals: number; replyHours: number | null; reviewAvg: number | null; reviewCount: number;
}
export interface Ad { empty: boolean; id?: string; advertiser?: string; title?: string; code?: string; cta?: string | null; landingRoute?: string | null }

export function MatchView({ weights, cands, gwanCode, ad }: { weights: Weight[]; cands: Cand[]; gwanCode: string; ad: Ad | null }) {
  const router = useRouter();
  const base = useMemo(() => Object.fromEntries(weights.map((w) => [w.code, w.weight])), [weights]);
  const [W, setW] = useState<Record<string, number>>(base);
  const tot = Object.values(W).reduce((a, b) => a + Number(b || 0), 0) || 1;
  const rows = useMemo(() => cands.map((c) => ({
    c, sc: Math.round((weights.reduce((s, w) => s + (c.scores[w.code] ?? 0) * Number(W[w.code] || 0), 0) / tot) * 10) / 10,
  })).sort((a, b) => b.sc - a.sc), [cands, weights, W, tot]);

  const seen = useRef(false);
  useEffect(() => {
    if (!ad?.id || ad.empty || seen.current) return;
    seen.current = true;
    fetch(`/api/v1/ads/${encodeURIComponent(ad.id)}/impression?slot=RECS`, { method: 'POST' }).catch(() => {});
  }, [ad]);

  async function adClick() {
    if (!ad?.id) return;
    await fetch(`/api/v1/ads/${encodeURIComponent(ad.id)}/click?slot=RECS`, { method: 'POST' }).catch(() => {});
    const r = ad.landingRoute;
    router.push(r && r.startsWith('/') && !r.startsWith('//') ? r : `/ad/${encodeURIComponent(ad.id)}?from=recs`);
  }

  return (
    <div className="w1-aiwrap">
      <div className="w1-aiwb">
        <div className="w1-aiwh"><b>가중치</b><button type="button" className="w1-bo sm" onClick={() => setW(base)}>기본값으로</button></div>
        {weights.map((w) => (
          <label key={w.code} className="w1-aiwrow" htmlFor={`w-${w.code}`}>
            <span>{w.name}</span>
            <input type="range" id={`w-${w.code}`} min={0} max={50} step={5} value={Number(W[w.code] ?? 0)}
              onChange={(e) => setW((x) => ({ ...x, [w.code]: Number(e.target.value) }))} />
            <b>{Number(W[w.code] ?? 0)}</b>
          </label>
        ))}
        <div className="w1-ls">합계 {Object.values(W).reduce((a, b) => a + Number(b || 0), 0)} — 합이 100이 아니어도 됩니다. 비율로 나눠 씁니다.</div>
      </div>
      <div className="w1-aicol">
        {ad && !ad.empty && ad.id && (
          <div className="w1-adrec" data-adbox="RECS">
            <span className="adlab">광고</span>
            <div><b>{ad.title}</b><span className="w1-ls" style={{ display: 'block', marginTop: 2 }}>{ad.advertiser} · {ad.code}</span></div>
            <button type="button" className="w1-bo sm" onClick={adClick}>{ad.cta ?? '자세히 보기'}</button>
            <div className="adwhy">스폰서 자리입니다. <b>점수 계산에 넣지 않았고</b> 순위에도 끼지 않습니다 — 광고와 추천을 섞으면 표시광고법상 문제가 됩니다.</div>
          </div>
        )}
        {rows.length === 0 && <div className="w1-empty">이 요청의 관에 게시 중인 사업자 매물이 아직 없습니다 — 후보가 생기면 여기에 줄 세웁니다.</div>}
        {rows.map(({ c, sc }, i) => (
          <div key={c.listingId} className={`w1-reccard${i === 0 ? ' on' : ''}`}>
            <div className="w1-rcdh">
              <span className="rkr">{i + 1}</span>
              <div style={{ minWidth: 0 }}><b>{c.company}</b><span className="w1-ls">{[c.categoryName, c.region ?? '주소 미등록'].join(' · ')}</span></div>
              <div className="rsc"><b>{sc}</b><span>점</span></div>
            </div>
            <div className="w1-rbars">
              {weights.map((w) => (
                <div key={w.code} className="w1-rb"><span>{w.name}</span><i style={{ width: `${c.scores[w.code] ?? 0}%` }} /><em>{c.scores[w.code] ?? 0}</em></div>
              ))}
            </div>
            <div className="w1-rmeta">
              성사 {c.deals}건 · 평균 응답 {c.replyHours != null ? `${c.replyHours}시간` : '기록 없음'}
              {c.reviewCount ? ` · 후기 ★${c.reviewAvg} (${c.reviewCount})` : ''} · 매물 <Link href={`/${GWAN_PATH[gwanCode] ?? 'money'}/${c.listingId}`}>{c.listingTitle}</Link>
            </div>
            <div className="w1-rflag">
              {!c.verified
                ? <span className="w1-rfl no">사업자 인증 없음 — 성사되면 소개비는 개인으로 받습니다(본인인증 · 받을 계좌 확인).</span>
                : <span className="w1-rfl ok">인증 문제 없음 — 1:1 문의를 시작하면 소개코드가 발급됩니다.</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

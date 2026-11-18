import { useState } from 'react';

export interface PreviewFaq {
  question: string; answer: string; linkHref?: string | null; linkLabel?: string | null; handoff: boolean;
  channels: string[]; keywords: string[]; isActive: boolean;
}

const WHERE: Record<string, string> = { FAQ: '고객센터', CS: '고객센터', GUIDE: '이용안내', BOT: '1:1 문의 챗봇 · AI 상담' };

/** 사용자 웹 고객센터 찾기와 같은 규칙(site CsHub) — 소문자로 바꾼 낱말이 질문 · 답에 들었거나, 찾기 낱말과 서로 들어 있으면 나옴 */
export function faqMatch(word: string, f: PreviewFaq): '' | 'question' | 'answer' | 'keyword' {
  const w = word.trim().toLowerCase();
  if (!w) return '';
  if (f.question.toLowerCase().includes(w)) return 'question';
  if (f.answer.toLowerCase().includes(w)) return 'answer';
  if (f.keywords.some((k) => k && (k.toLowerCase().includes(w) || w.includes(k.toLowerCase())))) return 'keyword';
  return '';
}

const HIT_KO = { question: '질문에 든 낱말', answer: '답에 든 낱말', keyword: '찾기 낱말과 맞음' } as const;

/**
 * 질문 미리보기 (v10.345 · docs/479) — 관 관리 › 자주 묻는 질문(SB-ADM-SIT-100)
 *
 * 대표 11/18 「다음개발」 → ②. 「보이기」 · 저장 전에 회원이 고객센터에서 펼쳤을 때 보는 모습 · 나오는 곳 · 찾기 시험.
 * 서버를 부르지 않습니다(화면 안 계산) — 저장 전 글도 그대로 봅니다. 질문은 한국어 글만 있습니다(영어는 다국어 › 번역 초안).
 */
export function FaqPreview({ f, onClose }: { f: PreviewFaq; onClose: () => void }) {
  const [word, setWord] = useState('');
  const hit = faqMatch(word, f);
  const where = [...new Set(f.channels.map((c) => WHERE[c] ?? c))];
  const linkOk = !f.linkHref || f.linkHref.startsWith('/');
  return (
    <div className="card" data-faq-preview={f.isActive ? 'on' : 'off'}>
      <h3 className="sec">미리보기 — 회원이 보는 모습 <button className="btn-plain btn-sm" onClick={onClose} data-faq-preview-close="">닫기</button></h3>
      {!f.isActive && <div className="ad-nt warn" data-faq-preview-hidden=""><b>지금 숨김</b> — 「보이기」를 누르기 전에는 사용자 웹 어디에도 나오지 않습니다.</div>}
      <p className="dim">나오는 곳: <b data-faq-preview-where={where.length}>{where.length ? where.join(' · ') : '없음'}</b></p>
      <div style={{ border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: '10px 14px', maxWidth: 680, background: 'var(--bg, #fff)' }}>
        <details open data-faq-preview-item="">
          <summary><b>{f.question || '(질문 없음)'}</b></summary>
          <p style={{ whiteSpace: 'pre-line' }} data-faq-preview-answer="">{f.answer || '(답 없음)'}</p>
          {f.linkHref && f.linkLabel && <p data-faq-preview-link="">{f.linkLabel} →</p>}
          <p className="dim">도움이 되었나요? <button className="btn-sm btn-plain" disabled>예</button> <button className="btn-sm btn-plain" disabled>아니오</button></p>
        </details>
      </div>
      {f.handoff && <p className="dim" data-faq-preview-handoff="">챗봇에서는 답 아래 「상담원 연결」 단추가 붙습니다.</p>}
      {(f.linkHref && !f.linkLabel) || (!f.linkHref && f.linkLabel) ? <p className="warn-text">「…에서 보기」는 주소와 단추 글자가 둘 다 있어야 나옵니다.</p> : null}
      {!linkOk && <p className="warn-text" data-faq-preview-badlink="">주소는 / 로 시작해야 합니다(사이트 안 주소만) — 저장하면 422 로 막힙니다.</p>}
      <p>
        <label>찾기 시험 <input name="faq-preview-word" value={word} onChange={(e) => setWord(e.target.value)} placeholder="회원이 칠 낱말" /></label>{' '}
        {word.trim() && (hit
          ? <b data-faq-preview-hit={hit}>나옴 — {HIT_KO[hit]}</b>
          : <b className="warn-text" data-faq-preview-hit="none">안 나옴 — 이 낱말을 찾기 낱말(챗봇 낱말)에 더하면 나옵니다</b>)}
      </p>
    </div>
  );
}

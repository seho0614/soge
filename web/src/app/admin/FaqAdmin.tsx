import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { siteHref } from '../../lib/siteUrl';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Row {
  id: string; category: string; question: string; answer: string; topic: string; isTop: boolean; isActive: boolean;
  channels: string[]; keywords: string[]; linkHref: string | null; linkLabel: string | null; handoff: boolean;
  gwanCode: string | null; sortOrder: number; updatedAt: string; by: string | null;
  views30?: number; yes30?: number; no30?: number;   /* v10.334 (D226) 최근 30일 펼침 · 도움 됨 · 안 됨 */
}
interface Miss { word: string; hits30: number; last: string }
interface Data { rows: Row[]; topics: string[]; channels: string[]; topMax: number; top: number; candidates?: Array<{ id: string; question: string; views30: number }>; misses?: Miss[] }

const TOPIC_KO: Record<string, string> = {
  ACCOUNT: '회원 · 가입', DEAL: '소개 · 거래', MONEY: '수수료 · 정산', MALL: '소개몰', ADS: '광고 · 구독', SAFETY: '안전 · 신고', ETC: '기타',
};
const CH_KO: Record<string, string> = { FAQ: '고객센터', CS: '고객센터(시안)', GUIDE: '이용안내', BOT: '챗봇' };

type Form = Omit<Row, 'id' | 'updatedAt' | 'by' | 'keywords' | 'views30' | 'yes30' | 'no30'> & { keywords: string };
const EMPTY: Form = {
  category: '', question: '', answer: '', topic: 'ETC', isTop: false, isActive: true, channels: ['FAQ', 'CS'], keywords: '',
  linkHref: '', linkLabel: '', handoff: false, gwanCode: '', sortOrder: 100,
};
const toForm = ({ views30: _v, yes30: _y, no30: _n, id: _i, updatedAt: _u, by: _b, ...r }: Row): Form => ({ ...r, keywords: r.keywords.join(', '), linkHref: r.linkHref ?? '', linkLabel: r.linkLabel ?? '', gwanCode: r.gwanCode ?? '' });

/**
 * SB-ADM-SIT-100 자주 묻는 질문 (v10.332 · D224 · docs/463)
 *
 * 대표 11/17 「고객센터 … 보통의 고객센터 기능」 → 「기본 + 운영 화면 FAQ 관리」.
 * 사용자 웹 고객센터(분야 탭 · 많이 찾는 질문 · 찾기) · 이용안내 · 1:1 문의 챗봇이 읽는 질문 글입니다. 저장하면 바로 나갑니다.
 * 지우기는 없습니다 — 「숨기기」. 바꿀 때마다 감사 기록(FAQ_CREATE · FAQ_UPDATE).
 */
export function FaqAdmin() {
  const q = useApi<Data>('/admin/faqs');
  const a = useAct();
  const [edit, setEdit] = useState<{ id: string | null; f: Form } | null>(null);
  const [topic, setTopic] = useState('');
  const [word, setWord] = useState('');
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const { rows, topics, channels, topMax, top, candidates = [], misses = [] } = q.data;
  const w = word.trim();
  const shown = rows.filter((r) => (!topic || r.topic === topic) && (!w || r.question.includes(w) || r.answer.includes(w) || r.category.includes(w)));

  const body = (f: Form) => ({
    category: f.category, question: f.question, answer: f.answer, topic: f.topic, isTop: f.isTop, isActive: f.isActive, channels: f.channels,
    keywords: f.keywords.split(',').map((x) => x.trim()).filter(Boolean), linkHref: f.linkHref ?? '', linkLabel: f.linkLabel ?? '',
    handoff: f.handoff, gwanCode: f.gwanCode ?? '', sortOrder: Number(f.sortOrder) || 0,
  });
  const save = () => {
    if (!edit) return;
    const { id, f } = edit;
    void a.run('save', () => api(id ? `/admin/faqs/${id}` : '/admin/faqs', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body(f)) }),
      () => { setEdit(null); q.reload(); });
  };
  const patch = (r: Row, v: Partial<Pick<Row, 'isActive' | 'isTop'>>, ask: string) => {
    if (!confirm(ask)) return;
    void a.run(`p-${r.id}`, () => api(`/admin/faqs/${r.id}`, { method: 'PATCH', body: JSON.stringify(v) }), q.reload);
  };
  /* v10.336 (D228) — 못 찾은 낱말: 「새 질문」은 낱말을 질문 · 챗봇 낱말 칸에 넣어 엶 · 「다룸」은 목록에서 내림 */
  const fromMiss = (m: Miss) => setEdit({ id: null, f: { ...EMPTY, question: m.word, keywords: m.word } });
  const missDone = (m: Miss) => {
    if (!confirm(`「${m.word}」을(를) 다룸으로 표시합니다. 다시 찾는 사람이 있으면 목록에 다시 나옵니다.`)) return;
    void a.run(`m-${m.word}`, () => api('/admin/faqs/misses/done', { method: 'POST', body: JSON.stringify({ word: m.word }) }), q.reload);
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEdit((e) => (e ? { ...e, f: { ...e.f, [k]: v } } : e));

  return (
    <section data-faq-admin="">
      <Flash msg={a.msg} err={a.err} />
      <p data-faq-count={rows.length}>
        질문 <b>{rows.filter((r) => r.isActive).length}</b>개 보임 · 숨김 {rows.filter((r) => !r.isActive).length}개 ·
        「많이 찾는 질문」 <b data-faq-top={top}>{top}</b> / {topMax} ·{' '}
        <a href={siteHref('/support/new')} target="_blank" rel="noreferrer">사용자 웹 고객센터에서 보기</a>
      </p>
      <p>
        <select name="faq-topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="">분야 모두</option>
          {topics.map((t) => <option key={t} value={t}>{TOPIC_KO[t] ?? t}</option>)}
        </select>{' '}
        <input name="faq-word" value={word} onChange={(e) => setWord(e.target.value)} placeholder="질문 · 답 · 분류 찾기" />{' '}
        <button className="btn-ok" onClick={() => setEdit({ id: null, f: { ...EMPTY } })} data-faq-new="">새 질문</button>
      </p>

      {candidates.length > 0 && (
        <div className="ad-nt info" data-faq-candidates={candidates.length}>
          <b>「많이 찾는 질문」 후보</b>(최근 30일 많이 펼친 순 · 아직 TOP 아님):{' '}
          {candidates.map((c, i) => <span key={c.id}>{i > 0 && ' · '}{c.question} <small className="dim">{c.views30}회</small></span>)}
        </div>
      )}
      <div className="card" data-faq-misses={misses.length}>
        <b>못 찾은 낱말 30일</b> <small className="dim">고객센터 찾기에서 결과가 0건이던 낱말 · 많이 찾은 순 20개 · 사람 정보 없음</small>
        {misses.length === 0 ? <p className="muted">아직 없습니다.</p> : (
          <table className="tbl"><thead><tr><th>낱말</th><th>30일</th><th>마지막</th><th></th></tr></thead><tbody>
            {misses.map((m) => (
              <tr key={m.word} data-faq-miss={m.word}>
                <td>{m.word}</td><td>{m.hits30}회</td><td>{m.last}</td>
                <td>
                  <button className="btn-sm" onClick={() => fromMiss(m)} data-faq-miss-new="">이 낱말로 새 질문</button>{' '}
                  <button className="btn-sm ghost" onClick={() => missDone(m)} disabled={a.busy === `m-${m.word}`} data-faq-miss-done="">다룸</button>
                </td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
      {edit && (
        <div className="card" data-faq-form={edit.id ?? 'new'}>
          <h3 className="sec">{edit.id ? '질문 고치기' : '새 질문'}</h3>
          <p>
            <label>분류 <input name="faq-category" value={edit.f.category} onChange={(e) => set('category', e.target.value)} maxLength={20} placeholder="예: 정산" /></label>{' '}
            <label>고객센터 분야 <select name="faq-topic-edit" value={edit.f.topic} onChange={(e) => set('topic', e.target.value)}>
              {topics.map((t) => <option key={t} value={t}>{TOPIC_KO[t] ?? t}</option>)}
            </select></label>{' '}
            <label>순서 <input name="faq-sort" type="number" min={0} max={9999} value={edit.f.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} style={{ width: 80 }} /></label>
          </p>
          <p><input name="faq-question" value={edit.f.question} onChange={(e) => set('question', e.target.value)} maxLength={200} placeholder="질문(2 ~ 200자)" style={{ width: '100%' }} /></p>
          <p><textarea name="faq-answer" value={edit.f.answer} onChange={(e) => set('answer', e.target.value)} maxLength={3000} rows={6} placeholder="답(2 ~ 3,000자)" style={{ width: '100%' }} /></p>
          <p>
            나오는 곳:{' '}
            {channels.map((c) => (
              <label key={c} style={{ marginRight: 10 }}>
                <input type="checkbox" name={`faq-ch-${c}`} checked={edit.f.channels.includes(c)}
                  onChange={(e) => set('channels', e.target.checked ? [...edit.f.channels, c] : edit.f.channels.filter((x) => x !== c))} /> {CH_KO[c] ?? c}
              </label>
            ))}
          </p>
          <p>
            <label><input type="checkbox" name="faq-top" checked={edit.f.isTop} onChange={(e) => set('isTop', e.target.checked)} /> 「많이 찾는 질문」에 올림</label>{' '}
            <label><input type="checkbox" name="faq-active" checked={edit.f.isActive} onChange={(e) => set('isActive', e.target.checked)} /> 사용자 웹에 보임</label>{' '}
            <label><input type="checkbox" name="faq-handoff" checked={edit.f.handoff} onChange={(e) => set('handoff', e.target.checked)} /> 챗봇 답 아래 「상담원 연결」</label>
          </p>
          <p>
            <input name="faq-keywords" value={edit.f.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="챗봇 낱말(쉼표로 · 10개)" style={{ width: '40%' }} />{' '}
            <input name="faq-link" value={edit.f.linkHref ?? ''} onChange={(e) => set('linkHref', e.target.value)} placeholder="「…에서 보기」 주소(/ 로 시작)" style={{ width: '25%' }} />{' '}
            <input name="faq-link-label" value={edit.f.linkLabel ?? ''} onChange={(e) => set('linkLabel', e.target.value)} maxLength={30} placeholder="단추 글자" style={{ width: '20%' }} />
          </p>
          <p>
            <button className="btn-ok" disabled={a.busy === 'save'} onClick={save} data-faq-save="">저장</button>{' '}
            <button className="btn-plain btn-sm" onClick={() => setEdit(null)}>취소</button>
          </p>
        </div>
      )}

      <table className="tbl" data-faq-rows={shown.length}>
        <thead><tr><th>순서</th><th>분야</th><th>질문</th><th>나오는 곳</th><th>상태</th><th title="최근 30일">펼침 · 도움 됨 / 안 됨</th><th>고친 때</th><th></th></tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} data-faq-row={r.id} className={r.isActive ? undefined : 'muted'}>
              <td>{r.sortOrder}</td>
              <td>{TOPIC_KO[r.topic] ?? r.topic}<br /><small className="dim">{r.category}</small></td>
              <td>{r.isTop && <b className="warn-text">TOP </b>}{r.question}</td>
              <td>{r.channels.map((c) => CH_KO[c] ?? c).join(' · ')}</td>
              <td>{r.isActive ? '보임' : '숨김'}</td>
              <td className="muted" data-faq-stat={`${r.views30 ?? 0}|${r.yes30 ?? 0}|${r.no30 ?? 0}`}>{r.views30 ?? 0} · {r.yes30 ?? 0} / {r.no30 ?? 0}</td>
              <td className="muted">{ymdhm(r.updatedAt)}{r.by ? ` · ${r.by}` : ''}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-plain btn-sm" onClick={() => setEdit({ id: r.id, f: toForm(r) })} data-faq-edit={r.id}>고치기</button>{' '}
                {r.isActive && <button className="btn-plain btn-sm" disabled={a.busy === `p-${r.id}`} data-faq-toggle-top={r.id}
                  onClick={() => patch(r, { isTop: !r.isTop }, r.isTop ? '「많이 찾는 질문」에서 내립니다.' : '「많이 찾는 질문」에 올립니다.')}>{r.isTop ? 'TOP 내리기' : 'TOP 올리기'}</button>}{' '}
                <button className="btn-plain btn-sm" disabled={a.busy === `p-${r.id}`} data-faq-toggle-active={r.id}
                  onClick={() => patch(r, { isActive: !r.isActive }, r.isActive ? '이 질문을 숨깁니다 — 사용자 웹 고객센터 · 이용안내 · 챗봇에서 빠집니다.' : '이 질문을 다시 보이게 합니다.')}>{r.isActive ? '숨기기' : '보이기'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ad-nt info">
        저장하면 사용자 웹에 바로 나갑니다(고객센터 · 이용안내 · 1:1 문의 챗봇 · AI 상담). 지우기는 없습니다 — 「숨기기」를 씁니다.
        금액 · 기한 · 법률 문구는 약관 · 화면과 같게 적습니다. 영어 번역이 있는 질문은 글을 고치면 다국어 › 번역 초안을 다시 확인하십시오.
      </div>
    </section>
  );
}

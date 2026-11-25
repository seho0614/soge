import { useState } from 'react';
import { api, tokenSub } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

/**
 * SB-ADM-MAIL-010 공용 메일함 (v10.791 · D330 · docs/906)
 *
 * 대표 11/25 「사내 웹메일 구축」 → B. AWS 직접(SES 받기) → W1. privacy@ · help@ · admin@ · dmarc@sogaebank.com 으로 온 메일을
 * 받아 읽고 · 맡기고 · 답하고 · 끝냅니다. 메일함마다 업무 권한(mailbox-*)이 있는 것만 보임 · 열면 열람 기록이 남습니다.
 * ★ 받은 HTML 은 격리 틀(iframe sandbox — 스크립트 · 양식 · 새 창 막음 · CSP 로 바깥 그림 · 글꼴 · 연결 막음)로만 보입니다.
 *   「그림 보기」를 누르면 그 메일만 바깥 그림(https)을 허락합니다(스크립트는 그대로 막힘).
 */

interface Box { id: number; address: string; label: string; fresh: number }
interface Row {
  id: string; boxId: number; fromAddr: string | null; fromName: string | null; subject: string | null; state: string;
  receivedAt: string; hasContent: boolean; spam: string | null; virus: string | null; dmarc: string | null; attachments: number; assigneeName: string | null;
}
interface ListData { boxes: Box[]; items: Row[]; total: number; page: number }
interface Att { id: string; filename: string; contentType: string; sizeBytes: number; contentId: string | null; inline: boolean }
interface One {
  id: string; boxAddress: string; boxLabel: string; fromAddr: string | null; fromName: string | null; toAddrs: string[]; ccAddrs: string[];
  subject: string | null; sentAt: string | null; receivedAt: string; textBody: string | null; htmlBody: string | null; hasContent: boolean;
  s3Key: string | null; state: string; assigneeName: string | null; attachments: Att[]; senderUnverified: boolean; virusBlocked: boolean;
  spam: string | null; virus: string | null; spf: string | null; dkim: string | null; dmarc: string | null;
  thread: Array<{ id: string; direction: string; fromAddr: string | null; subject: string | null; state: string; receivedAt: string }>;
  accessLog: Array<{ action: string; at: string; name: string | null }>;
}
interface State { switchOn: boolean; topicSet: boolean; lastAt: string | null }

const ST: Record<string, string> = { NEW: '새 메일', ASSIGNED: '맡음', DONE: '끝냄', SPAM: '스팸' };
const ACT: Record<string, string> = { VIEW: '열람', REPLY: '답장', ASSIGN: '맡기기', DONE: '끝냄', REOPEN: '다시 열기', SPAM: '스팸', DOWNLOAD: '첨부 받기' };

/** 받은 HTML 을 격리 틀용 문서로 — CSP 로 스크립트 · 바깥 연결을 막고, 그림은 허락했을 때만 https 를 엶 */
export function mailFrameDoc(html: string, allowImages: boolean): string {
  const img = allowImages ? "img-src https: data: cid:;" : "img-src data: cid:;";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; ${img} font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  const body = html.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<meta[^>]+http-equiv[^>]*>/gi, '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"></head><body>${body}</body></html>`;
}

export function Mailbox() {
  const [f, setF] = useState({ box: '', state: 'NEW', q: '', page: 1 });
  const [word, setWord] = useState('');
  const qs = new URLSearchParams({ ...(f.box ? { box: f.box } : {}), ...(f.state ? { state: f.state } : {}), ...(f.q ? { q: f.q } : {}), page: String(f.page) }).toString();
  const list = useApi<ListData>(`/admin/mailbox/messages?${qs}`);
  const st = useApi<State>('/admin/mailbox/state');
  const [open, setOpen] = useState<string | null>(null);
  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  if (!list.data) return <p className="muted">불러오는 중…</p>;
  const { boxes, items, total, page } = list.data;
  const pick = (v: Partial<typeof f>) => { setOpen(null); setF({ ...f, page: 1, ...v }); };

  return (
    <section data-mailbox="" data-mailbox-total={total}>
      {st.data && (
        <p className={st.data.switchOn && st.data.topicSet ? 'dim' : 'warn-text'} data-mailbox-state={`${st.data.switchOn ? 'on' : 'off'}|${st.data.topicSet ? 'topic' : 'notopic'}`}>
          받기 {st.data.switchOn ? '켜짐' : '꺼짐(설정 mail.inbound)'} · SNS 주제 {st.data.topicSet ? '있음' : '없음(mail.inbound_topic_arn)'}
          {st.data.lastAt ? ` · 마지막 받음 ${ymdhm(st.data.lastAt)}` : ' · 아직 받은 알림 없음'} — 받기 규칙 만들기는 docs/902 W0
        </p>
      )}
      <p data-mailbox-boxes={boxes.length}>
        <button className={`btn-sm ${!f.box ? 'btn-ok' : 'btn-plain'}`} onClick={() => pick({ box: '' })}>모든 메일함</button>{' '}
        {boxes.map((b) => (
          <span key={b.id}>
            <button className={`btn-sm ${f.box === String(b.id) ? 'btn-ok' : 'btn-plain'}`} onClick={() => pick({ box: String(b.id) })} data-mailbox-box={b.address}>
              {b.label} <small className="dim">{b.address}</small> {b.fresh > 0 && <b className="warn-text">{b.fresh}</b>}
            </button>{' '}
          </span>
        ))}
      </p>
      <p>
        {(['NEW', 'ASSIGNED', 'DONE', 'SPAM', ''] as const).map((s) => (
          <span key={s || 'ALL'}>
            <button className={`btn-sm ${f.state === s ? 'btn-ok' : 'btn-plain'}`} onClick={() => pick({ state: s })} data-mailbox-state-btn={s || 'ALL'}>{s ? ST[s] : '모두'}</button>{' '}
          </span>
        ))}
        <input name="mailbox-q" value={word} onChange={(e) => setWord(e.target.value)} placeholder="제목 · 보낸 주소"
          onKeyDown={(e) => { if (e.key === 'Enter') pick({ q: word.trim() }); }} />{' '}
        <button className="btn-plain btn-sm" onClick={() => pick({ q: word.trim() })} data-mailbox-q-go="">찾기</button>
      </p>
      <table className="tbl" data-mailbox-rows={items.length}>
        <thead><tr><th>받은 때</th><th>보낸 사람</th><th>제목</th><th>메일함</th><th>상태</th><th>맡은 사람</th></tr></thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan={6} className="muted">해당하는 메일이 없습니다.</td></tr>}
          {items.map((r) => (
            <tr key={r.id} data-mailbox-row={r.id} className={r.state === 'NEW' ? 'warn' : undefined}>
              <td className="muted">{ymdhm(r.receivedAt)}</td>
              <td>{r.fromName ? <>{r.fromName} <small className="dim">{r.fromAddr}</small></> : (r.fromAddr ?? '—')}
                {r.dmarc === 'FAIL' && <span className="badge badge-urgent"> 확인 안 됨</span>}</td>
              <td><button className="linkbtn" onClick={() => setOpen(open === r.id ? null : r.id)} data-mailbox-open={r.id}>{r.subject || '(제목 없음)'}</button>
                {r.attachments > 0 && <small className="dim"> · 첨부 {r.attachments}</small>}
                {!r.hasContent && <small className="dim"> · 원본만(S3)</small>}
                {r.virus === 'FAIL' && <span className="badge badge-urgent"> 바이러스</span>}</td>
              <td className="muted">{boxes.find((b) => b.id === r.boxId)?.label ?? r.boxId}</td>
              <td>{ST[r.state] ?? r.state}</td>
              <td className="muted">{r.assigneeName ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > 30 && (
        <p>
          <button className="btn-plain btn-sm" disabled={page <= 1} onClick={() => setF({ ...f, page: page - 1 })}>이전</button>{' '}
          <span className="muted">{page} / {Math.ceil(total / 30)}</span>{' '}
          <button className="btn-plain btn-sm" disabled={page * 30 >= total} onClick={() => setF({ ...f, page: page + 1 })}>다음</button>
        </p>
      )}
      {open && <MailOne key={open} id={open} onChanged={list.reload} />}
    </section>
  );
}

function MailOne({ id, onChanged }: { id: string; onChanged: () => void }) {
  const q = useApi<One>(`/admin/mailbox/messages/${id}`);
  const a = useAct();
  const [text, setText] = useState('');
  const [imgs, setImgs] = useState(false);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  const after = () => { setText(''); q.reload(); onChanged(); };
  const state = (s: string, ask?: string) => {
    if (ask && !confirm(ask)) return;
    void a.run('state', () => api(`/admin/mailbox/messages/${id}/state`, { method: 'POST', body: JSON.stringify({ state: s }) }), after);
  };
  const reply = (done: boolean) => {
    if (!confirm(`${d.fromAddr} 에게 ${d.boxAddress} 이름으로 답장을 보냅니다${done ? '(보내고 끝냄)' : ''}.`)) return;
    void a.run('reply', () => api(`/admin/mailbox/messages/${id}/reply`, { method: 'POST', body: JSON.stringify({ body: text, done }) }), after, '답장을 보냈습니다.');
  };
  const take = (mine: boolean) => {
    const me = tokenSub();
    void a.run('assign', () => api(`/admin/mailbox/messages/${id}/assign`, { method: 'POST', body: JSON.stringify({ assignee: mine && me ? me : null }) }), after);
  };
  const download = (att: Att) => void a.run('dl', async () => {
    const r = await api<{ filename: string; contentType: string; dataBase64: string }>(`/admin/mailbox/attachments/${att.id}`);
    const bin = atob(r.dataBase64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u8], { type: 'application/octet-stream' }));
    const el = document.createElement('a'); el.href = url; el.download = r.filename; el.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { ok: true, note: `${r.filename} 를 받았습니다.` };
  });

  return (
    <div className="card" data-mailbox-one={id} style={{ marginTop: 10 }}>
      <Flash msg={a.msg} err={a.err} />
      <h3 style={{ margin: '0 0 4px' }}>{d.subject || '(제목 없음)'}</h3>
      <p className="dim" style={{ margin: 0 }}>
        보낸 사람 {d.fromName ? `${d.fromName} ` : ''}&lt;{d.fromAddr ?? '—'}&gt; · 받는 곳 {d.boxLabel}({d.boxAddress})
        {d.ccAddrs.length > 0 && <> · 참조 {d.ccAddrs.join(', ')}</>} · {ymdhm(d.sentAt ?? d.receivedAt)} · {ST[d.state] ?? d.state}{d.assigneeName ? ` · 맡은 사람 ${d.assigneeName}` : ''}
      </p>
      {d.senderUnverified && <p className="warn-text" data-mailbox-unverified="">⚠ 보낸 사람 확인 안 됨(SPF {d.spf ?? '—'} · DKIM {d.dkim ?? '—'} · DMARC {d.dmarc ?? '—'}) — 링크 · 첨부 · 계좌 안내를 믿기 전에 확인하십시오.</p>}
      {d.virusBlocked && <p className="warn-text" data-mailbox-virus="">⚠ 바이러스 판정 — 첨부를 내려받을 수 없습니다.</p>}
      {d.spam === 'FAIL' && <p className="warn-text">스팸 판정이 나온 메일입니다.</p>}
      {!d.hasContent && (
        <p className="muted" data-mailbox-s3only="">본문을 아직 풀지 않았습니다(15MB 넘음 · S3 읽기 설정 전 · 가져오기 실패) — S3 원본: <span className="mono">{d.s3Key ?? '—'}</span>{' '}
          {d.s3Key && <button className="btn-plain btn-sm" onClick={() => void a.run('fetch', () => api(`/admin/mailbox/messages/${id}/fetch`, { method: 'POST' }), after)} data-mailbox-fetch="">S3 에서 가져오기</button>}
        </p>
      )}
      {d.htmlBody ? (
        <>
          <p style={{ margin: '6px 0' }}>
            <button className="btn-plain btn-sm" onClick={() => setImgs(!imgs)} data-mailbox-images={imgs ? 'on' : 'off'}>{imgs ? '바깥 그림 다시 막기' : '그림 보기(바깥 그림 허락)'}</button>
          </p>
          <iframe title="메일 본문" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={mailFrameDoc(d.htmlBody, imgs)}
            style={{ width: '100%', minHeight: 360, border: '1px solid var(--line, #ddd)', background: '#fff' }} data-mailbox-frame="" referrerPolicy="no-referrer" />
        </>
      ) : d.textBody != null ? <pre style={{ whiteSpace: 'pre-wrap' }} data-mailbox-text="">{d.textBody}</pre> : null}
      {d.attachments.length > 0 && (
        <p data-mailbox-atts={d.attachments.length}>첨부:{' '}
          {d.attachments.map((t) => (
            <button key={t.id} className="btn-plain btn-sm" disabled={d.virusBlocked} onClick={() => download(t)} data-mailbox-att={t.id}>
              {t.filename} <small className="dim">{Math.ceil(t.sizeBytes / 1024)}KB</small>
            </button>
          ))}
        </p>
      )}
      <p>
        <button className="btn-plain btn-sm" onClick={() => take(true)} data-mailbox-take="">내가 맡기</button>{' '}
        <button className="btn-plain btn-sm" onClick={() => take(false)}>맡기 풀기</button>{' '}
        {d.state !== 'DONE' && <button className="btn-ok btn-sm" onClick={() => state('DONE')} data-mailbox-done="">끝냄</button>}{' '}
        {(d.state === 'DONE' || d.state === 'SPAM') && <button className="btn-plain btn-sm" onClick={() => state('NEW')} data-mailbox-reopen="">다시 열기</button>}{' '}
        {d.state !== 'SPAM' && <button className="btn-plain btn-sm" onClick={() => state('SPAM', '스팸으로 옮깁니다.')} data-mailbox-spam="">스팸</button>}
      </p>
      <textarea name="mailbox-reply" rows={6} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} placeholder={`답장 — ${d.boxAddress} 이름으로 보냅니다(글자만)`} />
      <p>
        <button className="btn-ok btn-sm" disabled={text.trim().length < 2 || !!a.busy} onClick={() => reply(false)} data-mailbox-reply="">답장 보내기</button>{' '}
        <button className="btn-plain btn-sm" disabled={text.trim().length < 2 || !!a.busy} onClick={() => reply(true)}>보내고 끝냄</button>
      </p>
      {d.thread.length > 0 && (
        <details><summary>같은 대화 {d.thread.length}통</summary>
          <ul>{d.thread.map((t) => <li key={t.id}>{t.direction === 'OUT' ? '보냄' : '받음'} · {ymdhm(t.receivedAt)} · {t.subject ?? '—'}</li>)}</ul>
        </details>
      )}
      <details data-mailbox-log={d.accessLog.length}><summary>열람 · 처리 기록 {d.accessLog.length}</summary>
        <ul>{d.accessLog.map((l, i) => <li key={i}>{ymdhm(l.at)} · {l.name ?? '—'} · {ACT[l.action] ?? l.action}</li>)}</ul>
      </details>
    </div>
  );
}

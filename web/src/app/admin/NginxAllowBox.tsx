import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

interface Data {
  ips: Array<{ ip: string; memo: string }>; count: number; hash: string; file: string; lastChangedAt: string | null;
  applied: { hash: string | null; at: string | null; by: string | null } | null; appliedSame: boolean;
  myIpIn: boolean; myIp: string | null; invalid: string[]; script: string;
  watcher: { installed: boolean; last: { id: string; hash: string; ok: boolean; at: string; message: string } | null; pending: { id: string; at: string } | null };
}

/**
 * 「Nginx 반영」 상자 (v10.348 · docs/482) — 권한 계층 › 접속 인증(SB-ADM-SIP-010) · SUPER 만
 *
 * 대표 11/18 「화면은 목록만 보여주고, 반영 스크립트를 보여준다 · 수퍼 가능」. 허용 IP 목록(위 표와 같은 목록)으로 반영 스크립트를 만들어 보여 줍니다.
 * 이 화면은 서버를 바꾸지 않습니다 — 사람이 운영 서버 ubuntu 창에 붙여 넣고, 끝나면 「반영했음」을 누릅니다(감사 기록에 목록 지문).
 * 대표 11/18 다시 「적용 버튼으로 엔진엑스 구동하여 적용」 → 「적용」 단추: 요청만 보내고 운영 서버 루트 감시 서비스가 적용(1분 안) · 결과를 이 상자에.
 *   감시 서비스 설치 전에는 단추가 닫히고 스크립트 복사(비상용)로 반영합니다.
 */
export function NginxAllowBox() {
  const q = useApi<Data>('/admin/staff-access/nginx-script');
  const a = useAct();
  const [copied, setCopied] = useState(false);
  const [reason, setReason] = useState('');
  const [wait, setWait] = useState<{ id: string; until: number } | null>(null);
  /* 「적용」 뒤 결과가 올 때까지 3초마다 다시 읽음(최대 90초) */
  const done = !!wait && q.data?.watcher.last?.id === wait.id;
  useEffect(() => {
    if (!wait || done || Date.now() > wait.until) return undefined;
    const t = setTimeout(() => q.reload(), 3000);
    return () => clearTimeout(t);
  });
  if (q.error || !q.data) return null;
  const d = q.data;
  const copy = () => {
    void navigator.clipboard?.writeText(d.script).then(() => setCopied(true)).catch(() => setCopied(false));
  };
  const applied = () => {
    if (!confirm(`운영 서버에서 반영 스크립트(목록 ${d.hash} · ${d.count}곳)를 돌렸고 「반영함」이 나왔습니까?`)) return;
    void a.run('applied', () => api('/admin/staff-access/nginx-applied', { method: 'POST', body: JSON.stringify({ hash: d.hash }) }), q.reload);
  };
  const w = d.watcher;
  const apply = () => {
    const c = prompt(`허용 IP ${d.count}곳(목록 ${d.hash})을 Nginx 에 적용합니다. 확인 문구 「적용」을 넣으십시오.`);
    if (c === null) return;
    void a.run('apply', () => api<{ id: string }>('/admin/staff-access/nginx-apply', { method: 'POST', body: JSON.stringify({ confirm: c, reason }) }))
      .then((r) => { if (r?.id) { setWait({ id: r.id, until: Date.now() + 90_000 }); setReason(''); q.reload(); } });
  };
  return (
    <div className="card" data-nginx-allow={`${d.count}|${d.appliedSame ? 'same' : 'diff'}`}>
      <h3 className="sec">Nginx 반영 <small className="dim">— 위 허용 IP 가 운영 화면에 들어올 수 있는 곳(Nginx allow)이 됩니다 · SUPER</small></h3>
      <Flash msg={a.msg} err={a.err} />
      <p>
        목록 <b>{d.count}</b>곳 · 지문 <code data-nginx-hash={d.hash}>{d.hash}</code>
        {d.lastChangedAt && <> · 마지막으로 고친 때 {ymdhm(d.lastChangedAt)}</>} ·{' '}
        {d.applied
          ? <>마지막 「반영했음」 {d.applied.at ? ymdhm(d.applied.at) : ''}{d.applied.by ? ` · ${d.applied.by}` : ''} · 그때 지문 <code>{d.applied.hash}</code></>
          : <>아직 「반영했음」 기록 없음</>}
      </p>
      {d.appliedSame
        ? <div className="ad-nt info" data-nginx-state="same"><b>반영한 목록과 같습니다.</b> 목록을 고치면 다시 반영해야 합니다.</div>
        : <div className="ad-nt warn" data-nginx-state="diff"><b>아직 Nginx 에 반영하지 않은 목록입니다.</b> 아래 스크립트를 운영 서버에서 돌린 뒤 「반영했음」을 누르십시오.</div>}
      {!d.myIpIn && <div className="ad-nt warn" data-nginx-myip=""><b>지금 접속한 주소({d.myIp ?? '모름'})가 목록에 없습니다.</b> 이대로 반영하면 지금 자리에서 운영 화면이 막힙니다. 위 「지금 주소 넣기」로 먼저 더하십시오.</div>}
      {w.installed ? (
        <div data-nginx-watch="on">
          <p>
            <input name="nginx-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(예: 사무실 IP 바뀜)" maxLength={200} style={{ width: 280 }} />{' '}
            <button className="btn-ok" disabled={a.busy === 'apply' || !d.script || !d.myIpIn || reason.trim().length < 2 || (!!wait && !done && Date.now() < wait.until)} onClick={apply} data-nginx-apply="">적용</button>
            <small className="dim"> 운영 서버 감시 서비스가 1분 안에 적용(nginx -t 실패면 스스로 되돌림)</small>
          </p>
          {wait && !done && Date.now() < wait.until && <p className="dim" data-nginx-waiting="">적용 중… (요청 {wait.id})</p>}
          {w.last && (
            <div className={`ad-nt ${w.last.ok ? 'info' : 'warn'}`} data-nginx-last={w.last.ok ? 'ok' : 'fail'}>
              <b>마지막 적용 {w.last.ok ? '성공' : '실패'}</b> — {w.last.message} · {ymdhm(w.last.at)} · 목록 <code>{w.last.hash}</code>
            </div>
          )}
        </div>
      ) : (
        <div className="ad-nt info" data-nginx-watch="off">
          <b>「적용」 단추는 운영 서버에 감시 서비스를 설치한 뒤 열립니다</b>(처음 한 번 · <code>bash ~/sgb/deploy/aws/nginx-allow-watch-install.sh --apply</code> · 운영 절차서). 그 전에는 아래 스크립트를 복사해 반영합니다.
        </div>
      )}
      {d.invalid.length > 0 && <div className="ad-nt warn">Nginx 가 읽지 못할 모양이라 스크립트에서 뺀 것: {d.invalid.join(' · ')}</div>}
      {!d.script ? <p className="warn-text" data-nginx-empty="">허용 IP 가 없어 스크립트를 만들지 않습니다(비면 운영 화면에 아무도 못 들어옴).</p> : (
        <>
          <ol className="dim">
            <li>처음 한 번만: 운영 서버에서 <code>bash ~/sgb/deploy/aws/nginx-admin-allow-setup.sh admin.sogaebank.com</code>(미리 보기) → <code>--apply</code> — 운영 절차서대로.</li>
            <li>(「적용」 단추를 못 쓸 때) 아래 스크립트를 「복사」해 운영 서버 ubuntu 창에 붙여 넣습니다. 바뀌는 줄 → <code>nginx -t</code> → 「반영함」을 확인합니다(실패하면 스스로 되돌림).</li>
            <li>「반영했음」을 누릅니다.</li>
          </ol>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', fontSize: 12 }} data-nginx-script="">{d.script}</pre>
          <p>
            <button className="btn-sm" onClick={copy} data-nginx-copy="">{copied ? '복사했습니다' : '복사'}</button>{' '}
            <button className="btn-ok btn-sm" disabled={a.busy === 'applied' || d.appliedSame} onClick={applied} data-nginx-applied="">반영했음</button>
            <small className="dim"> 바꾸는 파일 <code>{d.file}</code> 하나</small>
          </p>
        </>
      )}
    </div>
  );
}

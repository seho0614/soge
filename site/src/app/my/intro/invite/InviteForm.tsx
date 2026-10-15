'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Channel { channel: string; ready: boolean; note: string }
export interface ReqOpt { id: string; title: string }

const NAME: Record<string, string> = {
  SELF: '직접 전달', SMS: '문자로 대신 보내기',
  ALIMTALK: '카카오 알림톡', EMAIL: '이메일',
};

/**
 * 기본값이 SELF 인 이유를 화면이 말합니다.
 *
 * 대행 발송을 고르면 연락처를 받아야 하는데, 그 지인은 동의한 적이
 * 없습니다. 그래서 발송 직후 지우고, 그 사실을 미리 알립니다.
 *
 * v10.29 — 시안(scIntroInvite) 배치: 요청 한 줄 → 「누구를 소개하시겠습니까」(상대방 표기명) → 「어떻게 전달하시겠습니까」(채널 카드)
 *   → 직접 전달 안내 · 링크 복사 → 동의 안내 → 초대 보내기. 보내는 API(POST /me/introducer/invite)와 입력 이름은 그대로입니다.
 *   소개할 요청은 전에는 번호를 직접 쳐야 했습니다 — 「제가 알아요」에서 넘어온 요청(?request=)을 채워 두고, 맞춤 요청 목록에서 고를 수도 있습니다.
 */
export function InviteForm({ channels, requests = [], initialRequest = '' }: { channels: Channel[]; requests?: ReqOpt[]; initialRequest?: string }) {
  const [label, setLabel] = useState('');
  const [channel, setChannel] = useState('SELF');
  const [requestId, setRequestId] = useState(initialRequest);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  /* v10.29 — 서버 채널 목록(v_notify_channels)에 SELF 가 없어 기본값인 「직접 전달」 칸이 화면에 없었습니다. 늘 맨 앞에 둡니다(시안 순서). */
  const SELF = { channel: 'SELF', ready: true, note: '링크를 복사해 카카오톡·문자로 보냅니다. 연락처를 입력하지 않습니다.' };
  const list = [SELF, ...channels.filter((c) => c.channel !== 'SELF')];
  const known = requests.find((r) => r.id === requestId);
  /* v10.31 (결함 — 「소개할 요청」 칸은 요청 번호(UUID)를 받습니다) — 형식이 틀리면 보내기 전에 화면이 알립니다.
   * 전에는 숫자 번호를 넣으면 그대로 보내져 서버의 「형식이 올바르지 않습니다 (uuid).」가 보였습니다. */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const idOk = UUID.test(requestId.trim());

  async function send() {
    setErr(null); setLink(null); setCopied(false);
    if (!idOk) { setErr('소개할 요청을 「맞춤 요청에서 고르기」로 골라 주십시오. 요청 번호는 요청 화면 주소의 긴 번호(예: 1a2b3c4d-…)입니다.'); return; }
    const res = await fetch('/api/v1/me/introducer/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: requestId.trim(), inviteeLabel: label, channel }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(b.message ?? '보내지 못했습니다.'); return; }
    setLink(b.link ?? null);
    start(() => router.refresh());
  }

  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <section data-invite-form="">
      <div className="my-subnow one">
        <div>
          <span className="my-ls">요청</span>
          {known ? <b className="big">{known.title}</b> : <b className="big">{requestId ? '선택한 요청' : '소개할 요청을 고르십시오'}</b>}
          <label className="my-fld" style={{ margin: '8px 0 0' }}>
            <span className="my-ls">소개할 요청</span>
            {requests.length > 0 && (
              <select className="my-inp" value={known ? requestId : ''} onChange={(e) => setRequestId(e.target.value)} aria-label="맞춤 요청에서 고르기">
                <option value="">맞춤 요청에서 고르기</option>
                {requests.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            )}
            <input className="my-inp" style={{ marginTop: 6 }} value={requestId} onChange={(e) => setRequestId(e.target.value)} placeholder="요청 번호 (예: 1a2b3c4d-…)"
              aria-invalid={!!requestId && !idOk} data-invite-reqid="" />
            {requestId && !idOk && <span className="my-ls warnx" role="alert">요청 번호 형식이 아닙니다 — 맞춤 요청에서 골라 주십시오.</span>}
          </label>
        </div>
      </div>

      <h2 className="my-s2">누구를 소개하시겠습니까</h2>
      <label className="my-fld">
        <span>상대방 표기명</span>
        <input className="my-inp" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 한빛이사 김대표" />
      </label>
      <p className="my-ls">이 이름만 저장됩니다. 회사명·연락처는 상대방이 동의할 때 직접 입력합니다.</p>

      <h2 className="my-s2">어떻게 전달하시겠습니까</h2>
      <div className="my-chan">
        {list.filter((c) => c.channel !== 'INAPP').map((c) => (
          <button
            key={c.channel}
            type="button"
            className={`my-chn${channel === c.channel ? ' on' : ''}${c.ready ? '' : ' off'}`}
            disabled={!c.ready}
            onClick={() => setChannel(c.channel)}
            aria-pressed={channel === c.channel}
            data-chn={c.channel}
          >
            <b>{NAME[c.channel] ?? c.channel}</b>
            <span className="my-ls">{c.note}</span>
            {!c.ready && <span><span className="my-bg wait">준비 중</span></span>}
          </button>
        ))}
      </div>

      {channel === 'SELF' ? (
        <div className="my-nt ok">
          <b>연락처를 입력하지 않습니다.</b> 초대를 보내면 링크가 만들어집니다 — 복사해 카카오톡·문자로 직접 보내시면 됩니다.
          소개뱅크는 상대방의 번호를 알지 못합니다.
        </div>
      ) : (
        <div className="my-nt warn">
          <b>대신 보내려면 연락처가 필요합니다.</b> 발송 직후 지우며 다시 쓰지 않습니다 —
          재발송하시려면 한 번 더 입력하셔야 합니다.
        </div>
      )}

      {link && (
        <div className="my-cpy" data-invite-link="">
          <code>{link}</code>
          <button type="button" className="my-bp" onClick={() => void copy()}>{copied ? '복사됨' : '링크 복사'}</button>
        </div>
      )}

      <div className="my-nt info">
        <b>동의하지 않으면 아무 일도 일어나지 않습니다.</b> 링크는 14일 뒤 만료되고, 거절해도 상대방에게 불이익이 없습니다.
      </div>

      <div className="my-btns">
        <button type="button" className="my-bp" onClick={() => void send()} disabled={pending || !label || !requestId} data-invite-send="">
          {pending ? '보내는 중…' : '초대 보내기'}
        </button>
      </div>

      {err && <div className="my-nt warn" role="alert">{err}</div>}
    </section>
  );
}

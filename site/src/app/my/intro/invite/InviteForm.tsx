'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';

interface Channel { channel: string; ready: boolean; note: string }
export interface ReqOpt { id: string; title: string }

/* v10.99 — 전달 방식 이름은 사전(myDeal.inviteForm.name.*) */
const NAMES = ['SELF', 'SMS', 'ALIMTALK', 'EMAIL'] as const;
const isName = (s: string): s is (typeof NAMES)[number] => (NAMES as readonly string[]).includes(s);

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
  const t = useTranslations('myDeal');
  const fm = useFmt();   // v10.123 — 채널 안내(DB 뷰 v_notify_channels 의 고정 글)는 다른 언어에서 사전
  const b_ = (c: React.ReactNode) => <b>{c}</b>;

  /* v10.29 — 서버 채널 목록(v_notify_channels)에 SELF 가 없어 기본값인 「직접 전달」 칸이 화면에 없었습니다. 늘 맨 앞에 둡니다(시안 순서). */
  const SELF = { channel: 'SELF', ready: true, note: t('inviteForm.selfNote') };
  const list = [SELF, ...channels.filter((c) => c.channel !== 'SELF')];
  const known = requests.find((r) => r.id === requestId);
  /* v10.31 (결함 — 「소개할 요청」 칸은 요청 번호(UUID)를 받습니다) — 형식이 틀리면 보내기 전에 화면이 알립니다.
   * 전에는 숫자 번호를 넣으면 그대로 보내져 서버의 「형식이 올바르지 않습니다 (uuid).」가 보였습니다. */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const idOk = UUID.test(requestId.trim());

  async function send() {
    setErr(null); setLink(null); setCopied(false);
    if (!idOk) { setErr(t('inviteForm.badId')); return; }
    const res = await fetch('/api/v1/me/introducer/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: requestId.trim(), inviteeLabel: label, channel }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(b.message ?? t('inviteForm.sendFail')); return; }
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
          <span className="my-ls">{t('invite.colReq')}</span>
          {known ? <b className="big">{known.title}</b> : <b className="big">{requestId ? t('inviteForm.picked') : t('inviteForm.pickReq')}</b>}
          <label className="my-fld" style={{ margin: '8px 0 0' }}>
            <span className="my-ls">{t('inviteForm.reqLabel')}</span>
            {requests.length > 0 && (
              <select className="my-inp" value={known ? requestId : ''} onChange={(e) => setRequestId(e.target.value)} aria-label={t('inviteForm.fromMatched')}>
                <option value="">{t('inviteForm.fromMatched')}</option>
                {requests.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            )}
            <input className="my-inp" style={{ marginTop: 6 }} value={requestId} onChange={(e) => setRequestId(e.target.value)} placeholder={t('inviteForm.idPh')}
              aria-invalid={!!requestId && !idOk} data-invite-reqid="" />
            {requestId && !idOk && <span className="my-ls warnx" role="alert">{t('inviteForm.idWarn')}</span>}
          </label>
        </div>
      </div>

      <h2 className="my-s2">{t('inviteForm.whoH')}</h2>
      <label className="my-fld">
        <span>{t('inviteForm.label')}</span>
        <input className="my-inp" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('inviteForm.labelPh')} />
      </label>
      <p className="my-ls">{t('inviteForm.labelNote')}</p>

      <h2 className="my-s2">{t('inviteForm.howH')}</h2>
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
            <b>{isName(c.channel) ? t(`inviteForm.name.${c.channel}`) : c.channel}</b>
            <span className="my-ls">{t.has(`inviteForm.chNote.${c.channel}` as never) ? fm.srv(c.note, t(`inviteForm.chNote.${c.channel}` as never)) : c.note}</span>
            {!c.ready && <span><span className="my-bg wait">{t('inviteForm.soon')}</span></span>}
          </button>
        ))}
      </div>

      {channel === 'SELF' ? (
        <div className="my-nt ok">
          {t.rich('inviteForm.selfBox', { b: b_ })}
        </div>
      ) : (
        <div className="my-nt warn">
          {t.rich('inviteForm.proxyBox', { b: b_ })}
        </div>
      )}

      {link && (
        <div className="my-cpy" data-invite-link="">
          <code>{link}</code>
          <button type="button" className="my-bp" onClick={() => void copy()}>{copied ? t('inviteForm.copied') : t('inviteForm.copy')}</button>
        </div>
      )}

      <div className="my-nt info">
        {t.rich('inviteForm.consentBox', { b: b_ })}
      </div>

      <div className="my-btns">
        <button type="button" className="my-bp" onClick={() => void send()} disabled={pending || !label || !requestId} data-invite-send="">
          {pending ? t('payout.sending') : t('intro.sendInvite')}
        </button>
      </div>

      {err && <div className="my-nt warn" role="alert">{err}</div>}
    </section>
  );
}

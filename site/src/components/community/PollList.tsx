'use client';
/**
 * SB-HOM-CMU-040 소개광장 「이건 어때?」 — 투표 목록 (D021).
 * 열린 투표와 마감된 투표를 한 장씩 보여 줍니다. 로그인 없이 투표합니다(회원 1인 1표 · 비로그인은 기기 1표).
 * 비율은 투표한 뒤(또는 마감 뒤)에만 보입니다. 숫자는 전부 서버의 실제 표 수입니다.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ymdKst } from '@/lib/format';
import { type Poll, POLL_KIND, pct, usePoll } from './poll';

function Card({ p }: { p: Poll }) {
  const t = useTranslations('plaza');
  const h = usePoll(p, {
    pick: t('poll.msg.pick'), ok: t('poll.msg.ok'), already: t('poll.msg.already'),
    login: t('poll.msg.login'), fail: t('poll.msg.fail'), offline: t('poll.msg.offline'),
  });
  const kk = POLL_KIND[h.poll.kind];
  const k = kk ? { label: t(kk.label), cta: t(kk.cta) } : { label: h.poll.kind, cta: t('poll.vote') };
  return (
    <article className={`poll-card${h.poll.open ? '' : ' closed'}`} data-poll={h.poll.id} data-kind={h.poll.kind} data-voted={h.voted ? '1' : '0'}>
      <div className="poll-top">
        <span className="poll-kind">{k.label}</span>
        <span className="poll-state">{h.poll.open ? (h.poll.endsAt ? t('poll.endsAt', { date: ymdKst(h.poll.endsAt) }) : t('poll.ongoing')) : t('poll.ended')}</span>
      </div>
      <h2>{h.poll.title}</h2>
      {h.poll.description && <p className="poll-desc">{h.poll.description}</p>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {h.poll.image && <img className="poll-img" src={h.poll.image} alt="" loading="lazy" />}
      <ul className="poll-opts" role="radiogroup" aria-label={h.poll.title}>
        {h.poll.options.map((o) => {
          const on = h.canVote ? h.sel === o.id : h.poll.myOptionId === o.id;
          const v = pct(o.votes, h.poll.total);
          return (
            <li key={o.id} className={`${h.result ? 'res' : ''}${on ? ' on' : ''}`} style={h.result ? { ['--p' as string]: `${v}%` } : undefined}>
              <button type="button" className="poll-opt" role="radio" aria-checked={on} disabled={!h.canVote} onClick={() => h.pick(o.id)} data-opt={o.id}>
                <i aria-hidden="true" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {o.image && <img src={o.image} alt="" loading="lazy" />}
                <span className="poll-ol"><span>{o.label}</span>{o.sub && <small>{o.sub}</small>}</span>
                {h.result && <em>{t('poll.result', { p: String(v), n: o.votes.toLocaleString('ko-KR') })}</em>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="poll-foot">
        {h.canVote
          ? <button type="button" className="btn-primary" onClick={h.vote} disabled={h.busy} data-vote>{h.busy ? t('poll.sending') : k.cta}</button>
          : <span className="poll-done" data-done>{h.voted ? t('poll.voted') : t('poll.closed')}</span>}
        <span className="poll-total" data-total={h.poll.total}>{t('poll.people', { n: h.poll.total.toLocaleString('ko-KR') })}</span>
      </div>
      {h.msg && (
        <p className={`poll-msg ${h.msg.kind}`} role={h.msg.kind === 'ok' ? 'status' : 'alert'}>
          {h.msg.text}{h.msg.kind === 'login' && <> <Link href="/login">{t('poll.login')}</Link></>}
        </p>
      )}
    </article>
  );
}

export function PollList({ polls }: { polls: Poll[] }) {
  return <div className="poll-grid">{polls.map((p) => <Card key={p.id} p={p} />)}</div>;
}

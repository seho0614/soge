'use client';
/**
 * SB-HOM-MAIN-010 · 011 — 메인 「이건 어때?」 세 장 (v10.14 · D021). 그림의 모양 그대로, **실제로 투표됩니다.**
 *
 * 사장님 결정(2026-10-02): 비로그인도 투표 가능 · 참여 수는 실제 표 수(그림의 3,482명 등은 쓰지 않음).
 *
 * 무엇을 보여 주나
 *   서버의 「메인에 낼 투표」(GET /community/polls?scope=home — 종류마다 1건)를 그 종류의 카드에 넣습니다.
 *   그 종류의 투표가 없으면 그림의 문구로 카드 모양만 두고 「준비 중」으로 표시합니다(누르면 투표 목록으로).
 * 어떻게 투표하나
 *   보기를 고르고 「투표하기」 → POST /community/polls/{id}/vote (사용자 웹이 방문자 쿠키 · 로그인 토큰을 붙여 넘깁니다).
 *   투표한 뒤(또는 마감 뒤)에만 비율을 보여 줍니다.
 * 그림은 투표에 등록된 것을 쓰고, 없으면 주신 그림에서 잘라 낸 것(/home/d)을 씁니다.
 * 「준비 중」 카드의 문구는 2026-10-03 에 확정한 질문입니다(v10.15 — 시드 scripts/seed-polls.sql 과 같은 문구. 전에는 그림의 예시 문구).
 */
import Link from 'next/link';
import { Line } from './Icons';
import { type Poll, type PollOption, people, pct, usePoll } from '../community/poll';

const ALL = '/community/polls';

/* eslint-disable-next-line @next/next/no-img-element */
const Img = ({ src }: { src: string }) => <img src={src} alt="" loading="lazy" decoding="async" />;

function Foot({ h, cta }: { h: ReturnType<typeof usePoll>; cta: string }) {
  const { poll, canVote, voted, busy, vote, msg } = h;
  return (
    <>
      <div className="home-plf">
        {canVote
          ? <button type="button" className="home-vbtn" onClick={vote} disabled={busy} data-vote>{busy ? '보내는 중…' : cta} <Line name="arrow" size={16} w={2.4} /></button>
          : <span className="home-vdone" data-done>{voted ? '투표했습니다' : '마감된 투표'}</span>}
        <span data-total={poll.total}>{people(poll.total)}</span>
      </div>
      {msg && (
        <p className={`home-plmsg ${msg.kind}`} role={msg.kind === 'ok' ? 'status' : 'alert'}>
          {msg.text}{msg.kind === 'login' && <> <Link href="/login">로그인</Link></>}
        </p>
      )}
    </>
  );
}

/** 보기 한 줄(궁금해요 · 써본 의견) — 고르기 전에는 동그라미, 결과에서는 비율 막대 */
function Row({ o, h }: { o: PollOption; h: ReturnType<typeof usePoll> }) {
  const { poll, sel, pick, canVote, result } = h;
  const p = pct(o.votes, poll.total);
  const on = canVote ? sel === o.id : poll.myOptionId === o.id;
  return (
    <li className={`${result ? 'res' : ''}${on ? ' on' : ''}`} style={result ? { ['--p' as string]: `${p}%` } : undefined}>
      <button type="button" className="home-opt" role="radio" aria-checked={on} disabled={!canVote} onClick={() => pick(o.id)} data-opt={o.id}>
        <i aria-hidden="true" /><span>{o.label}</span>{result && <em>{p}%</em>}
      </button>
    </li>
  );
}

function Vs({ p }: { p: Poll }) {
  const h = usePoll(p);
  const [a, b] = h.poll.options;
  const tile = (o: PollOption | undefined, fallback: string) => {
    if (!o) return null;
    const on = h.canVote ? h.sel === o.id : h.poll.myOptionId === o.id;
    return (
      <button type="button" className={`home-vsi${on ? ' on' : ''}`} aria-pressed={on} disabled={!h.canVote} onClick={() => h.pick(o.id)} data-opt={o.id}>
        <Img src={o.image ?? fallback} /><b>{o.label}</b>
        <span>{h.result ? `${pct(o.votes, h.poll.total)}% · ${o.votes.toLocaleString('ko-KR')}표` : (o.sub ?? ' ')}</span>
      </button>
    );
  };
  return (
    <article className="home-pl" data-poll={h.poll.id} data-kind="VS" data-voted={h.voted ? '1' : '0'}>
      <span className="home-bdg blue">비교해요</span>
      <h3>{h.poll.title}</h3>
      <div className="home-vs" role="group" aria-label={h.poll.title}>
        {tile(a, '/home/d/vs-a.png')}<i aria-hidden="true">VS</i>{tile(b, '/home/d/vs-b.png')}
      </div>
      <Foot h={h} cta="투표하기" />
    </article>
  );
}

function Ask({ p }: { p: Poll }) {
  const h = usePoll(p);
  return (
    <article className="home-pl" data-poll={h.poll.id} data-kind="ASK" data-voted={h.voted ? '1' : '0'}>
      <span className="home-bdg lilac">궁금해요</span>
      <h3>{h.poll.title}</h3>
      <div className="home-ask">
        <ul role="radiogroup" aria-label={h.poll.title}>{h.poll.options.map((o) => <Row key={o.id} o={o} h={h} />)}</ul>
        <span className="home-aska" aria-hidden="true"><Img src={h.poll.image ?? '/home/d/poll-bags.png'} /></span>
      </div>
      <Foot h={h} cta="투표하기" />
    </article>
  );
}

function Used({ p }: { p: Poll }) {
  const h = usePoll(p);
  return (
    <article className="home-pl" data-poll={h.poll.id} data-kind="USED" data-voted={h.voted ? '1' : '0'}>
      <span className="home-bdg mint">써본 의견이 필요해요</span>
      <h3>{h.poll.title}</h3>
      <div className="home-op">
        <span className="home-opa" aria-hidden="true"><Img src={h.poll.image ?? '/home/d/poll-purifier.png'} /></span>
        <div>
          {h.poll.description && <p className="home-opd">{h.poll.description}</p>}
          <ul role="radiogroup" aria-label={h.poll.title}>{h.poll.options.map((o) => <Row key={o.id} o={o} h={h} />)}</ul>
        </div>
      </div>
      <Foot h={h} cta="의견 남기기" />
    </article>
  );
}

/* 그 종류의 투표가 아직 없을 때 — 그림의 문구로 모양만 둡니다. 숫자는 넣지 않습니다 */
const Soon = ({ wait }: { wait: string }) => (
  <div className="home-plf">
    <Link className="home-vbtn" href={ALL}>투표 보러 가기 <Line name="arrow" size={16} w={2.4} /></Link><span>{wait}</span>
  </div>
);
const SoonRows = ({ rows }: { rows: string[] }) => <ul>{rows.map((o) => <li key={o}><span className="home-opt"><i aria-hidden="true" /><span>{o}</span></span></li>)}</ul>;

export function PollCards({ polls }: { polls: Poll[] }) {
  const of = (k: string) => polls.find((p) => p.kind === k);
  const vs = of('VS'), ask = of('ASK'), used = of('USED');
  return (
    <div className="home-polls">
      {vs ? <Vs p={vs} /> : (
        <article className="home-pl" data-kind="VS" data-soon="1">
          <span className="home-bdg blue">비교해요</span><span className="home-exs">준비 중</span>
          <h3>로봇청소기를 산다면, 어느 쪽을 고르시겠어요?</h3>
          <div className="home-vs">
            <span className="home-vsi"><Img src="/home/d/vs-a.png" /><b>흡입력 우선</b><span>값이 더 나가도 잘 빨아들이는 쪽</span></span>
            <i aria-hidden="true">VS</i>
            <span className="home-vsi"><Img src="/home/d/vs-b.png" /><b>가성비 우선</b><span>기본 기능에 값이 싼 쪽</span></span>
          </div>
          <Soon wait="투표는 곧 열립니다" />
        </article>
      )}
      {ask ? <Ask p={ask} /> : (
        <article className="home-pl" data-kind="ASK" data-soon="1">
          <span className="home-bdg lilac">궁금해요</span><span className="home-exs">준비 중</span>
          <h3>소개받아 살 때 가장 먼저 보는 것은?</h3>
          <div className="home-ask">
            <SoonRows rows={['가격', '써 본 사람의 후기', '소개한 사람에 대한 믿음', '사후관리(A/S)', '브랜드']} />
            <span className="home-aska" aria-hidden="true"><Img src="/home/d/poll-bags.png" /></span>
          </div>
          <Soon wait="투표는 곧 열립니다" />
        </article>
      )}
      {used ? <Used p={used} /> : (
        <article className="home-pl" data-kind="USED" data-soon="1">
          <span className="home-bdg mint">써본 의견이 필요해요</span><span className="home-exs">준비 중</span>
          <h3>공기청정기를 써 보신 분들의 의견을 들려주세요!</h3>
          <div className="home-op">
            <span className="home-opa" aria-hidden="true"><Img src="/home/d/poll-purifier.png" /></span>
            <div>
              <p className="home-opd">필터 값 · 소음 · 전기료 — 솔직한 의견을 기다려요.</p>
              <SoonRows rows={['사용 중이에요', '사용해봤어요', '아직 안 써봤어요']} />
            </div>
          </div>
          <Soon wait="의견 남기기는 곧 열립니다" />
        </article>
      )}
    </div>
  );
}

var M_poll = (function(){
/* ═══════════════════════════════════════════════════════════════════
   v10.14 (2026-10-02) — 시안에서 시연되지 않던 것을 채웁니다
   ───────────────────────────────────────────────────────────────────
   ① 「이건 어때?」 투표 (서버 D021 · GET/POST /community/polls…)
        · 메인 카드 3장 — 고르고 투표합니다(본체는 render.js 의 mxPoll, 상태 · 규칙은 여기)
        · 소개광장 투표 목록   cmupoll   SB-HOM-CMU-040   /community/polls
        · 운영 투표 관리       admpoll   SB-ADM-CMU-020   /admin/community/polls
   ② 사회관계망 주소 — 운영 「사이트 기본 정보」에서 넣으면 메인 푸터 아이콘이 그 주소로 연결됩니다
   ③ 실제 운영 화면에는 있고 시안에만 없던 두 장
        · 지급 데스크          admpay    SB-ADM-PAY-010   /admin/payouts
        · 리드 배정            admlasg   SB-ADM-PTN-090   /admin/partners/leads

   사장님 결정(2026-10-02) — 비로그인도 투표(회원 1인 1표 · 비로그인은 기기 1표) · 참여 수는 실제 표 수 ·
   사회관계망 주소는 운영 화면에서 입력.
   ★ 시연입니다 — 이 브라우저 안에서만 바뀌고 저장하지 않습니다(새로고침하면 처음으로 돌아갑니다).
     규칙의 순서와 문구는 서버(D021 · poll.service · payout · lead)와 같게 그렸습니다. 집행은 서버가 합니다.
   ═══════════════════════════════════════════════════════════════════ */
let U = null, D = null;
const e = x => U.esc(x);
const S = () => U.state;
const H = o => U.header(o || {});
const F = () => U.footer();
const FS = () => U.footer({slim:true});
const B = l => U.backLink(l);
const won = n => Number(n).toLocaleString("ko-KR") + "원";
const num = n => Number(n).toLocaleString("ko-KR");
const today = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
const nowHM = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return today() + " " + p(d.getHours()) + ":" + p(d.getMinutes()); };

/* ── 공통 조각 (다른 묶음과 같은 모양 — 모듈 밖이라 다시 만듭니다) ── */
function page(title, sub, right){
  return '<div class="pgh"><div><h1>' + e(title) + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (right || '') + '</div>';
}
function note(kind, body){ return '<div class="nt ' + kind + '">' + body + '</div>'; }
function table(head, rows, attr){
  return '<div class="tw"><table class="tb2"' + (attr || '') + '><thead><tr>' + head.map(h => '<th>' + e(h) + '</th>').join("") + '</tr></thead><tbody>' +
    rows.map(r => '<tr' + (r.attr || '') + '>' + (r.cells || r).map(c => '<td>' + c + '</td>').join("") + '</tr>').join("") + '</tbody></table></div>';
}
function bg(t, k){ return '<span class="bg ' + (k || "off") + '">' + e(t) + '</span>'; }
function empty(t){ return '<p class="ls" style="margin:6px 0 14px">' + e(t) + '</p>'; }
/* data-n — 누를 때마다 올라가는 번호. 같은 안내가 또 나와도 「다시 처리했다」가 화면에 남습니다(시연 보장 안내가 끼어들지 않게) */
function flash(m){ return m ? '<div class="px-flash' + (m[0] === "ok" ? '' : ' bad') + '" role="' + (m[0] === "ok" ? 'status' : 'alert') + '" data-px-flash="' + m[0] + '" data-n="' + PX.n + '">' + m[1] + '</div>' : ''; }
function admNav(cur){
  return '<header class="ahd"><div class="wrap ain">' +
    '<a class="alg" href="#" data-go="adm"><span class="d"></span>소개뱅크 <b>운영</b></a>' +
    '<nav class="agnb">' + D.admin.nav.map(n =>
      '<a href="#" class="' + (n[0] === cur ? "on" : "") + '"' + (n[0] === cur ? ' aria-current="page"' : '') +
      ' data-go="' + e(n[0]) + '">' + e(n[1]) + '</a>').join("") + '</nav>' +
    '<div class="ahr"><span class="ls">검수 1명 · 일 50건</span>' +
      '<button class="bo sm" data-go="main2">사용자 화면으로</button></div>' +
    '</div></header>';
}
function admShell(cur, title, sub, body, right){
  return admNav(cur) + '<div class="wrap admw">' + page(title, sub, right) + body + '</div>' + FS();
}
/* 한 화면 안의 작은 갈래 — 누르면 그 화면으로 갑니다 */
function subTabs(list, cur, attr){
  return '<div class="tabs2"' + (attr || '') + '>' + list.map(t =>
    '<button class="tb' + (t[0] === cur ? " on" : "") + '" data-go="' + e(t[0]) + '"' + (t[0] === cur ? ' aria-current="page"' : '') + '>' + e(t[1]) + '</button>').join("") + '</div>';
}
/* 입력칸 값 — 화면을 다시 그려도 적던 것이 남게 여기 담아 둡니다 */
const FV = {};
const fv = (k, d) => (FV[k] == null ? (d == null ? "" : d) : FV[k]);
function keep(){
  document.querySelectorAll("[data-pxv]").forEach(el => { FV[el.getAttribute("data-pxv")] = el.type === "checkbox" ? el.checked : el.value; });
}
function inp(k, o){
  o = o || {};
  return '<input class="inp" data-pxv="' + e(k) + '" id="px-' + e(k) + '" value="' + e(fv(k, o.v)) + '"' +
    (o.ph ? ' placeholder="' + e(o.ph) + '"' : '') + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.num ? ' inputmode="numeric"' : '') +
    (o.label ? ' aria-label="' + e(o.label) + '"' : '') + '>';
}

/* ══ ① 투표 ══════════════════════════════════════════════════════════
   종류마다 보기 수가 다릅니다(서버 fn_poll_guard) — 비교해요 2 · 궁금해요 2~8 · 써본 의견 2~5 */
const KIND = {
  VS:   { label: "비교해요", tone: "blue", cta: "투표하기", min: 2, max: 2, rule: "정확히 2개" },
  ASK:  { label: "궁금해요", tone: "lilac", cta: "투표하기", min: 2, max: 8, rule: "2 ~ 8개" },
  USED: { label: "써본 의견이 필요해요", tone: "mint", cta: "의견 남기기", min: 2, max: 5, rule: "2 ~ 5개" }
};
const STATE = { DRAFT: "준비 중", OPEN: "진행 중", CLOSED: "마감", HIDDEN: "감춤" };
const o2 = (id, label, sub, img, n) => ({ id: id, label: label, sub: sub || "", img: img || "", n: n || 0 });
const PX = {
  seq: 6, n: 0,
  /* 메인 3장은 2026-10-03 에 확정한 질문입니다(v10.15 — 실제 웹의 시드 scripts/seed-polls.sql 과 같은 문구. 그림은 주신 디자인 그대로).
     표는 0표에서 시작합니다(참여 수 = 실제 표 수).
     마감 · 준비 중 1건씩은 목록 · 운영 화면을 보여 주기 위한 시연 자료입니다 */
  polls: [
    { id: "p1", kind: "VS", title: "로봇청소기를 산다면, 어느 쪽을 고르시겠어요?", desc: "", img: "", state: "OPEN", home: true, sort: 1, why: "",
      opts: [o2("p1a", "흡입력 우선", "값이 더 나가도 잘 빨아들이는 쪽", "vs-a"), o2("p1b", "가성비 우선", "기본 기능에 값이 싼 쪽", "vs-b")] },
    { id: "p2", kind: "ASK", title: "소개받아 살 때 가장 먼저 보는 것은?", desc: "", img: "poll-bags", state: "OPEN", home: true, sort: 2, why: "",
      opts: [o2("p2a", "가격"), o2("p2b", "써 본 사람의 후기"), o2("p2c", "소개한 사람에 대한 믿음"), o2("p2d", "사후관리(A/S)"), o2("p2e", "브랜드")] },
    { id: "p3", kind: "USED", title: "공기청정기를 써 보신 분들의 의견을 들려주세요!", desc: "필터 값 · 소음 · 전기료 — 솔직한 의견을 기다려요.", img: "poll-purifier", state: "OPEN", home: true, sort: 3, why: "",
      opts: [o2("p3a", "사용 중이에요"), o2("p3b", "사용해봤어요"), o2("p3c", "아직 안 써봤어요")] },
    { id: "p4", kind: "ASK", title: "소개받을 때 가장 먼저 보는 것은?", desc: "마감된 투표의 예(시연 자료)입니다.", img: "", state: "CLOSED", home: false, sort: 4, why: "",
      opts: [o2("p4a", "실제 후기", "", "", 14), o2("p4b", "가격", "", "", 9), o2("p4c", "인증 여부", "", "", 11), o2("p4d", "거리", "", "", 5)] },
    { id: "p5", kind: "VS", title: "정수기, 렌탈과 구매 중 어느 쪽?", desc: "", img: "", state: "DRAFT", home: false, sort: 5, why: "",
      opts: [o2("p5a", "렌탈", "관리까지 맡김"), o2("p5b", "구매", "오래 쓰면 저렴")] }
  ],
  votes: { member: {}, guest: {} },   /* 누가(회원 · 이 기기의 비로그인 방문자) 어느 투표에 무엇을 넣었나 — 투표 1건에 1표 */
  sel: {},                            /* 고른 보기(아직 안 넣음) */
  msg: {},                            /* 투표별 안내 [종류, 글] */
  guest: true,                        /* 설정 poll.guest_vote — 비로그인도 투표 */
  ipLimit: 5,                         /* 설정 poll.guest_ip_daily_limit — 같은 인터넷 주소 · 하루 · 투표 1건당.
                                         시연은 기기가 하나라(투표 1건에 1표) 이 한도에 걸리는 모습은 나오지 않습니다 — 값 저장만 보여 줍니다.
                                         실제로 막히는 것은 서버 점검(qa/srv_poll.py · POLL_IP_LIMIT)에서 확인합니다 */
  sns: { facebook: "", instagram: "", x: "", youtube: "" },
  adm: null, snsMsg: null
};
const SNS = [["facebook", "페이스북", "https://www.facebook.com/…"], ["instagram", "인스타그램", "https://www.instagram.com/…"],
             ["x", "엑스", "https://x.com/…"], ["youtube", "유튜브", "https://www.youtube.com/@…"]];
const SNS_RE = /^https:\/\/\S{4,200}$/;

const who = () => (M_session.isLoggedIn() ? "member" : "guest");
const find = id => PX.polls.filter(p => p.id === id)[0] || null;
const total = p => p.opts.reduce((a, o) => a + o.n, 0);
const pct = (p, o) => { const t = total(p); return t > 0 ? Math.round(o.n * 100 / t) : 0; };
const mine = p => PX.votes[who()][p.id] || null;
const canVote = p => p.state === "OPEN" && !mine(p);
const result = p => !!mine(p) || p.state !== "OPEN";       /* 비율은 투표한 뒤(또는 마감 뒤)에만 — 남의 선택에 끌려가지 않게 */
const byKind = k => PX.polls.filter(p => p.kind === k && p.state === "OPEN" && p.home).sort((a, b) => a.sort - b.sort)[0] || null;
const home = () => ({ VS: byKind("VS"), ASK: byKind("ASK"), USED: byKind("USED") });
const art = n => (window.__MHX && n ? window.__MHX.art(n) : "");

function pick(id, t){
  const p = find(id), o = t.getAttribute("data-opt");
  if (!p || !canVote(p)) return;
  if (PX.sel[id] === o) { U.toast("이미 고른 보기입니다 — 「" + KIND[p.kind].cta + "」를 누르면 들어갑니다."); return; }
  PX.sel[id] = o; delete PX.msg[id];
}
/* 서버와 같은 순서 — 없는 투표 → 마감 → 이미 투표 → 로그인 필요 → 보기 (같은 인터넷 주소 하루 한도는 서버만 — 위 ipLimit 설명) */
function vote(id){
  const p = find(id), w = who();
  if (!p) return;
  const bad = (k, t) => { PX.msg[id] = [k, t]; };
  if (p.state !== "OPEN") return bad("err", "마감된 투표입니다.");
  if (PX.votes[w][id]) return bad("err", "이미 투표하셨습니다.");
  if (w === "guest" && !PX.guest) return bad("login", "로그인한 회원만 투표할 수 있습니다.");
  const o = p.opts.filter(x => x.id === PX.sel[id])[0];
  if (!o) return bad("err", "보기를 먼저 골라 주세요.");
  o.n += 1; PX.votes[w][id] = o.id; delete PX.sel[id];
  PX.msg[id] = ["ok", "투표했습니다. 고맙습니다."];
}

/* 소개광장 안의 갈래 — 글 · 투표. 소개광장 목록(scCmu · scCommunity)도 이 줄을 씁니다 */
function cmuTabs(cur){ return subTabs([["cmu", "글"], ["cmupoll", "이건 어때? 투표"]], cur, ' data-polls-tab'); }

function pollCard(p){
  const k = KIND[p.kind], can = canVote(p), res = result(p), my = mine(p), m = PX.msg[p.id], t = total(p);
  return '<article class="px-card' + (p.state === "OPEN" ? '' : ' closed') + '" data-poll="' + p.id + '" data-kind="' + p.kind + '" data-voted="' + (my ? 1 : 0) + '">' +
    '<div class="px-top"><span class="px-kind">' + k.label + '</span><span class="px-state">' + (p.state === "OPEN" ? "진행 중" : "마감") + '</span></div>' +
    '<h2>' + e(p.title) + '</h2>' + (p.desc ? '<p class="px-desc">' + e(p.desc) + '</p>' : '') +
    (art(p.img) ? '<img class="px-img" src="' + art(p.img) + '" alt="" loading="lazy">' : '') +
    '<ul class="px-opts" role="radiogroup" aria-label="' + e(p.title) + '">' + p.opts.map(o => {
      const on = can ? PX.sel[p.id] === o.id : my === o.id, v = pct(p, o);
      const inner = '<i aria-hidden="true"></i>' + (art(o.img) ? '<img src="' + art(o.img) + '" alt="" loading="lazy">' : '') +
        '<span class="px-ol"><span>' + e(o.label) + '</span>' + (o.sub ? '<small>' + e(o.sub) + '</small>' : '') + '</span>' +
        (res ? '<em>' + v + '% · ' + num(o.n) + '표</em>' : '');
      return '<li class="' + (res ? 'res' : '') + (on ? ' on' : '') + '"' + (res ? ' style="--p:' + v + '%"' : '') + '>' +
        (can ? '<button type="button" class="px-opt" role="radio" aria-checked="' + on + '" data-px="pick" data-id="' + p.id + '" data-opt="' + o.id + '">' + inner + '</button>'
             : '<span class="px-opt" data-opt="' + o.id + '">' + inner + '</span>') + '</li>';
    }).join("") + '</ul>' +
    '<div class="px-foot">' +
      (can ? '<button type="button" class="bp" data-px="vote" data-id="' + p.id + '" data-vote>' + k.cta + '</button>'
           : '<span class="px-done" data-done>' + (my ? '투표했습니다' : '마감된 투표') + '</span>') +
      '<span class="px-total" data-total="' + t + '">' + num(t) + '명 참여</span></div>' +
    (m ? '<p class="px-msg ' + m[0] + '" role="' + (m[0] === "ok" ? 'status' : 'alert') + '" data-n="' + PX.n + '">' + e(m[1]) +
         (m[0] === "login" ? ' <a href="#" data-go="login">로그인</a>' : '') + '</p>' : '') +
  '</article>';
}

/* ── SB-HOM-CMU-040 · 소개광장 「이건 어때?」 투표 ──────────────────── */
function scCmuPoll(){
  const list = PX.polls.filter(p => p.state === "OPEN" || p.state === "CLOSED")
    .sort((a, b) => (a.state === "OPEN" ? 0 : 1) - (b.state === "OPEN" ? 0 : 1) || a.sort - b.sort);
  const open = list.filter(p => p.state === "OPEN").length, w = who();
  return H({}) + '<div class="wrap aiw">' + B("이전 화면") +
    page("이건 어때?", "여러분의 의견을 알려 주세요. 실제 사용자들의 생각이 더 나은 선택을 만듭니다. <b>SB-HOM-CMU-040</b>",
      '<button class="bo" data-go="cmu">소개광장으로</button>') +
    note("info", (PX.guest
        ? "<b>로그인 없이 투표하실 수 있습니다.</b> 회원은 계정당 한 번, 비로그인은 기기당 한 번입니다. "
        : "<b>로그인한 회원만 투표할 수 있습니다.</b> 계정당 한 번입니다. ") +
      "넣은 표는 바꿀 수 없고, 결과는 투표한 뒤에 보입니다. 참여 수는 <b>실제로 투표한 수</b>입니다.") +
    cmuTabs("cmupoll") +
    (list.length
      ? '<p class="ls" data-poll-count="' + list.length + '">진행 중 ' + open + '건 · 마감 ' + (list.length - open) + '건 · 지금 <b>' +
          (w === "member" ? "회원" : "비로그인(이 기기)") + '</b>으로 보고 있습니다</p>' +
        '<div class="px-grid">' + list.map(pollCard).join("") + '</div>'
      : empty("지금 열린 투표가 없습니다. 곧 새 투표가 올라옵니다.")) +
    note("warn", "<b>시연입니다.</b> 이 브라우저 안에서만 세고 저장하지 않습니다. 실제 웹은 서버가 셉니다 — " +
      "<span class=\"code\">POST /community/polls/{id}/vote</span> · 같은 사람의 두 번째 표는 DB 가 막습니다(409).") +
    '</div>' + F();
}

/* ── SB-ADM-CMU-020 · 투표 관리 ────────────────────────────────────── */
function admCmuTabs(cur){ return subTabs([["admcmu", "글 검수"], ["admpoll", "이건 어때? 투표"]], cur, ' data-admpoll-tab'); }
function scAdmPoll(){
  const hm = home(), onHome = ["VS", "ASK", "USED"].filter(k => hm[k]);
  const rows = PX.polls.slice().sort((a, b) => a.sort - b.sort).map(p => {
    const t = total(p), k = KIND[p.kind], isHome = hm[p.kind] && hm[p.kind].id === p.id;
    return { attr: ' data-poll="' + p.id + '" data-state="' + p.state + '"', cells: [
      e(k.label),
      '<b>' + e(p.title) + '</b><div class="ls">' + p.opts.map(o => e(o.label) + ' ' + num(o.n) + '표(' + pct(p, o) + '%)').join(' · ') + '</div>' +
        (p.state === "HIDDEN" && p.why ? '<div class="px-bad">감춘 사유: ' + e(p.why) + '</div>' : ''),
      bg(STATE[p.state], p.state === "OPEN" ? "ok" : p.state === "HIDDEN" ? "no" : p.state === "DRAFT" ? "wait" : "off"),
      '<b data-total="' + t + '">' + num(t) + '</b>',
      '<button class="bo sm" data-px="phome" data-id="' + p.id + '" aria-pressed="' + !!p.home + '">' + (p.home ? '메인에서 빼기' : '메인에 내기') + '</button>' +
        (isHome ? ' <span class="ls">나가는 중</span>' : ''),
      (p.state !== "OPEN" ? '<button class="bp sm" data-px="popen" data-id="' + p.id + '">열기</button> ' : '') +
      (p.state === "OPEN" ? '<button class="bo sm" data-px="pclose" data-id="' + p.id + '">마감</button> ' : '') +
      (p.state !== "HIDDEN" ? '<button class="bo sm" data-px="phide" data-id="' + p.id + '">감추기</button>' : '')
    ] };
  });
  return admShell("admcmu", "투표 관리",
    "소개광장 「이건 어때?」와 메인의 세 장에 나오는 투표를 만들고 엽니다. 참여 수는 실제 표 수입니다. <b>SB-ADM-CMU-020</b>",
    admCmuTabs("admpoll") + flash(PX.adm) +

    '<div class="panel px-box" data-poll-rule><div class="sh2"><b>누가 투표할 수 있나</b><span class="ls">설정 poll.guest_vote · poll.guest_ip_daily_limit</span></div>' +
      '<p>지금: <b>' + (PX.guest ? '비로그인도 가능 — 회원 1인 1표 · 비로그인은 기기 1표' : '로그인 회원만 — 1인 1표') + '</b></p>' +
      '<p class="ls">비로그인 투표는 기기(방문자 쿠키)로 한 번만 받고, 같은 인터넷 주소에서 하루에 넣을 수 있는 표를 제한합니다. ' +
        '쿠키를 지우면 다시 넣을 수 있으므로 <b>표 수가 부풀 수 있습니다</b> — 정확해야 하면 「로그인 회원만」으로 바꾸십시오. 이미 들어온 표는 그대로입니다. ' +
        '(시연은 기기가 하나라 하루 한도에 걸리는 모습은 나오지 않습니다 — 실제 서버는 한도를 넘으면 POLL_IP_LIMIT 로 막습니다.)</p>' +
      '<div class="prfact" style="margin:8px 0 0"><button class="bo" data-px="guest">' + (PX.guest ? '로그인 회원만으로 바꾸기' : '비로그인도 가능으로 바꾸기') + '</button></div>' +
      '<div class="px-form" style="margin-top:10px"><label><span>같은 인터넷 주소에서 비로그인으로 하루에 넣을 수 있는 표 (투표 1건당 · 1 ~ 999)</span>' +
        '<span class="px-inl">' + inp("iplimit", { v: PX.ipLimit, num: 1, max: 3 }) + '<button class="bp sm" data-px="iplimit">한도 저장</button></span></label></div></div>' +

    '<div class="panel px-box" style="margin-top:12px" data-poll-home="' + onHome.length + '"><div class="sh2"><b>메인에 나가는 투표 ' + onHome.length + ' / 3</b><span class="ls">종류마다 1건 — 순서가 가장 앞선 열린 투표</span></div>' +
      ["VS", "ASK", "USED"].map(k => '<p>' + e(KIND[k].label) + ' — ' + (hm[k] ? '<b>' + e(hm[k].title) + '</b>'
        : '<span class="tbd">없음</span> <span class="ls">메인 카드는 「준비 중」으로 나갑니다</span>') + '</p>').join("") + '</div>' +

    '<h2 class="st2">새 투표</h2>' +
    '<div class="panel px-box"><div class="px-form">' +
      '<label><span>종류</span><span class="px-inl"><select data-pxv="nk" id="px-nk" aria-label="종류">' + ["VS", "ASK", "USED"].map(k =>
        '<option value="' + k + '"' + (fv("nk", "VS") === k ? ' selected' : '') + '>' + e(KIND[k].label) + ' (보기 ' + KIND[k].rule + ')</option>').join("") + '</select>' +
        '<label class="chk2"><input type="checkbox" data-pxv="nh" id="px-nh"' + (fv("nh", true) ? ' checked' : '') + '> 메인에 내기</label></span></label>' +
      '<label><span>제목 (4 ~ 80자)</span>' + inp("nt", { ph: "둘 중 어떤 제품이 더 좋을까요?", max: 80 }) + '</label>' +
      '<label><span>설명 (선택 · 200자까지)</span>' + inp("nd", { max: 200 }) + '</label>' +
      '<label><span>보기 — 한 줄에 하나 (<span class="code">이름 | 한 줄 설명</span>, 설명은 선택)</span>' +
        '<textarea data-pxv="no" id="px-no" rows="4" placeholder="A 브랜드 | 흡입력 강함&#10;B 브랜드 | 가성비 좋음">' + e(fv("no")) + '</textarea></label>' +
      '<div class="prfact"><button class="bp" data-px="pcreate">만들기 (준비 중으로)</button></div>' +
    '</div></div>' +

    '<h2 class="st2">투표 ' + PX.polls.length + '건</h2>' +
    table(["종류", "제목 · 보기별 표", "상태", "참여", "메인", "처리"], rows, ' data-polls-admin') +
    '<div class="px-form" style="margin:10px 0 0"><label><span>감추는 사유 (5자 이상 — 기록에 남습니다)</span>' + inp("hide", { ph: "예) 특정 상표를 깎아내리는 보기", max: 200 }) + '</label></div>' +
    note("warn", "<b>표가 들어온 투표는 제목 · 보기를 바꿀 수 없습니다(POLL_LOCKED).</b> 결과가 달라지기 때문입니다 — 새 투표를 만드십시오. " +
      "이 화면에서 표 수를 고칠 수 없고, 넣은 표는 누구도 고치거나 지울 수 없습니다(POLL_VOTE_FIXED).") +
    note("info", "<b>실제 운영 화면</b>은 「소개광장 → 이건 어때? 투표」 탭입니다 — " +
      "<span class=\"code\">GET · POST /admin/community/polls</span> · <span class=\"code\">PATCH /admin/community/polls/{id}</span>. 만들기 · 열기 · 마감 · 감추기는 감사 기록에 남습니다."));
}
const ADM = {
  guest(){ PX.guest = !PX.guest; PX.adm = ["ok", PX.guest ? "비로그인 방문자도 투표할 수 있게 했습니다." : "로그인 회원만 투표하게 했습니다."]; },
  iplimit(){
    const v = String(fv("iplimit", PX.ipLimit)).trim();
    if (!/^[1-9][0-9]{0,2}$/.test(v)) { PX.adm = ["err", "1 ~ 999 사이의 숫자만 적어 주십시오."]; return; }
    PX.ipLimit = Number(v); FV.iplimit = v; PX.adm = ["ok", "하루 한도를 " + v + "표로 저장했습니다."];
  },
  phome(id){ const p = find(id); p.home = !p.home; PX.adm = ["ok", p.home ? "메인에 내도록 했습니다." : "메인에서 뺐습니다."]; },
  popen(id){
    const p = find(id), k = KIND[p.kind], n = p.opts.length;
    if (n < k.min || n > k.max) { PX.adm = ["err", "「" + k.label + "」는 보기가 " + k.rule + "여야 열 수 있습니다 (지금 " + n + "개) (POLL_OPTIONS)"]; return; }
    p.state = "OPEN"; p.why = ""; PX.adm = ["ok", "열었습니다 — 지금부터 투표를 받습니다."];
  },
  pclose(id){ const p = find(id); p.state = "CLOSED"; PX.adm = ["ok", "마감했습니다 — 결과는 계속 보입니다."]; },
  phide(id){
    const p = find(id), why = String(fv("hide")).trim();
    if (why.length < 5) { PX.adm = ["err", "감추실 때는 아래 「감추는 사유」를 5자 이상 적으십시오. (POLL_HIDE_REASON)"]; return; }
    p.state = "HIDDEN"; p.why = why; FV.hide = ""; PX.adm = ["ok", "감췄습니다 — 목록과 메인에서 빠집니다."];
  },
  pcreate(){
    const kind = fv("nk", "VS"), k = KIND[kind], title = String(fv("nt")).trim(), desc = String(fv("nd")).trim();
    const opts = String(fv("no")).split("\n").map(l => l.trim()).filter(Boolean).map(l => l.split("|").map(x => x.trim()));
    if (title.length < 4) { PX.adm = ["err", "제목을 4자 이상 적어 주십시오."]; return; }
    if (opts.length < 2) { PX.adm = ["err", "보기를 2개 이상 적어 주십시오(한 줄에 하나)."]; return; }
    if (opts.length < k.min || opts.length > k.max) { PX.adm = ["err", "「" + k.label + "」는 보기가 " + k.rule + "여야 합니다 (지금 " + opts.length + "개)."]; return; }
    if (opts.some(o => !o[0] || o[0].length > 40)) { PX.adm = ["err", "보기 이름은 1 ~ 40자입니다."]; return; }
    const id = "p" + (PX.seq++);
    PX.polls.push({ id: id, kind: kind, title: title, desc: desc, img: "", state: "DRAFT", home: !!fv("nh", true),
      sort: PX.polls.reduce((a, p) => Math.max(a, p.sort), 0) + 1, why: "",
      opts: opts.map((o, i) => o2(id + String.fromCharCode(97 + i), o[0], o[1] || "")) });
    FV.nt = ""; FV.nd = ""; FV.no = "";
    PX.adm = ["ok", "만들었습니다 — 「준비 중」입니다. 「열기」를 누르면 투표를 받습니다."];
  }
};

/* ══ ② 사회관계망 주소 — 운영 「사이트 기본 정보」(scAdmLegal)에 붙습니다 ══ */
function snsBox(){
  const n = SNS.filter(k => SNS_RE.test(PX.sns[k[0]])).length;
  return '<div class="panel px-box" style="margin-top:12px" data-sns-settings="' + n + '"><div class="sh2"><b>사회관계망 주소</b>' +
      '<span class="ls">설정 sns.facebook · sns.instagram · sns.x · sns.youtube</span></div>' +
    '<p>지금: <b>' + (n ? n + '곳 연결' : '연결한 곳 없음 — 메인 푸터 아이콘 4개가 「준비 중」으로 나갑니다') + '</b></p>' +
    '<p class="ls">주소를 넣은 아이콘만 메인 푸터에서 <b>새 창으로</b> 그 주소를 엽니다. 비워 두면 「준비 중」으로 남습니다. ' +
      '<span class="code">https://</span> 로 시작하는 주소만 받습니다(서버 설정의 형식 검사와 같습니다).</p>' +
    '<div class="px-form">' + SNS.map(k => '<label><span>' + k[1] + '</span>' + inp("sns_" + k[0], { v: PX.sns[k[0]], ph: k[2], max: 208, label: k[1] + " 주소" }) + '</label>').join("") +
      '<div class="prfact"><button class="bp sm" data-px="snssave">사회관계망 주소 저장</button><button class="bo sm" data-go="main2">메인 푸터에서 확인</button></div></div>' +
    flash(PX.snsMsg) + '</div>';
}
ADM.snssave = function(){
  const next = {}; let bad = "";
  SNS.forEach(k => { const v = String(fv("sns_" + k[0], PX.sns[k[0]])).trim(); if (v && !SNS_RE.test(v) && !bad) bad = k[1]; next[k[0]] = v; });
  if (bad) { PX.snsMsg = ["err", "「" + bad + "」 주소는 https:// 로 시작해야 합니다 (빈칸 없이 · 200자까지). 저장하지 않았습니다."]; return; }
  PX.sns = next; SNS.forEach(k => { FV["sns_" + k[0]] = next[k[0]]; });
  const n = SNS.filter(k => next[k[0]]).length;
  PX.snsMsg = ["ok", n ? "저장했습니다 — " + n + "곳이 메인 푸터에서 연결됩니다." : "저장했습니다 — 연결한 곳이 없어 4개 모두 「준비 중」으로 나갑니다."];
};

/* ══ ③-1 지급 데스크 (SB-ADM-PAY-010 · 2026-10-01 결정 Q1) ════════════
   확정은 운영(ADMIN · SUPER), 지급 기록은 지급 담당(PAYOUT)이 합니다 — 같은 사람이 둘 다 할 수 없습니다(2인 원칙).
   소개비는 여기 없습니다 — 당사자끼리 직접 지급합니다(INV-11). */
const PK = { PARTNER: "제휴 수수료", HEALTH: "소개뱅크몰 판매자" };
const PAY = {
  role: "ADMIN", msg: null,
  queue: [
    { id: "q1", kind: "PARTNER", payee: "소개하니", from: "2026-09-01", to: "2026-09-30", amount: 184000, ready: true, bank: "국민은행", last4: "9012", holder: "김소개" },
    { id: "q2", kind: "HEALTH", payee: "그린팜 건강", from: "2026-09-16", to: "2026-09-30", amount: 612500, ready: false, blocker: "정산 계좌 1원 인증이 끝나지 않았습니다", bank: "", last4: "", holder: "" }
  ],
  drafts: [
    { id: "d1", kind: "PARTNER", payee: "대성상사", from: "2026-09-01", to: "2026-09-30", amount: 96000, bank: "신한은행", last4: "4471", holder: "대성상사" },
    { id: "d2", kind: "HEALTH", payee: "맑은샘 헬스", from: "2026-09-16", to: "2026-09-30", amount: 438000, bank: "하나은행", last4: "2208", holder: "맑은샘 헬스" }
  ],
  paid: [
    { id: "x1", kind: "PARTNER", payee: "정연물류", amount: 152000, at: "2026-09-10", ref: "KB-20260910-0031", by: "지급 담당" }
  ],
  recv: [
    { id: "r1", no: "AD-2026-09-0007", adv: "세바코리아", unpaid: 330000, due: "2026-09-25", over: 7 },
    { id: "r2", no: "AD-2026-09-0011", adv: "맑은물렌탈", unpaid: 110000, due: "2026-10-10", over: 0 }
  ]
};
function stlTabs(cur){ return subTabs([["admstl", "정산 승인"], ["admpay", "지급 데스크"]], cur, ' data-pay-tab'); }
function payRow(main, sub, act, bad, attr){
  return '<div class="px-row"' + (attr || '') + '><div><span class="m">' + main + '</span><span class="ls">' + sub + '</span>' +
    (bad ? '<div class="px-bad">' + e(bad) + '</div>' : '') + '</div><div class="a">' + act + '</div></div>';
}
function scAdmPay(){
  const isPay = PAY.role === "PAYOUT", ready = PAY.queue.filter(r => r.ready);
  return admShell("admstl", "지급 데스크",
    "확정된 정산을 보내고 기록합니다. 확정은 운영, 지급 기록은 지급 담당이 합니다. <b>SB-ADM-PAY-010</b>",
    stlTabs("admpay") +
    '<div class="px-role" data-pay-role="' + PAY.role + '"><b>시연 — 지금 보는 사람</b><div class="tabs2" style="margin:0">' +
      '<button class="tb' + (!isPay ? ' on' : '') + '" data-px="payrole" data-id="ADMIN" aria-pressed="' + !isPay + '">운영 (ADMIN · SUPER)</button>' +
      '<button class="tb' + (isPay ? ' on' : '') + '" data-px="payrole" data-id="PAYOUT" aria-pressed="' + isPay + '">지급 담당 (PAYOUT)</button></div>' +
      '<span class="ls">실제 화면은 로그인한 계정의 역할을 봅니다 — 버튼은 역할에 맞는 것만 보입니다.</span></div>' +
    note("info", "<b>확정은 운영, 지급 기록은 지급 담당이 합니다(2인 원칙).</b> 같은 사람이 둘 다 할 수 없게 서버와 DB 가 막습니다. " +
      "<b>소개비는 여기 없습니다</b> — 당사자끼리 직접 지급합니다.") +
    '<div class="px-kpis">' +
      '<div class="px-kpi"><span>지급 대기</span><b data-kpi="waiting">' + PAY.queue.length + '</b><i>확정됨</i></div>' +
      '<div class="px-kpi"><span>바로 보낼 수 있음</span><b data-kpi="ready">' + ready.length + '</b><i>' + won(ready.reduce((a, r) => a + r.amount, 0)) + '</i></div>' +
      '<div class="px-kpi"><span>확정 전</span><b data-kpi="drafts">' + PAY.drafts.length + '</b><i>DRAFT</i></div>' +
      '<div class="px-kpi"><span>광고비 미수금</span><b data-kpi="recv">' + PAY.recv.length + '</b><i>' + won(PAY.recv.reduce((a, r) => a + r.unpaid, 0)) + '</i></div>' +
    '</div>' + flash(PAY.msg) +

    '<h2 class="st2">지급 대기 (확정됨) ' + PAY.queue.length + '건</h2>' +
    (PAY.queue.length ? PAY.queue.map(r => payRow(won(r.amount),
        PK[r.kind] + ' · ' + e(r.payee) + ' · ' + r.from + ' ~ ' + r.to + (r.bank ? ' · ' + e(r.bank) + ' ****' + e(r.last4) + ' (' + e(r.holder) + ')' : ''),
        isPay ? inp("ref_" + r.id, { ph: "이체 참조 (은행 거래번호)", max: 60, label: r.payee + " 이체 참조" }) +
                '<button class="bp sm" data-px="paypay" data-id="' + r.id + '">지급 기록</button>'
              : '<span class="ls">지급은 지급 담당이 합니다</span>',
        r.ready ? "" : "지급 불가 — " + r.blocker, ' data-pay-queue="' + r.id + '"')).join("")
      : empty("확정된 지급이 없습니다.")) +

    '<h2 class="st2">확정 전 (DRAFT) ' + PAY.drafts.length + '건</h2>' +
    (PAY.drafts.length ? PAY.drafts.map(r => payRow(won(r.amount), PK[r.kind] + ' · ' + e(r.payee) + ' · ' + r.from + ' ~ ' + r.to,
        !isPay ? '<button class="bp sm" data-px="payconfirm" data-id="' + r.id + '">확정</button>' : '<span class="ls">확정은 운영이 합니다</span>',
        "", ' data-pay-draft="' + r.id + '"')).join("")
      : empty("확정할 정산이 없습니다.")) +

    '<h2 class="st2">광고비 미수금 ' + PAY.recv.length + '건</h2>' +
    (PAY.recv.length ? PAY.recv.map(v => payRow(won(v.unpaid),
        e(v.no) + ' · ' + e(v.adv) + ' · 기한 ' + v.due + (v.over > 0 ? ' · ' + v.over + '일 연체' : ''),
        isPay ? inp("in_" + v.id, { v: v.unpaid, num: 1, max: 10, label: v.adv + " 입금액" }) +
                '<button class="bp sm" data-px="payin" data-id="' + v.id + '">입금 기록</button>'
              : '<span class="ls">입금 기록은 지급 담당이 합니다</span>',
        "", ' data-pay-recv="' + v.id + '"')).join("")
      : empty("미수금이 없습니다.")) +

    '<h2 class="st2">최근 지급 ' + PAY.paid.length + '건</h2>' +
    table(["종류", "받는 곳", "금액", "지급일", "이체 참조", "지급자"], PAY.paid.map(r =>
      [PK[r.kind], '<b>' + e(r.payee) + '</b>', '<b>' + won(r.amount) + '</b>', r.at, '<span class="code">' + e(r.ref) + '</span>', e(r.by)]), ' data-pay-paid') +
    note("warn", "<b>지급 기록은 되돌릴 수 없습니다.</b> 은행에서 실제로 보낸 뒤, 그 거래번호(이체 참조)를 적어 기록하십시오. " +
      "계좌 인증이 끝나지 않은 곳은 「지급 불가」로 잠깁니다."));
}
ADM.payrole = function(id){
  const r = id === "PAYOUT" ? "PAYOUT" : "ADMIN";
  if (PAY.role === r) { U.toast("이미 「" + (r === "PAYOUT" ? "지급 담당" : "운영") + "」으로 보고 있습니다."); return; }
  PAY.role = r; PAY.msg = null;
};
ADM.payconfirm = function(id){
  if (PAY.role === "PAYOUT") { PAY.msg = ["err", "확정은 운영이 합니다 — 지급 담당은 확정할 수 없습니다."]; return; }
  const i = PAY.drafts.findIndex(r => r.id === id); if (i < 0) return;
  const r = PAY.drafts.splice(i, 1)[0]; r.ready = true; r.by = "ADMIN"; PAY.queue.push(r);
  PAY.msg = ["ok", e(r.payee) + " " + won(r.amount) + " 을 확정했습니다 — 지급 대기로 넘어갔습니다. 지급 기록은 지급 담당이 합니다."];
};
ADM.paypay = function(id){
  if (PAY.role !== "PAYOUT") { PAY.msg = ["err", "지급은 지급 담당이 합니다."]; return; }
  const i = PAY.queue.findIndex(r => r.id === id); if (i < 0) return;
  const r = PAY.queue[i], ref = String(fv("ref_" + id)).trim();
  if (!r.ready) { PAY.msg = ["err", "지급 불가 — " + e(r.blocker) + "."]; return; }
  if (!ref) { PAY.msg = ["err", "이체 참조(은행 거래번호)를 적어 주십시오."]; return; }
  PAY.queue.splice(i, 1);
  PAY.paid.unshift({ id: r.id, kind: r.kind, payee: r.payee, amount: r.amount, at: today(), ref: ref, by: "지급 담당" });
  delete FV["ref_" + id];
  PAY.msg = ["ok", e(r.payee) + " 에 " + won(r.amount) + " 지급을 기록했습니다 — 되돌릴 수 없습니다."];
};
ADM.payin = function(id){
  if (PAY.role !== "PAYOUT") { PAY.msg = ["err", "입금 기록은 지급 담당이 합니다."]; return; }
  const i = PAY.recv.findIndex(v => v.id === id); if (i < 0) return;
  const v = PAY.recv[i], raw = String(fv("in_" + id, v.unpaid)).trim(), amt = Number(raw);
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) { PAY.msg = ["err", "입금액을 숫자로 적어 주십시오 (1원 이상)."]; return; }
  if (amt > v.unpaid) { PAY.msg = ["err", "입금액이 미수금(" + won(v.unpaid) + ")보다 큽니다."]; return; }
  v.unpaid -= amt; delete FV["in_" + id];
  if (v.unpaid === 0) PAY.recv.splice(i, 1);
  PAY.msg = ["ok", e(v.adv) + " " + won(amt) + " 입금을 기록했습니다" + (v.unpaid ? " — 남은 미수금 " + won(v.unpaid) + "." : " — 미수금이 없어졌습니다.")];
};

/* ══ ③-2 리드 배정 (SB-ADM-PTN-090 · D008 · D018) ════════════════════
   상담 신청은 휴대폰 확인을 마치면 인증업체 1곳에 자동 배정되고, 그 업체가 기한 안에 열지 않으면 배치(lead_assign)가
   10분마다 다른 1곳으로 넘깁니다. 여기서는 자동으로 못 보낸 것을 사람이 처리합니다.
   후보 · 탈락 사유는 서버(fn_lead_candidates)가 냅니다 — 아래는 그 결과를 흉내 낸 시연 자료입니다. */
const LST = { OPEN: "배정 대기", ASSIGNED: "배정 완료", UNMATCHED: "미배정", CLOSED: "종료" };
const DST = { DELIVERED: "받음 · 미열람", VIEWED: "열람(과금)", EXPIRED: "기한 지남", REVOKED: "회수" };
const MODE = { AUTO: "자동", MANUAL: "운영 지정", REASSIGN: "재배정" };
const LFIL = [["QUEUE", "손이 필요한 것"], ["OPEN", "배정 대기"], ["UNMATCHED", "미배정"], ["ASSIGNED", "배정 완료"], ["CLOSED", "종료"], ["ALL", "전체"]];
const cd = (id, co, grade, w, recent, unpaid, cap, why) => ({ id: id, co: co, grade: grade, w: w, recent: recent, unpaid: unpaid, reserved: 0, cap: cap, why: why || [] });
const dv = (id, pid, co, state, mode, at, exp, viewed, end) => ({ id: id, pid: pid, co: co, state: state, mode: mode, at: at, exp: exp || "", viewed: viewed || "", end: end || "" });
const LEAD = {
  filter: "QUEUE", open: null, pick: {}, revoke: {}, msg: null, seq: 10,
  set: { target: 1, max: 3, ttl: 24, age: 72, weights: [["A", 1.5], ["B", 1], ["C", 0.7]] },
  items: [
    { id: "L-1042", cat: "이사 · 청소", area: "서울특별시 강서구", at: "2026-10-02 09:12", st: "UNMATCHED", urgent: true, gated: false,
      summary: "30평 아파트 이사 견적 — 10월 셋째 주 주말 희망", deadline: "2026-10-05 09:12", who: "010-****-1234", why: "",
      dl: [], cands: [cd("c1", "한강이사", "A", 1.5, 6, 0, 300000), cd("c2", "깔끔클린", "B", 1, 2, 330000, 300000, ["미납 한도 초과"]), cd("c3", "새집이사", "C", 0.7, 1, 0, 100000)] },
    { id: "L-1041", cat: "인테리어", area: "경기도 성남시", at: "2026-10-01 10:00", st: "OPEN", urgent: false, gated: false,
      summary: "24평 욕실 · 주방 부분 수리 상담", deadline: "2026-10-04 10:00", who: "010-****-5678", why: "",
      dl: [dv("d1", "c4", "모던하우스", "EXPIRED", "AUTO", "2026-10-01 10:00", "2026-10-02 10:00", "", "기한 안에 열지 않음")],
      cands: [cd("c4", "모던하우스", "B", 1, 4, 0, 300000, ["이미 받은 업체"]), cd("c5", "집닥터 인테리어", "A", 1.5, 3, 0, 500000), cd("c6", "우리집수리", "C", 0.7, 0, 0, 100000)] },
    { id: "L-1039", cat: "세탁 · 수선", area: "인천광역시 연수구", at: "2026-10-01 16:40", st: "ASSIGNED", urgent: false, gated: false,
      summary: "커튼 · 이불 대량 세탁 수거 문의", deadline: "2026-10-04 16:40", who: "010-****-2468", why: "",
      dl: [dv("d2", "c7", "빠른세탁", "DELIVERED", "AUTO", "2026-10-01 16:41", "2026-10-02 16:41")],
      cands: [cd("c7", "빠른세탁", "B", 1, 5, 0, 300000, ["이미 받은 업체"]), cd("c8", "우리동네세탁", "B", 1, 1, 0, 300000)] },
    { id: "L-1035", cat: "보험 상담", area: "서울특별시 마포구", at: "2026-09-30 14:05", st: "ASSIGNED", urgent: false, gated: true,
      summary: "자동차 보험 갱신 비교 상담", deadline: "2026-10-03 14:05", who: "010-****-1357", why: "",
      dl: [dv("d3", "c9", "든든보험대리점", "VIEWED", "AUTO", "2026-09-30 14:06", "2026-10-01 14:06", "2026-09-30 14:22")],
      cands: [cd("c9", "든든보험대리점", "A", 1.5, 8, 0, 500000, ["이미 받은 업체"]), cd("c10", "미래보험서비스", "B", 1, 2, 0, 300000, ["자격 심사 중"])] },
    { id: "L-1030", cat: "휴대폰 · 통신", area: "부산광역시 해운대구", at: "2026-09-29 11:20", st: "CLOSED", urgent: false, gated: false,
      summary: "인터넷 · TV 결합 상담", deadline: "", who: "010-****-9090", why: "중복 신청", dl: [], cands: [] }
  ]
};
const lead = id => LEAD.items.filter(l => l.id === id)[0] || null;
const active = l => l.dl.filter(x => x.state === "DELIVERED" || x.state === "VIEWED").length;
const score = c => Math.round(c.recent / c.w * 100) / 100;
const okCands = l => l.cands.filter(c => !c.why.length).sort((a, b) => score(a) - score(b));
const lcount = st => LEAD.items.filter(l => l.st === st).length;
function send(l, c, mode){
  l.dl.push(dv("d" + (LEAD.seq++), c.id, c.co, "DELIVERED", mode, nowHM(), "", ""));
  c.recent += 1; c.why = ["이미 받은 업체"];
  l.st = active(l) >= LEAD.set.target ? "ASSIGNED" : l.st;
}
function scAdmLeadAsg(){
  const f = LEAD.filter, s = LEAD.set;
  const rows = LEAD.items.filter(l => f === "ALL" || (f === "QUEUE" ? (l.st === "OPEN" || l.st === "UNMATCHED") : l.st === f));
  const nav = window.__ptnNav ? window.__ptnNav("admlasg") : '';
  return admShell("admptn", "리드 배정",
    "자동으로 못 보낸 상담 신청을 처리합니다 — 미배정 · 목표 미달 · 재배정 · 종료. <b>SB-ADM-PTN-090</b>",
    nav +
    note("info", "상담 신청(안심소개 「생활 · 금융 상담」)은 휴대폰 확인을 마치면 <b>인증업체 1곳에 자동 배정</b>되고, 그 업체가 기한 안에 열지 않으면 " +
      "배치가 10분마다 다른 1곳으로 넘깁니다. 여기서는 자동으로 못 보낸 건을 처리합니다.") +
    '<div class="panel px-box" data-lead-settings><p>한 건에 <b>' + s.target + '곳</b>(최대 ' + s.max + '곳) · 받은 업체가 <b>' + s.ttl + '시간</b> 안에 열지 않으면 다른 업체로 · ' +
      '접수 후 ' + s.age + '시간까지 자동으로 채우고, 그때까지 보낼 곳이 없으면 <b>미배정</b>으로 넘어옵니다. ' +
      '순번은 최근 30일 받은 수 ÷ 등급 가중치(' + s.weights.map(w => w[0] + ' ' + w[1]).join(' · ') + ')가 작은 업체부터입니다.</p></div>' +
    '<div class="tabs2" style="margin-top:12px" data-lead-filter="' + f + '">' + LFIL.map(x =>
      '<button class="tb' + (x[0] === f ? ' on' : '') + '" data-px="leadfilter" data-id="' + x[0] + '" aria-pressed="' + (x[0] === f) + '">' + x[1] +
        (x[0] === "OPEN" || x[0] === "UNMATCHED" || x[0] === "ASSIGNED" ? '<i>' + lcount(x[0]) + '</i>' : '') + '</button>').join("") +
      '<button class="bo sm" data-px="leadrun">지금 배정 돌리기</button></div>' +
    flash(LEAD.msg) +
    (rows.length ? rows.map(leadCard).join("") : empty("해당하는 상담 신청이 없습니다.")) +
    note("warn", "<b>배정은 요약만 보냅니다.</b> 이용료는 업체가 연락처를 열람할 때 생기고, 연락처는 열람한 업체에만 풀립니다. " +
      "열람한 배정은 거둘 수 없습니다 — 연락처가 이미 넘어갔습니다."));
}
function leadCard(l){
  const open = LEAD.open === l.id, exp = l.dl.filter(x => x.state === "EXPIRED").length, vw = l.dl.filter(x => x.state === "VIEWED").length;
  return '<div class="px-lead" data-lead="' + l.id + '" data-state="' + l.st + '">' +
    '<b>' + e(l.cat) + '</b> <span class="ls">' + e(l.area) + ' · 접수 ' + l.at + ' · ' + l.id + '</span> ' +
    bg(LST[l.st], l.st === "ASSIGNED" ? "ok" : l.st === "CLOSED" ? "off" : "wait") + (l.urgent ? ' ' + bg("급함", "no") : '') +
    (l.gated ? ' <span class="ls">· 자격 업종</span>' : '') +
    '<p>' + e(l.summary) + '</p>' +
    '<p class="ls">보냄 ' + active(l) + '/' + LEAD.set.target + '곳 · 열람 ' + vw + ' · 기한 지남 ' + exp +
      (l.st !== "CLOSED" ? ' · 지금 보낼 수 있는 업체 ' + okCands(l).length + '곳' : '') +
      (l.deadline ? ' · 자동 배정 기한 ' + l.deadline : '') + ' · 신청 ' + e(l.who) + (l.why ? ' · 종료 사유: ' + e(l.why) : '') + '</p>' +
    (open ? leadPanel(l)
          : '<div class="prfact"><button class="bo sm" data-px="leadopen" data-id="' + l.id + '">후보 · 배정</button></div>') +
  '</div>';
}
function leadPanel(l){
  const closed = l.st === "CLOSED", pk = LEAD.pick[l.id] || {}, rv = LEAD.revoke[l.id] || {};
  const np = Object.keys(pk).length, nr = Object.keys(rv).length;
  const ck = (act, id, sub, on, label) => '<label class="chk2"><input type="checkbox" data-px="' + act + '" data-id="' + id + '" data-sub="' + sub + '"' +
    (on ? ' checked' : '') + ' aria-label="' + e(label) + '"></label>';
  return '<h2 class="st2">배정 현황 ' + l.dl.length + '건</h2>' +
    (l.dl.length ? table(["", "업체", "상태", "방식", "보냄", "열람"], l.dl.map(x => ({ attr: ' data-delivery="' + x.id + '" data-dstate="' + x.state + '"', cells: [
        x.state === "DELIVERED" && !closed ? ck("leadrevoke", l.id, x.id, rv[x.id], x.co + " 거두기") : '',
        '<b>' + e(x.co) + '</b>', DST[x.state] + (x.end ? '<br><span class="ls">' + e(x.end) + '</span>' : ''),
        '<span class="ls">' + MODE[x.mode] + '</span>', '<span class="ls">' + x.at + '</span>', '<span class="ls">' + (x.viewed || '—') + '</span>'] })))
      : empty("아직 보낸 업체가 없습니다.")) +
    '<h2 class="st2">후보 업체 ' + okCands(l).length + ' / ' + l.cands.length + '</h2>' +
    '<p class="ls">이 업종에 서비스를 등록한 업체입니다. 순번 점수가 작을수록 먼저 받습니다. 탈락 사유가 있으면 보낼 수 없습니다.</p>' +
    (l.cands.length ? table(["", "업체", "등급", "최근 30일", "순번 점수", "미납 / 한도", "탈락 사유"], l.cands.map(c => ({ attr: ' data-candidate="' + c.id + '"', cells: [
        !c.why.length && !closed ? ck("leadpick", l.id, c.id, pk[c.id], c.co + " 보내기") : '',
        '<b>' + e(c.co) + '</b>', c.grade + ' <span class="ls">×' + c.w + '</span>', String(c.recent), String(score(c)),
        num(c.unpaid) + ' / ' + num(c.cap) + '원',
        c.why.length ? '<span class="px-bad">' + e(c.why.join(" · ")) + '</span>' : '<span class="st ok">보낼 수 있음</span>'] })))
      : empty("이 업종에 서비스를 등록한 업체가 없습니다 — 파트너 모집이 먼저입니다.")) +
    (closed ? '' : '<div class="px-form" style="margin:10px 0 0"><label><span>사유 (거두기 · 종료에 필요 — 거둔 업체에 그대로 알립니다)</span>' +
      inp("lr_" + l.id, { ph: "예) 업체 연락 두절 · 장난 신청 · 중복 신청", max: 200, label: "사유" }) + '</label></div>') +
    '<div class="prfact" style="margin-top:10px">' +
      (closed ? '' :
        '<button class="bp sm" data-px="leadsend" data-id="' + l.id + '">고른 업체에 보내기' + (np ? ' ' + np : '') + '</button>' +
        '<button class="bo sm" data-px="leadauto" data-id="' + l.id + '">순번대로 빈자리 채우기</button>' +
        '<button class="bo sm" data-px="leadre" data-id="' + l.id + '">고른 배정 거두고 다시 보내기' + (nr ? ' ' + nr : '') + '</button>' +
        '<button class="bo sm" data-px="leadend" data-id="' + l.id + '">신청 종료</button>') +
      '<button class="bo sm" data-px="leadopen" data-id="">닫기</button></div>' +
    (nr ? '<p class="ls">거둘 배정 ' + nr + '건 — 업체를 함께 고르면 그 업체로, 고르지 않으면 순번대로 같은 수만큼 보냅니다.</p>' : '');
}
function tog(map, id, sub){ const m = map[id] = map[id] || {}; if (m[sub]) delete m[sub]; else m[sub] = true; }
function fill(l, n, mode){
  let sent = 0;
  while (sent < n && active(l) < LEAD.set.max) { const c = okCands(l)[0]; if (!c) break; send(l, c, mode); sent++; }
  return sent;
}
ADM.leadfilter = function(id){
  if (LEAD.filter === id && !LEAD.open && !LEAD.msg) { U.toast("이미 「" + LFIL.filter(x => x[0] === id)[0][1] + "」만 보고 있습니다."); return; }
  LEAD.filter = id; LEAD.open = null; LEAD.msg = null;
};
ADM.leadopen = function(id){ LEAD.open = id || null; LEAD.msg = null; };
ADM.leadpick = function(id, t){ tog(LEAD.pick, id, t.getAttribute("data-sub")); };
ADM.leadrevoke = function(id, t){ tog(LEAD.revoke, id, t.getAttribute("data-sub")); };
ADM.leadsend = function(id){
  const l = lead(id), pk = Object.keys(LEAD.pick[id] || {}), nr = Object.keys(LEAD.revoke[id] || {}).length;
  if (nr) { LEAD.msg = ["err", "거둘 배정을 고른 상태입니다 — 「고른 배정 거두고 다시 보내기」를 쓰십시오."]; return; }
  if (!pk.length) { LEAD.msg = ["err", "보낼 업체를 후보에서 골라 주십시오."]; return; }
  if (active(l) + pk.length > LEAD.set.max) { LEAD.msg = ["err", "한 건에 최대 " + LEAD.set.max + "곳까지 보낼 수 있습니다."]; return; }
  const cs = l.cands.filter(c => pk.indexOf(c.id) >= 0 && !c.why.length);
  cs.forEach(c => send(l, c, "MANUAL")); LEAD.pick[id] = {};
  LEAD.msg = ["ok", l.id + " — " + cs.map(c => e(c.co)).join(" · ") + " 에 보냈습니다(요약만). 열람하면 이용료가 생깁니다."];
};
ADM.leadauto = function(id){
  const l = lead(id), need = Math.max(0, LEAD.set.target - active(l));
  if (!need) { LEAD.msg = ["err", l.id + " — 이미 목표(" + LEAD.set.target + "곳)만큼 보냈습니다. 더 보내려면 업체를 직접 고르십시오."]; return; }
  const n = fill(l, need, "AUTO");
  if (!n) { l.st = "UNMATCHED"; LEAD.msg = ["err", l.id + " — 지금 보낼 수 있는 업체가 없습니다. 미배정으로 남습니다."]; return; }
  LEAD.msg = ["ok", l.id + " — 순번대로 " + n + "곳에 보냈습니다."];
};
ADM.leadre = function(id){
  const l = lead(id), rv = Object.keys(LEAD.revoke[id] || {}), pk = Object.keys(LEAD.pick[id] || {}), why = String(fv("lr_" + id)).trim();
  if (!rv.length) { LEAD.msg = ["err", "거둘 배정을 「배정 현황」에서 골라 주십시오 (받음 · 미열람인 것만 거둘 수 있습니다)."]; return; }
  if (!why) { LEAD.msg = ["err", "거두는 사유를 적어 주십시오 — 거둔 업체에 그대로 알립니다."]; return; }
  l.dl.filter(x => rv.indexOf(x.id) >= 0 && x.state === "DELIVERED").forEach(x => { x.state = "REVOKED"; x.end = why; });
  let n = 0;
  if (pk.length) { l.cands.filter(c => pk.indexOf(c.id) >= 0 && !c.why.length).forEach(c => { send(l, c, "REASSIGN"); n++; }); }
  else n = fill(l, rv.length, "REASSIGN");
  if (active(l) < LEAD.set.target) l.st = n ? "OPEN" : "UNMATCHED";
  LEAD.revoke[id] = {}; LEAD.pick[id] = {}; delete FV["lr_" + id];
  LEAD.msg = [n ? "ok" : "err", l.id + " — " + rv.length + "건을 거뒀습니다" + (n ? " · " + n + "곳에 다시 보냈습니다." : " · 다시 보낼 수 있는 업체가 없어 미배정으로 남습니다.")];
};
ADM.leadend = function(id){
  const l = lead(id), why = String(fv("lr_" + id)).trim();
  if (!why) { LEAD.msg = ["err", "종료 사유를 적어 주십시오 — 장난 · 중복 신청 등."]; return; }
  l.dl.filter(x => x.state === "DELIVERED").forEach(x => { x.state = "REVOKED"; x.end = "신청 종료 — " + why; });
  l.st = "CLOSED"; l.why = why; LEAD.pick[id] = {}; LEAD.revoke[id] = {}; delete FV["lr_" + id];
  LEAD.msg = ["ok", l.id + " — 종료했습니다. 아직 안 연 배정은 함께 거뒀습니다."];
};
ADM.leadrun = function(){
  let a = 0, u = 0;
  LEAD.items.filter(l => l.st === "OPEN" || l.st === "UNMATCHED").forEach(l => {
    const need = Math.max(0, LEAD.set.target - active(l));
    if (!need) return;
    if (fill(l, need, "AUTO")) a++; else { l.st = "UNMATCHED"; u++; }
  });
  LEAD.msg = [a ? "ok" : "err", "배정 배치를 돌렸습니다 — " + a + "건 배정" + (u ? " · " + u + "건은 보낼 업체가 없어 미배정" : "") + (a || u ? "." : " · 처리할 건이 없습니다.")];
};

/* ══ 처리기 — data-px 가 붙은 것만 듣습니다 ══════════════════════════ */
function bind(){
  document.addEventListener("click", ev => {
    const t = ev.target.closest && ev.target.closest("[data-px]");
    if (!t) return;
    const k = t.getAttribute("data-px"), id = t.getAttribute("data-id");
    if (t.tagName !== "INPUT") ev.preventDefault();
    keep(); PX.n += 1;
    if (k === "pick") pick(id, t);
    else if (k === "vote") vote(id);
    else if (ADM[k]) ADM[k](id, t);
    else return;
    U.render();
  });
}

const M = (id, url, chip, note) => ({ id: id, url: url, chip: chip, note: note });
const SCREENS = { cmupoll: scCmuPoll, admpoll: scAdmPoll, admpay: scAdmPay, admlasg: scAdmLeadAsg };
const METAS = {
  cmupoll: M("SB-HOM-CMU-040", "sogaebaenk.co.kr/community/polls", "소개광장", "「이건 어때?」 투표 목록 · 참여(서버 D021). 회원 1인 1표 · 비로그인은 기기 1표. 결과는 투표한 뒤에 보이고, 참여 수는 실제 표 수."),
  admpoll: M("SB-ADM-CMU-020", "admin.sogaebaenk.co.kr/community/polls", "운영", "투표 만들기 · 열기 · 마감 · 감추기 · 메인 노출(종류마다 1건). 비로그인 투표 허용 · 하루 한도 설정. 표가 들어온 투표는 보기를 못 바꿈."),
  admpay:  M("SB-ADM-PAY-010", "admin.sogaebaenk.co.kr/payouts", "06 정산", "지급 데스크(10/1 결정 Q1). 확정은 운영, 지급 기록은 지급 담당(2인 원칙). 광고비 미수금 입금 기록. 소개비는 여기 없음."),
  admlasg: M("SB-ADM-PTN-090", "admin.sogaebaenk.co.kr/partners/leads", "10.4 상담 축", "리드 배정(D008 · D018). 자동으로 못 보낸 상담 신청 — 미배정 · 목표 미달 · 재배정 · 종료. 후보 · 탈락 사유는 서버가 냄.")
};
const NAVS = { cmupoll: "이건 어때? 투표", admpoll: "투표 관리", admpay: "지급 데스크", admlasg: "리드 배정" };
const NEW_ROUTES = [
  { re: /^\/community\/polls\/?$/, screen: "cmupoll", title: "이건 어때?", desc: "소개광장 투표" },
  { re: /^\/admin\/community\/polls\/?$/, screen: "admpoll", title: "투표 관리", desc: "만들기 · 열기 · 마감 · 감추기" },
  { re: /^\/admin\/payouts\/?$/, screen: "admpay", title: "지급 데스크", desc: "확정 · 지급 기록 · 입금 기록" },
  { re: /^\/admin\/partners\/leads\/?$/, screen: "admlasg", title: "리드 배정", desc: "미배정 · 재배정 · 종료" }
];
const PATHS = { cmupoll: "/community/polls", admpoll: "/admin/community/polls", admpay: "/admin/payouts", admlasg: "/admin/partners/leads" };

function install(ui, data, router){
  U = ui; D = data;
  if (router && router.ROUTES) {
    /* 앞에 넣습니다 — /community/:id · /admin/partners/:x 정규식에 먼저 잡히면 새 화면으로 못 갑니다 */
    for (let i = NEW_ROUTES.length - 1; i >= 0; i--) router.ROUTES.unshift(NEW_ROUTES[i]);
    if (router.TO_PATH) for (const k in PATHS) router.TO_PATH[k] = PATHS[k];
  }
  bind();
  /* 메인(mxPoll · mxFooter)과 기존 화면(소개광장 목록 · 검수 큐 · 정산 승인 · 사이트 기본 정보)이 부르는 자리 */
  window.__PX = { state: PX, pay: PAY, lead: LEAD, kind: KIND, home: home, total: total, pct: pct, mine: mine, canVote: canVote, result: result,
                  who: who, snsOk: v => SNS_RE.test(v || ""), cmuTabs: cmuTabs, admCmuTabs: admCmuTabs, stlTabs: stlTabs, snsBox: snsBox };
  return { screens: SCREENS, meta: METAS, nav: NAVS };
}
  return { install: install, screenKeys: Object.keys(SCREENS) };
})();


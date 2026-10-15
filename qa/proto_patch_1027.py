"""v10.27 시안 고침 — v10.26 시안에서 v10.27 로 (결함 수정판 · 10/8).

  python3 proto_patch_1027.py                 BASE(v10.26 시안)에서 읽어 OUT 에 씁니다 — 몇 번을 돌려도 같은 결과
  OUT=/path/preview.html python3 …            미리보기(확인 받기 전)는 킷 밖에 씁니다
고치는 곳:
  G-189  구독 결제 — 「이 요금제로」 → 결제 패널(처음 구독 = 전액 · 올리기 · 내리기 = 다음 결제일부터 예약 — 10/8 답 ③) · 「한도 안내」의 「요금제 올리기」도 같은 패널로
         (10/8 「시안부터 그려서 확인」 — 확인 받은 뒤 실제 웹에 반영)
"""
import os, sys
P = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_26.html')
OUT = os.environ.get('OUT', P)
s = open(BASE, encoding='utf-8').read()
def rep(old, new, n=1):
    global s
    c = s.count(old)
    if c != n: sys.exit(f'자리 수가 다릅니다({c} ≠ {n}): {old[:90]!r}')
    s = s.replace(old, new)

# ── G-189 구독 결제 ───────────────────────────────────────────────────────
# ① 요금제 카드의 단추 — 안내 글(data-t) 대신 결제 패널을 엶
rep('''        :'<button class="bp" data-t="요금제 변경은 다음 결제일부터 적용됩니다.">이 요금제로</button>')+
      '</div>').join("")+'</div>'+''',
    '''        :(window.__PS ? window.__PS.planBtn(p) : '<button class="bp" data-t="요금제 변경은 다음 결제일부터 적용됩니다.">이 요금제로</button>'))+
      '</div>').join("")+'</div>'+
    /* v10.27 (G-189) — 결제 패널: 처음 구독 · 올리기 · 내리기(예약) */
    (window.__PS ? window.__PS.panel() : '')+''')
# ② 위쪽 「요금제 변경」 단추 — 아래 요금제로 내려가게
rep('''      '<button class="bo" data-t="요금제 변경은 다음 결제일부터 적용됩니다.">요금제 변경</button></div>'+''',
    '''      (window.__PS ? window.__PS.changeBtn() : '<button class="bo" data-t="요금제 변경은 다음 결제일부터 적용됩니다.">요금제 변경</button>')+'</div>'+''')
# ③ 「한도 안내」의 「요금제 올리기」 — 한 단계 위 요금제로 결제 패널을 열고 구독 화면으로
rep('''    '<div class="btns"><button class="bp" data-t="결제 수단이 등록돼 있어야 합니다.">요금제 올리기</button>'+''',
    '''    '<div class="btns">'+(window.__PS ? window.__PS.upBtn() : '<button class="bp" data-t="결제 수단이 등록돼 있어야 합니다.">요금제 올리기</button>')+''')
# ④ 모듈 — PB(결제 · 환불 상태) 바로 뒤
rep('''/*PB:END*/''', r'''/*PB:END*/
/*PS:BEGIN*/
var M_plan = (function(){
/* ═══════════════════════════════════════════════════════════════════
   v10.27 (2026-10-08) — 구독 결제 (G-189 · SB-MYP-SUB-010 「구독 · 소개코드」)
   ───────────────────────────────────────────────────────────────────
   요금제 카드의 「이 요금제로」를 누르면 아래에 결제 패널이 열립니다.
     · 처음 구독(지금 무료)   → 월 회비 전액을 결제하고 오늘부터 30일
     · 올리기 · 내리기         → 10/8 답 ③ 「3 맞음」: 둘 다 **예약** — 지금 결제 없음 · 다음 결제일부터 새 요금제 ·
                                 그 전까지 지금 요금제 그대로 · 예약 취소 가능.
                                 올리기는 다음 결제일에 등록된 카드로 새 월 회비가 결제되고, **결제가 되어야** 바뀝니다(카드 등록 필요).
                                 (처음 그린 ① 차액 결제안은 버렸습니다)
   결제 수단은 카드 · 계좌이체. 환불 조건(결제 당일 · 열람 전)은 결제 전에 보이고 확인 칸을 체크해야 결제됩니다.
   ★ 시연입니다 — 시험 결제이고 이 브라우저 안에서만 바뀝니다(새로고침하면 처음으로).
     실제 화면은 결제사 키가 없으면 시험 결제 · 키를 넣으면 토스 결제창이 열리고 결제 뒤 이 화면으로 돌아옵니다.
   ═══════════════════════════════════════════════════════════════════ */
let U = null, D = null;
const e = x => U.esc(x);
const won = n => Number(n).toLocaleString("ko-KR") + "원";
const ymd = d => { const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
const PERIOD = 30;
/* 받침이 있으면 「으로」(ㄹ 받침은 「로」) — 「프로로 · 베이직으로 · 스탠다드로」 */
const ro = n => { const c = n.charCodeAt(n.length - 1) - 0xAC00; if (c < 0 || c > 11171) return n + "(으)로"; const j = c % 28; return n + (j === 0 || j === 8 ? "로" : "으로"); };
let PS = null;
function fresh(){
  const t = new Date(), from = new Date(t), next = new Date(t);
  from.setDate(t.getDate() - 19); next.setDate(t.getDate() + 11);     /* 지금 기간: 19일 지남 · 11일 남음 */
  return { n: 0, pick: null, method: "CARD", agree: false, reserve: null, msg: null, from: ymd(from), next: ymd(next), left: 11, demoPlan: null };
}
const plans = () => D.my.plans;
const curCode = () => PS.demoPlan || D.my.sub.plan;
const planOf = c => plans().filter(p => p.code === c)[0] || plans()[0];
function kind(target){
  const cur = planOf(curCode()), to = planOf(target);
  if (!cur.price && to.price) return "NEW";
  if (to.price > cur.price) return "UP";
  return "DOWN";
}
function charge(target){
  const cur = planOf(curCode()), to = planOf(target), k = kind(target);
  if (k === "NEW") return to.price;
  return 0;                      /* ③ — 올리기 · 내리기는 지금 결제 없음(예약) */
}
function flash(){
  const m = PS.msg;
  return m ? '<div class="px-flash' + (m[0] === "ok" ? '' : ' bad') + '" role="' + (m[0] === "ok" ? 'status' : 'alert') + '" data-ps-flash="' + m[0] + '" data-n="' + PS.n + '">' + e(m[1]) + '</div>' : '';
}
function planBtn(p){
  if (PS.reserve === p.code) return '<button class="bo" data-ps="unreserve">예약 취소 (' + e(PS.next) + '부터)</button>';
  const k = kind(p.code);
  const label = k === "NEW" ? "이 요금제로" : "이 요금제로 (다음 결제일부터)";
  return '<button class="bp" data-ps="pick" data-plan="' + e(p.code) + '"' + (PS.pick === p.code ? ' aria-expanded="true"' : '') + '>' + label + '</button>';
}
function changeBtn(){ return '<button class="bo" data-ps="toplans">요금제 변경</button>'; }
function upBtn(){
  const ps = plans(), i = ps.findIndex(p => p.code === curCode()), up = ps[i + 1];
  return up ? '<button class="bp" data-ps="pickup" data-plan="' + e(up.code) + '">요금제 올리기</button>'
            : '<button class="bp" disabled title="가장 높은 요금제를 쓰고 계십니다.">요금제 올리기</button>';
}
function row(k, v){ return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; }
function panel(){
  const top = '<div class="ls" style="margin:10px 0 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<label class="ls" style="display:inline-flex;gap:6px;align-items:center">시연 — 지금 요금제 ' +
    '<select class="inp" style="width:auto" data-ps-demo aria-label="시연용 지금 요금제">' +
    plans().map(p => '<option value="' + e(p.code) + '"' + (curCode() === p.code ? ' selected' : '') + '>' + e(p.name) + (p.price ? '' : ' (무료)') + '</option>').join("") +
    '</select></label>' +
    (PS.reserve ? '<span class="bg wait" data-ps-reserved>예약: ' + e(PS.next) + '부터 ' + e(planOf(PS.reserve).name) + '</span>' : '') + '</div>';
  if (!PS.pick) return top + flash();
  const cur = planOf(curCode()), to = planOf(PS.pick), k = kind(PS.pick), amt = charge(PS.pick);
  const title = k === "NEW" ? to.name + " 구독 시작" : k === "UP" ? ro(to.name) + " 올리기 — 예약" : ro(to.name) + " 내리기 — 예약";
  const how = k === "NEW" ? "오늘부터 " + PERIOD + "일 · 다음 결제일부터 월 " + won(to.price) + " 자동 결제"
    : "<strong>" + e(PS.next) + "(다음 결제일)부터</strong> " + e(to.name) + " · 그 전까지는 " + e(cur.name) + " 그대로";
  const pay = k === "NEW" ? won(amt)
    : '지금 결제 없음' + (to.price ? ' <span class="ls">· ' + e(PS.next) + '에 등록된 카드로 월 ' + won(to.price) + ' 결제</span>' : '');
  const chip = (c, t) => '<button type="button" class="chip' + (PS.method === c ? ' on' : '') + '" data-ps="method" data-m="' + c + '" aria-pressed="' + (PS.method === c) + '">' + t + '</button>';
  return top + '<section class="subnow" data-ps-panel="' + k + '" style="display:block;margin-top:12px">' +
    '<h2 class="s2" style="margin-top:0">' + e(title) + '</h2>' +
    '<table class="tb"><tbody>' +
      row("지금 요금제", e(cur.name) + ' <span class="ls">월 ' + won(cur.price) + (cur.price ? ' · ' + e(PS.from) + ' ~ ' + e(PS.next) + ' · 남은 ' + PS.left + '일' : '') + '</span>') +
      row("바꿀 요금제", e(to.name) + ' <span class="ls">월 ' + won(to.price) + '</span>') +
      row("적용", how) +
      row("이번에 결제할 금액", pay) +
    '</tbody></table>' +
    (amt > 0
      ? '<div style="margin:12px 0 6px"><span class="ls">결제 수단</span><div class="chips" style="margin-top:6px">' + chip("CARD", "카드") + chip("TRANSFER", "계좌이체") + '</div></div>' +
        '<p class="ls" style="margin:4px 0 0">다음 결제일부터는 <a href="#mypay">결제 수단</a>에 등록하신 카드로 자동 결제됩니다.</p>' +
        '<div class="nt warn"><strong>환불은 결제 당일에만 가능합니다.</strong> 결제하시는 순간부터 요청을 열람하실 수 있어, ' +
          '<strong>한 건이라도 열람하시면 당일이어도 환불되지 않습니다</strong> — 열람한 연락처는 되돌릴 수 없기 때문입니다.</div>' +
        '<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:8px 0"><input type="checkbox" data-ps="agree"' + (PS.agree ? ' checked' : '') + '> ' +
          '<span>위 금액 · 자동 결제 · 환불 조건을 확인했습니다 <strong class="warnx">(필수)</strong></span></label>'
      : '<div class="nt info"><strong>지금 결제하는 돈은 없습니다.</strong> ' + e(PS.next) + '부터 ' + e(ro(to.name)) + ' 바뀝니다' + (to.price ? '(월 ' + won(to.price) + ')' : '(무료)') +
          '. 그 전까지 ' + e(cur.name) + '의 혜택이 그대로이고, 예약은 그 전에 취소할 수 있습니다.' +
          (k === "UP" ? ' 그날 등록하신 카드로 새 월 회비가 결제되고, <strong>결제가 되어야</strong> 바뀝니다(결제가 안 되면 지금 요금제의 연체 규칙 그대로). 카드를 먼저 <a href="#mypay">결제 수단</a>에 등록해 주십시오.' : '') +
          (to.price < cur.price ? ' 요금제를 내리면 다음 결제일부터 노출 슬롯이 줄어 넘치는 매물이 내려갑니다.' : '') + '</div>') +
    '<div class="btns" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
      (amt > 0 ? '<button class="bp" data-ps="pay"' + (PS.agree ? '' : ' disabled title="환불 조건 확인 칸을 체크해 주십시오."') + '>' + won(amt) + ' 결제하기</button>'
               : '<button class="bp" data-ps="reserve">' + e(PS.next) + '부터 바꾸기</button>') +
      '<button class="bo" data-ps="close">닫기</button></div>' +
    (amt > 0 ? '<p class="ls" style="margin:8px 0 0">이 시안에서는 <strong>시험 결제</strong>입니다 — 실제 돈은 오가지 않습니다. 실제 화면은 결제사 키를 넣으면 토스 결제창이 열립니다.</p>' : '') +
    flash() + '</section>';
}
const ACT = {
  pick(t){ PS.pick = t.getAttribute("data-plan"); PS.agree = false; PS.msg = null; },
  pickup(t){ PS.pick = t.getAttribute("data-plan"); PS.agree = false; PS.msg = null; U.go("mysub"); },
  toplans(){ PS.msg = null; setTimeout(() => { const el = document.querySelector(".plans"); if (el) el.scrollIntoView({ block: "start" }); }, 30); },
  method(t){ PS.method = t.getAttribute("data-m"); },
  agree(t){ PS.agree = !!t.checked; },
  close(){ PS.pick = null; PS.msg = null; },
  pay(){
    if (!PS.agree) { PS.msg = ["err", "환불 조건 확인 칸을 체크해 주십시오."]; return; }
    const to = planOf(PS.pick), k = kind(PS.pick), amt = charge(PS.pick), t = new Date();
    if (k === "NEW") { PS.from = ymd(t); const n = new Date(t); n.setDate(t.getDate() + PERIOD); PS.next = ymd(n); PS.left = PERIOD; }
    D.my.sub.history.unshift([ymd(t), to.name + " 첫 결제", won(amt), "완료"]);
    PS.demoPlan = to.code; D.my.sub.plan = to.code; PS.reserve = null; PS.pick = null; PS.agree = false;
    PS.msg = ["ok", "결제가 승인되었습니다 (시험 결제 · " + won(amt) + " · " + (PS.method === "CARD" ? "카드" : "계좌이체") + ") — 지금부터 " + to.name + " 요금제입니다."];
  },
  reserve(){ PS.reserve = PS.pick; const to = planOf(PS.pick); PS.pick = null; PS.msg = ["ok", PS.next + "부터 " + ro(to.name) + " 바뀝니다. 그 전까지는 지금 요금제 그대로입니다."]; },
  unreserve(){ PS.reserve = null; PS.msg = ["ok", "예약을 취소했습니다. 지금 요금제가 그대로 이어집니다."]; }
};
function bind(){
  document.addEventListener("click", ev => {
    const t = ev.target.closest && ev.target.closest("[data-ps]");
    if (!t) return;
    const k = t.getAttribute("data-ps");
    if (!ACT[k] || (t.disabled)) return;
    if (k !== "agree") ev.preventDefault();
    PS.n += 1; ACT[k](t); U.render();
  });
  document.addEventListener("change", ev => {
    const t = ev.target;
    if (t && t.hasAttribute && t.hasAttribute("data-ps-demo")) {
      PS.demoPlan = t.value; D.my.sub.plan = t.value; PS.pick = null; PS.reserve = null; PS.agree = false; PS.msg = null; PS.n += 1; U.render();
    }
  });
}
function install(ui, data){
  U = ui; D = data; PS = fresh();
  D.my.sub.from = PS.from; D.my.sub.next = PS.next;               /* G-199 — 지난 날짜 대신 오늘 기준 */
  bind();
  window.__PS = { state: () => PS, panel: panel, planBtn: planBtn, changeBtn: changeBtn, upBtn: upBtn };
}
  return { install: install };
})();
/*PS:END*/''')
rep('''    M_bill.install(View.UI, data);   /*PB:INSTALL*/''',
    '''    M_bill.install(View.UI, data);   /*PB:INSTALL*/
    M_plan.install(View.UI, data);   /*PS:INSTALL*/ /* v10.27 — 구독 결제(G-189) */''')

# v10.27 시안 결함 G-196 ~ G-200 (따로 둔 파일 — 같은 s · rep 를 씀)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proto_patch_1027_fix.py'), encoding='utf-8').read())
# 소개몰 메인 나머지 구역 = 실제 상품 값(10/8 두 번째 답)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proto_patch_1027_shop.py'), encoding='utf-8').read())
# G-116 — 베스트매칭 · 사고예방 · 성공현황의 소개 버튼 3종 삭제(10/8 답)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proto_patch_1027_g116.py'), encoding='utf-8').read())
# G-137 — 견본 그림 14칸(10/8 답 「지금 적용」 · 코드로 그린 그림)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proto_patch_1027_g137.py'), encoding='utf-8').read())
# G-130 — 「상세 · 보기」 단추가 화면을 엶(10/8 답 「22건 모두 만듬」)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proto_patch_1027_g130.py'), encoding='utf-8').read())

open(OUT, 'w', encoding='utf-8').write(s)
print('썼습니다', OUT, len(s))

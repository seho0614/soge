"""시안 v10.14 — 「이건 어때?」 투표 · 사회관계망 주소 · 지급 데스크 · 리드 배정 점검. 파일(file://)로 열어 실제로 누릅니다. 결과: proto_poll.json

  A. 구성          새 화면 4장이 등록됨(화면 키 · 화면 ID · 주소) · 메인 카드가 실제 투표(0표에서 시작)
  B. 투표          고르기 → 투표 → 결과(비율) · 1인 1표 · 비로그인/회원을 따로 셈 · 소개광장 투표 목록과 같은 상태
  C. 투표 관리      비로그인 허용 스위치 · 하루 한도 · 만들기(보기 수 규칙) · 열기 · 마감 · 감추기(사유) · 메인 노출
  D. 사회관계망     운영 화면에서 주소 저장 → 메인 푸터 아이콘이 그 주소로(새 창) · 비우면 「준비 중」
  E. 지급 데스크    확정(운영) · 지급 기록(지급 담당 · 이체 참조) · 지급 불가 · 입금 기록
  F. 리드 배정      거르기 · 후보 · 보내기 · 순번대로 채우기 · 거두고 다시 보내기(사유) · 종료(사유) · 배치 돌리기
  G. 누르는 것 전부  새 화면 4장의 버튼 · 링크를 하나씩 눌러 무반응 0 · 오류 0
  H. 다른 화면은 그대로  v10.13 시안과 화면마다 비교 — 달라져야 할 화면만 달라짐
  I. 390px         가로 넘침 없음

사용:  python3 proto_poll.py          BASE=/path/SGB_Prototype_v10_13.html (비교 기준 · 기본 /mnt/user-data/outputs)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright
from proto_names import names as _names      # v10.25 — 앞 판의 글자에 이름 규칙(소개뱅크몰 → 소개몰 …)을 입혀 견줍니다

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
P = 'file://' + os.environ.get('PROTO', K + '/spec/proto.html')   # v10.31 PROTO
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_13.html')
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:200], file=sys.stderr)

V1018 = ['admbil', 'mysub']      # v10.18 에서 달라진 화면(내 구독 · 결제 · 환불 확인 필요)
V1019 = ['urg']                  # v10.19 에서 달라진 화면(급구 · 급매 — 소개 버튼 3종 삭제)
V1020 = ['detail']               # v10.20 에서 달라진 화면(상세 — 소개 버튼 3종 삭제)
# v10.21 에서 달라진 화면 16장(매물 상세 3 · 문의방 2 · 카드가 있는 목록 7 · 마이 관심 · 소개광장 글 목록 · 프로필 · 창업 등록의 돌아가기 글) — proto_item.py · proto_diff.py 가 따로 봅니다
V1021 = ['detail', 'dtlm', 'dtll', 'ask', 'asklock', 'list', 'listl', 'listb', 'lstm', 'lstl2', 'lstb2', 'urg', 'mylik', 'cmu', 'myacc']      # v10.25 — regb(사업자 등록)는 뺐습니다: 옛 판과의 차이가 옛 관 이름뿐이라, 옛 판에 이름 규칙을 입히면 같습니다
# v10.22 에서 더한 화면 4장(소개창업 축의 상세). 달라진 화면은 listb 한 장(V1021 에 이미 있음). 언어 단추의 클래스 이름(lgb → lngb)은 같은 것으로 보고 견줍니다
V1022_NEW = ['bjob', 'bsvc', 'bpol', 'bedu']
# v10.23 에서 달라진 화면 5장(소개광장 — 제시 디자인). proto_cmu.py · proto_diff.py · proto_pixel.py 가 따로 봅니다
V1023 = ['cmu', 'commu', 'cmud', 'cmuw', 'cmupoll']
# v10.24 — 안심소개 「생활 · 금융 상담」: 새 화면 malcsld(업종 상세) · 달라진 화면 malcsl(줄 단추 · 신청서 주소). malgive 는 내용이 같지만 이 비교가 화면을 순서대로 그리다 보니
#   「돌아가기」에 적히는 앞 화면 이름이 「상담 신청」에서 「상담 업종」(새 화면)으로 바뀌어 함께 달라집니다. proto_fin.py · proto_diff.py · proto_pixel.py 가 따로 봅니다
V1024_NEW = ['malcsld']; V1024 = ['malcsl', 'malgive']
V1026_NEW = ['admhpr']      # v10.26 — 운영 「소개몰 상품」(새 화면)
from v1027_changes import CHANGED as V1027, NEW as V1027_NEW      # v10.27 — 바뀐 29장(G-116 세 화면 포함) · 새 화면 termsv
CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"
txts = lambda pg, sel: pg.eval_on_selector_all(sel, 'e=>e.map(x=>x.textContent.trim())')
scr = lambda pg: pg.evaluate("__VIEW.state.screen")

NOTOAST = "(()=>{const t=document.getElementById('toast'); if(t){t.classList.remove('on'); t.innerHTML=''}})()"
def paint(pg, k):
    pg.evaluate("location.hash=''"); pg.wait_for_timeout(120); pg.evaluate("k=>__VIEW.paint(k)", k); pg.wait_for_timeout(250); pg.evaluate(CLEAN); pg.evaluate(NOTOAST)
def goto(pg, h):
    pg.evaluate("h=>{location.hash=h}", h); pg.wait_for_timeout(400); pg.evaluate(CLEAN)
def click(pg, sel):
    pg.evaluate(CLEAN); pg.click(sel); pg.wait_for_timeout(150); pg.evaluate(CLEAN)
def fill(pg, sel, v):
    pg.fill(sel, v)
flash = lambda pg: pg.evaluate("(()=>{const f=document.querySelector('#screen [data-px-flash]');return f?[f.getAttribute('data-px-flash'),f.textContent.trim()]:null})()")
toast = lambda pg: pg.evaluate("(()=>{const t=document.getElementById('toast');return t&&t.classList.contains('on')?t.textContent.trim():''})()")

GET2 = """(k)=>{location.hash=''; __VIEW.paint(k); document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove());
    let h=document.getElementById('screen').innerHTML;
    h=h.replace(/data-adbox="HERO"[\\s\\S]*?<\\/div><\\/div>/g,'AD').replace(/\\d{1,2}:\\d{2}(:\\d{2})?/g,'T').replace(/SGB_Prototype_v10_[0-9]+\\.html/g,'PROTO').replace(/방문자 키: v-[a-z0-9]+/g,'방문자 키').replace(/class="lngb"/g,'class="lgb"').replace(/class="lngc"/g,'class="lgc"').replace(/data:image\\/[a-z]+;base64,[A-Za-z0-9+\\/=]+/g,'IMG').replace(/<span class="bell"[^>]*>/g,'<span class="bell">').replace(/<a href="#" data-(t="알림 정책\(G-03\)이 확정되면 붙입니다\."|go="myntf")>설정 · 알림/g,'<a>설정 · 알림');;  /* v10.27 — 머리줄 종 · 「설정 · 알림」(G-196) 한 줄만 같게 맞춤 */
    return h}"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    dialogs = []
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    pg.goto(P); pg.wait_for_timeout(1600); pg.evaluate(CLEAN)

    # ── A. 구성 ──
    title = open(os.environ.get('PROTO', K + '/spec/proto.html'), encoding='utf-8').read(3000).split('<title>')[1].split('</title>')[0]
    rec('A-0 파일 제목 v10.14 이후 · 「이건 어때?」 투표 표기', bool(re.search(r'v10\.1[4-9]', title)) and '이건 어때?' in title and '지급 데스크' in title and '리드 배정' in title, title[:90])
    keys = pg.evaluate("Object.keys(__VIEW.screens)")
    NEW = {'cmupoll': ('SB-HOM-CMU-040', '/community/polls', '이건 어때?'), 'admpoll': ('SB-ADM-CMU-020', '/admin/community/polls', '투표 관리'),
           'admpay': ('SB-ADM-PAY-010', '/admin/payouts', '지급 데스크'), 'admlasg': ('SB-ADM-PTN-090', '/admin/partners/leads', '리드 배정')}
    rec('A-1 새 화면 4장 등록 — cmupoll · admpoll · admpay · admlasg', all(k in keys for k in NEW), len(keys))
    meta = pg.evaluate("(()=>{const m=__VIEW.meta();const o={};['cmupoll','admpoll','admpay','admlasg'].forEach(k=>o[k]=m[k]?m[k].id:null);return o})()")
    rec('A-2 화면 ID — SB-HOM-CMU-040 · SB-ADM-CMU-020 · SB-ADM-PAY-010 · SB-ADM-PTN-090', all(meta[k] == NEW[k][0] for k in NEW), meta)
    for k, (sid, path, h1) in NEW.items():
        goto(pg, '#' + path)
        rec(f'A-3 주소 #{path} → {k} · 제목 「{h1}」 · 화면 ID 표기', scr(pg) == k and pg.locator('#screen h1').first.inner_text().strip() == h1 and sid in pg.inner_text('#screen'),
            (scr(pg), pg.locator('#screen h1').first.inner_text()[:20]))
        paint(pg, k)
        rec(f'A-4 화면 키 {k} 로 열어도 같은 화면', scr(pg) == k and pg.locator('#screen h1').first.inner_text().strip() == h1)
    paint(pg, 'main1')
    cards = pg.evaluate("[...document.querySelectorAll('.home-pl')].map(x=>[x.dataset.poll,x.dataset.kind,x.dataset.voted,x.querySelector('h3').textContent.trim()])")
    rec('A-5 메인 「이건 어때?」 3장 = 실제 투표(비교해요 · 궁금해요 · 써본 의견) · 확정한 질문(v10.15)', [c[:3] for c in cards] == [['p1', 'VS', '0'], ['p2', 'ASK', '0'], ['p3', 'USED', '0']]
        and cards[0][3] == '로봇청소기를 산다면, 어느 쪽을 고르시겠어요?' and cards[1][3] == '소개받아 살 때 가장 먼저 보는 것은?'
        and cards[2][3] == '공기청정기를 써 보신 분들의 의견을 들려주세요!', cards)
    rec('A-6 참여 수는 0에서 시작 — 그림의 3,482 · 4,219 · 812 는 쓰지 않음', txts(pg, '.home-plf > span[data-total]') == ['0명 참여'] * 3
        and not re.search(r'3,482|4,219|812명', pg.inner_text('.home-band.poll')), txts(pg, '.home-plf > span[data-total]'))
    rec('A-7 버튼 — 투표하기 · 투표하기 · 의견 남기기 (투표 전에는 비율이 안 보임)', [x.strip() for x in txts(pg, '.home-pl [data-vote]')] == ['투표하기', '투표하기', '의견 남기기']
        and pg.locator('.home-pl li.res').count() == 0 and '%' not in pg.inner_text('.home-polls'))
    rec('A-8 그림이 뜸(카드 4장의 그림 전부)', pg.evaluate("[...document.querySelectorAll('.home-polls img')].every(i=>i.complete&&i.naturalWidth>0)") and pg.locator('.home-polls img').count() == 4)
    click(pg, '.home-band.poll .home-sh a'); pg.wait_for_timeout(300)
    rec('A-9 「전체보기」 → 소개광장 투표 목록(cmupoll)', scr(pg) == 'cmupoll' and pg.evaluate('location.hash') == '#/community/polls', scr(pg))

    # ── B. 투표 (비로그인) ──
    paint(pg, 'main1')
    click(pg, '.home-pl[data-kind=ASK] [data-vote]')
    rec('B-1 고르지 않고 「투표하기」 → 「보기를 먼저 골라 주세요.」 · 표는 그대로 0', pg.inner_text('.home-pl[data-kind=ASK] .home-plmsg') == '보기를 먼저 골라 주세요.'
        and pg.get_attribute('.home-pl[data-kind=ASK]', 'data-voted') == '0')
    click(pg, '.home-pl[data-kind=ASK] [data-opt=p2b]')
    rec('B-2 보기를 누르면 고른 표시(.on) · 안내 문구 사라짐', pg.get_attribute('.home-pl[data-kind=ASK] li.on > button', 'data-opt') == 'p2b'
        and pg.get_attribute('.home-pl[data-kind=ASK] li.on > button', 'aria-checked') == 'true' and pg.locator('.home-pl[data-kind=ASK] .home-plmsg').count() == 0)
    click(pg, '.home-pl[data-kind=ASK] [data-opt=p2b]')
    rec('B-3 같은 보기를 또 누르면 안내(고른 것은 그대로)', '이미 고른 보기' in toast(pg) and pg.locator('.home-pl[data-kind=ASK] li.on').count() == 1, toast(pg))
    click(pg, '.home-pl[data-kind=ASK] [data-opt=p2a]')
    rec('B-4 다른 보기로 바꿔 고르기', pg.get_attribute('.home-pl[data-kind=ASK] li.on > button', 'data-opt') == 'p2a')
    click(pg, '.home-pl[data-kind=ASK] [data-vote]')
    ask = '.home-pl[data-kind=ASK]'
    rec('B-5 「투표하기」 → 투표됨 · 1명 참여 · 「투표했습니다」 · 비율 표시(가격 100%)', pg.get_attribute(ask, 'data-voted') == '1' and pg.inner_text(ask + ' [data-total]') == '1명 참여'
        and pg.inner_text(ask + ' [data-done]') == '투표했습니다' and pg.locator(ask + ' li.res').count() == 5 and txts(pg, ask + ' li em')[0] == '100%'
        and '투표했습니다. 고맙습니다.' in pg.inner_text(ask + ' .home-plmsg'), txts(pg, ask + ' li em'))
    rec('B-6 한 번 넣으면 다시 못 넣음 — 버튼 · 보기 고르기가 사라짐(1인 1표)', pg.locator(ask + ' [data-vote]').count() == 0 and pg.locator(ask + ' button').count() == 0)
    click(pg, '.home-pl[data-kind=VS] [data-opt=p1b]'); click(pg, '.home-pl[data-kind=VS] [data-vote]')
    vs = pg.inner_text('.home-pl[data-kind=VS] .home-vs').replace('\n', ' ')
    rec('B-7 비교해요 — 「가성비 우선」에 투표 → 「0% · 0표」 / 「100% · 1표」', '0% · 0표' in vs and '100% · 1표' in vs and pg.get_attribute('.home-pl[data-kind=VS]', 'data-voted') == '1', vs)
    paint(pg, 'cmupoll')
    st = pg.evaluate("[...document.querySelectorAll('.px-card')].map(x=>[x.dataset.poll,x.dataset.voted,x.querySelector('.px-total').textContent,x.querySelector('.px-state').textContent])")
    rec('B-8 투표 목록 — 메인에서 넣은 표가 그대로(p1 · p2 투표함 · p3 아직) · 마감 1건', st == [['p1', '1', '1명 참여', '진행 중'], ['p2', '1', '1명 참여', '진행 중'], ['p3', '0', '0명 참여', '진행 중'], ['p4', '0', '39명 참여', '마감']], st)
    rec('B-9 마감된 투표 — 결과는 보이고 투표 버튼 없음', pg.inner_text('.px-card[data-poll=p4] [data-done]') == '마감된 투표' and pg.locator('.px-card[data-poll=p4] [data-vote]').count() == 0
        and pg.locator('.px-card[data-poll=p4] li.res').count() == 4 and '36% · 14표' in pg.inner_text('.px-card[data-poll=p4]'))
    rec('B-10 안내 — 로그인 없이 투표 · 「비로그인(이 기기)」으로 보고 있음 · 건수', '로그인 없이 투표하실 수 있습니다' in pg.inner_text('#screen .nt.info')
        and pg.get_attribute('[data-poll-count]', 'data-poll-count') == '4' and '진행 중 3건 · 마감 1건' in pg.inner_text('[data-poll-count]') and '비로그인(이 기기)' in pg.inner_text('[data-poll-count]'))
    click(pg, '.px-card[data-poll=p3] [data-opt=p3b]'); click(pg, '.px-card[data-poll=p3] [data-vote]')
    rec('B-11 목록에서 「의견 남기기」 → 투표됨 · 「33%」가 아니라 실제 비율(100% · 1표)', pg.get_attribute('.px-card[data-poll=p3]', 'data-voted') == '1' and '100% · 1표' in pg.inner_text('.px-card[data-poll=p3]'))
    paint(pg, 'main1')
    rec('B-12 메인에도 반영 — 3장 모두 투표함 · 1명 참여', [pg.get_attribute(f'.home-pl[data-kind={k}]', 'data-voted') for k in ('VS', 'ASK', 'USED')] == ['1', '1', '1']
        and txts(pg, '.home-plf > span[data-total]') == ['1명 참여'] * 3)
    # 회원으로
    click(pg, '.home-hdr [data-auth=in]'); pg.wait_for_timeout(400)
    logged = pg.evaluate("""(()=>{const b=[...document.querySelectorAll('#screen button, #screen a')].find(x=>/^로그인$|로그인하기|시연 로그인/.test(x.textContent.trim())&&!x.closest('header'));if(b){b.click();return b.textContent.trim()}return null})()""")
    pg.wait_for_timeout(700); pg.evaluate(CLEAN)
    if not pg.evaluate("!!document.querySelector('#screen .home-hdr [data-auth=out]')"): paint(pg, 'main2')
    isin = pg.evaluate("!!document.querySelector('#screen .home-hdr [data-auth=out]')")
    rec('B-13 로그인(회원) — 회원은 비로그인 방문자와 따로 셈: 3장 다시 투표 가능 · 참여 수는 그대로 1', isin and [pg.get_attribute(f'.home-pl[data-kind={k}]', 'data-voted') for k in ('VS', 'ASK', 'USED')] == ['0', '0', '0']
        and txts(pg, '.home-plf > span[data-total]') == ['1명 참여'] * 3 and pg.locator('.home-pl [data-vote]').count() == 3, (logged, isin))
    click(pg, '.home-pl[data-kind=VS] [data-opt=p1a]'); click(pg, '.home-pl[data-kind=VS] [data-vote]')
    vs = pg.inner_text('.home-pl[data-kind=VS] .home-vs').replace('\n', ' ')
    rec('B-14 회원이 「흡입력 우선」에 투표 → 2명 참여 · 50% · 1표씩', pg.inner_text('.home-pl[data-kind=VS] [data-total]') == '2명 참여' and vs.count('50% · 1표') == 2, vs)
    paint(pg, 'cmupoll')
    rec('B-15 목록 — 「회원」으로 보고 있음 · p1 만 투표함', '회원' in pg.inner_text('[data-poll-count] b') and
        pg.evaluate("[...document.querySelectorAll('.px-card')].map(x=>x.dataset.voted).join('')") == '1000')
    paint(pg, 'main2'); click(pg, '.home-hdr [data-auth=out]'); pg.wait_for_timeout(700); pg.evaluate(CLEAN); paint(pg, 'main1')
    rec('B-16 로그아웃 → 비로그인 방문자의 표가 그대로(3장 투표함)', [pg.get_attribute(f'.home-pl[data-kind={k}]', 'data-voted') for k in ('VS', 'ASK', 'USED')] == ['1', '1', '1'])

    # ── C. 투표 관리 ──
    paint(pg, 'admcmu')
    rec('C-1 소개광장 검수에 갈래 「글 검수 | 이건 어때? 투표」', txts(pg, '[data-admpoll-tab] button') == ['글 검수', '이건 어때? 투표'])
    click(pg, '[data-admpoll-tab] [data-go=admpoll]'); pg.wait_for_timeout(300)
    rec('C-2 갈래 → 투표 관리 · 운영 메뉴 「소개광장」 켜짐', scr(pg) == 'admpoll' and pg.inner_text('.agnb a.on') == '소개광장', scr(pg))
    rows = pg.evaluate("[...document.querySelectorAll('[data-polls-admin] tbody tr')].map(r=>[r.dataset.poll,r.dataset.state,r.querySelector('[data-total]').textContent])")
    rec('C-3 투표 5건 · 실제 표 수(p1 2표 · p2 1표 · p3 1표 · p4 39표 · p5 0표)', rows == [['p1', 'OPEN', '2'], ['p2', 'OPEN', '1'], ['p3', 'OPEN', '1'], ['p4', 'CLOSED', '39'], ['p5', 'DRAFT', '0']], rows)
    rec('C-4 메인에 나가는 투표 3 / 3 · 「나가는 중」 3건', pg.get_attribute('[data-poll-home]', 'data-poll-home') == '3' and pg.inner_text('[data-polls-admin]').count('나가는 중') == 3)
    # 하루 한도
    fill(pg, '#px-iplimit', '0'); click(pg, '[data-px=iplimit]')
    rec('C-5 하루 한도 0 → 거절(1 ~ 999)', flash(pg) and flash(pg)[0] == 'err' and '1 ~ 999' in flash(pg)[1], flash(pg))
    fill(pg, '#px-iplimit', '3'); click(pg, '[data-px=iplimit]')
    rec('C-6 하루 한도 3 → 저장', flash(pg) == ['ok', '하루 한도를 3표로 저장했습니다.'] and pg.input_value('#px-iplimit') == '3', flash(pg))
    # 만들기
    click(pg, '[data-px=pcreate]')
    rec('C-7 제목 없이 만들기 → 「제목을 4자 이상」', flash(pg)[0] == 'err' and '제목을 4자 이상' in flash(pg)[1], flash(pg))
    fill(pg, '#px-nt', '무선 청소기, 어느 쪽이 나을까요?'); fill(pg, '#px-no', '가 | 가볍다\n나 | 오래 간다\n다 | 조용하다'); click(pg, '[data-px=pcreate]')
    rec('C-8 「비교해요」에 보기 3개 → 거절(정확히 2개) · 적던 내용은 남음', flash(pg)[0] == 'err' and '정확히 2개' in flash(pg)[1] and pg.input_value('#px-nt').startswith('무선 청소기'), flash(pg))
    fill(pg, '#px-no', '가 | 가볍다\n나 | 오래 간다'); pg.uncheck('#px-nh'); click(pg, '[data-px=pcreate]')
    rows = pg.evaluate("[...document.querySelectorAll('[data-polls-admin] tbody tr')].map(r=>[r.dataset.poll,r.dataset.state])")
    rec('C-9 보기 2개로 만들기 → 6건 · 새 투표는 「준비 중」 · 입력칸 비워짐', flash(pg)[0] == 'ok' and rows[-1] == ['p6', 'DRAFT'] and len(rows) == 6 and pg.input_value('#px-nt') == '', (flash(pg), rows[-1]))
    click(pg, 'tr[data-poll=p6] [data-px=popen]')
    rec('C-10 「열기」 → 진행 중', pg.get_attribute('tr[data-poll=p6]', 'data-state') == 'OPEN' and '열었습니다' in flash(pg)[1], flash(pg))
    # 비로그인 허용 스위치
    click(pg, '[data-px=guest]')
    rec('C-11 「로그인 회원만으로 바꾸기」 → 지금: 로그인 회원만', '로그인 회원만 — 1인 1표' in pg.inner_text('[data-poll-rule]') and flash(pg)[1] == '로그인 회원만 투표하게 했습니다.', flash(pg))
    paint(pg, 'cmupoll')
    rec('C-12 투표 목록 안내가 「로그인한 회원만」으로 · 새 투표 p6 이 목록에', '로그인한 회원만 투표할 수 있습니다' in pg.inner_text('#screen .nt.info') and pg.locator('.px-card[data-poll=p6]').count() == 1)
    click(pg, '.px-card[data-poll=p6] [data-opt=p6a]'); click(pg, '.px-card[data-poll=p6] [data-vote]')
    rec('C-13 비로그인이 투표 → 「로그인한 회원만 투표할 수 있습니다.」 + 로그인 링크 · 표 0', '로그인한 회원만 투표할 수 있습니다.' in pg.inner_text('.px-card[data-poll=p6] .px-msg')
        and pg.locator('.px-card[data-poll=p6] .px-msg a[data-go=login]').count() == 1 and pg.inner_text('.px-card[data-poll=p6] .px-total') == '0명 참여')
    paint(pg, 'admpoll'); click(pg, '[data-px=guest]')
    rec('C-14 다시 「비로그인도 가능」으로', '비로그인도 가능' in pg.inner_text('[data-poll-rule]') and flash(pg)[1] == '비로그인 방문자도 투표할 수 있게 했습니다.')
    paint(pg, 'cmupoll'); click(pg, '.px-card[data-poll=p6] [data-opt=p6a]'); click(pg, '.px-card[data-poll=p6] [data-vote]')
    rec('C-15 이제 비로그인 투표가 들어감(p6 1명 참여)', pg.get_attribute('.px-card[data-poll=p6]', 'data-voted') == '1' and pg.inner_text('.px-card[data-poll=p6] .px-total') == '1명 참여')
    # 메인 노출
    paint(pg, 'admpoll'); click(pg, 'tr[data-poll=p1] [data-px=phome]')
    rec('C-16 p1 「메인에서 빼기」 → 메인에 나가는 투표 2 / 3 (p6 은 메인에 안 내기로 만들어 비교해요가 빔)', pg.get_attribute('[data-poll-home]', 'data-poll-home') == '2' and '없음' in pg.inner_text('[data-poll-home]'), flash(pg))
    paint(pg, 'main1')
    soon = '.home-pl[data-kind=VS][data-soon="1"]'
    rec('C-17 메인 비교해요 카드 → 「준비 중」 · 숫자 없음 · 「투표 보러 가기」는 투표 목록으로', pg.locator(soon).count() == 1 and '준비 중' in pg.inner_text(soon) and '명 참여' not in pg.inner_text(soon)
        and pg.get_attribute(soon + ' a.home-vbtn', 'data-go') == 'cmupoll')
    paint(pg, 'admpoll'); click(pg, 'tr[data-poll=p6] [data-px=phome]'); paint(pg, 'main1')
    rec('C-18 p6 을 메인에 내면 그 투표가 비교해요 카드에(1명 참여)', pg.get_attribute('.home-pl[data-kind=VS]', 'data-poll') == 'p6' and pg.inner_text('.home-pl[data-kind=VS] [data-total]') == '1명 참여')
    paint(pg, 'admpoll'); click(pg, 'tr[data-poll=p1] [data-px=phome]'); paint(pg, 'main1')
    rec('C-19 p1 을 다시 내면 순서가 앞선 p1 이 나감(2명 참여 그대로)', pg.get_attribute('.home-pl[data-kind=VS]', 'data-poll') == 'p1' and pg.inner_text('.home-pl[data-kind=VS] [data-total]') == '2명 참여')
    # 마감 · 다시 열기
    paint(pg, 'admpoll'); click(pg, 'tr[data-poll=p2] [data-px=pclose]')
    rec('C-20 p2 「마감」 → 마감 · 결과는 계속 보임 안내', pg.get_attribute('tr[data-poll=p2]', 'data-state') == 'CLOSED' and '마감했습니다' in flash(pg)[1])
    paint(pg, 'cmupoll')
    rec('C-21 목록 — p2 는 「마감」 · 투표 버튼 없음 · 표 수 그대로 · 진행 중 3 · 마감 2', pg.inner_text('.px-card[data-poll=p2] .px-state') == '마감' and pg.locator('.px-card[data-poll=p2] [data-vote]').count() == 0
        and pg.inner_text('.px-card[data-poll=p2] [data-done]') == '투표했습니다' and pg.inner_text('.px-card[data-poll=p2] .px-total') == '1명 참여'
        and '진행 중 3건 · 마감 2건' in pg.inner_text('[data-poll-count]'), pg.inner_text('[data-poll-count]'))
    paint(pg, 'admpoll'); click(pg, 'tr[data-poll=p2] [data-px=popen]')
    rec('C-22 p2 「열기」 → 다시 진행 중 · 표는 그대로 1', pg.get_attribute('tr[data-poll=p2]', 'data-state') == 'OPEN' and pg.inner_text('tr[data-poll=p2] [data-total]') == '1')
    # 감추기
    click(pg, 'tr[data-poll=p4] [data-px=phide]')
    rec('C-23 사유 없이 「감추기」 → 거절(5자 이상)', flash(pg)[0] == 'err' and '5자 이상' in flash(pg)[1] and pg.get_attribute('tr[data-poll=p4]', 'data-state') == 'CLOSED', flash(pg))
    fill(pg, '#px-hide', '오래된 시연 자료'); click(pg, 'tr[data-poll=p4] [data-px=phide]')
    rec('C-24 사유를 적고 감추기 → 감춤 · 사유 표시', pg.get_attribute('tr[data-poll=p4]', 'data-state') == 'HIDDEN' and '감춘 사유: 오래된 시연 자료' in pg.inner_text('tr[data-poll=p4]'))
    paint(pg, 'cmupoll')
    rec('C-25 감춘 투표는 목록에서 빠짐', pg.locator('.px-card[data-poll=p4]').count() == 0 and pg.get_attribute('[data-poll-count]', 'data-poll-count') == '4')
    paint(pg, 'cmu')
    # v10.23 — 갈래가 알약 탭 여섯 개가 됐습니다(제시 디자인): 글 게시판 다섯 + 「이건 어때? 투표」
    rec('C-26 소개광장 글 목록의 알약 탭 — 여섯째가 「이건 어때? 투표」', txts(pg, '.plz-tabs a') == ['전체', '소개 후기', '업종 이야기', '질문', '공지', '이건 어때? 투표'] and txts(pg, '.plz-tabs a[data-polls-tab]') == ['이건 어때? 투표'], txts(pg, '.plz-tabs a'))
    click(pg, '.plz-tabs a[data-polls-tab]'); pg.wait_for_timeout(300)
    rec('C-27 갈래 → 투표 목록', scr(pg) == 'cmupoll')

    # ── D. 사회관계망 ──
    paint(pg, 'main1')
    sns = pg.evaluate("[...document.querySelectorAll('.home-sns [data-sns]')].map(x=>[x.tagName,x.dataset.sns,x.getAttribute('aria-label')])")
    rec('D-1 처음 — 푸터 아이콘 4개 모두 「준비 중」(연결 없음)', [s[:2] for s in sns] == [['BUTTON', 'facebook'], ['BUTTON', 'instagram'], ['BUTTON', 'x'], ['BUTTON', 'youtube']] and all('준비 중' in s[2] for s in sns), sns)
    click(pg, '.home-sns [data-sns=instagram]')
    rec('D-2 누르면 「인스타그램 계정은 준비 중입니다.」', '인스타그램 계정은 준비 중입니다' in toast(pg), toast(pg))
    paint(pg, 'admleg')
    rec('D-3 운영 「사이트 기본 정보」에 사회관계망 주소 상자 · 입력칸 4개', pg.locator('[data-sns-settings]').count() == 1 and pg.locator('[data-sns-settings] input').count() == 4
        and pg.get_attribute('[data-sns-settings]', 'data-sns-settings') == '0')
    fill(pg, '#px-sns_instagram', 'http://instagram.com/sogaebank'); click(pg, '[data-px=snssave]')
    rec('D-4 http:// 주소 → 거절(https:// 만) · 저장 안 됨 · 적던 내용은 남음', flash(pg)[0] == 'err' and 'https://' in flash(pg)[1] and pg.get_attribute('[data-sns-settings]', 'data-sns-settings') == '0'
        and pg.input_value('#px-sns_instagram').startswith('http://'), flash(pg))
    fill(pg, '#px-sns_instagram', 'https://www.instagram.com/sogaebank'); fill(pg, '#px-sns_youtube', 'https://www.youtube.com/@sogaebank'); click(pg, '[data-px=snssave]')
    rec('D-5 https:// 주소 2곳 저장 → 「2곳 연결」', flash(pg)[0] == 'ok' and '2곳' in flash(pg)[1] and pg.get_attribute('[data-sns-settings]', 'data-sns-settings') == '2', flash(pg))
    click(pg, '[data-sns-settings] [data-go=main2]'); pg.wait_for_timeout(400); pg.evaluate(CLEAN)
    if not pg.locator('.home-sns').count(): paint(pg, 'main1')
    sns = pg.evaluate("[...document.querySelectorAll('.home-sns [data-sns]')].map(x=>[x.tagName,x.dataset.sns,x.getAttribute('href'),x.getAttribute('target'),x.getAttribute('rel'),x.className])")
    rec('D-6 메인 푸터 — 인스타그램 · 유튜브는 그 주소로(새 창 · noopener), 나머지 2개는 「준비 중」',
        sns[1] == ['A', 'instagram', 'https://www.instagram.com/sogaebank', '_blank', 'noopener noreferrer', 'home-snsi on']
        and sns[3][:4] == ['A', 'youtube', 'https://www.youtube.com/@sogaebank', '_blank'] and sns[0][0] == 'BUTTON' and sns[2][0] == 'BUTTON', sns)
    paint(pg, 'admleg'); fill(pg, '#px-sns_instagram', ''); fill(pg, '#px-sns_youtube', ''); click(pg, '[data-px=snssave]'); paint(pg, 'main1')
    rec('D-7 주소를 비우고 저장 → 다시 4개 모두 「준비 중」', pg.locator('.home-sns a').count() == 0 and pg.locator('.home-sns button[data-sns]').count() == 4)

    # ── E. 지급 데스크 ──
    paint(pg, 'admstl')
    rec('E-1 정산 승인에 갈래 「정산 승인 | 지급 데스크」', txts(pg, '[data-pay-tab] button') == ['정산 승인', '지급 데스크'])
    click(pg, '[data-pay-tab] [data-go=admpay]'); pg.wait_for_timeout(300)
    kpi = lambda: pg.evaluate("[...document.querySelectorAll('#screen [data-kpi]')].map(x=>x.textContent)")
    rec('E-2 갈래 → 지급 데스크 · 지급 대기 2 · 바로 보낼 수 있음 1 · 확정 전 2 · 미수금 2', scr(pg) == 'admpay' and kpi() == ['2', '1', '2', '2'], kpi())
    rec('E-3 운영으로 볼 때 — 「확정」 버튼 2개 · 지급 입력칸 없음(지급은 지급 담당)', pg.get_attribute('[data-pay-role]', 'data-pay-role') == 'ADMIN' and pg.locator('[data-px=payconfirm]').count() == 2
        and pg.locator('[data-px=paypay]').count() == 0 and pg.inner_text('#screen').count('지급은 지급 담당이 합니다') == 2)
    click(pg, '[data-pay-draft=d1] [data-px=payconfirm]')
    rec('E-4 「확정」 → 지급 대기 3 · 확정 전 1 · 안내', kpi()[:3] == ['3', '2', '1'] and flash(pg)[0] == 'ok' and '확정했습니다' in flash(pg)[1], (kpi(), flash(pg)))
    click(pg, '[data-px=payrole][data-id=PAYOUT]')
    rec('E-5 지급 담당으로 볼 때 — 「지급 기록」 3개 · 「확정」 없음(확정은 운영)', pg.locator('[data-px=paypay]').count() == 3 and pg.locator('[data-px=payconfirm]').count() == 0
        and '확정은 운영이 합니다' in pg.inner_text('[data-pay-draft=d2]'))
    click(pg, '[data-pay-queue=q1] [data-px=paypay]')
    rec('E-6 이체 참조 없이 「지급 기록」 → 거절', flash(pg) == ['err', '이체 참조(은행 거래번호)를 적어 주십시오.'], flash(pg))
    fill(pg, '#px-ref_q2', 'KB-TEST-1'); click(pg, '[data-pay-queue=q2] [data-px=paypay]')
    rec('E-7 계좌 인증이 안 끝난 곳 → 「지급 불가」(적어도 못 보냄)', flash(pg)[0] == 'err' and '지급 불가' in flash(pg)[1] and '1원 인증' in flash(pg)[1] and kpi()[0] == '3', flash(pg))
    fill(pg, '#px-ref_q1', 'KB-20261002-0007'); click(pg, '[data-pay-queue=q1] [data-px=paypay]')
    paid = pg.inner_text('[data-pay-paid] tbody tr:first-child')
    rec('E-8 이체 참조를 적고 지급 기록 → 지급 대기 2 · 최근 지급 맨 위에 기록(참조 · 지급자)', kpi()[0] == '2' and '소개하니' in paid and '184,000원' in paid and 'KB-20261002-0007' in paid and '지급 담당' in paid
        and '되돌릴 수 없습니다' in flash(pg)[1], paid)
    fill(pg, '#px-in_r1', '999999'); click(pg, '[data-pay-recv=r1] [data-px=payin]')
    rec('E-9 미수금보다 큰 입금액 → 거절', flash(pg)[0] == 'err' and '미수금' in flash(pg)[1], flash(pg))
    fill(pg, '#px-in_r1', '100000'); click(pg, '[data-pay-recv=r1] [data-px=payin]')
    rec('E-10 일부 입금 100,000원 → 남은 미수금 230,000원', flash(pg)[0] == 'ok' and '230,000원' in flash(pg)[1] and '230,000원' in pg.inner_text('[data-pay-recv=r1]'), flash(pg))
    click(pg, '[data-pay-recv=r2] [data-px=payin]')
    rec('E-11 전액 입금 → 미수금 목록에서 빠짐(1건 남음)', pg.locator('[data-pay-recv]').count() == 1 and kpi()[3] == '1' and '미수금이 없어졌습니다' in flash(pg)[1], flash(pg))
    click(pg, '[data-px=payrole][data-id=ADMIN]')
    rec('E-12 다시 운영으로 — 입금 · 지급 입력칸이 사라짐', pg.locator('[data-px=payin]').count() == 0 and pg.locator('[data-px=paypay]').count() == 0)

    # ── F. 리드 배정 ──
    paint(pg, 'admptn')
    rec('F-1 파트너사 갈래에 「리드 배정」', '리드 배정' in txts(pg, '#screen .tabs2 button'), txts(pg, '#screen .tabs2 button'))
    click(pg, '#screen .tabs2 [data-go=admlasg]'); pg.wait_for_timeout(300)
    leads = lambda: pg.evaluate("[...document.querySelectorAll('#screen [data-lead]')].map(x=>[x.dataset.lead,x.dataset.state])")
    rec('F-2 갈래 → 리드 배정 · 「손이 필요한 것」 2건(미배정 · 배정 대기) · 갈래 줄 그대로', scr(pg) == 'admlasg' and leads() == [['L-1042', 'UNMATCHED'], ['L-1041', 'OPEN']]
        and pg.inner_text('#screen .tabs2 .tb.on') .startswith('리드 배정'), leads())
    rec('F-3 설정 요약 — 한 건에 1곳 · 24시간 · 등급 가중치', '1곳' in pg.inner_text('[data-lead-settings]') and '24시간' in pg.inner_text('[data-lead-settings]') and 'A 1.5 · B 1 · C 0.7' in pg.inner_text('[data-lead-settings]'))
    click(pg, '[data-lead=L-1042] [data-px=leadopen]')
    cands = pg.evaluate("[...document.querySelectorAll('[data-lead=\"L-1042\"] [data-candidate]')].map(r=>[r.dataset.candidate,!!r.querySelector('input'),r.lastElementChild.textContent.trim()])")
    # v10.31 (W5 D070 · 10/10 결정 「리드 이용료 선불 충전」) — 탈락 사유가 「미납 한도 초과」 → 「잔액 0 — 충전 전까지 받지 않음」
    rec('F-4 「후보 · 배정」 → 후보 3곳(2곳 보낼 수 있음 · 1곳 탈락 사유 = 선불 잔액 0)', cands == [['c1', True, '보낼 수 있음'], ['c2', False, '잔액 0 — 충전 전까지 받지 않음'], ['c3', True, '보낼 수 있음']], cands)
    click(pg, '[data-lead=L-1042] [data-px=leadsend]')
    rec('F-5 고르지 않고 「보내기」 → 거절', flash(pg) == ['err', '보낼 업체를 후보에서 골라 주십시오.'], flash(pg))
    click(pg, '[data-candidate=c3] input')
    rec('F-6 후보 체크 → 「고른 업체에 보내기 1」', pg.is_checked('[data-candidate=c3] input') and '보내기 1' in pg.inner_text('[data-lead=L-1042] [data-px=leadsend]'))
    click(pg, '[data-lead=L-1042] [data-px=leadsend]')
    pg.wait_for_timeout(100)
    rec('F-7 보내기 → 배정 완료 · 「손이 필요한 것」에서 빠짐(1건)', flash(pg)[0] == 'ok' and '새집이사' in flash(pg)[1] and leads() == [['L-1041', 'OPEN']], (flash(pg), leads()))
    click(pg, '[data-px=leadrun]')
    rec('F-8 「지금 배정 돌리기」 → 배정 대기 1건이 순번대로 배정 · 남은 것 없음', flash(pg)[0] == 'ok' and '1건 배정' in flash(pg)[1] and leads() == [] and '해당하는 상담 신청이 없습니다' in pg.inner_text('#screen'), flash(pg))
    click(pg, '[data-px=leadrun]')
    rec('F-9 다시 돌리면 「처리할 건이 없습니다」', flash(pg)[0] == 'err' and '처리할 건이 없습니다' in flash(pg)[1], flash(pg))
    click(pg, '[data-px=leadfilter][data-id=ASSIGNED]')
    rec('F-10 「배정 완료」 4건', [l[0] for l in leads()] == ['L-1042', 'L-1041', 'L-1039', 'L-1035'] and all(l[1] == 'ASSIGNED' for l in leads()), leads())
    click(pg, '[data-lead=L-1041] [data-px=leadopen]')
    dl = pg.evaluate("[...document.querySelectorAll('[data-lead=\"L-1041\"] [data-delivery]')].map(r=>[r.dataset.dstate,r.children[1].textContent,r.children[3].textContent])")
    rec('F-11 L-1041 배정 현황 — 기한 지난 1건 + 순번 점수가 가장 작은 업체(우리집수리)에 자동 배정', dl == [['EXPIRED', '모던하우스', '자동'], ['DELIVERED', '우리집수리', '자동']], dl)
    click(pg, '[data-lead=L-1039] [data-px=leadopen]')
    click(pg, '[data-lead=L-1039] [data-px=leadre]')
    rec('F-12 거둘 배정을 안 고르고 「거두고 다시 보내기」 → 거절', flash(pg)[0] == 'err' and '거둘 배정' in flash(pg)[1], flash(pg))
    click(pg, '[data-lead=L-1039] [data-delivery] input'); click(pg, '[data-lead=L-1039] [data-px=leadre]')
    rec('F-13 사유 없이 → 거절(사유는 거둔 업체에 그대로 알림)', flash(pg)[0] == 'err' and '사유' in flash(pg)[1] and pg.is_checked('[data-lead=L-1039] [data-delivery] input'), flash(pg))
    fill(pg, '#px-lr_L-1039', '업체 연락 두절'); click(pg, '[data-lead=L-1039] [data-px=leadre]')
    dl = pg.evaluate("[...document.querySelectorAll('[data-lead=\"L-1039\"] [data-delivery]')].map(r=>[r.dataset.dstate,r.children[1].textContent,r.children[3].textContent])")
    rec('F-14 사유를 적고 거두기 → 회수(사유 표시) + 다른 업체에 재배정', dl == [['REVOKED', '빠른세탁', '자동'], ['DELIVERED', '우리동네세탁', '재배정']] and '업체 연락 두절' in pg.inner_text('[data-lead=L-1039]')
        and flash(pg)[0] == 'ok', (dl, flash(pg)))
    click(pg, '[data-lead=L-1035] [data-px=leadopen]')
    rec('F-15 열람한 배정은 거둘 수 없음(체크 칸 없음)', pg.locator('[data-lead=L-1035] [data-delivery] input').count() == 0 and '열람(과금)' in pg.inner_text('[data-lead=L-1035]'))
    click(pg, '[data-lead=L-1035] [data-px=leadend]')
    rec('F-16 사유 없이 「신청 종료」 → 거절', flash(pg)[0] == 'err' and '종료 사유' in flash(pg)[1], flash(pg))
    click(pg, '[data-lead=L-1035] [data-px=leadauto]')
    rec('F-17 이미 목표만큼 보낸 건에 「순번대로 빈자리 채우기」 → 안내', flash(pg)[0] == 'err' and '이미 목표' in flash(pg)[1], flash(pg))
    fill(pg, '#px-lr_L-1035', '중복 신청'); click(pg, '[data-lead=L-1035] [data-px=leadend]')
    rec('F-18 사유를 적고 종료 → 「배정 완료」에서 빠짐(3건)', flash(pg)[0] == 'ok' and len(leads()) == 3, (flash(pg), leads()))
    click(pg, '[data-px=leadfilter][data-id=CLOSED]')
    rec('F-19 「종료」 2건 · 종료 사유 표시 · 종료된 건은 보내기 버튼 없음', [l[0] for l in leads()] == ['L-1035', 'L-1030'] and '종료 사유: 중복 신청' in pg.inner_text('[data-lead=L-1035]'), leads())
    click(pg, '[data-lead=L-1035] [data-px=leadopen]')
    rec('F-20 종료된 건의 패널 — 「닫기」만', txts(pg, '[data-lead=L-1035] .prfact button') == ['닫기'], txts(pg, '[data-lead=L-1035] .prfact button'))
    click(pg, '[data-px=leadfilter][data-id=ALL]')
    rec('F-21 「전체」 5건', len(leads()) == 5)

    # ── G. 새 화면 4장 — 누르는 것 전부 ──
    SIG = """()=>{const a=document.getElementById('screen'),t=document.getElementById('toast');
        return [location.hash,__VIEW.state.screen,a.innerHTML.length+':'+a.innerHTML.split('').reduce((v,c,i)=>i%5?v:(v*31+c.charCodeAt(0))|0,0),t?t.innerHTML:'',t?t.className:''].join('|')}"""
    dead = []; total = 0; e0 = len(errs)
    PREP = {'admlasg+': "document.querySelector('#screen [data-px=leadfilter][data-id=ALL]').click(); document.querySelector('#screen [data-lead] [data-px=leadopen]').click()",
            'admpay+': "document.querySelector('#screen [data-px=payrole][data-id=PAYOUT]').click()"}
    for k0 in list(NEW) + ['admlasg+', 'admpay+']:      # + = 패널을 연 리드 배정 · 지급 담당으로 본 지급 데스크
        k = k0.rstrip('+')
        def prep():
            paint(pg, k)
            if k0 in PREP: pg.evaluate(PREP[k0]); pg.wait_for_timeout(120); pg.evaluate(NOTOAST)
        prep()
        n = pg.evaluate("document.querySelectorAll('#screen .wrap a, #screen .wrap button, #screen .wrap input[type=checkbox][data-px]').length")
        for i in range(n):
            prep()
            els = pg.locator('#screen .wrap a, #screen .wrap button, #screen .wrap input[type=checkbox][data-px]')
            if i >= els.count(): break
            el = els.nth(i)
            label = (el.inner_text() or el.get_attribute('aria-label') or '').strip().replace('\n', ' ')[:24]
            href = el.get_attribute('href') or ''
            if href.startswith('http') or href.startswith('tel:'): continue
            before = pg.evaluate(SIG); total += 1
            try:
                el.click(timeout=3000)
            except Exception as ex:
                dead.append((k0, label, 'click ' + str(ex)[:40])); continue
            pg.wait_for_timeout(260)
            if pg.evaluate(SIG) == before: dead.append((k0, label, '무반응'))
            if '실제 동작은 구현 화면' in toast(pg): dead.append((k0, label, '시연 안내만 뜸'))
    rec(f'G-1 새 화면 4장(+ 리드 배정 패널 · 지급 담당 보기)에서 누를 수 있는 {total}개 — 무반응 0 · 「시연 안내만」 0', not dead, dead[:8])
    rec('G-2 누르는 동안 스크립트 오류 0 · 확인창(alert · confirm · prompt) 0', len(errs) == e0 and not dialogs, (errs[e0:e0 + 3], dialogs[:3]))
    paint(pg, 'admlasg'); click(pg, '[data-px=leadfilter][data-id=ALL]')
    click(pg, '#screen [data-px=leadopen]')
    dis = pg.evaluate("document.querySelectorAll('#screen .wrap button:disabled, #screen .wrap input:disabled').length")
    for k in ('cmupoll', 'admpoll', 'admpay'):
        paint(pg, k); dis += pg.evaluate("document.querySelectorAll('#screen .wrap button:disabled, #screen .wrap input:disabled').length")
    rec('G-3 새 화면 4장에 잠긴(비활성) 버튼 0 — 안 되는 것은 눌렀을 때 이유를 알려 줌', dis == 0, dis)

    # ── I. 390px ──
    m = b.new_page(viewport={'width': 390, 'height': 800})
    m.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    m.goto(P); m.wait_for_timeout(1500)
    over = []
    for k in ['main1'] + list(NEW):
        paint(m, k)
        if k == 'admlasg': m.click('#screen [data-px=leadopen]'); m.wait_for_timeout(200)
        w = m.evaluate("[document.documentElement.scrollWidth, innerWidth]")
        if w[0] > w[1] + 1: over.append((k, w))
    rec('I-1 390px — 메인 + 새 화면 4장 가로 넘침 없음', not over, over)
    m.close()

    # ── H. 다른 화면은 그대로 (v10.13 과 비교) ──
    if os.path.exists(BASE):
        old = b.new_page(viewport={'width': 1280, 'height': 900}); new = b.new_page(viewport={'width': 1280, 'height': 900})
        for q in (old, new): q.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        old.goto('file://' + BASE); new.goto(P); old.wait_for_timeout(1500); new.wait_for_timeout(1500)
        k_old = old.evaluate("Object.keys(__VIEW.screens)"); k_new = new.evaluate("Object.keys(__VIEW.screens)")
        added = [k for k in k_new if k not in k_old]
        rec(f'H-1 화면 {len(k_old)}장 → {len(k_new)}장 — 늘어난 것은 v10.14 의 새 화면 4장 · v10.22 의 새 화면 4장 · v10.24 의 새 화면 1장 · v10.26 의 새 화면 1장 · v10.27 의 새 화면 1장(약관 전문)뿐 · 없어진 것 없음', sorted(added) == sorted(list(NEW) + V1022_NEW + V1024_NEW + V1026_NEW + V1027_NEW) and all(k in k_new for k in k_old), added)
        GET = """(k)=>{location.hash=''; __VIEW.paint(k); document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove());
            let h=document.getElementById('screen').innerHTML;
            h=h.replace(/data-adbox="HERO"[\\s\\S]*?<\\/div><\\/div>/g,'AD').replace(/\\d{1,2}:\\d{2}(:\\d{2})?/g,'T').replace(/SGB_Prototype_v10_[0-9]+\\.html/g,'PROTO').replace(/방문자 키: v-[a-z0-9]+/g,'방문자 키').replace(/class="lngb"/g,'class="lgb"').replace(/class="lngc"/g,'class="lgc"').replace(/data:image\\/[a-z]+;base64,[A-Za-z0-9+\\/=]+/g,'IMG').replace(/<span class="bell"[^>]*>/g,'<span class="bell">').replace(/<a href="#" data-(t="알림 정책\(G-03\)이 확정되면 붙입니다\."|go="myntf")>설정 · 알림/g,'<a>설정 · 알림');;  /* v10.27 — 머리줄 종 · 「설정 · 알림」(G-196) 한 줄만 같게 맞춤 */
            return h}"""
        diff = []
        for k in k_old:
            try:
                a = _names(old.evaluate(GET, k)); c = new.evaluate(GET, k)
            except Exception as ex:
                diff.append((k, 'error ' + str(ex)[:60])); continue
            if a != c: diff.append((k, len(a), len(c)))
        changed = sorted(d[0] for d in diff)
        # 달라져야 하는 화면 — 메인 2장(투표 카드 · 푸터), 소개광장 목록 2장(갈래), 검수 · 정산 승인(갈래), 사이트 기본 정보(사회관계망), 파트너사 갈래를 쓰는 화면(「리드 배정」)
        ptn = new.evaluate("""Object.keys(__VIEW.screens).filter(k=>{location.hash='';__VIEW.paint(k);return !!document.querySelector('#screen .tabs2 [data-go=admlasg]') && k!=='admlasg'})""")
        # v10.18 — 「내 구독」(mysub) · 「결제 · 환불 확인 필요」(admbil) 두 장이 더 달라집니다(proto_bill.py 가 따로 봅니다)
        # v10.19 — 「급구 · 급매」(urg) 한 장이 더 달라집니다(proto_urg.py · proto_diff.py 가 따로 봅니다)
        want = sorted(set(['main1', 'main2', 'cmu', 'commu', 'admcmu', 'admstl', 'admleg'] + [k for k in ptn if k not in V1027_NEW] + V1018 + V1019 + V1020 + V1021 + [k for k in V1023 if k in k_old] + [k for k in V1024 if k != 'malgive'] + [k for k in V1027 if k in k_old]))      # v10.27 — 나의공간 메뉴 · 운영 · 가입 · G-116 세 화면 등 29장(v1027_changes.py)      # cmupoll 은 기준 판(v10.13)에 없던 화면이라 견줄 것이 없습니다 · malgive 는 여기서는 그대로입니다(이 비교는 기준 판에 있던 화면만 차례로 그려서, 바로 앞에 새 화면 malcsld 가 끼지 않습니다)
        rec(f'H-2 {len(k_old)}장 가운데 달라진 화면 {len(changed)}장 = 달라져야 하는 화면 {len(want)}장 (메인 2 · 소개광장 2 · 검수 · 정산 승인 · 사이트 기본 정보 · 파트너사 갈래 {len(ptn)} · v10.18 의 2 · v10.19 의 1 · v10.20 의 1 · v10.21 의 15 · v10.23 의 소개광장 4(기준 판에 있던 것) · v10.24 의 1(상담 신청) · v10.27 의 {len([k for k in V1027 if k in k_old])} — 겹치는 것은 한 번)',
            changed == want, {'더 달라짐': [c for c in changed if c not in want], '안 달라짐': [w for w in want if w not in changed]})
        old.close(); new.close()
    else:
        R.append({'step': f'H 비교 기준 파일이 없어 건너뜀 — {BASE}', 'ok': True, 'skip': True, 'detail': ''})
    # v10.15 — 바로 앞 판(v10.14)과도 비교: 투표 질문만 바뀌었으므로 투표가 보이는 4장만 달라야 합니다
    BASE2 = os.environ.get('BASE2', '/mnt/user-data/outputs/SGB_Prototype_v10_14.html')
    if os.path.exists(BASE2):
        old = b.new_page(viewport={'width': 1280, 'height': 900}); new = b.new_page(viewport={'width': 1280, 'height': 900})
        for q in (old, new): q.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        old.goto('file://' + BASE2); new.goto(P); old.wait_for_timeout(1500); new.wait_for_timeout(1500)
        k_old = old.evaluate("Object.keys(__VIEW.screens)"); k_new = new.evaluate("Object.keys(__VIEW.screens)")
        diff = []
        for k in k_new:
            try:
                a = _names(old.evaluate(GET2, k)); c = new.evaluate(GET2, k)
            except Exception as ex:
                diff.append((k, 'error ' + str(ex)[:60])); continue
            if a != c: diff.append((k, len(a), len(c)))
        changed = sorted(d[0] for d in diff)
        rec(f'H-3 v10.14 시안과 비교 — 화면 {len(k_old)}장 + v10.22 의 새 화면 4장 + v10.24 의 새 화면 1장 · 달라진 것은 투표 질문이 보이는 4장(메인 2 · 투표 목록 · 투표 관리)과 v10.18 의 2장(구독 · 청구 현황) · v10.19 의 1장(급구 · 급매) · v10.20 의 1장(상세) · v10.21 의 15장 · v10.22 의 새 4장 · v10.23 의 5장(소개광장) · v10.24 의 3장(상담 업종 — 새 화면 1 포함) · v10.26 의 새 1장(운영 「소개몰 상품」)뿐',
            sorted(k for k in k_new if k not in k_old) == sorted(V1022_NEW + V1024_NEW + V1026_NEW + V1027_NEW) and all(k in k_new for k in k_old) and changed == sorted(set(['admpoll', 'cmupoll', 'main1', 'main2'] + V1018 + V1019 + V1020 + V1021 + V1022_NEW + V1023 + V1024 + V1024_NEW + V1026_NEW + sorted(V1027) + V1027_NEW)), changed)
        old.close(); new.close()
    else:
        R.append({'step': f'H-3 비교 기준 파일이 없어 건너뜀 — {BASE2}', 'ok': True, 'skip': True, 'detail': ''})
    rec('Z 스크립트 오류 0', not errs, errs[:3])
    b.close()

json.dump(R, open(os.path.join(OUT, 'proto_poll.json'), 'w'), ensure_ascii=False, indent=1)
real = [r for r in R if not r.get('skip')]
print(f"통과 {sum(r['ok'] for r in real)} / {len(real)}" + (f" · 건너뜀 {len(R) - len(real)}" if len(R) > len(real) else ''))

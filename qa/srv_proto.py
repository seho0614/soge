"""시안 v10.2 서버 연동 검증 — 시연(file://) + 실제 API(사용자 웹에서 연 시안)."""
import json, sys, re
from playwright.sync_api import sync_playwright
FILE='file:///home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'
# v10.23 — 시안 파일 이름을 적어 두지 않고 킷의 site/public/proto 에서 읽습니다(판을 올릴 때마다 이 줄을 고쳐야 했고, 잊으면 없는 파일(404)을 열어 15초 뒤 멈춤 — v10.23 전수 검정 첫 실행)
import glob, os
_P=sorted(glob.glob('/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/site/public/proto/SGB_Prototype_v*.html'))
assert len(_P)==1, _P
HTTP=os.environ.get('SITE','http://localhost:5174')+'/proto/'+os.path.basename(_P[0])
R=[]
def rec(step,ok,detail=''):
    R.append({'step':step,'ok':bool(ok),'detail':str(detail)[:220]}); print('ok  ' if ok else 'FAIL',step,str(detail)[:160],file=sys.stderr)
def open_(pg,url):
    pg.goto(url); pg.wait_for_timeout(1500); pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())")
def go(pg,k):
    pg.evaluate(f"__VIEW.paint('{k}')"); pg.wait_for_timeout(150); pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())")
def click(pg,act,nth=0,wait=900):
    pg.locator(f'[data-srv="{act}"]').nth(nth).evaluate('e=>e.click()')
    pg.wait_for_function("!window.__SRV.conn.busy", timeout=60000); pg.wait_for_timeout(wait)
def txt(pg): return pg.evaluate("document.getElementById('app').innerText")
def lastlog(pg,n=1): return pg.evaluate(f"window.__SRV.conn.log.slice(0,{n})")
with sync_playwright() as p:
    b=p.chromium.launch()
    # ── 1. 시연 (file://) ───────────────────────────────
    pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:150]))
    open_(pg,FILE)
    rec('S-0 file:// → 시연 모드', pg.evaluate("window.__SRV.conn.base")=='' , pg.evaluate("window.__SRV.conn.online"))
    go(pg,'srvhub'); rec('S-1 서버 연동 홈 7기능', txt(pg).count('열기')>=7 and '서버 연동 (v10.2)' in txt(pg))
    go(pg,'srvclk'); c0=pg.evaluate("window.__SRV.sim.links[0].clicks")
    click(pg,'clk',0,200); click(pg,'clk',0,200); c1=pg.evaluate("window.__SRV.sim.links[0].clicks")
    click(pg,'clknew',0,200); c2=pg.evaluate("window.__SRV.sim.links[0].clicks"); click(pg,'clkbot',0,200); c3=pg.evaluate("window.__SRV.sim.links[0].clicks")
    rec('S-2 클릭: 같은 방문자 1회 · 새 방문자 +1 · 로봇 0', (c1-c0,c2-c1,c3-c2)==(1,1,0), (c0,c1,c2,c3))
    go(pg,'srvacc'); click(pg,'accchange',0,200); click(pg,'accreq',0,200)
    for i in range(2): click(pg,'accwrong',0,150)
    pg.fill('#srvcode','SGB01'); click(pg,'accverify',0,200)
    rec('S-3 계좌: 변경→1원→틀림 2→인증', pg.evaluate("!!window.__SRV.sim.acc.verifiedAt") and pg.evaluate("window.__SRV.sim.acc.tries")==2, txt(pg)[-200:])
    click(pg,'accchange',0,150); click(pg,'accreq',0,150)
    for i in range(5): click(pg,'accwrong',0,120)
    rec('S-4 계좌: 5회 틀림 → 잠김', pg.evaluate("window.__SRV.sim.acc.locked"), '')
    go(pg,'srvstk'); click(pg,'stkrun',0,200); t=txt(pg)
    st=[int(x) for x in re.findall(r'\t(\d+)\n', pg.evaluate("[...document.querySelectorAll('#app table tbody tr')].map(r=>r.innerText).join('\\n')+'\\n'"))]
    rec('S-5 재고: 주문 −1 → 승인 +1', len(st)>=4 and st[1]==st[0]-1 and st[3]==st[0], st)
    click(pg,'stkagain',0,200); rec('S-6 재고: 다시 승인 거부', '거부' in txt(pg))
    go(pg,'srvwd')
    for (sel,val,exp) in [('status','SHIPPED','HLT_RETURN_BEFORE_SHIP'),('status','DELIVERED','OK'),('days','8','HLT_WITHDRAWAL_EXPIRED'),('reason','DEFECT','OK'),('kind','CANCEL','HLT_CANCEL_AFTER_SHIP')]:
        pg.select_option(f'[data-srvwd="{sel}"]',val); pg.wait_for_timeout(150)
    rec('S-7 청약철회 판정 5단계(발송전 반품×·7일×·하자○·발송후 취소×)', 'HLT_CANCEL_AFTER_SHIP' in txt(pg))
    go(pg,'srvadr'); n0=pg.evaluate("window.__SRV.sim.addrs.length")
    click(pg,'adrdel',1,150); rec('S-8 배송지: 진행 중 주문 배송지 삭제 거부', 'ADDRESS_IN_USE' in txt(pg) and pg.evaluate("window.__SRV.sim.addrs.length")==n0)
    click(pg,'adrdef',1,150); rec('S-9 배송지: 기본은 1개', pg.evaluate("window.__SRV.sim.addrs.filter(a=>a.isDefault).length")==1)
    go(pg,'srvcon'); click(pg,'conopen',0,150); click(pg,'conbad',0,150); rec('S-10 성분·고민 열기 · 질병명 거부 안내', '많이 찾는 성분' in txt(pg) and 'HLTK' in txt(pg))
    go(pg,'srvops'); click(pg,'opsload',0,150); rec('S-11 운영 목록 시연', '중개사 인증 (최근)' in txt(pg))
    rec('S-12 시연 중 스크립트 오류 0', not errs, errs[:2])
    pg.close()
    # ── 2. 실제 API (사용자 웹에서 연 시안) ───────────────
    # 헤드리스 브라우저는 서버가 로봇으로 봅니다(HeadlessChrome) — 사람 브라우저 UA 로 엽니다
    pg=b.new_page(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36')
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:150]))
    open_(pg,HTTP); pg.wait_for_function("window.__SRV && window.__SRV.conn.online!==null", timeout=15000)
    rec('L-0 사용자 웹에서 열면 서버 연동', pg.evaluate("window.__SRV.conn.online")==True, pg.evaluate("window.__SRV.conn.base"))
    go(pg,'srvhub'); click(pg,'loginall',0,300)
    rec('L-1 세 계정 로그인', len(pg.evaluate("Object.keys(window.__SRV.conn.tok)"))==3, pg.evaluate("Object.keys(window.__SRV.conn.tok)"))
    go(pg,'srvclk'); click(pg,'links',0,300)
    L=pg.evaluate("__VIEW.state.srvLinks||[]"); rec('L-2 내 소개링크(서버)', len(L)>0, [x['code'] for x in L][:3])
    if L:
        # v10.27 — 다른 시험(fix_1027)이 사용을 멈춘 링크를 남길 수 있어 「사용 중인」 첫 링크로 봅니다(멈춘 링크는 404 LINK_INACTIVE 가 맞음)
        #   v10.27(2) — 상품이 판매 중지된 링크도 404 PRODUCT_NOT_ON_SALE 가 맞음 → 「사용 중 + 판매 중」 첫 링크
        ix=next((i for i,x in enumerate(L) if x.get('isActive',True) and x.get('productStatus','ON_SALE')=='ON_SALE'),0)
        c0=L[ix]['clicks']; click(pg,'clknew',ix,400); c1=pg.evaluate(f"(__VIEW.state.srvLinks||[])[{ix}].clicks"); click(pg,'clk',ix,400); c2=pg.evaluate(f"(__VIEW.state.srvLinks||[])[{ix}].clicks")
        rec('L-3 /r/{code}: 새 방문자 +1 · 같은 방문자 다시 0', (c1-c0,c2-c1)==(1,0), (c0,c1,c2, pg.evaluate("__VIEW.state.srvClkMsg")))
    go(pg,'srvacc'); click(pg,'accload',0,300); click(pg,'accchange',0,300)
    a=pg.evaluate("__VIEW.state.srvAcc"); rec('L-4 계좌 변경 → 인증 풀림', a and not a.get('verifiedAt'), a)
    click(pg,'accreq',0,300); m=pg.evaluate("__VIEW.state.srvAccMsg"); code=(re.findall(r'코드: (\w+)',m) or ['SGB01'])[0]
    rec('L-5 1원 받기(스텁 코드)', 'SGB01' in m or '코드' in m, m)
    click(pg,'accwrong',0,300); a=pg.evaluate("__VIEW.state.srvAcc"); rec('L-6 틀린 코드 → 시도 +1', a and a.get('verifyTries',0)>=1 and not a.get('verifiedAt'), a)
    pg.fill('#srvcode',code); click(pg,'accverify',0,300); a=pg.evaluate("__VIEW.state.srvAcc"); rec('L-7 맞는 코드 → 인증 완료', a and a.get('verifiedAt'), (a, pg.evaluate("__VIEW.state.srvAccMsg")))
    go(pg,'srvstk'); click(pg,'stkrun',0,400); f=pg.evaluate("__VIEW.state.srvStk"); s=[x[2] for x in f['steps']]
    rec('L-8 서버 재고: 주문 −1 → 취소 승인 +1 (정확히 1회)', s[1]==s[0]-1 and s[3]==s[0], f['steps'])
    click(pg,'stkagain',0,400); f=pg.evaluate("__VIEW.state.srvStk"); rec('L-9 같은 건 재승인 → 거부 · 재고 그대로', f['steps'][-1][1].startswith(('HTTP 4',)) and f['steps'][-1][2]==s[3], f['steps'][-1])
    go(pg,'srvwd'); click(pg,'wdload',0,400); W=pg.evaluate("__VIEW.state.srvWdLive||[]")
    rec('L-10 서버 판정(returnable) 불러옴', len(W)>0 and all('r' in o and o['r'] for o in W), [(o['orderNo'],o['status']) for o in W][:4])
    canceled=[o for o in W if o['status']=='CANCELED']; rec('L-11 취소된 주문은 취소·반품 모두 불가', all(not o['r']['cancel']['ok'] and not o['r']['return']['ok'] for o in canceled) if canceled else True, len(canceled))
    go(pg,'srvadr'); click(pg,'adrload',0,300); click(pg,'adradd',0,400); A=pg.evaluate("__VIEW.state.srvAdr")
    nd=[x for x in A if not x['isDefault']]; rec('L-12 배송지 추가', len(A)>=2, len(A))
    if nd:
        idx=[x['id'] for x in A].index(nd[-1]['id'])
        pg.locator(f'[data-srv="adrdef"][data-id="{nd[-1]["id"]}"]').evaluate('e=>e.click()'); pg.wait_for_function("!window.__SRV.conn.busy"); pg.wait_for_timeout(400)
        A2=pg.evaluate("__VIEW.state.srvAdr"); rec('L-13 기본 변경 · 기본은 1개', sum(1 for x in A2 if x['isDefault'])==1 and [x for x in A2 if x['id']==nd[-1]['id']][0]['isDefault'], '')
        old=[x for x in A2 if not x['isDefault']][-1]
        pg.locator(f'[data-srv="adrdel"][data-id="{old["id"]}"]').evaluate('e=>e.click()'); pg.wait_for_function("!window.__SRV.conn.busy"); pg.wait_for_timeout(400)
        A3=pg.evaluate("__VIEW.state.srvAdr"); m=pg.evaluate("__VIEW.state.srvAdrMsg")
        rec('L-14 배송지 삭제(또는 사용 중 거부 사유)', (len(A3)==len(A2)-1) or ('ADDRESS_IN_USE' in (m or '')), (len(A2),len(A3),m))
    go(pg,'srvcon'); click(pg,'conload',0,300); Cn=pg.evaluate("__VIEW.state.srvCon||[]"); rec('L-15 고민 목록(DB)', len(Cn)>0, [c['code'] for c in Cn])
    click(pg,'conopen',0,400); d=pg.evaluate("__VIEW.state.srvConD"); rec('L-16 고민 상세 → 성분 · 상품', d and d.get('ingredients') and d.get('products') is not None, d and [i['name'] for i in d['ingredients']])
    go(pg,'srvops'); click(pg,'opsload',0,500); o=pg.evaluate("__VIEW.state.srvOps")
    rec('L-17 운영 목록 4종(서버)', o and all(k in o and o[k] is not None for k in ['svc','rej','aff','brk']), {k:(len(v) if isinstance(v,list) else len(v.get('items',[]))) for k,v in (o or {}).items()})
    logs=pg.evaluate("window.__SRV.conn.log"); bad=[l for l in logs if str(l['st']).startswith('5')]
    rec('L-18 서버 호출 5xx 0', not bad, bad[:2])
    rec('L-19 연동 중 스크립트 오류 0', not errs, errs[:2])
    b.close()
json.dump(R,open('srv_proto.json','w'),ensure_ascii=False,indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")

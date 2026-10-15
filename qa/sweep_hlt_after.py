import json, sys
from playwright.sync_api import sync_playwright
import os as _os; P='file://'+_os.environ.get('PROTO','/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html')   # v10.31 PROTO
ROUTES={"SB-HLT-HUB-010":"#/","SB-HLT-HUB-020":"#/direct","SB-HLT-CAT-010":"#/c/HLT_FOOD","SB-HLT-CAT-020":"#/search","SB-HLT-CAT-030":"#/ingredients","SB-HLT-CAT-040":"#/i/VITC","SB-HLT-CAT-050":"#/concerns","SB-HLT-CAT-060":"#/w/IMMUNE","SB-HLT-PRD-010":"#/p/p01","SB-HLT-CRT-010":"#/cart","SB-HLT-ORD-010":"#/order","SB-HLT-ORD-020":"#/order/pay","SB-HLT-ORD-030":"#/order/done","SB-HLT-ORD-040":"#/order/fail","SB-HLT-MYO-010":"#/my/orders","SB-HLT-MYO-020":"#/my/orders/H20260908-000041","SB-HLT-MYO-030":"#/my/orders/H20260908-000041/track","SB-HLT-RTN-010":"#/my/returns/new","SB-HLT-RTN-020":"#/my/returns","SB-HLT-ADR-010":"#/my/addresses","SB-HLT-ETC-010":"#/guide"}
SEL="a,button,[data-go],[data-back],[data-tab],[data-cardadd],[data-tbd],input[type=checkbox],input[type=radio],select"
GO="""(h)=>{const b=document.createElement('a');b.setAttribute('data-go',h);b.textContent='x';document.getElementById('hltapp').appendChild(b);b.click();}"""
SIG="""()=>{const x=document.getElementById('hltapp').innerHTML+'|'+document.getElementById('hltmodal').innerHTML;let v=0;for(let i=0;i<x.length;i+=5)v=(v*31+x.charCodeAt(i))|0;
 return [__hltMall.route(), x.length+':'+v, document.getElementById('hlttoast').innerText, document.getElementById('hlttoast').className, location.hash]}"""
N=f"""()=>[...document.querySelectorAll('#hltapp {SEL.replace(',',', #hltapp ')}')].filter(e=>e.offsetParent!==null).length"""
D=f"""(i)=>{{const e=[...document.querySelectorAll('#hltapp {SEL.replace(',',', #hltapp ')}')].filter(e=>e.offsetParent!==null)[i];if(!e)return null;
 return {{tag:e.tagName,text:(e.innerText||e.value||'').trim().replace(/\\s+/g,' ').slice(0,40),href:e.getAttribute('href'),ds:Object.assign({{}},e.dataset),disabled:!!e.disabled}}}}"""
C=f"""(i)=>{{const e=[...document.querySelectorAll('#hltapp {SEL.replace(',',', #hltapp ')}')].filter(e=>e.offsetParent!==null)[i];
 if(e.tagName==='SELECT'){{if(e.options.length>1)e.selectedIndex=(e.selectedIndex+1)%e.options.length;e.dispatchEvent(new Event('change',{{bubbles:true}}));return}} e.click()}}"""
out=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    errs=[]; dl=[]
    pg.on('pageerror',lambda e:errs.append(str(e)[:200])); pg.on('dialog',lambda d:(dl.append(d.message[:80]),d.dismiss()))
    pg.goto(P+'#/health'); pg.wait_for_timeout(1500)
    pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())")
    for sid,h in ROUTES.items():
        def open_():
            if pg.evaluate("!document.getElementById('hltapp')"):
                pg.goto(P+'#/health'); pg.wait_for_timeout(1200)
            if pg.evaluate("location.hash")!='#/health':
                pg.evaluate("location.hash='#/health'"); pg.wait_for_timeout(150)
            pg.evaluate(GO,h); pg.wait_for_timeout(60)
        errs.clear(); open_()
        rec={'id':sid,'route':h,'at':pg.evaluate("__hltMall.route()"),'errors':list(errs),
             'text_len':pg.evaluate("document.getElementById('hltapp').innerText.length"),
             'h1':pg.evaluate("(()=>{const x=document.querySelector('#hltapp h1,#hltapp h2');return x?x.innerText.slice(0,40):''})()"),'clicks':[]}
        n=pg.evaluate(N); rec['n_click']=n
        for i in range(min(n,70)):
            open_(); d=pg.evaluate(D,i)
            if not d: continue
            if d['href'] and d['href'].startswith('http'): rec['clicks'].append({**d,'res':'EXTERNAL'}); continue
            pg.evaluate("(()=>{const t=document.getElementById('hlttoast');if(t)t.innerHTML=''})()")
            s0=pg.evaluate(SIG); k=len(dl); errs.clear()
            try: pg.evaluate(C,i)
            except Exception as ex: rec['clicks'].append({**d,'res':'EXC','msg':str(ex)[:120]}); continue
            pg.wait_for_timeout(300)   # 시연 보장 안내(90ms 뒤)가 부하 중 늦게 뜨는 것을 기다립니다
            try: s1=pg.evaluate(SIG)
            except Exception as ex:
                rec['clicks'].append({**d,'res':'PAGE-LEFT','msg':pg.url[-80:]})
                pg.goto(P+'#/health'); pg.wait_for_timeout(1200); pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"); continue
            if errs: r,m='ERROR',errs[-1]
            elif len(dl)>k: r,m='DIALOG',dl[-1]
            elif s1[4]!=s0[4]: r,m='NAV-OUT',s1[4]
            elif s1[0]!=s0[0]: r,m='NAV',f"{s0[0]}→{s1[0]}"
            elif s1[2]!=s0[2] or s1[3]!=s0[3]: r,m='TOAST',s1[2][:80]
            elif s1[1]!=s0[1]: r,m='DOM',''
            elif d.get('tag') in ('INPUT','SELECT'): r,m='INPUT','입력값 변경'
            elif d.get('disabled'): r,m='DISABLED','비활성(조건 미충족 — 의도)'
            else: r,m='NONE',''
            rec['clicks'].append({**d,'res':r,'msg':m})
        out.append(rec); print(sid,n,rec['at'],file=sys.stderr)
    b.close()
json.dump(out,open('hlt_sweep_after.json','w'),ensure_ascii=False,indent=1)

import json, sys, hashlib, os
WAIT=int(os.environ.get('WAIT','150')); ONLY=[k for k in os.environ.get('KEYS','').split(',') if k]
from playwright.sync_api import sync_playwright
import os as _os; P='file://'+_os.environ.get('PROTO','/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html')   # v10.31 PROTO
SIG = """()=>{const a=document.getElementById('app');const h=document.getElementById('hlthost');
 const t=document.getElementById('toast');
 return [location.hash, (window.__VIEW&&__VIEW.state.screen)||'', (()=>{const x=(a?a.innerHTML:'')+'|'+(h?h.innerHTML:'');let v=0;for(let i=0;i<x.length;i+=7)v=(v*31+x.charCodeAt(i))|0;return x.length+':'+v})(), t?t.innerText:'', t?t.className:'',
   document.querySelectorAll('[role=dialog],.modal.on,.mdl.on,.sheet.on').length]}"""
CLK = """(i)=>{const root=document.getElementById('app');
 const els=[...root.querySelectorAll('a,button,[data-go],[data-t],[data-act],[data-open],[data-tab],[onclick],input[type=checkbox],input[type=radio],select,summary')]
   .filter(e=>e.offsetParent!==null || e.tagName==='SUMMARY');
 return els.length}"""
DESC = """(i)=>{const root=document.getElementById('app');
 const els=[...root.querySelectorAll('a,button,[data-go],[data-t],[data-act],[data-open],[data-tab],[onclick],input[type=checkbox],input[type=radio],select,summary')]
   .filter(e=>e.offsetParent!==null || e.tagName==='SUMMARY');
 const e=els[i]; if(!e) return null;
 const ds=Object.assign({},e.dataset);
 return {tag:e.tagName, text:(e.innerText||e.value||e.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ').slice(0,40),
   href:e.getAttribute('href'), ds, disabled: !!e.disabled}}"""
DO = """(i)=>{const root=document.getElementById('app');
 const els=[...root.querySelectorAll('a,button,[data-go],[data-t],[data-act],[data-open],[data-tab],[onclick],input[type=checkbox],input[type=radio],select,summary')]
   .filter(e=>e.offsetParent!==null || e.tagName==='SUMMARY');
 const e=els[i]; if(e.tagName==='SELECT'){ if(e.options.length>1){e.selectedIndex=(e.selectedIndex+1)%e.options.length;} e.dispatchEvent(new Event('change',{bubbles:true})); return;}
 e.click();}"""
out={'screens':[], 'global_errors':[]}
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(); pg=ctx.new_page()
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    errs=[]; dialogs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
    pg.on('dialog',lambda d:(dialogs.append(d.message[:100]), d.dismiss()))
    pg.goto(P); pg.wait_for_timeout(1500)
    out['boot_errors']=list(errs); errs.clear()
    keys=pg.evaluate("Object.keys(__VIEW.screens)")
    for k in (ONLY or keys):
        rec={'key':k,'clicks':[]}
        errs.clear()
        def paint():
            pg.evaluate("location.hash=''")
            pg.evaluate(f"__VIEW.paint({json.dumps(k)})"); pg.wait_for_timeout(40)
            pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())")
        try: paint()
        except Exception as ex: rec['paint_error']=str(ex)[:200]; out['screens'].append(rec); continue
        rec['paint_errors']=list(errs); errs.clear()
        rec['title']=pg.evaluate("(()=>{const h=document.querySelector('#app h1, #app h2');return h?h.innerText.slice(0,60):''})()")
        rec['text_len']=pg.evaluate("document.getElementById('app').innerText.length")
        rec['screen_after']=pg.evaluate("__VIEW.state.screen")
        n=pg.evaluate(CLK,0); rec['n_click']=n
        for i in range(min(n,200)):   # v10.13 — 새 메인은 누를 것이 101개라 80 에서 올렸습니다
            paint()
            d=pg.evaluate(DESC,i)
            if d is None: continue
            if d['href'] and d['href'].startswith('http'):
                rec['clicks'].append({**d,'res':'EXTERNAL'}); continue
            pg.evaluate("(()=>{const t=document.getElementById('toast');if(t){t.innerHTML='';t.classList.remove('on')}})()")  # 같은 문구가 이어지면 변화로 안 잡힙니다
            s0=pg.evaluate(SIG); dl=len(dialogs)
            try: pg.evaluate(DO,i)
            except Exception as ex: rec['clicks'].append({**d,'res':'EXC','msg':str(ex)[:150]}); continue
            pg.wait_for_timeout(WAIT)
            s1=pg.evaluate(SIG)
            if errs: res='ERROR'; msg=errs[-1]; errs.clear()
            elif len(dialogs)>dl: res='DIALOG'; msg=dialogs[-1]
            elif s1[1]!=s0[1] or s1[0]!=s0[0]: res='NAV'; msg=f"{s0[1]}{s0[0]}→{s1[1]}{s1[0]}"
            elif s1[3]!=s0[3] or s1[4]!=s0[4]: res='TOAST'; msg=s1[3][:80]
            elif s1[2]!=s0[2] or s1[5]!=s0[5]: res='DOM'; msg=''
            elif d['tag'] in ('INPUT','SELECT'): res='INPUT'; msg='입력값 변경(화면 구조 변화 없음 — 정상)'
            elif d.get('disabled'): res='DISABLED'; msg='비활성(조건 미충족 — 의도)'
            else: res='NONE'; msg=''
            # v10.25 점검 보강 — 「반응은 있지만 시연이 안 되는 것」을 가려 둡니다: 없는 주소 화면으로 간 것(nf) · 그때 주소(hash)
            nf=pg.evaluate("(()=>{const a=document.getElementById('app'),h=document.getElementById('hlthost');const mall=!!h && getComputedStyle(h).display!=='none' && h.getClientRects().length>0 && h.innerText.length>50;return !mall && !!a && a.innerText.indexOf('페이지를 찾을 수 없습니다')>=0})()") if res=='NAV' else False
            rec['clicks'].append({**d,'res':res,'msg':msg, **({'nf':True,'hash':s1[0]} if nf else {})})
        out['screens'].append(rec)
        print(k, rec.get('n_click'), 'err' if rec.get('paint_errors') else '', file=sys.stderr)
    # hash routes
    hr=[]
    for h in ['#/', '#/health','#/health/cart','#/health/search','#/c/HLT_FOOD','#/cart','#/concerns','#/direct','#/g/biz','#/g/mal','#/g/mal/urgent','#/g/mny/best','#/g/mny/safety','#/guide','#/gwan/biz','#/gwan/earn','#/gwan/mal','#/gwan/mny','#/i/VITC','#/ingredients','#/l/1','#/listings/new','#/my/addresses','#/my/orders','#/my/orders/H20260908-000041','#/my/orders/H20260908-000041/track','#/my/returns','#/my/returns/new','#/order','#/order/done','#/order/fail','#/order/pay','#/p/p01','#/register','#/request','#/search','#/success','#/w/IMMUNE','#/admin/integration','#/admin/acl','#/admin/gwan-scope','#/admin/invariants','#/ads','#/ads/payouts']:
        errs.clear(); pg.evaluate(f"location.hash={json.dumps(h)}"); pg.wait_for_timeout(250)
        t=pg.evaluate("(document.getElementById('app').innerText.length)+'/'+(document.getElementById('hlthost').innerText.length)")
        hr.append({'hash':h,'screen':pg.evaluate("__VIEW.state.screen"),'len':t,'errors':list(errs),
                   'h1':pg.evaluate("(()=>{const h=document.querySelector('#app h1,#hlthost h1,#app h2,#hlthost h2');return h?h.innerText.slice(0,50):''})()")})
    out['hash_routes']=hr
    b.close()
json.dump(out,open(os.environ.get('OUT','proto_sweep.json'),'w'),ensure_ascii=False,indent=1)

"""사용자 웹 폼 실제 제출 — 화면이 보내는 본문이 서버 계약과 맞는지."""
import os
ROOT = os.environ.get("SGB_ROOT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sgb"))
OUT = os.environ.get("SGB_QA_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
os.makedirs(OUT, exist_ok=True)
DB_URL = os.environ.get("DATABASE_URL", "postgresql://sgb:sgb@localhost:5432/sgb")

import json, sys, subprocess, uuid
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
BASE=os.environ.get('SITE','http://localhost:5174')
DB=DB_URL
q=lambda s: subprocess.run(['psql',DB,'-tAc',s],capture_output=True,text=True).stdout.strip().split('\n')[0]
LIST=q("select l.id from listings l join accounts a on a.id=l.owner_account_id where l.status='PUBLISHED' and a.email<>'person@x.com' order by l.created_at desc limit 1")
CASES=[  # (역할, 경로, 설명)
 ('person','/request/new','소개 요청 등록'),
 ('person',f'/chat/{LIST}','매물 문의(첫 메시지)'),
 ('person','/support/new','1:1 문의'),
 ('person',f'/report/LISTING/{LIST}','신고'),
 ('person','/verify','본인인증(스텁)'),
 ('intro','/partner/services/new','파트너 서비스 등록'),
 ('intro','/register','매물 등록'),
 ('buyer','/biz/register','소개창업 등록 — 개인 회원은 403 이 정상'),
 ('buyer','/terms/agree','약관 동의 — 이미 동의했으면 409'),
 ('buyer','/my/intro/invite','소개 초대 — 요청 ID 직접 입력이라 임의값은 400'),
 ('person','/ai/classify','AI 분류 체험'),
 ('person','/support/dispute','분쟁 접수'),
]
tag=uuid.uuid4().hex[:5]
def fill(pg):
    pg.evaluate("""(tag)=>{
      const set=(el,v)=>{const p=Object.getPrototypeOf(el);const d=Object.getOwnPropertyDescriptor(p,'value');d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
      for(const el of document.querySelectorAll('main input, main textarea, main select, form input, form textarea, form select')){
        if(el.offsetParent===null||el.disabled||el.readOnly) continue;
        const t=(el.type||'').toLowerCase(), n=(el.name||el.id||'').toLowerCase();
        if(el.tagName==='SELECT'){ if(el.options.length>1){el.selectedIndex=1;el.dispatchEvent(new Event('change',{bubbles:true}));} continue;}
        if(t==='checkbox'||t==='radio'){ if(!el.checked) el.click(); continue;}
        if(t==='file'||t==='hidden'||t==='submit') continue;
        if(t==='email'){set(el,'form_'+tag+'@t.local');continue;}
        if(t==='number'||/fee|amount|price|budget/.test(n)){set(el,'300000');continue;}
        if(t==='tel'||/phone|tel/.test(n)){set(el,'01012345678');continue;}
        if(t==='date'){set(el,'2026-10-15');continue;}
        if(/biz|regno|사업자/.test(n)){set(el,String(Date.now()).slice(-10));continue;}
        if(el.tagName==='TEXTAREA'){set(el,'시험 입력입니다. 금천구 사무실 40평 인테리어 관련으로 상세 내용을 적습니다. 연락은 플랫폼 안에서 부탁드립니다. '+tag);continue;}
        set(el,'시험 '+tag+' 입력값');
      }}""", tag)
out=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    ctxs={}
    for role,path,desc in CASES:
        if role not in ctxs:
            c=b.new_context(); pg=c.new_page()
            __import__('consent_ok').agree(f'{role}@x.com','sgb-dev-1234')   # v10.29 — 필수 약관 재동의(v10.28) 전이면 화면이 동의 칸을 먼저 띄워 폼 대신 동의를 보냄 — 먼저 동의
            pg.goto(BASE+'/login'); pg.fill('input[name=email]',f'{role}@x.com'); pg.fill('input[name=password]','sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(1500)
            ctxs[role]=c
        pg=ctxs[role].new_page(); calls=[]; errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)[:120]))
        def onr(r,calls=calls):
            if '/api/' in r.url and r.request.method!='GET':
                try: body=r.text()[:160]
                except Exception: body=''
                calls.append(f"{r.status} {r.request.method} {urlparse(r.url).path} {body}")
        pg.on('response',onr)
        pg.goto(BASE+path,wait_until='networkidle'); fill(pg)
        btn=pg.locator('main form button:not([disabled]), form button[type=submit]:not([disabled]), main button.cta-primary:not([disabled]), main button.btn-primary:not([disabled]), main button.pt-bp:not([disabled]), main button.my-bp:not([disabled]), main button.bok:not([disabled])').last   # v10.29 — 시안 단추 클래스(.pt-bp 파트너센터 · .my-bp 나의공간) · v10.32 — 등록 폼(시안 scReg) 「등록완료」 .bok(type=button, form 밖)
        clicked=False
        if btn.count():
            try: btn.click(timeout=4000); clicked=True
            except Exception as ex: errs.append('click:'+str(ex)[:80])
        pg.wait_for_timeout(2500)
        msg=pg.evaluate("[...document.querySelectorAll('[role=alert], .err, .error, .form-error, .notice.err')].map(e=>e.innerText.slice(0,120)).join(' | ')")
        rec={'role':role,'path':path,'desc':desc,'clicked':clicked,'final':urlparse(pg.url).path,'calls':calls,'errors':errs,'msg':msg}
        out.append(rec); print(json.dumps(rec,ensure_ascii=False)[:400],file=sys.stderr)
        pg.close()
    b.close()
json.dump(out,open(os.path.join(OUT,'forms.json'),'w'),ensure_ascii=False,indent=1)

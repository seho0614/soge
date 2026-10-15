"""응답 표본 수집 — 응답 스키마가 없는 API 를 실제로 불러 응답 모양을 남깁니다 (개발 DB)."""
import os
ROOT = os.environ.get("SGB_ROOT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sgb"))
DB_URL = os.environ.get("DATABASE_URL", "postgresql://sgb:sgb@localhost:5432/sgb")

import json, urllib.request, subprocess, re, uuid
B=os.environ.get('API','http://localhost:3000')
q=lambda s: subprocess.run(['psql',DB_URL,'-tAc',s],capture_output=True,text=True).stdout.strip().split('\n')[0]
def login(e,pw='sgb-dev-1234'):
    r=urllib.request.Request(B+'/api/v1/auth/login',data=json.dumps({'email':e,'password':pw}).encode(),headers={'content-type':'application/json'})
    return json.load(urllib.request.urlopen(r))['accessToken']
T={'admin':login('admin@x.com'),'intro':login('intro@x.com'),'person':login('person@x.com')}
API=json.load(open(f'{ROOT}/docs/06_openapi.json')); S=API['components']['schemas']
def gen(schema):
    if '$ref' in schema: return gen(S[schema['$ref'].split('/')[-1]])
    t=schema.get('type')
    if 'example' in schema: return schema['example']
    if schema.get('enum'): return schema['enum'][0]
    if t=='object' or 'properties' in schema:
        req=set(schema.get('required',[]))
        return {k:gen(v) for k,v in schema.get('properties',{}).items() if k in req}
    if t=='array': return [gen(schema.get('items',{'type':'string'}))]
    if t in ('integer','number'): return 1
    if t=='boolean': return True
    fmt=schema.get('format')
    if fmt=='uuid': return q("select id from categories limit 1")
    return '표본 수집용 입력 '+uuid.uuid4().hex[:4]
todo=[]
for p,v in API['paths'].items():
    for m,o in v.items():
        if o.get('x-status')=='IMPLEMENTED' and not any(r.get('content') for r in o['responses'].values()):
            todo.append((m,p,o))
# 경로 id
POST_ID=None
LIST_ID=q("select l.id from listings l join accounts a on a.id=l.owner_account_id where a.email='intro@x.com' order by l.created_at desc limit 1")
def pid(p):
    if '/community/posts/' in p: return q("select id from posts order by created_at desc limit 1")
    if '/listings/' in p: return LIST_ID
    if '/ownership/' in p: return q("select id from listing_ownership_checks order by created_at desc limit 1") or q("select id from listings limit 1")
    if '/applications/' in p: return q("select id from affiliate_applications limit 1") or str(uuid.uuid4())
    if '/products/' in p: return q("select id from affiliate_products limit 1") or str(uuid.uuid4())
    if '/materials/' in p: return q("select id from affiliate_materials limit 1") or str(uuid.uuid4())
    if '/exemptions/' in p: return q("select id from risk_exemptions where revoked_at is null order by created_at desc limit 1") or str(uuid.uuid4())
    return str(uuid.uuid4())
prev={}
import os
if os.path.exists(f'{ROOT}/spec/response_samples.json'): prev=json.load(open(f'{ROOT}/spec/response_samples.json'))
samples=dict(prev); report=[]
PROD=q("select id from affiliate_products order by created_at desc limit 1")
OVR={
 'post /api/v1/community/classify': {'title':'소개비 세금계산서 질문','body':'소개비를 받으면 세금계산서를 누가 발행하나요'},
 'post /api/v1/me/community/posts': {'board':'QNA','title':'표본 수집 — 소개비 세금계산서는 누가 끊나요','body':'소개비를 받으면 세금계산서를 누가 발행하는지 궁금합니다. 사업소득인가요?'},
 'post /api/v1/partner/affiliate/links': {'productId':PROD,'label':'블로그'},
 'post /api/v1/partner/affiliate/settlement-account': {'bankCode':'004','bankName':'국민은행','accountNo':'123-456-789012','holderName':'김시험'},
 'post /api/v1/admin/affiliates/goals': {'periodYm':'2026-10','target':3000000,'reward':300000},
 'post /api/v1/search/prompt': {'q':'10평 이내 상가 급매 있어?'},
}
# 순서: 만들기 → 읽기 → 바꾸기 → 지우기
order={'post':0,'get':1,'patch':2,'delete':3}
todo=[t for t in todo if f'{t[0]} {t[1]}' not in prev]
for m,p,o in sorted(todo,key=lambda x:(order.get(x[0],9), 0 if x[1].endswith('/me/community/posts') else 1)):
    who='admin' if '/admin/' in p else ('intro' if '/partner/' in p or '/listings/' in p else 'person')
    url=re.sub(r'\{[^}]+\}',lambda _:pid(p),p)
    body=None
    rb=o.get('requestBody',{}).get('content',{}).get('application/json',{}).get('schema')
    if rb: body=gen(rb)
    if f'{m} {p}' in OVR: body=OVR[f'{m} {p}']
    req=urllib.request.Request(B+url,method=m.upper(),data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('post','patch') else None),
        headers={'content-type':'application/json','authorization':'Bearer '+T[who],'Idempotency-Key':uuid.uuid4().hex})
    try:
        r=urllib.request.urlopen(req,timeout=30); st=r.status; raw=r.read()
    except urllib.error.HTTPError as e: st=e.code; raw=e.read()
    try: js=json.loads(raw) if raw else None
    except Exception: js=None
    if 200<=st<300 and js is not None: samples[f'{m} {p}']=js
    report.append((st,m.upper(),p,json.dumps(js,ensure_ascii=False)[:100] if js is not None else ''))
json.dump(samples,open(f'{ROOT}/spec/response_samples.json','w'),ensure_ascii=False,indent=1)
for r in report: print(*r)
print('표본', len(samples), '/', len(todo))

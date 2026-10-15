"""모든 GET 핸들러를 역할별로 불러 5xx·예상 밖 4xx 를 찾습니다."""
import json, urllib.request, urllib.parse, subprocess
B='http://localhost:3000'
DB='postgresql://sgb:sgb@localhost:5432/sgb'
q=lambda s: subprocess.run(['psql',DB,'-tAc',s],capture_output=True,text=True).stdout.strip().split('\n')[0]
def login(e):
    r=urllib.request.Request(B+'/api/v1/auth/login',data=json.dumps({'email':e,'password':'sgb-dev-1234'}).encode(),headers={'content-type':'application/json'})
    return json.load(urllib.request.urlopen(r))['accessToken']
T={'admin':login('admin@x.com'),'intro':login('intro@x.com'),'buyer':login('buyer@x.com'),'person':login('person@x.com')}
m=json.load(open('/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/docs/matrix/matrix.json'))
IDS={'listing':q("select id from listings where status='PUBLISHED' limit 1"),'request':q("select id from requests limit 1"),
 'deal':q("select id from deals limit 1"),'conv':q("select id from conversations limit 1"),'svc':q("select id from partner_services limit 1"),
 'account':q("select id from accounts where email='buyer@x.com'"),'business':q("select id from businesses limit 1"),
 'category':q("select id from categories limit 1"),'partner':q("select id from partners limit 1"),'post':q("select id from posts where state='PUBLISHED' limit 1"),
 'event':q("select id from events limit 1") }
def fillp(path):
    segs=path.split('/'); out=[]
    for i,sg in enumerate(segs):
        if sg.startswith(':'):
            prev=segs[i-1] if i>0 else ''
            name=sg[1:]
            v={'code':'MNY','gwanCode':'MNY','key':'manual_fee_threshold','version':'1'}.get(name)
            if name=='code' and prev in ('categories','directory') and '/consult/' in path: v='CSL_LEGAL' if prev=='directory' else 'CSL_CLEANING'      # v10.24 — 상담 업종의 코드(전에는 관 코드 MNY 를 넣어 두 길 모두 404 만 받았습니다)
            if not v:
                v = IDS['listing'] if 'listing' in prev else IDS['request'] if 'request' in prev else IDS['deal'] if 'deal' in prev \
                    else IDS['conv'] if 'conversation' in prev or 'chat' in prev else IDS['svc'] if 'service' in prev \
                    else IDS['account'] if prev in ('users','accounts','members') else IDS['partner'] if 'partner' in prev \
                    else IDS['post'] if 'post' in prev else IDS['category'] if 'categor' in prev else IDS['business'] if 'business' in prev \
                    else IDS['event'] if 'event' in prev else '00000000-0000-4000-a000-000000000000'
            out.append(v or '00000000-0000-4000-a000-000000000000')
        else: out.append(sg)
    return '/'.join(out)
res=[]
for h in m['backend']:
    if h['method']!='GET': continue
    path=fillp(h['full'] if h['full'].startswith('/') else '/'+h['full'])
    roles=h['roles']
    who='admin' if any(r in roles for r in ['ADMIN','SUPER','REVIEWER','PAYOUT']) and not any(r in roles for r in ['MEMBER','BIZ_OWNER']) else ('intro' if roles and roles!='PUBLIC' else None)
    req=urllib.request.Request(B+path,headers={'authorization':'Bearer '+T[who]} if who else {})
    try:
        r=urllib.request.urlopen(req,timeout=30); st=r.status; body=r.read()[:200].decode('utf8','ignore')
    except urllib.error.HTTPError as e: st=e.code; body=e.read()[:200].decode('utf8','ignore')
    except Exception as e: st=-1; body=str(e)[:100]
    res.append({'path':h['path'],'called':path,'who':who,'status':st,'body':body,'controller':h['controller']+'.'+h['handler']})
json.dump(res,open('api_smoke.json','w'),ensure_ascii=False,indent=1)
import collections
print(collections.Counter(r['status'] for r in res))
for r in res:
    if r['status']>=500 or r['status']<0 or r['status'] in (401,): print(r['status'],r['who'],r['called'],r['controller'],r['body'][:120])

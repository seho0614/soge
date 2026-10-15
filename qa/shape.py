import os
ROOT = os.environ.get("SGB_ROOT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sgb"))
OUT = os.environ.get("SGB_QA_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
os.makedirs(OUT, exist_ok=True)
DB_URL = os.environ.get("DATABASE_URL", "postgresql://sgb:sgb@localhost:5432/sgb")
import re, json, os, subprocess, urllib.request

B=os.environ.get('API','http://localhost:3000')+'/api/v1'
tok={}
def login(e):
    r=urllib.request.Request(B+'/auth/login',data=json.dumps({'email':e,'password':'sgb-dev-1234'}).encode(),headers={'content-type':'application/json'})
    return json.load(urllib.request.urlopen(r))['accessToken']
for k,e in [('admin','admin@x.com'),('intro','intro@x.com'),('buyer','buyer@x.com')]: tok[k]=login(e)
RE=re.compile(r"(apiGetPersonal|apiGet|useApi|api)\s*<\s*([^>(]*(?:<[^>]*>)?[^>(]*)>\s*\(\s*([`'\"])([^`'\"]+)\3([^\n]{0,120})")
res=[]
for base in ['site/src','web/src']:
    for dp,_,fs in os.walk(os.path.join(ROOT,base)):
        for f in fs:
            if not f.endswith(('.ts','.tsx')): continue
            p=os.path.join(dp,f); s=open(p,encoding='utf-8').read()
            for m in RE.finditer(s):
                fn,T,_,path,tail=m.groups()
                if 'method' in tail and 'GET' not in tail: continue
                if '${' in path: continue
                arr=T.strip().endswith('[]') or T.strip().startswith('Array<')
                role='admin' if path.startswith('/admin') else ('intro' if path.startswith(('/partner','/me','/my')) else None)
                url=B+path
                req=urllib.request.Request(url,headers={'authorization':'Bearer '+tok[role]} if role else {})
                try:
                    body=json.load(urllib.request.urlopen(req,timeout=20)); st=200
                except urllib.error.HTTPError as e:
                    st=e.code; body=None
                except Exception as e: st=-1; body=None
                union = '|' in T   # 두 모양을 모두 받는 화면
                ok = body is None or union or (isinstance(body,list)==arr) 
                shape=('array' if isinstance(body,list) else ('object:'+','.join(list(body.keys())[:4]) if isinstance(body,dict) else type(body).__name__))
                res.append({'file':p.replace(ROOT+'/',''),'path':path,'T':T.strip(),'expects_array':arr,'status':st,'shape':shape,'ok':ok})
json.dump(res,open(os.path.join(OUT,'shape.json'),'w'),ensure_ascii=False,indent=1)
bad=[r for r in res if not r['ok']]
print('checked',len(res),'mismatch',len(bad),'http>=400',sum(1 for r in res if r['status']>=400))
for r in bad: print('MISMATCH',r['file'],r['path'],r['T'],'→',r['shape'])
for r in res:
    if r['status']>=400 or r['status']<0: print('HTTP',r['status'],r['file'],r['path'])

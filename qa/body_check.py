import os
ROOT = os.environ.get("SGB_ROOT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sgb"))
OUT = os.environ.get("SGB_QA_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
os.makedirs(OUT, exist_ok=True)
DB_URL = os.environ.get("DATABASE_URL", "postgresql://sgb:sgb@localhost:5432/sgb")
import re, os, json

sw=json.load(open(f'{ROOT}/docs/_swagger_from_code.json')); S=sw['components']['schemas']
ops={}
for p,v in sw['paths'].items():
    for m,o in v.items():
        key=(m.upper(), re.sub(r'\{[^}]+\}','{}',p.replace('/api/v1','')))
        rb=o.get('requestBody',{}).get('content',{}).get('application/json',{}).get('schema',{})
        ref=rb.get('$ref','').split('/')[-1]
        props=S.get(ref,{}).get('properties',{}); req=S.get(ref,{}).get('required',[])
        ops[key]=(ref,set(props),set(req))
def norm(p):
    p=p.split('?')[0]; p=re.sub(r'\$\{[^}]*\}','{}',p); return p.replace('/api/v1','')
res=[]
for base in ['site/src','web/src']:
    for dp,_,fs in os.walk(os.path.join(ROOT,base)):
        for f in fs:
            if not f.endswith(('.tsx','.ts')): continue
            s=open(os.path.join(dp,f),encoding='utf-8').read()
            for m in re.finditer(r"(?:fetch|api)\s*(?:<[^>]*>)?\(\s*([`'\"])(/[^`'\"]+)\1\s*,\s*\{",s):
                path=norm(m.group(2)); seg=s[m.end():m.end()+600]
                seg=seg[:seg.find('})')+2] if '})' in seg else seg
                mm=re.search(r"method:\s*['\"](\w+)",seg); meth=mm.group(1).upper() if mm else 'GET'
                bm=re.search(r"body:\s*JSON\.stringify\(\s*\{([^}]*)\}",seg)
                if not bm or meth=='GET': continue
                keys=set()
                for part in bm.group(1).split(','):
                    part=part.strip()
                    if not part or part.startswith('...'): continue
                    k=re.split(r'[:\s]',part)[0].strip()
                    if k: keys.add(k)
                cand=[k for k in ops if k[0]==meth and re.fullmatch(re.sub(r'\\\{\\\}','[^/]+',re.escape(k[1])),path) or (k[0]==meth and k[1]==path)]
                if not cand: res.append((f,meth,path,'엔드포인트 없음',sorted(keys))); continue
                ref,props,req=ops[cand[0]]
                if not ref: continue
                extra=keys-props; missing=req-keys
                if extra or missing: res.append((os.path.join(dp,f).replace(ROOT+'/',''),meth,path,f'DTO {ref}: 모르는 키 {sorted(extra)} · 빠진 필수 {sorted(missing)}',sorted(keys)))
for r in res: print(r)
print('검사 끝', len(res))

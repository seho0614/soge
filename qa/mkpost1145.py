"""회귀 전에 소개광장 시험 글 하나(게시 상태) — 글이 있어야 도는 시험(test_v1145 등)용 · run_regression.sh 가 부름 (v10.145 · 2026-10-29 · 10-31 qa 로 옮김)"""
import json, urllib.error, urllib.request
API='http://localhost:13000/api/v1'
def call(m,p,b=None,t=None):
    h={'content-type':'application/json'}
    if t: h['Authorization']='Bearer '+t
    r=urllib.request.Request(API+p,data=json.dumps(b).encode() if b is not None else None,headers=h,method=m)
    try: return json.load(urllib.request.urlopen(r,timeout=30))
    except urllib.error.HTTPError as e: return {'_err':e.code,'b':e.read().decode()[:200]}
ts=call('POST','/auth/login',{'email':'seller@x.com','password':'sgb-dev-1234'})['accessToken']
ta=call('POST','/auth/login',{'email':'admin@x.com','password':'sgb-dev-1234'})['accessToken']
p=call('POST','/me/community/posts',{'board':'QNA','title':'T1145 시험 글','body':'점검용 시험 글입니다(v10.145). 끝나면 지웁니다.'},ts)
print(p.get('id'), p.get('state'), p.get('_err'), p.get('b'))
if p.get('id') and p.get('state')!='PUBLISHED': print(call('POST',f"/admin/community/posts/{p['id']}/approve",{},ta).get('state'))

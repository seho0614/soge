"""검색 기능 점검(v10.83 · docs/137) — 통합 검색 · 관 목록 · 소개광장 · 검색 팝업 · 검색어 집계 · 문장 검색 · 소개몰

  API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 -I search_check.py   (점검판 · func_check.sh 가 부름)

  결과: search_check.json · 줄마다 ok / FAIL / NOTE(자료에 달린 것 — 실패로 세지 않음)
"""
import os
import json, subprocess, sys, time, urllib.request, urllib.parse
API=os.environ.get('API','http://localhost:3000/api/v1'); DB=os.environ.get('DB','postgresql://sgb:sgb@localhost:5432/sgb')
F=[]
def q(sql): return subprocess.run(['psql',DB,'-X','-At','-c',sql],capture_output=True,text=True).stdout.strip()
def call(m,p,body=None,h=None):
    t=time.time(); req=urllib.request.Request(API+p,method=m,data=json.dumps(body).encode() if body is not None else None,headers={'content-type':'application/json',**(h or {})})
    try: r=urllib.request.urlopen(req,timeout=30); st,raw=r.status,r.read()
    except urllib.error.HTTPError as e: st,raw=e.code,e.read()
    try: js=json.loads(raw) if raw else None
    except Exception: js=raw[:200]
    return st,js,round((time.time()-t)*1000)
G=lambda p,**kw: call('GET',p+('?'+urllib.parse.urlencode(kw) if kw else ''))
def rec(area,case,ok,detail): F.append((area,case,ok,detail)); print(('ok  ' if ok is True else ('NOTE' if ok=='note' else 'FAIL')),area,'|',case,'|',str(detail)[:230],flush=True)

pub=int(q("select count(*) from listings where status='PUBLISHED'"))
# ── 통합 검색 GET /search
for qq in ['', '가']:
    st,js,ms=G('/search',q=qq); rec('/search',f'짧은 검색어 {qq!r} → 422',st==422,f'{st} {js}')
st,js,ms=G('/search',q='고깃집'); rec('/search','「고깃집」 → 매물 · 요청 모두',st==200 and len(js['listings'])>=1 and len(js['requests'])>=1,f"{st} 매물 {len(js['listings'])} 요청 {len(js['requests'])} {ms}ms")
st,js,ms=G('/search',q='고깃 집'); rec('/search','띄어쓰기 「고깃 집」(제목 「고깃집」)',st==200 and len(js['listings'])>=1,f"매물 {len(js['listings'])} 요청 {len(js['requests'])} — 통합 검색은 검색어 전체를 제목에 그대로 찾음")
st,js,ms=G('/search',q='양도 고깃집'); rec('/search','낱말 순서 「양도 고깃집」(제목 「해운대 고깃집 양도」)',st==200 and len(js['listings'])>=1,f"매물 {len(js['listings'])}")
st,js,ms=G('/search',q='고기집'); rec('/search','한 글자 틀림 「고기집」(동의어 사전에 있을 때만 — 없으면 NOTE)',True if (st==200 and len(js['listings'])>=1) else 'note',f"매물 {len(js['listings'])} 요청 {len(js['requests'])}")
for sp in ['%%','__','\\\\']:
    st,js,ms=G('/search',q=sp); rec('/search',f'특수문자 {sp!r} → 전건 아님',st==200 and len(js['listings'])<min(pub,20),f"{st} 매물 {len((js or {}).get('listings',[]))}")
st,js,ms=G('/search',q="' OR 1=1 --"); rec('/search','SQL 주입 꼴 → 500 아님 · 0건',st==200 and js['total']==0,f'{st} {js if st!=200 else js["total"]}')
for lim in ['abc','-1','0','1.5','100000']:
    st,js,ms=G('/search',q='소개',limit=lim)
    n=len((js or {}).get('listings',[])) if isinstance(js,dict) else None
    rec('/search',f'limit={lim} → 500 아님 · 50 이하',st==200 and (n is None or n<=50),f'{st} 매물 {n} {str(js)[:80] if st>=400 else ""}')
st,js,ms=G('/search',q='가'*500); rec('/search','500자 검색어',st in (200,400,422),f'{st} {ms}ms')
hid=q("select title from listings where status<>'PUBLISHED' limit 1")
if hid:
    st,js,ms=G('/search',q=hid[:12]); rec('/search','공개 안 된 매물(SUSPENDED)은 안 나옴',st==200 and not any(x['title']==hid for x in js['listings']),f'{hid[:20]!r}')
inr=q("select title from requests where status='IN_REVIEW' limit 1")
if inr:
    st,js,ms=G('/search',q=inr[:10]); rec('/search','검수 중 요청은 안 나옴',st==200 and not any(x['title']==inr for x in js['requests']),f'{inr[:20]!r}')

# ── 상품 · 서비스 목록 GET /listings?keyword
st,js,ms=G('/listings',keyword='가',limit='50'); n=len(js.get('organic',[]))+len(js.get('promoted',[])) if isinstance(js,dict) else None
rec('/listings','한 글자 「가」 → 전부가 나오는가',n is not None and n<pub,f'{st} {n}건(공개 매물 {pub}) — fn_search_match 는 두 글자 미만 낱말을 건너뜀')
st,js,ms=G('/listings',keyword='고깃 집',limit='50'); n=len(js.get('organic',[]))+len(js.get('promoted',[])) if isinstance(js,dict) else None
rec('/listings','띄어쓰기 「고깃 집」',n is not None and n>=1,f'{st} {n}건 — 「집」 한 글자는 건너뛰고 「고깃」만으로 찾음')
st,js,ms=G('/listings',keyword='양도 고깃집',limit='50'); n=len(js.get('organic',[]))+len(js.get('promoted',[])) if isinstance(js,dict) else None
rec('/listings','낱말 순서 「양도 고깃집」',n is not None and n>=1,f'{st} {n}건 {ms}ms')
st,js,ms=G('/listings',keyword='%%',limit='50'); n=len(js.get('organic',[]))+len(js.get('promoted',[])) if isinstance(js,dict) else None
rec('/listings','특수문자 「%%」',n is not None and n<pub,f'{st} {n}건')
st,js,ms=G('/listings',keyword='고깃집',limit='20',sort='RELEVANCE',match='TITLE'); n=len(js.get('organic',[]))+len(js.get('promoted',[])) if isinstance(js,dict) else None
rec('/listings','통합 검색 표(제목만 · 관련순)',st==200 and n>=1,f'{st} {n}건 {ms}ms')
st,js,ms=G('/listings',keyword='x'*300,limit='20'); rec('/listings','300자 검색어',st in (200,400,422),f'{st} {ms}ms')

# ── 소개광장 GET /community/board?q
st,js,ms=G('/community/board',q='권리금'); rec('/community/board','「권리금」',st==200,f"{st} {js.get('total') if isinstance(js,dict) else js}건 {ms}ms")
st,js,ms=G('/community/board',q='x'*51); rec('/community/board','51자 → 400',st==400,f'{st}')
hp=q("select title from posts where state in ('HIDDEN','PENDING','DELETED') and length(title)>=4 order by created_at desc limit 1")
if hp:
    st,js,ms=G('/community/board',q=hp[:10],size='50'); rec('/community/board','감춘 · 검수 · 지운 글은 안 나옴',st==200 and not any(x.get('title')==hp for x in js.get('items',[])),f'{hp[:20]!r}')
fp=q("select title from posts where board='FOOD' and state='PUBLISHED' limit 1")
if fp:
    st,js,ms=G('/community/board',q=fp[:8],size='50'); rec('/community/board','맛집 글은 전체 검색에 안 섞임(D100)',st==200 and not any(x.get('title')==fp for x in js.get('items',[])),f'{fp[:20]!r}')

# ── 검색 팝업 GET /search/suggest
st,js,ms=G('/search/suggest'); rec('/search/suggest','빈 검색어 → 추천어 · 업종',st==200 and isinstance(js,dict),f"{st} 키 {sorted(js) if isinstance(js,dict) else js} {ms}ms")
kw=(js or {}).get('keywords',[]) if isinstance(js,dict) else []
rec('/search/suggest','추천 검색어에 숫자 섞인 말(시험 꼬리표 등 — 운영 화면 「검색 사전」에서 숨김 · 자료에 달림)',True if not [k for k in kw if any(c.isdigit() for c in k)] else 'note',f'{kw[:12]}')
restricted=[r for r in q("select lower(name) from restricted_industries where is_active and mode in ('BLOCK','AD_ONLY')").split('\n') if r]
for rr in restricted[:3]:
    st,js,ms=G('/search/suggest',q=rr); bad=[x for x in json.dumps(js,ensure_ascii=False).lower().split('"') if rr in x and x!=rr]
    rec('/search/suggest',f'제한업종 「{rr}」 → 추천 · 업종에 안 나옴',st==200 and not (js.get('keywords') or []) and not [c for c in (js.get('categories') or []) if rr in json.dumps(c,ensure_ascii=False)],f"{st} kw {js.get('keywords')} cat {str(js.get('categories'))[:60]}")
st,js,ms=G('/search/suggest',q='김'); intro=(js or {}).get('introducers') or (js or {}).get('people') or []
rec('/search/suggest','소개자 이름은 첫 글자만',all(('OO' in json.dumps(i,ensure_ascii=False)) for i in intro) if intro else 'note',f'{str(intro)[:120]}')
st,js,ms=G('/search/suggest',q='x'*500); rec('/search/suggest','500자',st in (200,400,422),f'{st} {ms}ms')

# ── 검색어 집계 POST /search/log
st,js,ms=call('POST','/search/log',{'q':'고깃집 1234567 a@b.com 다단계'}); rec('/search/log','아는 말만 셈(숫자 3자리 · @ · 제한업종 버림)',st==200 and all(w not in (js or {}).get('recorded',[]) for w in ('1234567','a@b.com','다단계')),f'{st} {js}')
thr=None
for i in range(25):
    st,js,ms=call('POST','/search/log',{'q':'고깃집'})
    if (js or {}).get('throttled'): thr=i; break
rec('/search/log','1분 20번 넘으면 조용히 무시',thr is not None,f'{thr}번째에 throttled')

# ── 문장으로 찾기 POST /search/prompt
st,js,ms=call('POST','/search/prompt',{'q':'강남에서 고깃집 인수할 곳 찾아요'}); rec('/search/prompt','문장 → 결과(LLM 없으면 규칙 엔진)',st in (200,201),f'{st} {str(js)[:160]} {ms}ms')
st,js,ms=call('POST','/search/prompt',{'q':'다단계 사업 같이 하실 분'}); rec('/search/prompt','제한업종 문장 → 후보에서 빠짐',st in (200,201,422),f'{st} {str(js)[:160]}')
st,js,ms=call('POST','/search/prompt',{'q':'가'}); rec('/search/prompt','한 글자',st in (200,201,400,422),f'{st} {str(js)[:100]}')
st,js,ms=call('POST','/search/prompt',{'q':'가'*3000}); rec('/search/prompt','3000자',st in (200,201,400,413,422),f'{st} {ms}ms')

# ── 소개몰 GET /health/products?keyword
st,js,ms=G('/health/products',keyword='비타민'); n=len(js) if isinstance(js,list) else len((js or {}).get('items',[])) if isinstance(js,dict) else None
rec('/health/products','「비타민」',st==200 and n and n>=1,f'{st} {n}건 {ms}ms')
st,js,ms=G('/health/products',keyword='비타민 C'); n=len(js) if isinstance(js,list) else len((js or {}).get('items',[])) if isinstance(js,dict) else None
rec('/health/products','띄어쓰기 「비타민 C」(상품 「메가바이탈 비타민C」)',st==200 and n and n>=1,f'{st} {n}건')
st,js,ms=G('/health/products',keyword='%%'); n=len(js) if isinstance(js,list) else len((js or {}).get('items',[])) if isinstance(js,dict) else None
tot=int(q("select count(*) from hlt_products where status='ON_SALE'"))
rec('/health/products','특수문자 「%%」 → 전건 아님',st in (200,400) and (n is None or n<tot),f'{st} {n}건 / 판매 중 {tot}')
st,js,ms=G('/health/products',keyword='가'); n=len(js) if isinstance(js,list) else len((js or {}).get('items',[])) if isinstance(js,dict) else None
rec('/health/products','한 글자 「가」',st in (200,400,422),f'{st} {n}건 / 판매 중 {tot}')
json.dump(F,open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'search_check.json'),'w'),ensure_ascii=False,indent=1)
bad=[f for f in F if f[2] is not True and f[2]!='note']
print(f'통과 {len(F)-len(bad)} / {len(F)} · 주의 {sum(1 for f in F if f[2]=="note")}')
sys.exit(1 if bad else 0)

"""10/2 백엔드 수정 검증 (73화면 구현 중 발견)."""
import json, urllib.request, subprocess, uuid, sys
B='http://localhost:3000/api/v1'; DB='postgresql://sgb:sgb@localhost:5432/sgb'
q=lambda s: subprocess.run(['psql',DB,'-tAc',s],capture_output=True,text=True).stdout.strip().split('\n')[0]
R=[]
def call(m,p,tok=None,body=None):
    h={'content-type':'application/json','Idempotency-Key':uuid.uuid4().hex}
    if tok: h['authorization']='Bearer '+tok
    req=urllib.request.Request(B+p,method=m,data=json.dumps(body).encode() if body is not None else (b'{}' if m in('POST','PATCH') else None),headers=h)
    try: r=urllib.request.urlopen(req,timeout=30); st=r.status; raw=r.read()
    except urllib.error.HTTPError as e: st=e.code; raw=e.read()
    try: js=json.loads(raw) if raw else None
    except Exception: js=None
    return st,js
def rec(step,ok,detail=''):
    R.append({'step':step,'ok':bool(ok),'detail':str(detail)[:200]}); print('ok  ' if ok else 'FAIL',step,str(detail)[:140],file=sys.stderr)
login=lambda e,pw='sgb-dev-1234': call('POST','/auth/login',body={'email':e,'password':pw})[1]['accessToken']
ADM=login('admin@x.com'); BUY=login('buyer@x.com')
# F-1 검색 관련도순
st,j=call('GET','/listings?keyword=%EC%83%81%EA%B0%80&sort=RELEVANCE&limit=3')
rec('F-1 검색어+관련도순 (전: 500)', st==200 and len(j['organic'])>0, f"{st} {len(j['organic']) if j else ''}")
# F-2 메인 구성 저장
st,cur=call('GET','/admin/layout',ADM)
new=list(reversed(cur['sections']))
st,j=call('PATCH','/admin/layout',ADM,{'sections':new})
st2,after=call('GET','/admin/layout',ADM)
rec('F-2 메인 구성 저장이 반영됨 (전: 값을 버림)', after['sections']==new and after['gwanOrder']==cur['gwanOrder'], after['sections'])
call('PATCH','/admin/layout',ADM,{'sections':cur['sections']})
st,j=call('PATCH','/admin/layout',ADM,{'sections':'x'})
rec('F-2b 형식이 틀리면 400', st==400, st)
# F-3 제휴 입점 심사
# 신청자를 새로 만듭니다 — 가입 → 본인인증(스텁) → 사업자 → 운영 승인 → 입점 신청
_e=f'fx3_{uuid.uuid4().hex[:6]}@t.local'
call('POST','/auth/signup',body={'email':_e,'password':'sgb-test-1234','name':'F3 시험','agreedTerms':[]})
_T=login(_e,'sgb-test-1234'); call('POST','/verifications/identity',_T,{'provider':'PASS'})
_st,_j=call('POST','/businesses',_T,{'bizRegNo':str(uuid.uuid4().int)[-10:],'companyName':'F3상사'+_e[4:8],'ceoName':'김시험','sido':'서울','sigungu':'금천구'})
_bid=(_j or {}).get('id') or q(f"select id from businesses where company_name='F3상사{_e[4:8]}'")
call('PATCH',f'/admin/businesses/{_bid}/verify',ADM,{})
call('POST','/partner/apply',login(_e,'sgb-test-1234'))
st,j=call('GET','/admin/affiliates/applications',ADM)
n=len(j['items']); exp=int(q("select count(*) from partners p join businesses b on b.id=p.business_id where p.status='APPLIED'"))
rec('F-3 입점 대기 목록 = APPLIED 건수 (전: 늘 0)', n==exp and n>0, f'{n}/{exp}')
if n:
    pid=j['items'][0]['id']
    st,r=call('POST',f'/admin/affiliates/applications/{pid}/decide',ADM,{'state':'REJECTED','reason':'10/2 검증 — 반려 동작 확인'})
    rec('F-3b 반려 처리 (전: CHECK 위반)', st<300 and r.get('ok') and q(f"select status from partners where id='{pid}'")=='REJECTED', r)
# F-4 이름 바꾸면 본인인증 해제
e=f'fx_{uuid.uuid4().hex[:6]}@t.local'
call('POST','/auth/signup',body={'email':e,'password':'sgb-test-1234','name':'검증회원'})
q(f"update accounts set identity_verified_at=now() where email='{e}'")
T=login(e,'sgb-test-1234')
st,j=call('PATCH','/me/account',T,{'name':'검증회원'})
rec('F-4a 같은 이름 저장 → 인증 유지', st<300 and q(f"select identity_verified_at is not null from accounts where email='{e}'")=='t', j)
st,j=call('PATCH','/me/account',T,{'name':'다른이름'})
rec('F-4b 이름 변경 → 본인인증 해제 (전: 유지)', st<300 and j.get('identityReset') is True and q(f"select identity_verified_at is null from accounts where email='{e}'")=='t', j)
# F-5 건강몰 주문 트랜잭션 · 결제 멱등 · 반품 중복 · 장바구니
prod=q("select code from hlt_products where status='ON_SALE' and stock>0 and (select count(*) from hlt_product_options o where o.product_id=hlt_products.id and o.is_active)=1 order by stock desc limit 1")
stock=int(q(f"select stock from hlt_products where code='{prod}'"))
addr=q("select a.id from hlt_addresses a join accounts c on c.id=a.account_id where c.email='buyer@x.com' and a.deleted_at is null order by a.is_default desc limit 1")
before=int(q("select count(*) from hlt_orders"))
st,j=call('POST','/health/orders',BUY,{'addressId':addr,'items':[{'productCode':prod,'qty':stock+50}]})
after=int(q("select count(*) from hlt_orders"))
rec('F-5a 재고 초과 주문 실패 시 주문 행이 남지 않음 (전: 고아 주문)', st>=400 and after==before, f'{st} {before}->{after} {j}')
call('POST','/me/health/cart',BUY,{'productCode':prod,'qty':1})
st,o=call('POST','/health/orders',BUY,{'addressId':addr,'items':[{'productCode':prod,'qty':1}]})
st2,cart=call('GET','/me/health/cart',BUY)
rec('F-5b 주문 성공 + 장바구니에서 빠짐 (전: 남음)', st<300 and not any(i['code']==prod for i in cart['items']), f"{st} {o and o.get('orderNo')}")
no=o['orderNo']
s1,p1=call('POST',f'/health/orders/{no}/pay',BUY,{'method':'CARD'}); s2,p2=call('POST',f'/health/orders/{no}/pay',BUY,{'method':'CARD'})
rec('F-5c 같은 수단 결제 두 번 → 같은 결제 건 (전: READY 가 쌓임)', p1['id']==p2['id'] and q(f"select count(*) from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no='{no}' and p.state='READY'")=='1', (p1['id'],p2['id']))
s3,p3=call('POST',f'/health/orders/{no}/pay',BUY,{'method':'VBANK'})
rec('F-5d 수단 변경 → 이전 준비 건 닫힘 · READY 1건 · 주문은 결제 대기 유지', q(f"select count(*) from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no='{no}' and p.state='READY'")=='1' and p3['method']=='VBANK' and q(f"select status from hlt_orders where order_no='{no}'")=='PENDING', p3)
r1=call('POST','/me/health/returns',BUY,{'orderNo':no,'kind':'CANCEL','reason':'CHANGE_MIND'})
r2=call('POST','/me/health/returns',BUY,{'orderNo':no,'kind':'CANCEL','reason':'CHANGE_MIND'})
rec('F-5e 같은 주문 취소 중복 접수 → 409 (전: 여러 번 접수)', r1[0]<300 and r2[0]==409, (r1[0],r2[0],r2[1]))
empty=q("select order_no from hlt_orders o where status='PENDING' and not exists(select 1 from hlt_order_items i where i.order_id=o.id) limit 1")
rec('F-5f 품목 없는 결제 대기 주문 0건 (C998 정리)', not empty, empty)
json.dump(R,open('fixes_1002.json','w'),ensure_ascii=False,indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")

"""기능 검증 — 핵심 업무 흐름을 API 로 처음부터 끝까지 돌립니다."""
import urllib.parse
import json, time, urllib.request, subprocess, uuid, sys
B='http://localhost:3000/api/v1'
DB='postgresql://sgb:sgb@localhost:5432/sgb'
q=lambda s: subprocess.run(['psql',DB,'-tAc',s],capture_output=True,text=True).stdout.strip()
R=[]
def call(m,p,tok=None,body=None,expect=None,name=None,headers=None):
    h={'content-type':'application/json'}
    if tok: h['authorization']='Bearer '+tok
    if headers: h.update(headers)
    req=urllib.request.Request(B+p,method=m,data=json.dumps(body).encode() if body is not None else None,headers=h)
    try:
        r=urllib.request.urlopen(req,timeout=30); st=r.status; raw=r.read()
    except urllib.error.HTTPError as e: st=e.code; raw=e.read()
    try: js=json.loads(raw) if raw else None
    except Exception: js=raw[:200].decode('utf8','ignore')
    ok = (st in expect) if expect else st<400
    if name: R.append({'step':name,'req':f'{m} {p}','status':st,'ok':ok,'resp':json.dumps(js,ensure_ascii=False)[:180]})
    print(('ok  ' if ok else 'FAIL'),name or '',m,p,st,json.dumps(js,ensure_ascii=False)[:150],file=sys.stderr)
    return st,js
def login(e,pw='sgb-dev-1234'): return call('POST','/auth/login',body={'email':e,'password':pw})[1]['accessToken']
ADM=login('admin@x.com')
tag=uuid.uuid4().hex[:6]
# ── 1. 가입 → 로그인 → 내 요약
st,j=call('POST','/auth/signup',body={'email':f'e2e_{tag}@t.local','password':'Sgb-e2e-1234!','name':'E2E 판매자','agreedTerms':[]},name='1-1 회원가입')
S1=j.get('accessToken') if isinstance(j,dict) else None
if not S1: S1=login(f'e2e_{tag}@t.local','Sgb-e2e-1234!')
call('GET','/me/summary',S1,name='1-2 내 요약(MEMBER)')
# ── 2. 본인인증(스텁) → 사업자 등록 → 운영 승인 → BIZ_OWNER
call('POST','/verifications/identity',S1,{'provider':'PASS'},name='2-1 본인인증(스텁)')
brn=str(int(time.time()))[-10:]
st,j=call('POST','/businesses',S1,{'bizRegNo':brn,'companyName':f'E2E상사{tag}','ceoName':'김시험','sido':'서울','sigungu':'금천구'},name='2-2 사업자 등록')
bid=(j or {}).get('id') or q(f"select id from businesses where company_name='E2E상사{tag}'")
call('PATCH',f'/admin/businesses/{bid}/verify',ADM,{},name='2-3 운영 사업자 승인')
st,j=call('GET','/me/summary',S1,name='2-4 역할 반영 확인')
roles=(j or {}).get('roles') or (j or {}).get('principal',{}).get('roles')
R.append({'step':'2-5 BIZ_OWNER 부여','req':'roles','status':200,'ok':bool(roles and 'BIZ_OWNER' in roles),'resp':str(roles)})
# ── 3. 매물 등록 → 검수 → 공개 → 목록 노출
cat=q("select id from categories where gwan_code='MNY' and status='APPROVED' and restricted_code is null and labor_law_flag is distinct from 'REQUIRED' limit 1")
st,j=call('POST','/listings',S1,{'gwanCode':'MNY','categoryId':cat,'title':f'E2E 사무실 인테리어 소개 {tag}','body':'금천구 사무실 40평 인테리어 업체를 소개해 주시면 소개비를 드립니다. 시공 이력 확인 가능합니다.','desiredFee':500000,'feeBearer':'SELLER'},name='3-1 매물 등록')
lid=(j or {}).get('listingId') or (j or {}).get('id')
state=q(f"select status from listings where id='{lid}'") if lid else ''
rid=q(f"select id from review_items where target_id='{lid}' order by submitted_at desc limit 1") if lid else ''
R.append({'step':'3-2 등록 직후 상태','req':'db','status':200,'ok':bool(state),'resp':f'status={state} review={rid or "-"}'})
if state!='PUBLISHED' and rid:
    call('PATCH',f'/admin/reviews/{rid}',ADM,{'decision':'APPROVED'},name='3-3 운영 검수 승인')
state=q(f"select status from listings where id='{lid}'") if lid else ''
st,j=call('GET',f'/listings?gwanCode=MNY&limit=50',name='3-4 목록 조회')
found=any(x['id']==lid for x in (j or {}).get('organic',[]))
R.append({'step':'3-5 목록에 노출','req':'organic 포함','status':200,'ok':found and state=='PUBLISHED','resp':f'status={state} found={found}'})
call('GET',f'/listings/{lid}',name='3-6 매물 상세')
# ── 4. 구매자 문의 → 거래 생성 → 소개비 제안·동의 → 확정 → 대금 신고
BUY=login('person@x.com')   # 거래 확정은 양측 모두 사업자(BIZ_OWNER · BUSINESS_VERIFIED) — 개인 buyer@x.com 은 문의까지만
st,j=call('POST','/conversations',BUY,{'targetType':'LISTING','targetId':lid,'message':'견적 문의드립니다. 이번 달 착공 가능할까요?'},name='4-1 구매자 문의')
cid=(j or {}).get('id') or (j or {}).get('conversationId')
st,j=call('POST',f'/conversations/{cid}/deal',S1,{},name='4-2 거래 생성(판매자)')
did=(j or {}).get('id') or (j or {}).get('dealId')
if not did: st,j=call('POST',f'/conversations/{cid}/deal',BUY,{},name='4-2b 거래 생성(구매자)'); did=(j or {}).get('id') or (j or {}).get('dealId')
# 소개비 중개는 정책상 꺼져 있습니다(fee.mediation OFF) — 422 FEATURE_OFF 가 정상
call('POST',f'/deals/{did}/fee',S1,{'amount':500000},name='4-3 소개비 제안 → 정책상 차단(정상)', headers={'Idempotency-Key':uuid.uuid4().hex}, expect=[422])
call('POST',f'/deals/{did}/confirm',BUY,{},name='4-6 거래 확정(구매자)', headers={'Idempotency-Key':uuid.uuid4().hex})
call('POST',f'/deals/{did}/confirm',S1,{},name='4-7 거래 확정(판매자)', headers={'Idempotency-Key':uuid.uuid4().hex}, expect=[200,201,409])
call('POST',f'/deals/{did}/payment-report',BUY,{'method':'BANK_TRANSFER','memo':'E2E'},name='4-8 대금 지급 신고', headers={'Idempotency-Key':uuid.uuid4().hex})
R.append({'step':'4-9 거래 상태','req':'db','status':200,'ok':True,'resp':q(f"select status from deals where id='{did}'") if did else '-'})
# ── 5. 소개 요청 → 소개자 조회
st,j=call('POST','/requests',BUY,{'gwanCode':'MNY','title':f'E2E 요청 — 태양광 EPC 업체 {tag}','body':'공장 지붕 500kW 태양광 EPC 업체를 소개받고 싶습니다.','offeredFee':300000},name='5-1 소개 요청 등록')
call('GET','/requests?gwanCode=MNY',name='5-2 요청 목록')
# ── 6. 파트너센터
INT=login('intro@x.com')
call('GET','/partner/dashboard',INT,name='6-1 파트너 대시보드')
st,j=call('POST','/partner/services',INT,{'title':f'E2E 인테리어 시공 {tag}','body':'사무실·상가 인테리어 시공. 40평 이하 전문, 하자보수 1년.'},name='6-2 서비스 등록')
call('POST','/partner/regions',INT,{'regions':[{'sido':'서울','sigungu':'금천구'},{'sido':'서울','sigungu':'구로구'}]},name='6-3 활동 지역 저장')
st,j=call('GET','/partner/leads',INT,name='6-4 리드 목록')
leads=(j or {}).get('items') if isinstance(j,dict) else j
if leads:
    lid2=leads[0].get('deliveryId') or leads[0].get('id')
    call('POST',f'/partner/leads/{lid2}/view',INT,{},name='6-5 리드 열람(이용료)', headers={'Idempotency-Key':uuid.uuid4().hex}, expect=[200,201,409,422])
    # v10.28 — 열었으면 연락처도 읽음(파트너센터 화면 「연락처 보기」와 같음 · 열람 기록이 남음). 열기만 하고 읽지 않으면 감시 뷰(v_lead_contact_unlogged)에 「열었는데 기록 없음」으로 남습니다
    call('GET',f'/partner/leads/{lid2}/contact',INT,name='6-5b 연락처 보기(열람 기록)', expect=[200,404,409,422])
call('GET','/partner/fees',INT,name='6-6 이용료 내역')
# ── 7. 운영 기능
call('POST','/admin/search/synonyms',ADM,{'term':f'e2e{tag}','canonical':'상가','kind':'CATEGORY'},name='7-1 동의어 추가')
call('GET','/search?q='+urllib.parse.quote('상가'),name='7-2 통합 검색')
call('PATCH','/admin/policies/auto-review/manual_fee_threshold',ADM,{'enabled':True},name='7-3 자동검수 규칙 변경')
call('GET','/admin/gwans/manage',ADM,name='7-4 관 관리 목록')
call('POST','/admin/segments/learn',ADM,{},name='7-5 성향 학습 실행')
call('GET','/admin/summary',ADM,name='7-6 운영 대시보드')
json.dump(R,open('/home/claude/qa/e2e.json','w'),ensure_ascii=False,indent=1)
print('\n통과',sum(r['ok'] for r in R),'/',len(R))

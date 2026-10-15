"""2026-10-01 결정 5건 기능 검증."""
import json, urllib.request, subprocess, uuid, sys, urllib.parse
B='http://localhost:3000/api/v1'; DB='postgresql://sgb:sgb@localhost:5432/sgb'
q=lambda s: subprocess.run(['psql',DB,'-tAc',s],capture_output=True,text=True).stdout.strip().split('\n')[0]
R=[]
def call(m,p,tok=None,body=None,name=None,expect=None):
    h={'content-type':'application/json','Idempotency-Key':uuid.uuid4().hex}
    if tok: h['authorization']='Bearer '+tok
    req=urllib.request.Request(B+p,method=m,data=json.dumps(body).encode() if body is not None else (b'{}' if m=='POST' else None),headers=h)
    try: r=urllib.request.urlopen(req,timeout=30); st=r.status; raw=r.read()
    except urllib.error.HTTPError as e: st=e.code; raw=e.read()
    try: js=json.loads(raw) if raw else None
    except Exception: js=None
    ok=(st in expect) if expect else st<400
    if name: R.append({'step':name,'req':f'{m} {p}','status':st,'ok':ok,'resp':json.dumps(js,ensure_ascii=False)[:200]})
    print('ok  ' if ok else 'FAIL',name,st,json.dumps(js,ensure_ascii=False)[:170],file=sys.stderr)
    return st,js
def login(e,pw='sgb-dev-1234'): return call('POST','/auth/login',body={'email':e,'password':pw})[1]['accessToken']
ADM=login('admin@x.com'); PAY=login('payout@t.local','sgb-test-1234'); OPS=login('ops@t.local','sgb-test-1234')
tag=uuid.uuid4().hex[:5]
# ── Q5 운영 계정 = 사용자 기능 전체
st,j=call('GET','/me/summary',ADM,name='Q5-1 운영 계정 /me/summary')
R.append({'step':'Q5-2 운영 계정 역할','req':'roles','status':200,'ok':bool(j and 'MEMBER' in j['principal']['roles'] and j['principal']['roles'][0] in ('ADMIN','SUPER')),'resp':str(j and j['principal']['roles'])})
call('GET','/me/favorites',ADM,name='Q5-3 운영 계정 관심 목록(사용자 기능)')
call('GET','/admin/summary',ADM,name='Q5-4 운영 기능은 그대로')
# ── Q2 · Q3 개인 회원 거래 확정 · 양측 확인 → CONFIRMED
BUY=login('buyer@x.com'); SEL=login('intro@x.com')
lid=q("select l.id from listings l join accounts a on a.id=l.owner_account_id where a.email='intro@x.com' and l.status='PUBLISHED' limit 1")
if not lid:
    cat=q("select id from categories where gwan_code='MNY' and status='APPROVED' and restricted_code is null limit 1")
    st,j=call('POST','/listings',SEL,{'gwanCode':'MNY','categoryId':cat,'title':f'결정검증 매물 {tag}','body':'결정 검증용 매물입니다. 사무실 인테리어 업체를 소개받습니다.','desiredFee':300000,'feeBearer':'SELLER'})
    rid=j.get('reviewId'); lid=j.get('listingId')
    if rid: call('PATCH',f'/admin/reviews/{rid}',ADM,{'decision':'APPROVED'})
st,j=call('POST','/conversations',BUY,{'targetType':'LISTING','targetId':lid,'message':f'결정 검증 문의 {tag}'},name='Q2-1 개인 회원 문의')
cid=j.get('conversationId')
st,j=call('POST',f'/conversations/{cid}/deal',SEL,{},name='Q2-2 판매자(사업자) 거래 생성')
did=j.get('dealId')
st,j=call('POST',f'/deals/{did}/confirm',BUY,{},name='Q2-3 개인 회원 거래 확인 (전: 403)')
st,j=call('POST',f'/deals/{did}/payment-report',BUY,{'method':'BANK_TRANSFER','memo':'결정 검증'},name='Q2-4 개인 회원 대금 신고 (전: 403)')
st,j=call('POST',f'/deals/{did}/confirm',SEL,{},name='Q3-1 판매자 확인 → 양측 완료')
R.append({'step':'Q3-2 거래 상태 CONFIRMED (전: INQUIRY)','req':'db','status':200,'ok':q(f"select status from deals where id='{did}'")=='CONFIRMED','resp':q(f"select status||' · '||coalesce(confirm_mode,'') from deals where id='{did}'")})
R.append({'step':'Q3-3 응답 안내문','req':'note','status':200,'ok':bool(j and '확정' in (j.get('note') or '')),'resp':(j or {}).get('note','')})
# 미인증 개인은 여전히 막힘
subprocess.run(['psql',DB,'-qc',f"INSERT INTO accounts(email,password_hash,name,account_type) VALUES ('noid_{tag}@t.local','h','미인증','INDIVIDUAL')"])
subprocess.run(['node','-e',f"""const b=require('bcryptjs');const {{Client}}=require('pg');(async()=>{{const c=new Client({{connectionString:'{DB}'}});await c.connect();await c.query("update accounts set password_hash=$1 where email='noid_{tag}@t.local'",[b.hashSync('sgb-dev-1234',10)]);await c.query("insert into account_roles(account_id,role) select id,'MEMBER' from accounts where email='noid_{tag}@t.local'");await c.end()}})()"""],cwd='/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
NOID=login(f'noid_{tag}@t.local')
call('POST',f'/deals/{did}/confirm',NOID,{},name='Q2-5 본인인증 없는 개인은 차단',expect=[403])
# ── Q4 제휴 정산 계좌 본인인증
call('POST','/partner/affiliate/settlement-account',NOID,{'bankCode':'004','bankName':'국민은행','accountNo':'123-456-789012','holderName':'미인증'},name='Q4-1 본인인증 없으면 계좌 등록 차단',expect=[403])
out=subprocess.run(['psql',DB,'-v','ON_ERROR_STOP=1','-c',f"""BEGIN;
 UPDATE accounts SET identity_verified_at=NULL WHERE id=(SELECT b.account_id FROM partners p JOIN businesses b ON b.id=p.business_id ORDER BY p.id LIMIT 1);   -- v10.31 두 줄이 같은 파트너를 고르게(ORDER BY · 파트너가 늘면 LIMIT 1 이 서로 다른 줄을 골랐음)
 INSERT INTO partner_settlement_accounts(partner_id,bank_code,bank_name,account_enc,account_last4,holder_name)
 SELECT id,'004','국민은행','x','9012','시험' FROM partners ORDER BY id LIMIT 1 ON CONFLICT (partner_id) DO UPDATE SET holder_name='시험2';
 ROLLBACK;"""],capture_output=True,text=True)
R.append({'step':'Q4-2 DB 도 차단 (API 우회 시)','req':'SQL','status':0,'ok':'IDENTITY' in out.stderr,'resp':out.stderr.strip()[:150]})
st,j=call('POST','/partner/affiliate/settlement-account',SEL,{'bankCode':'004','bankName':'국민은행','accountNo':'123-456-789012','holderName':'김소개'},name='Q4-3 본인인증한 파트너는 등록')
# ── Q1 지급 데스크
pid=q("select p.id from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where a.email='intro@x.com'")
subprocess.run(['psql',DB,'-qc',f"UPDATE partner_settlement_accounts SET verified_at=now() WHERE partner_id='{pid}'; WITH x AS (SELECT (random()*300)::int AS r) INSERT INTO partner_settlements(partner_id,track,period_from,period_to,gross_amount,withholding,net_amount) SELECT '{pid}','AFFILIATE','2026-09-01'::date + r,'2026-09-30'::date + r,100000,3300,96700 FROM x"])
st,j=call('GET','/admin/payouts',PAY,name='Q1-1 지급 담당 — 지급 데스크 조회')
st,j=call('GET','/admin/payouts',ADM,name='Q1-2 운영 — 지급 데스크 조회')
draft=next((d for d in j['drafts'] if d['kind']=='PARTNER'),None)
call('POST',f"/admin/payouts/partner/{draft['id']}/pay",PAY,{'ref':'KB-TEST-1'},name='Q1-3 확정 전 지급 차단',expect=[422])
call('POST',f"/admin/payouts/partner/{draft['id']}/confirm",PAY,{},name='Q1-4 지급 담당은 확정 불가',expect=[403])
call('POST',f"/admin/payouts/partner/{draft['id']}/confirm",OPS,{},name='Q1-5 운영(ADMIN) 확정')
call('POST',f"/admin/payouts/partner/{draft['id']}/pay",OPS,{'ref':'KB-TEST-1'},name='Q1-6 운영은 지급 불가',expect=[403])
call('POST',f"/admin/payouts/partner/{draft['id']}/pay",PAY,{'ref':''},name='Q1-7 이체 참조 없으면 차단',expect=[400,422])
st,j=call('POST',f"/admin/payouts/partner/{draft['id']}/pay",PAY,{'ref':f'KB-20261001-{tag}'},name='Q1-8 지급 담당 지급 기록')
R.append({'step':'Q1-9 지급자 · 참조 기록','req':'db','status':200,'ok':q(f"select (paid_by is not null and paid_ref like 'KB-%' and confirmed_by is not null and paid_by<>confirmed_by)::text from partner_settlements where id='{draft['id']}'")=='true','resp':q(f"select state||' '||paid_ref from partner_settlements where id='{draft['id']}'")})
call('POST',f"/admin/payouts/partner/{draft['id']}/pay",PAY,{'ref':'again'},name='Q1-10 이중 지급 차단',expect=[422])
out=subprocess.run(['psql',DB,'-c',f"""BEGIN;
 INSERT INTO partner_settlements(id,partner_id,track,period_from,period_to,gross_amount,withholding,net_amount,state,confirmed_by)
 VALUES ('eeeeeeee-1111-4000-a000-000000000001','{pid}','REFERRAL','2027-01-01','2027-01-31',1,0,1,'DRAFT',NULL);
 UPDATE partner_settlements SET state='CONFIRMED', confirmed_by=(SELECT id FROM accounts WHERE email='payout@t.local') WHERE id='eeeeeeee-1111-4000-a000-000000000001';
 UPDATE partner_settlements SET state='PAID', paid_by=(SELECT id FROM accounts WHERE email='payout@t.local'), paid_ref='x' WHERE id='eeeeeeee-1111-4000-a000-000000000001';
 ROLLBACK;"""],capture_output=True,text=True)
R.append({'step':'Q1-11 확정자=지급자 DB 차단 (2인 원칙)','req':'SQL','status':0,'ok':'2인 원칙' in out.stderr,'resp':out.stderr.strip()[:150]})
json.dump(R,open('decisions.json','w'),ensure_ascii=False,indent=1)
print('\n통과',sum(r['ok'] for r in R),'/',len(R))

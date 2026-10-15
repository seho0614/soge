/**
 * 안심소개 상담 신청 · 축별 입점 · 법률 · 세무 정액 노출 API 흐름 시험 (D018 · D019 · 2026-10-02)
 *   (올린 kit v10.4.7 의 scripts/test-consult-flow.js — 이 kit 의 마이그레이션 번호 · 응답에 맞췄습니다)
 *
 *   검정 전용 DB(sgb_check)에서만 돌리십시오 — 파트너 · 서비스 · 지역 행을 만듭니다.
 *   1) DATABASE_URL=…/sgb_check PORT=3125 npm run dev   (NODE_ENV=development — 인증번호를 응답에 싣는 개발 모드)
 *   2) DATABASE_URL=…/sgb_check JWT_SECRET=… API_BASE=http://localhost:3125 npm run test:consult
 *
 *   확인하는 것: 업종 목록 · 축별 입점 신청/판정(중개사 · 반려 사유) · 휴대폰 확인 전 리드 없음(INV-12) ·
 *   연락처 암호문 · 1곳 배분(INV-L1) · 중복 배분 없음 · 받을 업체 없으면 NO_PARTNER ·
 *   정액 노출형 업종 거부 · 동의 필수 · 인증번호 5회 잠금 · 정액 노출 신청 → 자격 → 입금 확인 → 노출 → 종료
 *
 *   개발 DB 에서 매 실행 새 계정으로 도는 넓은 검정은 qa/srv_lead.py · qa/srv_consult.py 입니다.
 */
const jwt=require('jsonwebtoken');
const {execSync}=require('child_process');
const B=(process.env.API_BASE||'http://localhost:3000')+'/api/v1', SEC=process.env.JWT_SECRET;
const q=s=>execSync(`psql "$DATABASE_URL" -At -c "${s.replace(/"/g,'\\"')}"`,{env:process.env}).toString().trim();
const tok=(id,roles)=>jwt.sign({sub:id,roles,iv:true,bv:true,sub_active:true},SEC,{expiresIn:'10m'});
const call=async(m,p,body,t)=>{const r=await fetch(B+p,{method:m,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});let j;try{j=await r.json()}catch{j=null};return [r.status,j];};
const ok=(name,cond,extra)=>console.log((cond?'PASS ':'FAIL ')+name+(extra?'  — '+JSON.stringify(extra).slice(0,160):''));
(async()=>{
 const ADM=process.argv[2]||q(`select account_id from account_roles where role in ('ADMIN','SUPER') limit 1`); const PACC='11111111-1111-1111-1111-111111111111'; const BIZ=q(`select id from businesses where account_id='${PACC}' order by verified_at desc nulls last, created_at desc limit 1`);
 const [s1,cats]=await call('GET','/consult/categories'); ok('업종 목록 공개 22 (리드형 20 · 정액 노출형 2)',s1===200&&cats.filter(c=>c.status==='APPROVED').length===22&&cats.filter(c=>c.consultMode==='LISTING_FEE').length===2,{n:cats?.length});
 const pt=tok(PACC,['BIZ_OWNER']), at=tok(ADM,['SUPER']);
 const [s2,ax]=await call('POST','/partner/axes',{axes:['CONSULT','RE']},pt); ok('축별 입점 신청',s2<300&&ax.length===2&&ax.every(a=>a.state==='PENDING'),ax);
 const [s2b]=await call('POST','/partner/axes',{axes:['CONSULT']}); ok('토큰 없이 입점 신청 거부',s2b===401||s2b===403,{s2b});
 const [s3,list]=await call('GET','/admin/partner-axes?state=PENDING',null,at); const c=list.find(x=>x.axis==='CONSULT'&&x.bizRegNo), r=list.find(x=>x.axis==='RE'&&x.bizRegNo===c.bizRegNo);
 ok('관리자 목록',s3===200&&c&&r,{n:list.length});
 const [s3b]=await call('GET','/admin/partner-axes',null,pt); ok('일반 회원은 관리자 목록 거부',s3b===403,{s3b});
 const [s4,dr]=await call('POST',`/admin/partner-axes/${r.id}/decide`,{approve:true},at); ok('부동산 승인은 중개사 인증 없으면 거부',s4>=400&&JSON.stringify(dr).includes('AXIS_BROKER'),{s4,dr});
 const [s5,dj]=await call('POST',`/admin/partner-axes/${r.id}/decide`,{approve:false},at); ok('사유 없는 반려 거부',s5>=400&&JSON.stringify(dj).includes('AXIS_REASON'),{s5,dj});
 const [s6]=await call('POST',`/admin/partner-axes/${c.id}/decide`,{approve:true},at); ok('상담 축 승인',s6<300,{s6});
 // 받을 수 있는 업체 준비: 파트너 ACTIVE · 청소 서비스 승인 · 서울 강남구
 const CLEAN=q(`select id from categories where code='CSL_CLEANING'`);
 q(`insert into partners(business_id,status,approved_at,approved_by) values ('${BIZ}','ACTIVE',now(),'${ADM}') on conflict (business_id) do update set status='ACTIVE',approved_at=now(),approved_by='${ADM}'`);
 const PID=q(`select id from partners where business_id='${BIZ}'`);
 q(`insert into partner_services(partner_id,category_id,title,status) values ('${PID}','${CLEAN}','입주 청소','APPROVED')`);
 q(`insert into partner_regions(partner_id,sido,sigungu) values ('${PID}','서울','강남구') on conflict do nothing`);
 const [s7,cr]=await call('POST','/consult/requests',{categoryId:CLEAN,name:'홍길동',phone:'010-1234-5678',sido:'서울',sigungu:'강남구',memo:'32평 입주 청소',agree:true});
 ok('상담 신청 → 인증번호(개발)',s7<300&&/^\d{6}$/.test(cr.devCode||''),{s7,state:cr.state});
 ok('확인 전 리드 없음 (INV-12)',q(`select count(*) from consult_requests where id='${cr.id}' and lead_id is null`)==='1');
 ok('연락처는 암호문',q(`select (contact_enc is not null and position('010' in encode(contact_enc,'escape'))=0)::int from consult_requests where id='${cr.id}'`)==='1');
 const [s8,bad]=await call('POST',`/consult/requests/${cr.id}/verify`,{code:'000000'}); ok('틀린 인증번호 거부',s8>=400&&JSON.stringify(bad).includes('OTP_MISMATCH'),{s8});
 const [s9,res]=await call('POST',`/consult/requests/${cr.id}/verify`,{code:cr.devCode}); ok('확인 → 업체 1곳 전달 · 리드 번호',s9<300&&res.state==='DELIVERED'&&!!res.leadId,res);
 ok('전달 뒤 연락처는 pii 로 옮기고 신청 표에서는 지움',q(`select (c.contact_enc is null and exists(select 1 from pii.lead_contacts p where p.lead_id=c.lead_id))::int from consult_requests c where c.id='${cr.id}'`)==='1');
 ok('배분 대상이 그 업체 1곳',q(`select count(*)||':'||max(d.partner_id::text) from lead_deliveries d join consult_requests c on c.lead_id=d.lead_id where c.id='${cr.id}' and d.state='DELIVERED'`)==='1:'+PID);
 const [s10,res2]=await call('POST',`/consult/requests/${cr.id}/verify`,{code:cr.devCode}); ok('다시 확인해도 중복 배분 없음',res2.state==='DELIVERED'&&q(`select count(*) from lead_deliveries d join consult_requests c on c.lead_id=d.lead_id where c.id='${cr.id}'`)==='1');
 const INT=q(`select id from categories where code='CSL_INTERIOR'`);
 const [,cr2]=await call('POST','/consult/requests',{categoryId:INT,name:'김철수',phone:'010-2222-3333',sido:'서울',agree:true});
 const [,res3]=await call('POST',`/consult/requests/${cr2.id}/verify`,{code:cr2.devCode}); ok('받을 업체 없으면 NO_PARTNER · 리드 안 만듦',res3.state==='NO_PARTNER'&&q(`select (lead_id is null)::int from consult_requests where id='${cr2.id}'`)==='1',res3);
 const LEG=q(`select id from categories where code='CSL_LEGAL'`);
 const [s11,leg]=await call('POST','/consult/requests',{categoryId:LEG,name:'이영희',phone:'010-4444-5555',sido:'서울',agree:true}); ok('정액 노출형(법률) 상담 신청 거부',s11>=400&&JSON.stringify(leg).includes('CONSULT_DIRECTORY_ONLY'),{s11,leg});
 const [s12,nc]=await call('POST','/consult/requests',{categoryId:CLEAN,name:'박',phone:'010-1111-2222',sido:'서울',agree:false}); ok('동의 없으면 거부',s12>=400&&JSON.stringify(nc).includes('CONSENT_REQUIRED'),{s12});
 const [s13,cr3]=await call('POST','/consult/requests',{categoryId:CLEAN,name:'최',phone:'010-7777-8888',sido:'서울',agree:true});
 for(let i=0;i<5;i++) await call('POST',`/consult/requests/${cr3.id}/verify`,{code:'111111'});
 const [s14,lk]=await call('POST',`/consult/requests/${cr3.id}/verify`,{code:cr3.devCode}); ok('5회 틀리면 잠김',s14>=400&&JSON.stringify(lk).includes('OTP_LOCKED'),{s14});

 /* ── D019 법률 · 세무 월 정액 노출형 ── */
 const today0=new Date(Date.now()+9*3600e3).toISOString().slice(0,10), until0=new Date(Date.now()+40*86400e3).toISOString().slice(0,10);
 const [d1,dir0]=await call('GET','/consult/directory/CSL_LEGAL'); ok('정액 노출 목록 — 활성 전 0곳 · 광고 표시',d1===200&&dir0.entries.length===0&&dir0.adLabel==='광고',{d1});
 const [d1b]=await call('GET','/consult/directory/CSL_CLEANING'); ok('리드형 업종은 정액 노출 목록 없음(404)',d1b===404,{d1b});
 const [d2,ap]=await call('POST','/partner/directory',{categoryCode:'CSL_LEGAL',displayName:'법무법인 한빛',intro:'민사 · 가사',contactPhone:'02-1234-5678',websiteUrl:'https://example.com',sido:'서울특별시'},pt);
 const ent=(ap||[]).find(x=>x.categoryCode==='CSL_LEGAL'); ok('정액 노출 신청 → 심사 중',d2<300&&ent&&ent.state==='PENDING',{d2,ent});
 const [d3,a1]=await call('POST',`/admin/directory/${ent.id}/activate`,{monthlyFee:100000,paidFrom:today0,paidTo:until0,paymentRef:'입금 확인 시험'},at);
 ok('자격 없으면 노출 켜기 거부',d3>=400&&JSON.stringify(a1).includes('DIRECTORY_QUALIFICATION'),{d3,a1});
 q(`insert into qualification_reviews(business_id,category_code,doc_no,lookup_done,lookup_by,lookup_at,state,decided_at,decided_by) values ('${BIZ}','LEGAL','시험-0001',true,'${ADM}',now(),'APPROVED',now(),'${ADM}') on conflict (business_id,category_code) do update set lookup_done=true,lookup_at=now(),state='APPROVED'`);
 const [d4,a2]=await call('POST',`/admin/directory/${ent.id}/activate`,{monthlyFee:0,paidFrom:today0,paidTo:until0,paymentRef:'x'},at); ok('노출료 0원 거부',d4>=400,{d4});
 const today=new Date(Date.now()+9*3600e3).toISOString().slice(0,10), until=new Date(Date.now()+40*86400e3).toISOString().slice(0,10);
 const [d5,a3]=await call('POST',`/admin/directory/${ent.id}/activate`,{monthlyFee:100000,paidFrom:today,paidTo:until,paymentRef:'입금 확인 시험'},at); ok('입금 확인 → 노출 켜기',d5<300&&a3.state==='ACTIVE',{d5,a3});
 const [d6,dir1]=await call('GET','/consult/directory/CSL_LEGAL'); ok('노출 목록에 업체 · 대표번호',d6===200&&dir1.entries.length===1&&dir1.entries[0].contactPhone==='02-1234-5678',{n:dir1.entries.length});
 ok('정액 노출형에서 리드 · 상담 신청 0건',q(`select count(*) from v_directory_lead_leak`)==='0');
 const [d7,e1]=await call('POST',`/admin/directory/${ent.id}/end`,{reason:'짧'},at); ok('사유 없는 종료 거부',d7>=400&&JSON.stringify(e1).includes('DIRECTORY_REASON'),{d7});
 const [d8]=await call('POST',`/admin/directory/${ent.id}/end`,{reason:'계약 기간 종료 요청'},at); const [,dir2]=await call('GET','/consult/directory/CSL_LEGAL'); ok('종료 → 목록에서 빠짐',d8<300&&dir2.entries.length===0,{d8});
 const [d9]=await call('GET','/admin/directory',null,pt); ok('일반 회원은 정액 노출 관리 거부',d9===403,{d9});
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});

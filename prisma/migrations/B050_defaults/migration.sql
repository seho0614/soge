-- =====================================================================
-- B050_defaults
--
-- 기본값 바인딩.
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

ALTER TABLE ONLY audit.audit_logs ALTER COLUMN id SET DEFAULT nextval('audit.audit_logs_id_seq'::regclass);

ALTER TABLE ONLY audit.pii_access_logs ALTER COLUMN id SET DEFAULT nextval('audit.pii_access_logs_id_seq'::regclass);

ALTER TABLE ONLY public.ad_events ALTER COLUMN id SET DEFAULT nextval('public.ad_events_id_seq'::regclass);

ALTER TABLE ONLY public.ad_leak_audits ALTER COLUMN id SET DEFAULT nextval('public.ad_leak_audits_id_seq'::regclass);

ALTER TABLE ONLY public.ad_waitlist ALTER COLUMN id SET DEFAULT nextval('public.ad_waitlist_id_seq'::regclass);

ALTER TABLE ONLY public.ai_decisions ALTER COLUMN id SET DEFAULT nextval('public.ai_decisions_id_seq'::regclass);

ALTER TABLE ONLY public.attribution_events ALTER COLUMN id SET DEFAULT nextval('public.attribution_events_id_seq'::regclass);

ALTER TABLE ONLY public.billing_attempts ALTER COLUMN id SET DEFAULT nextval('public.billing_attempts_id_seq'::regclass);

ALTER TABLE ONLY public.call_logs ALTER COLUMN id SET DEFAULT nextval('public.call_logs_id_seq'::regclass);

ALTER TABLE ONLY public.classify_logs ALTER COLUMN id SET DEFAULT nextval('public.classify_logs_id_seq'::regclass);

ALTER TABLE ONLY public.company_account_changes ALTER COLUMN id SET DEFAULT nextval('public.company_account_changes_id_seq'::regclass);

ALTER TABLE ONLY public.dispute_messages ALTER COLUMN id SET DEFAULT nextval('public.dispute_messages_id_seq'::regclass);

ALTER TABLE ONLY public.fee_agreements ALTER COLUMN id SET DEFAULT nextval('public.fee_agreements_id_seq'::regclass);

ALTER TABLE ONLY public.footer_links ALTER COLUMN id SET DEFAULT nextval('public.footer_links_id_seq'::regclass);

ALTER TABLE ONLY public.hlt_commission_changes ALTER COLUMN id SET DEFAULT nextval('public.hlt_commission_changes_id_seq'::regclass);

ALTER TABLE ONLY public.invite_deliveries ALTER COLUMN id SET DEFAULT nextval('public.invite_deliveries_id_seq'::regclass);

ALTER TABLE ONLY public.job_runs ALTER COLUMN id SET DEFAULT nextval('public.job_runs_id_seq'::regclass);

ALTER TABLE ONLY public.lead_fee_changes ALTER COLUMN id SET DEFAULT nextval('public.lead_fee_changes_id_seq'::regclass);

ALTER TABLE ONLY public.lead_fees ALTER COLUMN id SET DEFAULT nextval('public.lead_fees_id_seq'::regclass);

ALTER TABLE ONLY public.listing_versions ALTER COLUMN id SET DEFAULT nextval('public.listing_versions_id_seq'::regclass);

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);

ALTER TABLE ONLY public.notification_deliveries ALTER COLUMN id SET DEFAULT nextval('public.notification_deliveries_id_seq'::regclass);

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);

ALTER TABLE ONLY public.ops_alerts ALTER COLUMN id SET DEFAULT nextval('public.ops_alerts_id_seq'::regclass);

ALTER TABLE ONLY public.point_ledger ALTER COLUMN id SET DEFAULT nextval('public.point_ledger_id_seq'::regclass);

ALTER TABLE ONLY public.request_views ALTER COLUMN id SET DEFAULT nextval('public.request_views_id_seq'::regclass);

ALTER TABLE ONLY public.review_events ALTER COLUMN id SET DEFAULT nextval('public.review_events_id_seq'::regclass);

ALTER TABLE ONLY public.risk_actions ALTER COLUMN id SET DEFAULT nextval('public.risk_actions_id_seq'::regclass);

ALTER TABLE ONLY public.risk_alerts ALTER COLUMN id SET DEFAULT nextval('public.risk_alerts_id_seq'::regclass);

ALTER TABLE ONLY public.role_changes ALTER COLUMN id SET DEFAULT nextval('public.role_changes_id_seq'::regclass);

ALTER TABLE ONLY public.term_agreements ALTER COLUMN id SET DEFAULT nextval('public.term_agreements_id_seq'::regclass);

ALTER TABLE ONLY public.visitor_identities ALTER COLUMN id SET DEFAULT nextval('public.visitor_identities_id_seq'::regclass);

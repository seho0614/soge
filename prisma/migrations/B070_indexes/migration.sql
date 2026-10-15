-- =====================================================================
-- B070_indexes
--
-- 인덱스 127개.
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

CREATE INDEX idx_audit_actor ON audit.audit_logs USING btree (actor_account_id, occurred_at DESC);

CREATE INDEX idx_audit_target ON audit.audit_logs USING btree (target_type, target_id, occurred_at DESC);

CREATE INDEX idx_pii_access ON audit.pii_access_logs USING btree (actor_account_id, occurred_at DESC);

CREATE INDEX idx_ad_active ON public.ad_placements USING btree (slot_code, starts_at, ends_at) WHERE (status = 'ACTIVE'::text);

CREATE INDEX idx_ad_events_acct ON public.ad_events USING btree (account_id, creative_id, occurred_at DESC);

CREATE INDEX idx_ad_events_creative ON public.ad_events USING btree (creative_id, occurred_at DESC);

CREATE INDEX idx_ad_events_hash ON public.ad_events USING btree (member_hash);

CREATE INDEX idx_ad_invoices_adv ON public.ad_invoices USING btree (advertiser_id, created_at DESC);

CREATE INDEX idx_ad_invoices_due ON public.ad_invoices USING btree (due_date) WHERE (status = ANY (ARRAY['ISSUED'::text, 'PARTIAL'::text, 'OVERDUE'::text]));

CREATE INDEX idx_advertisers_active ON public.advertisers USING btree (status) WHERE (status = 'ACTIVE'::text);

CREATE INDEX idx_ai_decisions_acc ON public.ai_decisions USING btree (account_id, kind, decided_at DESC);

CREATE INDEX idx_ai_decisions_kind ON public.ai_decisions USING btree (kind, decided_at DESC);

CREATE INDEX idx_attr_account ON public.attribution_events USING btree (account_id, occurred_at) WHERE (account_id IS NOT NULL);

CREATE INDEX idx_attr_ad ON public.attribution_events USING btree (ad_creative_code) WHERE (source = 'AD'::text);

CREATE INDEX idx_attr_code ON public.attribution_events USING btree (code, occurred_at DESC);

CREATE INDEX idx_attr_lookup ON public.attribution_events USING btree (visitor_key, occurred_at);

CREATE INDEX idx_badges_listing ON public.listing_badges USING btree (listing_id, badge_type);

CREATE INDEX idx_banned_words_active ON public.banned_words USING btree (is_active, gwan_code);

CREATE INDEX idx_billing_attempts_day ON public.billing_attempts USING btree (subscription_id, attempted_at DESC);

CREATE INDEX idx_biz_region ON public.businesses USING btree (sido, sigungu) WHERE (sido IS NOT NULL);

CREATE INDEX idx_broker_state ON public.broker_verifications USING btree (state, recheck_due);

CREATE INDEX idx_businesses_account ON public.businesses USING btree (account_id);

CREATE INDEX idx_categories_gwan ON public.categories USING btree (gwan_code, status);

CREATE INDEX idx_classify_log_miss ON public.classify_logs USING btree (created_at DESC) WHERE (unclassified OR ((chosen IS NOT NULL) AND (chosen IS DISTINCT FROM suggested)));

CREATE INDEX idx_classify_log_time ON public.classify_logs USING btree (created_at DESC);

CREATE INDEX idx_code_labels_domain ON public.code_labels USING btree (domain, sort_order) WHERE is_active;

CREATE INDEX idx_contract_state ON public.deal_contracts USING btree (state, updated_at);

CREATE INDEX idx_conv_participant ON public.conversations USING btree (initiator_id, last_message_at DESC);

CREATE INDEX idx_crev_contract ON public.contract_revisions USING btree (contract_id, created_at);

CREATE INDEX idx_deals_introducer ON public.deals USING btree (introducer_account_id, status);

CREATE INDEX idx_deals_parties ON public.deals USING btree (buyer_account_id, seller_account_id);

CREATE INDEX idx_deals_status ON public.deals USING btree (status, created_at DESC);

CREATE INDEX idx_dpr_deal ON public.deal_payment_records USING btree (deal_id);

CREATE INDEX idx_events_live ON public.events USING btree (starts_at, ends_at) WHERE (status = 'PUBLISHED'::text);

CREATE UNIQUE INDEX idx_hlt_addr_default ON public.hlt_addresses USING btree (account_id) WHERE is_default;

CREATE INDEX idx_hlt_license_expiry ON public.hlt_seller_licenses USING btree (expires_at) WHERE (expires_at IS NOT NULL);

CREATE UNIQUE INDEX idx_hlt_seller_direct ON public.hlt_sellers USING btree (type) WHERE (type = 'DIRECT'::text);

CREATE INDEX idx_hlt_sellers_active ON public.hlt_sellers USING btree (status) WHERE (status = 'ACTIVE'::text);

CREATE INDEX idx_hlt_settle_period ON public.hlt_settlements USING btree (period_from DESC, seller_id);

CREATE INDEX idx_idem_created ON public.idempotency_records USING btree (created_at);

CREATE INDEX idx_idv_account ON public.identity_verifications USING btree (account_id, provider);

CREATE INDEX idx_invite_delivery ON public.invite_deliveries USING btree (invite_id, queued_at DESC);

CREATE INDEX idx_invite_request ON public.introduction_invites USING btree (request_id, state);

CREATE INDEX idx_job_runs_recent ON public.job_runs USING btree (job, started_at DESC);

CREATE INDEX idx_lead_fee_partner ON public.lead_fees USING btree (partner_id, incurred_at DESC);

CREATE INDEX idx_listings_browse ON public.listings USING btree (gwan_code, category_id, status, published_at DESC);

CREATE INDEX idx_listings_fee ON public.listings USING btree (desired_fee DESC NULLS LAST, id DESC) WHERE ((status = 'PUBLISHED'::text) AND (is_priority_exposed = false));

CREATE INDEX idx_listings_gwan_recent ON public.listings USING btree (gwan_code, published_at DESC NULLS LAST, id DESC) WHERE ((status = 'PUBLISHED'::text) AND (is_priority_exposed = false));

CREATE INDEX idx_listings_owner ON public.listings USING btree (owner_account_id, status);

CREATE INDEX idx_listings_priority ON public.listings USING btree (published_at DESC) WHERE ((status = 'PUBLISHED'::text) AND (is_priority_exposed = true));

CREATE INDEX idx_listings_recent ON public.listings USING btree (published_at DESC NULLS LAST, id DESC) WHERE ((status = 'PUBLISHED'::text) AND (is_priority_exposed = false));

CREATE INDEX idx_listings_search_trgm ON public.listings USING gin (lower(((COALESCE(title, ''::text) || ' '::text) || COALESCE(body, ''::text))) public.gin_trgm_ops);

CREATE INDEX idx_listings_title_lower ON public.listings USING btree (lower(title) text_pattern_ops);

CREATE INDEX idx_listings_title_trgm ON public.listings USING gin (title public.gin_trgm_ops);

CREATE INDEX idx_listings_urgent ON public.listings USING btree (gwan_code, badge_urgent_until DESC) WHERE ((status = 'PUBLISHED'::text) AND (badge_urgent_until IS NOT NULL));

CREATE INDEX idx_listings_view ON public.listings USING btree (view_count DESC, id DESC) WHERE ((status = 'PUBLISHED'::text) AND (is_priority_exposed = false));

CREATE INDEX idx_messages_conv ON public.messages USING btree (conversation_id, created_at);

CREATE INDEX idx_notif_unread ON public.notifications USING btree (account_id, created_at DESC) WHERE (read_at IS NULL);

CREATE INDEX idx_owner_verif_state ON public.owner_verifications USING btree (state, created_at);

CREATE UNIQUE INDEX idx_payout_default ON public.payout_accounts USING btree (account_id) WHERE is_default;

CREATE INDEX idx_payout_unverified ON public.payout_accounts USING btree (account_id) WHERE (NOT verified);

CREATE INDEX idx_point_ledger_acct ON public.point_ledger USING btree (account_id, earned_at DESC);

CREATE INDEX idx_refcodes_owner ON public.referral_codes USING btree (owner_account_id);

CREATE INDEX idx_reports_state ON public.reports USING btree (state, created_at);

CREATE INDEX idx_reports_target ON public.reports USING btree (target_type, target_id, state);

CREATE INDEX idx_request_views_sub ON public.request_views USING btree (subscription_id, viewed_at);

CREATE INDEX idx_requests_browse ON public.requests USING btree (gwan_code, status, created_at DESC);

CREATE INDEX idx_requests_recent ON public.requests USING btree (created_at DESC, id DESC) WHERE (status = 'PUBLISHED'::text);

CREATE INDEX idx_requests_search_trgm ON public.requests USING gin (lower(((COALESCE(title, ''::text) || ' '::text) || COALESCE(body, ''::text))) public.gin_trgm_ops);

CREATE INDEX idx_requests_title_lower ON public.requests USING btree (lower(title) text_pattern_ops);

CREATE INDEX idx_review_audit_sample ON public.review_items USING btree (decided_at DESC) WHERE (audit_sampled AND (decision_mode = 'AUTO'::text));

CREATE INDEX idx_review_queue ON public.review_items USING btree (status, sla_due_at) WHERE (status = ANY (ARRAY['QUEUED'::text, 'IN_PROGRESS'::text]));

CREATE INDEX idx_review_target ON public.review_items USING btree (target_type, target_id);

CREATE INDEX idx_risk_action ON public.risk_actions USING btree (alert_id, acted_at DESC);

CREATE INDEX idx_risk_alerts_open ON public.risk_alerts USING btree (state, occurred_at DESC);

CREATE INDEX idx_role_changes ON public.role_changes USING btree (account_id, changed_at DESC);

CREATE INDEX idx_safe_numbers_active ON public.safe_numbers USING btree (target_type, target_id) WHERE (released_at IS NULL);

CREATE INDEX idx_settlements_status ON public.settlements USING btree (status, requested_at);

CREATE INDEX idx_subscriptions_period ON public.subscriptions USING btree (current_period_end) WHERE (status = 'ACTIVE'::text);

CREATE INDEX idx_success_fee_payer ON public.success_fees USING btree (payer_account_id, status);

CREATE INDEX idx_term_agr_account ON public.term_agreements USING btree (account_id);

CREATE INDEX idx_vi_account ON public.visitor_identities USING btree (account_id);

CREATE INDEX idx_vi_visitor ON public.visitor_identities USING btree (visitor_key);

CREATE UNIQUE INDEX uq_badge_active ON public.listing_badges USING btree (listing_id, badge_type) WHERE (status = ANY (ARRAY['REQUESTED'::text, 'IN_REVIEW'::text, 'GRANTED'::text]));

CREATE UNIQUE INDEX uq_billing_key_active ON public.billing_keys USING btree (account_id) WHERE (status = 'ACTIVE'::text);

CREATE UNIQUE INDEX uq_biz_owner ON public.business_members USING btree (business_id) WHERE (member_role = 'OWNER'::text);

CREATE UNIQUE INDEX uq_delivery_idem ON public.notification_deliveries USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE UNIQUE INDEX uq_fee_locked ON public.fee_agreements USING btree (deal_id) WHERE (state = 'LOCKED'::text);

CREATE UNIQUE INDEX uq_gwan_primary ON public.gwans USING btree (is_primary) WHERE is_primary;

CREATE UNIQUE INDEX uq_rate_common ON public.lead_grade_rates USING btree (grade) WHERE (gwan_code IS NULL);

CREATE UNIQUE INDEX uq_rate_gwan ON public.lead_grade_rates USING btree (grade, gwan_code) WHERE (gwan_code IS NOT NULL);

CREATE UNIQUE INDEX uq_subscription_active ON public.subscriptions USING btree (account_id) WHERE (status = ANY (ARRAY['ACTIVE'::text, 'PAST_DUE'::text]));

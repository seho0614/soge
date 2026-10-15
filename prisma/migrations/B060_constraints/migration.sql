-- =====================================================================
-- B060_constraints
--
-- 기본키 · 유일제약 · CHECK 82개. CHECK 는 INSERT 와 UPDATE 양쪽에 걸리므로 트리거보다 안전합니다.
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

ALTER TABLE ONLY audit.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY audit.pii_access_logs
    ADD CONSTRAINT pii_access_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_roles
    ADD CONSTRAINT account_roles_pkey PRIMARY KEY (account_id, role);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_email_key UNIQUE (email);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ad_bookings
    ADD CONSTRAINT ad_bookings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ad_creative_segments
    ADD CONSTRAINT ad_creative_segments_pkey PRIMARY KEY (creative_id, segment_code);

ALTER TABLE ONLY public.ad_events
    ADD CONSTRAINT ad_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ad_invoices
    ADD CONSTRAINT ad_invoices_invoice_no_key UNIQUE (invoice_no);

ALTER TABLE ONLY public.ad_invoices
    ADD CONSTRAINT ad_invoices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ad_leak_audits
    ADD CONSTRAINT ad_leak_audits_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ad_payments
    ADD CONSTRAINT ad_payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ad_placements
    ADD CONSTRAINT ad_placements_creative_code_key UNIQUE (creative_code);

ALTER TABLE ONLY public.ad_placements
    ADD CONSTRAINT ad_placements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ad_products
    ADD CONSTRAINT ad_products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ad_segments
    ADD CONSTRAINT ad_segments_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.ad_slots
    ADD CONSTRAINT ad_slots_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.ad_waitlist
    ADD CONSTRAINT ad_waitlist_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.advertisers
    ADD CONSTRAINT advertisers_code_key UNIQUE (code);

ALTER TABLE ONLY public.advertisers
    ADD CONSTRAINT advertisers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_decisions
    ADD CONSTRAINT ai_decisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attribution_events
    ADD CONSTRAINT attribution_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attribution_policies
    ADD CONSTRAINT attribution_policies_pkey PRIMARY KEY (version);

ALTER TABLE ONLY public.audit_thresholds
    ADD CONSTRAINT audit_thresholds_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.auto_review_policies
    ADD CONSTRAINT auto_review_policies_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.banned_words
    ADD CONSTRAINT banned_words_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_attempts
    ADD CONSTRAINT billing_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_keys
    ADD CONSTRAINT billing_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.broker_verifications
    ADD CONSTRAINT broker_verifications_business_id_key UNIQUE (business_id);

ALTER TABLE ONLY public.broker_verifications
    ADD CONSTRAINT broker_verifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_pkey PRIMARY KEY (business_id, account_id);

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_biz_reg_no_key UNIQUE (biz_reg_no);

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_gwan_code_code_key UNIQUE (gwan_code, code);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.category_grades
    ADD CONSTRAINT category_grades_pkey PRIMARY KEY (category_id, effective_from);

ALTER TABLE ONLY public.category_matrix_axes
    ADD CONSTRAINT category_matrix_axes_category_id_axis_type_axis_key_key UNIQUE (category_id, axis_type, axis_key);

ALTER TABLE ONLY public.category_matrix_axes
    ADD CONSTRAINT category_matrix_axes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.classify_categories
    ADD CONSTRAINT classify_categories_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.classify_logs
    ADD CONSTRAINT classify_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.classify_vocab
    ADD CONSTRAINT classify_vocab_pkey PRIMARY KEY (category_code, term);

ALTER TABLE ONLY public.code_labels
    ADD CONSTRAINT code_labels_pkey PRIMARY KEY (domain, code);

ALTER TABLE ONLY public.collect_fetches
    ADD CONSTRAINT collect_fetches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.collect_items
    ADD CONSTRAINT collect_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.collect_items
    ADD CONSTRAINT collect_items_source_id_report_no_key UNIQUE (source_id, report_no);

ALTER TABLE ONLY public.collect_sources
    ADD CONSTRAINT collect_sources_code_key UNIQUE (code);

ALTER TABLE ONLY public.collect_sources
    ADD CONSTRAINT collect_sources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.company_account_changes
    ADD CONSTRAINT company_account_changes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.contract_revisions
    ADD CONSTRAINT contract_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.contract_templates
    ADD CONSTRAINT contract_templates_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_target_type_target_id_initiator_id_key UNIQUE (target_type, target_id, initiator_id);

ALTER TABLE ONLY public.deal_confirmations
    ADD CONSTRAINT deal_confirmations_pkey PRIMARY KEY (deal_id, party);

ALTER TABLE ONLY public.deal_contracts
    ADD CONSTRAINT deal_contracts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deal_payment_records
    ADD CONSTRAINT deal_payment_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deal_reviews
    ADD CONSTRAINT deal_reviews_deal_id_author_id_key UNIQUE (deal_id, author_id);

ALTER TABLE ONLY public.deal_reviews
    ADD CONSTRAINT deal_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dispute_messages
    ADD CONSTRAINT dispute_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.event_joins
    ADD CONSTRAINT event_joins_event_id_account_id_key UNIQUE (event_id, account_id);

ALTER TABLE ONLY public.event_joins
    ADD CONSTRAINT event_joins_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_code_key UNIQUE (code);

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ad_bookings
    ADD CONSTRAINT ex_ad_booking_recs EXCLUDE USING gist (slot_code WITH =, category WITH =, period WITH &&) WHERE (((slot_code = 'RECS'::text) AND (status = ANY (ARRAY['RESERVED'::text, 'CONFIRMED'::text]))));

ALTER TABLE ONLY public.ad_bookings
    ADD CONSTRAINT ex_ad_booking_single EXCLUDE USING gist (slot_code WITH =, period WITH &&) WHERE (((slot_code <> 'RECS'::text) AND (status = ANY (ARRAY['RESERVED'::text, 'CONFIRMED'::text]))));

ALTER TABLE ONLY public.faqs
    ADD CONSTRAINT faqs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (account_id, target_type, target_id);

ALTER TABLE ONLY public.fee_agreements
    ADD CONSTRAINT fee_agreements_deal_id_version_key UNIQUE (deal_id, version);

ALTER TABLE ONLY public.fee_agreements
    ADD CONSTRAINT fee_agreements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fee_guarantees
    ADD CONSTRAINT fee_guarantees_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fee_guidelines
    ADD CONSTRAINT fee_guidelines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.footer_links
    ADD CONSTRAINT footer_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.gwan_form_copy
    ADD CONSTRAINT gwan_form_copy_pkey PRIMARY KEY (gwan_code, role);

ALTER TABLE ONLY public.gwans
    ADD CONSTRAINT gwans_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.hlt_addresses
    ADD CONSTRAINT hlt_addresses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_cart_items
    ADD CONSTRAINT hlt_cart_items_account_id_product_id_key UNIQUE (account_id, product_id);

ALTER TABLE ONLY public.hlt_cart_items
    ADD CONSTRAINT hlt_cart_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_carts
    ADD CONSTRAINT hlt_carts_pkey PRIMARY KEY (account_id);

ALTER TABLE ONLY public.hlt_commission_changes
    ADD CONSTRAINT hlt_commission_changes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_commission_rates
    ADD CONSTRAINT hlt_commission_rates_category_code_key UNIQUE (category_code);

ALTER TABLE ONLY public.hlt_commission_rates
    ADD CONSTRAINT hlt_commission_rates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_order_items
    ADD CONSTRAINT hlt_order_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_orders
    ADD CONSTRAINT hlt_orders_order_no_key UNIQUE (order_no);

ALTER TABLE ONLY public.hlt_orders
    ADD CONSTRAINT hlt_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_payments
    ADD CONSTRAINT hlt_payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_products
    ADD CONSTRAINT hlt_products_code_key UNIQUE (code);

ALTER TABLE ONLY public.hlt_products
    ADD CONSTRAINT hlt_products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_returns
    ADD CONSTRAINT hlt_returns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_seller_licenses
    ADD CONSTRAINT hlt_seller_licenses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_sellers
    ADD CONSTRAINT hlt_sellers_code_key UNIQUE (code);

ALTER TABLE ONLY public.hlt_sellers
    ADD CONSTRAINT hlt_sellers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_settlement_items
    ADD CONSTRAINT hlt_settlement_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_settlements
    ADD CONSTRAINT hlt_settlements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hlt_settlements
    ADD CONSTRAINT hlt_settlements_seller_id_period_from_key UNIQUE (seller_id, period_from);

ALTER TABLE ONLY public.hlt_shipments
    ADD CONSTRAINT hlt_shipments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.identity_verifications
    ADD CONSTRAINT identity_verifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_code_key UNIQUE (code);

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.inquiries
    ADD CONSTRAINT inquiries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.introducer_profiles
    ADD CONSTRAINT introducer_profiles_pkey PRIMARY KEY (account_id);

ALTER TABLE ONLY public.introducer_referrals
    ADD CONSTRAINT introducer_referrals_invitee_id_key UNIQUE (invitee_id);

ALTER TABLE ONLY public.introducer_referrals
    ADD CONSTRAINT introducer_referrals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.introducer_responses
    ADD CONSTRAINT introducer_responses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.introducer_responses
    ADD CONSTRAINT introducer_responses_request_id_introducer_id_key UNIQUE (request_id, introducer_id);

ALTER TABLE ONLY public.introduction_connections
    ADD CONSTRAINT introduction_connections_invite_id_key UNIQUE (invite_id);

ALTER TABLE ONLY public.introduction_connections
    ADD CONSTRAINT introduction_connections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.introduction_invites
    ADD CONSTRAINT introduction_invites_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.introduction_invites
    ADD CONSTRAINT introduction_invites_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.invite_deliveries
    ADD CONSTRAINT invite_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.item_types
    ADD CONSTRAINT item_types_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_job_slot_key UNIQUE (job, slot);

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.job_schedules
    ADD CONSTRAINT job_schedules_pkey PRIMARY KEY (job);

ALTER TABLE ONLY public.lead_deliveries
    ADD CONSTRAINT lead_deliveries_lead_id_partner_id_key UNIQUE (lead_id, partner_id);

ALTER TABLE ONLY public.lead_deliveries
    ADD CONSTRAINT lead_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lead_fee_changes
    ADD CONSTRAINT lead_fee_changes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lead_fees
    ADD CONSTRAINT lead_fees_delivery_id_key UNIQUE (delivery_id);

ALTER TABLE ONLY public.lead_fees
    ADD CONSTRAINT lead_fees_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.listing_badges
    ADD CONSTRAINT listing_badges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.listing_checklist
    ADD CONSTRAINT listing_checklist_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.listing_media
    ADD CONSTRAINT listing_media_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.listing_regions
    ADD CONSTRAINT listing_regions_pkey PRIMARY KEY (listing_id, region_code);

ALTER TABLE ONLY public.listing_versions
    ADD CONSTRAINT listing_versions_listing_id_version_key UNIQUE (listing_id, version);

ALTER TABLE ONLY public.listing_versions
    ADD CONSTRAINT listing_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.main_copy
    ADD CONSTRAINT main_copy_pkey PRIMARY KEY (slot);

ALTER TABLE ONLY public.main_sections
    ADD CONSTRAINT main_sections_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.member_ad_profiles
    ADD CONSTRAINT member_ad_profiles_pkey PRIMARY KEY (account_id);

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notices
    ADD CONSTRAINT notices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notification_event_policies
    ADD CONSTRAINT notification_event_policies_pkey PRIMARY KEY (event_code);

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (account_id, event_code, channel);

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ops_alerts
    ADD CONSTRAINT ops_alerts_alert_code_raised_at_key UNIQUE (alert_code, raised_at);

ALTER TABLE ONLY public.ops_alerts
    ADD CONSTRAINT ops_alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.owner_verifications
    ADD CONSTRAINT owner_verifications_listing_id_key UNIQUE (listing_id);

ALTER TABLE ONLY public.owner_verifications
    ADD CONSTRAINT owner_verifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.partner_regions
    ADD CONSTRAINT partner_regions_pkey PRIMARY KEY (partner_id, sido, sigungu);

ALTER TABLE ONLY public.partner_services
    ADD CONSTRAINT partner_services_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_business_id_key UNIQUE (business_id);

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payout_accounts
    ADD CONSTRAINT payout_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pending_decisions
    ADD CONSTRAINT pending_decisions_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.point_ledger
    ADD CONSTRAINT point_ledger_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.point_rules
    ADD CONSTRAINT point_rules_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.profile_options
    ADD CONSTRAINT profile_options_pkey PRIMARY KEY (question_code, code);

ALTER TABLE ONLY public.profile_questions
    ADD CONSTRAINT profile_questions_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.property_listings
    ADD CONSTRAINT property_listings_pkey PRIMARY KEY (listing_id);

ALTER TABLE ONLY public.public_questions
    ADD CONSTRAINT public_questions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.qualification_reviews
    ADD CONSTRAINT qualification_reviews_business_id_category_code_key UNIQUE (business_id, category_code);

ALTER TABLE ONLY public.qualification_reviews
    ADD CONSTRAINT qualification_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.qualification_rules
    ADD CONSTRAINT qualification_rules_pkey PRIMARY KEY (category_code);

ALTER TABLE ONLY public.recommend_weights
    ADD CONSTRAINT recommend_weights_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_code_key UNIQUE (code);

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.report_reasons
    ADD CONSTRAINT report_reasons_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_target_type_target_id_reporter_id_key UNIQUE (target_type, target_id, reporter_id);

ALTER TABLE ONLY public.request_proposals
    ADD CONSTRAINT request_proposals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.request_proposals
    ADD CONSTRAINT request_proposals_request_id_proposer_account_id_key UNIQUE (request_id, proposer_account_id);

ALTER TABLE ONLY public.request_views
    ADD CONSTRAINT request_views_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.request_views
    ADD CONSTRAINT request_views_request_id_viewer_account_id_key UNIQUE (request_id, viewer_account_id);

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.restrict_vocab
    ADD CONSTRAINT restrict_vocab_pkey PRIMARY KEY (code, term);

ALTER TABLE ONLY public.restricted_industries
    ADD CONSTRAINT restricted_industries_code_gwan_code_key UNIQUE (code, gwan_code);

ALTER TABLE ONLY public.restricted_industries
    ADD CONSTRAINT restricted_industries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.review_reason_codes
    ADD CONSTRAINT review_reason_codes_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.risk_actions
    ADD CONSTRAINT risk_actions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.risk_alerts
    ADD CONSTRAINT risk_alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.risk_rules
    ADD CONSTRAINT risk_rules_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.role_changes
    ADD CONSTRAINT role_changes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.safe_numbers
    ADD CONSTRAINT safe_numbers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.safe_numbers
    ADD CONSTRAINT safe_numbers_virtual_no_key UNIQUE (virtual_no);

ALTER TABLE ONLY public.setting_placeholders
    ADD CONSTRAINT setting_placeholders_pkey PRIMARY KEY (token);

ALTER TABLE ONLY public.settlements
    ADD CONSTRAINT settlements_deal_id_key UNIQUE (deal_id);

ALTER TABLE ONLY public.settlements
    ADD CONSTRAINT settlements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.signup_types
    ADD CONSTRAINT signup_types_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.subscription_invoices
    ADD CONSTRAINT subscription_invoices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.success_fees
    ADD CONSTRAINT success_fees_deal_id_key UNIQUE (deal_id);

ALTER TABLE ONLY public.success_fees
    ADD CONSTRAINT success_fees_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.term_agreements
    ADD CONSTRAINT term_agreements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.terms
    ADD CONSTRAINT terms_pkey PRIMARY KEY (code, version);

ALTER TABLE ONLY public.trust_weights
    ADD CONSTRAINT trust_weights_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.ui_messages
    ADD CONSTRAINT ui_messages_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.subscription_invoices
    ADD CONSTRAINT uq_invoice_period UNIQUE (subscription_id, period_start);

ALTER TABLE ONLY public.term_agreements
    ADD CONSTRAINT uq_term_agreement UNIQUE (account_id, term_code, term_version);

ALTER TABLE ONLY public.visitor_identities
    ADD CONSTRAINT visitor_identities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.visitor_identities
    ADD CONSTRAINT visitor_identities_visitor_key_account_id_key UNIQUE (visitor_key, account_id);

ALTER TABLE ONLY public.withdrawal_rules
    ADD CONSTRAINT withdrawal_rules_pkey PRIMARY KEY (code);

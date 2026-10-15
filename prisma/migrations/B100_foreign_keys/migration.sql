-- =====================================================================
-- B100_foreign_keys
--
-- 외래키. 참조 대상이 모두 만들어진 뒤에 겁니다.
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

ALTER TABLE ONLY public.account_roles
    ADD CONSTRAINT account_roles_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_roles
    ADD CONSTRAINT account_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ad_bookings
    ADD CONSTRAINT ad_bookings_advertiser_id_fkey FOREIGN KEY (advertiser_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_bookings
    ADD CONSTRAINT ad_bookings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.ad_products(id);

ALTER TABLE ONLY public.ad_bookings
    ADD CONSTRAINT ad_bookings_slot_code_fkey FOREIGN KEY (slot_code) REFERENCES public.ad_slots(code);

ALTER TABLE ONLY public.ad_creative_segments
    ADD CONSTRAINT ad_creative_segments_creative_id_fkey FOREIGN KEY (creative_id) REFERENCES public.ad_placements(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_creative_segments
    ADD CONSTRAINT ad_creative_segments_segment_code_fkey FOREIGN KEY (segment_code) REFERENCES public.ad_segments(code);

ALTER TABLE ONLY public.ad_events
    ADD CONSTRAINT ad_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ad_events
    ADD CONSTRAINT ad_events_creative_id_fkey FOREIGN KEY (creative_id) REFERENCES public.ad_placements(id);

ALTER TABLE ONLY public.ad_events
    ADD CONSTRAINT ad_events_segment_code_fkey FOREIGN KEY (segment_code) REFERENCES public.ad_segments(code);

ALTER TABLE ONLY public.ad_events
    ADD CONSTRAINT ad_events_slot_code_fkey FOREIGN KEY (slot_code) REFERENCES public.ad_slots(code);

ALTER TABLE ONLY public.ad_invoices
    ADD CONSTRAINT ad_invoices_advertiser_id_fkey FOREIGN KEY (advertiser_id) REFERENCES public.advertisers(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.ad_invoices
    ADD CONSTRAINT ad_invoices_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.ad_bookings(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ad_invoices
    ADD CONSTRAINT ad_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ad_payments
    ADD CONSTRAINT ad_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.ad_invoices(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.ad_payments
    ADD CONSTRAINT ad_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.ad_placements
    ADD CONSTRAINT ad_placements_advertiser_business_id_fkey FOREIGN KEY (advertiser_business_id) REFERENCES public.businesses(id);

ALTER TABLE ONLY public.ad_placements
    ADD CONSTRAINT ad_placements_slot_code_fkey FOREIGN KEY (slot_code) REFERENCES public.ad_slots(code);

ALTER TABLE ONLY public.ad_products
    ADD CONSTRAINT ad_products_slot_code_fkey FOREIGN KEY (slot_code) REFERENCES public.ad_slots(code);

ALTER TABLE ONLY public.ad_slots
    ADD CONSTRAINT ad_slots_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.ad_waitlist
    ADD CONSTRAINT ad_waitlist_advertiser_id_fkey FOREIGN KEY (advertiser_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_waitlist
    ADD CONSTRAINT ad_waitlist_slot_code_fkey FOREIGN KEY (slot_code) REFERENCES public.ad_slots(code);

ALTER TABLE ONLY public.advertisers
    ADD CONSTRAINT advertisers_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ai_decisions
    ADD CONSTRAINT ai_decisions_account_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.attribution_events
    ADD CONSTRAINT attribution_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.auto_review_policies
    ADD CONSTRAINT auto_review_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.banned_words
    ADD CONSTRAINT banned_words_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.banned_words
    ADD CONSTRAINT banned_words_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.billing_attempts
    ADD CONSTRAINT billing_attempts_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.billing_keys
    ADD CONSTRAINT billing_keys_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.broker_verifications
    ADD CONSTRAINT broker_verifications_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.broker_verifications
    ADD CONSTRAINT broker_verifications_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_safe_number_id_fkey FOREIGN KEY (safe_number_id) REFERENCES public.safe_numbers(id);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_labor_law_checked_by_fkey FOREIGN KEY (labor_law_checked_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.category_grades
    ADD CONSTRAINT category_grades_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.category_grades
    ADD CONSTRAINT category_grades_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.category_matrix_axes
    ADD CONSTRAINT category_matrix_axes_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classify_categories
    ADD CONSTRAINT classify_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.classify_categories
    ADD CONSTRAINT classify_categories_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.classify_logs
    ADD CONSTRAINT classify_logs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.classify_logs
    ADD CONSTRAINT classify_logs_chosen_fkey FOREIGN KEY (chosen) REFERENCES public.classify_categories(code);

ALTER TABLE ONLY public.classify_logs
    ADD CONSTRAINT classify_logs_suggested_fkey FOREIGN KEY (suggested) REFERENCES public.classify_categories(code);

ALTER TABLE ONLY public.classify_vocab
    ADD CONSTRAINT classify_vocab_category_code_fkey FOREIGN KEY (category_code) REFERENCES public.classify_categories(code) ON DELETE CASCADE;

ALTER TABLE ONLY public.collect_fetches
    ADD CONSTRAINT collect_fetches_run_by_fkey FOREIGN KEY (run_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.collect_fetches
    ADD CONSTRAINT collect_fetches_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.collect_sources(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.collect_items
    ADD CONSTRAINT collect_items_fetch_id_fkey FOREIGN KEY (fetch_id) REFERENCES public.collect_fetches(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.collect_items
    ADD CONSTRAINT collect_items_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.collect_sources(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.collect_sources
    ADD CONSTRAINT collect_sources_legal_by_fkey FOREIGN KEY (legal_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.collect_sources
    ADD CONSTRAINT collect_sources_robots_by_fkey FOREIGN KEY (robots_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.collect_sources
    ADD CONSTRAINT collect_sources_unblocked_by_fkey FOREIGN KEY (unblocked_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.company_account_changes
    ADD CONSTRAINT company_account_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.contract_revisions
    ADD CONSTRAINT contract_revisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.contract_revisions
    ADD CONSTRAINT contract_revisions_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.deal_contracts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_counterpart_id_fkey FOREIGN KEY (counterpart_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_initiator_id_fkey FOREIGN KEY (initiator_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.deal_confirmations
    ADD CONSTRAINT deal_confirmations_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.deal_confirmations
    ADD CONSTRAINT deal_confirmations_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deal_contracts
    ADD CONSTRAINT deal_contracts_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deal_contracts
    ADD CONSTRAINT deal_contracts_fee_agreement_id_fkey FOREIGN KEY (fee_agreement_id) REFERENCES public.fee_agreements(id);

ALTER TABLE ONLY public.deal_contracts
    ADD CONSTRAINT deal_contracts_last_actor_id_fkey FOREIGN KEY (last_actor_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.deal_contracts
    ADD CONSTRAINT deal_contracts_template_fk FOREIGN KEY (template_code) REFERENCES public.contract_templates(code) ON DELETE RESTRICT;

ALTER TABLE ONLY public.deal_payment_records
    ADD CONSTRAINT deal_payment_records_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deal_payment_records
    ADD CONSTRAINT deal_payment_records_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.deal_reviews
    ADD CONSTRAINT deal_reviews_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.deal_reviews
    ADD CONSTRAINT deal_reviews_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deal_reviews
    ADD CONSTRAINT deal_reviews_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_attributed_event_id_fkey FOREIGN KEY (attributed_event_id) REFERENCES public.attribution_events(id);

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_attribution_policy_version_fkey FOREIGN KEY (attribution_policy_version) REFERENCES public.attribution_policies(version);

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_buyer_account_id_fkey FOREIGN KEY (buyer_account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_introducer_account_id_fkey FOREIGN KEY (introducer_account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id);

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id);

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_seller_account_id_fkey FOREIGN KEY (seller_account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.dispute_messages
    ADD CONSTRAINT dispute_messages_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.disputes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dispute_messages
    ADD CONSTRAINT dispute_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id);

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.event_joins
    ADD CONSTRAINT event_joins_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.event_joins
    ADD CONSTRAINT event_joins_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.event_joins
    ADD CONSTRAINT event_joins_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.faqs
    ADD CONSTRAINT faqs_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.faqs
    ADD CONSTRAINT faqs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fee_agreements
    ADD CONSTRAINT fee_agreements_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fee_agreements
    ADD CONSTRAINT fee_agreements_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.fee_guarantees
    ADD CONSTRAINT fee_guarantees_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fee_guarantees
    ADD CONSTRAINT fee_guarantees_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fee_guarantees
    ADD CONSTRAINT fee_guarantees_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.fee_guidelines
    ADD CONSTRAINT fee_guidelines_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.fee_guidelines
    ADD CONSTRAINT fee_guidelines_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.settlements
    ADD CONSTRAINT fk_settlement_dispute FOREIGN KEY (held_by_dispute_id) REFERENCES public.disputes(id);

ALTER TABLE ONLY public.gwan_form_copy
    ADD CONSTRAINT gwan_form_copy_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.gwans
    ADD CONSTRAINT gwans_parent_code_fkey FOREIGN KEY (parent_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.hlt_addresses
    ADD CONSTRAINT hlt_addresses_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hlt_cart_items
    ADD CONSTRAINT hlt_cart_items_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.hlt_carts(account_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hlt_cart_items
    ADD CONSTRAINT hlt_cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.hlt_products(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hlt_carts
    ADD CONSTRAINT hlt_carts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hlt_commission_changes
    ADD CONSTRAINT hlt_commission_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.hlt_commission_rates
    ADD CONSTRAINT hlt_commission_rates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.hlt_order_items
    ADD CONSTRAINT hlt_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.hlt_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hlt_order_items
    ADD CONSTRAINT hlt_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.hlt_products(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.hlt_orders
    ADD CONSTRAINT hlt_orders_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.hlt_orders
    ADD CONSTRAINT hlt_orders_address_id_fkey FOREIGN KEY (address_id) REFERENCES public.hlt_addresses(id);

ALTER TABLE ONLY public.hlt_orders
    ADD CONSTRAINT hlt_orders_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.hlt_sellers(id);

ALTER TABLE ONLY public.hlt_payments
    ADD CONSTRAINT hlt_payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.hlt_orders(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.hlt_products
    ADD CONSTRAINT hlt_products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.hlt_products
    ADD CONSTRAINT hlt_products_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.hlt_sellers(id);

ALTER TABLE ONLY public.hlt_products
    ADD CONSTRAINT hlt_products_withdrawal_code_fkey FOREIGN KEY (withdrawal_code) REFERENCES public.withdrawal_rules(code);

ALTER TABLE ONLY public.hlt_returns
    ADD CONSTRAINT hlt_returns_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.hlt_returns
    ADD CONSTRAINT hlt_returns_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.hlt_orders(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.hlt_seller_licenses
    ADD CONSTRAINT hlt_seller_licenses_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.hlt_sellers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hlt_seller_licenses
    ADD CONSTRAINT hlt_seller_licenses_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.hlt_sellers
    ADD CONSTRAINT hlt_sellers_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.hlt_settlement_items
    ADD CONSTRAINT hlt_settlement_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.hlt_orders(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.hlt_settlement_items
    ADD CONSTRAINT hlt_settlement_items_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.hlt_settlements(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hlt_settlements
    ADD CONSTRAINT hlt_settlements_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.hlt_settlements
    ADD CONSTRAINT hlt_settlements_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.hlt_sellers(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.hlt_shipments
    ADD CONSTRAINT hlt_shipments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.hlt_orders(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.identity_verifications
    ADD CONSTRAINT identity_verifications_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.inquiries
    ADD CONSTRAINT inquiries_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.introducer_profiles
    ADD CONSTRAINT introducer_profiles_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.introducer_referrals
    ADD CONSTRAINT introducer_referrals_invitee_id_fkey FOREIGN KEY (invitee_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.introducer_referrals
    ADD CONSTRAINT introducer_referrals_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.introducer_responses
    ADD CONSTRAINT introducer_responses_introducer_id_fkey FOREIGN KEY (introducer_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.introducer_responses
    ADD CONSTRAINT introducer_responses_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.introduction_connections
    ADD CONSTRAINT introduction_connections_introducer_id_fkey FOREIGN KEY (introducer_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.introduction_connections
    ADD CONSTRAINT introduction_connections_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.introduction_invites(id);

ALTER TABLE ONLY public.introduction_connections
    ADD CONSTRAINT introduction_connections_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id);

ALTER TABLE ONLY public.introduction_connections
    ADD CONSTRAINT introduction_connections_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.introduction_invites
    ADD CONSTRAINT introduction_invites_consented_by_fkey FOREIGN KEY (consented_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.introduction_invites
    ADD CONSTRAINT introduction_invites_introducer_id_fkey FOREIGN KEY (introducer_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.introduction_invites
    ADD CONSTRAINT introduction_invites_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.invite_deliveries
    ADD CONSTRAINT invite_deliveries_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.introduction_invites(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lead_deliveries
    ADD CONSTRAINT lead_deliveries_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lead_deliveries
    ADD CONSTRAINT lead_deliveries_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lead_fee_changes
    ADD CONSTRAINT lead_fee_changes_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lead_fee_changes
    ADD CONSTRAINT lead_fee_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.lead_fees
    ADD CONSTRAINT lead_fees_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.lead_deliveries(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lead_fees
    ADD CONSTRAINT lead_fees_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lead_fees
    ADD CONSTRAINT lead_fees_void_rule_fkey FOREIGN KEY (void_rule) REFERENCES public.risk_rules(code);

ALTER TABLE ONLY public.lead_grade_rates
    ADD CONSTRAINT lead_grade_rates_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.listing_badges
    ADD CONSTRAINT listing_badges_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.listing_badges
    ADD CONSTRAINT listing_badges_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.listing_badges
    ADD CONSTRAINT listing_badges_reject_reason_code_fkey FOREIGN KEY (reject_reason_code) REFERENCES public.review_reason_codes(code);

ALTER TABLE ONLY public.listing_badges
    ADD CONSTRAINT listing_badges_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.listing_checklist
    ADD CONSTRAINT listing_checklist_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.listing_media
    ADD CONSTRAINT listing_media_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.listing_regions
    ADD CONSTRAINT listing_regions_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.listing_regions
    ADD CONSTRAINT listing_regions_region_code_fkey FOREIGN KEY (region_code) REFERENCES public.regions(code);

ALTER TABLE ONLY public.listing_versions
    ADD CONSTRAINT listing_versions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.listing_versions
    ADD CONSTRAINT listing_versions_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_item_type_fkey FOREIGN KEY (item_type) REFERENCES public.item_types(code);

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_owner_account_id_fkey FOREIGN KEY (owner_account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.member_ad_profiles
    ADD CONSTRAINT member_ad_profiles_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.member_ad_profiles
    ADD CONSTRAINT member_ad_profiles_segment_code_fkey FOREIGN KEY (segment_code) REFERENCES public.ad_segments(code);

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.notices
    ADD CONSTRAINT notices_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.notices
    ADD CONSTRAINT notices_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_template_code_fkey FOREIGN KEY (template_code) REFERENCES public.notification_templates(code);

ALTER TABLE ONLY public.ops_alerts
    ADD CONSTRAINT ops_alerts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.owner_verifications
    ADD CONSTRAINT owner_verifications_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.owner_verifications
    ADD CONSTRAINT owner_verifications_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.owner_verifications
    ADD CONSTRAINT owner_verifications_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.partner_regions
    ADD CONSTRAINT partner_regions_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.partner_services
    ADD CONSTRAINT partner_services_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.partner_services
    ADD CONSTRAINT partner_services_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payout_accounts
    ADD CONSTRAINT payout_accounts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.point_ledger
    ADD CONSTRAINT point_ledger_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.point_ledger
    ADD CONSTRAINT point_ledger_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.introduction_connections(id);

ALTER TABLE ONLY public.point_ledger
    ADD CONSTRAINT point_ledger_rule_code_fkey FOREIGN KEY (rule_code) REFERENCES public.point_rules(code);

ALTER TABLE ONLY public.profile_options
    ADD CONSTRAINT profile_options_question_code_fkey FOREIGN KEY (question_code) REFERENCES public.profile_questions(code) ON DELETE CASCADE;

ALTER TABLE ONLY public.property_listings
    ADD CONSTRAINT property_listings_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.property_listings
    ADD CONSTRAINT property_listings_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.public_questions
    ADD CONSTRAINT public_questions_asker_id_fkey FOREIGN KEY (asker_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.public_questions
    ADD CONSTRAINT public_questions_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.qualification_reviews
    ADD CONSTRAINT qualification_reviews_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.qualification_reviews
    ADD CONSTRAINT qualification_reviews_category_code_fkey FOREIGN KEY (category_code) REFERENCES public.qualification_rules(category_code);

ALTER TABLE ONLY public.qualification_reviews
    ADD CONSTRAINT qualification_reviews_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.qualification_reviews
    ADD CONSTRAINT qualification_reviews_lookup_by_fkey FOREIGN KEY (lookup_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_owner_account_id_fkey FOREIGN KEY (owner_account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id);

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_parent_code_fkey FOREIGN KEY (parent_code) REFERENCES public.regions(code);

ALTER TABLE ONLY public.report_reasons
    ADD CONSTRAINT report_reasons_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reason_code_fkey FOREIGN KEY (reason_code) REFERENCES public.report_reasons(code);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.request_proposals
    ADD CONSTRAINT request_proposals_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id);

ALTER TABLE ONLY public.request_proposals
    ADD CONSTRAINT request_proposals_proposer_account_id_fkey FOREIGN KEY (proposer_account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.request_proposals
    ADD CONSTRAINT request_proposals_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.request_views
    ADD CONSTRAINT request_views_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.request_views
    ADD CONSTRAINT request_views_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id);

ALTER TABLE ONLY public.request_views
    ADD CONSTRAINT request_views_viewer_account_id_fkey FOREIGN KEY (viewer_account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_item_type_fkey FOREIGN KEY (item_type) REFERENCES public.item_types(code);

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_owner_account_id_fkey FOREIGN KEY (owner_account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.restricted_industries
    ADD CONSTRAINT restricted_industries_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.restricted_industries
    ADD CONSTRAINT restricted_industries_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_reason_code_fkey FOREIGN KEY (reason_code) REFERENCES public.review_reason_codes(code);

ALTER TABLE ONLY public.review_events
    ADD CONSTRAINT review_events_review_item_id_fkey FOREIGN KEY (review_item_id) REFERENCES public.review_items(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_decision_by_fkey FOREIGN KEY (decision_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_reject_reason_code_fkey FOREIGN KEY (reject_reason_code) REFERENCES public.review_reason_codes(code);

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.risk_actions
    ADD CONSTRAINT risk_actions_acted_by_fkey FOREIGN KEY (acted_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.risk_actions
    ADD CONSTRAINT risk_actions_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.risk_alerts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.risk_alerts
    ADD CONSTRAINT risk_alerts_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.risk_alerts
    ADD CONSTRAINT risk_alerts_rule_code_fkey FOREIGN KEY (rule_code) REFERENCES public.risk_rules(code);

ALTER TABLE ONLY public.role_changes
    ADD CONSTRAINT role_changes_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.role_changes
    ADD CONSTRAINT role_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.settlements
    ADD CONSTRAINT settlements_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id);

ALTER TABLE ONLY public.settlements
    ADD CONSTRAINT settlements_paid_marked_by_fkey FOREIGN KEY (paid_marked_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.settlements
    ADD CONSTRAINT settlements_payee_account_id_fkey FOREIGN KEY (payee_account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.settlements
    ADD CONSTRAINT settlements_payee_business_id_fkey FOREIGN KEY (payee_business_id) REFERENCES public.businesses(id);

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.subscription_invoices
    ADD CONSTRAINT subscription_invoices_billing_key_id_fkey FOREIGN KEY (billing_key_id) REFERENCES public.billing_keys(id);

ALTER TABLE ONLY public.subscription_invoices
    ADD CONSTRAINT subscription_invoices_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_code_fkey FOREIGN KEY (plan_code) REFERENCES public.subscription_plans(code);

ALTER TABLE ONLY public.success_fees
    ADD CONSTRAINT success_fees_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.success_fees
    ADD CONSTRAINT success_fees_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.subscription_invoices(id);

ALTER TABLE ONLY public.success_fees
    ADD CONSTRAINT success_fees_payer_account_id_fkey FOREIGN KEY (payer_account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.term_agreements
    ADD CONSTRAINT term_agreements_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

ALTER TABLE ONLY public.term_agreements
    ADD CONSTRAINT term_agreements_term_code_term_version_fkey FOREIGN KEY (term_code, term_version) REFERENCES public.terms(code, version);

ALTER TABLE ONLY public.terms
    ADD CONSTRAINT terms_gwan_code_fkey FOREIGN KEY (gwan_code) REFERENCES public.gwans(code);

ALTER TABLE ONLY public.visitor_identities
    ADD CONSTRAINT visitor_identities_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);

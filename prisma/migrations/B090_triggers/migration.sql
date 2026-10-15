-- =====================================================================
-- B090_triggers
--
-- 트리거 50개. 불변식이 실제로 집행되는 자리입니다.
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

CREATE TRIGGER trg_audit_logs_block BEFORE DELETE OR UPDATE ON audit.audit_logs FOR EACH ROW EXECUTE FUNCTION public.fn_block_audit_write();

CREATE TRIGGER trg_pii_access_ro BEFORE DELETE OR UPDATE ON audit.pii_access_logs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

CREATE TRIGGER trg_redact_audit BEFORE INSERT ON audit.audit_logs FOR EACH ROW EXECUTE FUNCTION public.fn_redact_audit();

CREATE TRIGGER trg_account_change_log AFTER UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.fn_account_change_log();

CREATE TRIGGER trg_account_change_ro BEFORE DELETE OR UPDATE ON public.company_account_changes FOR EACH ROW EXECUTE FUNCTION public.fn_account_change_ro();

CREATE TRIGGER trg_account_withdraw BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.fn_set_retention_on_withdraw();

CREATE TRIGGER trg_accounts_upd BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_ad_active_slot BEFORE INSERT OR UPDATE ON public.ad_placements FOR EACH ROW EXECUTE FUNCTION public.fn_ad_active_slot_guard();

CREATE TRIGGER trg_ad_attribution BEFORE INSERT OR UPDATE ON public.attribution_events FOR EACH ROW EXECUTE FUNCTION public.fn_ad_attribution_guard();

CREATE TRIGGER trg_ad_booking_gate BEFORE INSERT OR UPDATE ON public.ad_bookings FOR EACH ROW EXECUTE FUNCTION public.fn_ad_booking_gate();

CREATE TRIGGER trg_ad_events_ro BEFORE DELETE OR UPDATE ON public.ad_events FOR EACH ROW EXECUTE FUNCTION public.fn_ad_events_append_only();

CREATE TRIGGER trg_ad_external_gate BEFORE INSERT ON public.ad_bookings FOR EACH ROW EXECUTE FUNCTION public.fn_ad_external_gate();

CREATE TRIGGER trg_ad_invoice BEFORE INSERT OR UPDATE ON public.ad_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_ad_invoice_guard();

CREATE TRIGGER trg_ad_payment_apply AFTER INSERT ON public.ad_payments FOR EACH ROW EXECUTE FUNCTION public.fn_ad_payment_apply();

CREATE TRIGGER trg_ad_payment_ro BEFORE DELETE OR UPDATE ON public.ad_payments FOR EACH ROW EXECUTE FUNCTION public.fn_ad_payment_ro();

CREATE TRIGGER trg_ad_seg_regulated BEFORE INSERT ON public.ad_creative_segments FOR EACH ROW EXECUTE FUNCTION public.fn_ad_regulated_gate();

CREATE TRIGGER trg_ad_slot_gate BEFORE INSERT OR UPDATE ON public.ad_placements FOR EACH ROW EXECUTE FUNCTION public.fn_ad_slot_gate();

CREATE TRIGGER trg_ai_decision_ro BEFORE DELETE OR UPDATE ON public.ai_decisions FOR EACH ROW EXECUTE FUNCTION public.fn_ai_decision_ro();

CREATE TRIGGER trg_ai_match_no_fee BEFORE INSERT OR UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.fn_ai_match_no_fee();

CREATE TRIGGER trg_archive_prior_terms AFTER UPDATE ON public.terms FOR EACH ROW EXECUTE FUNCTION public.fn_archive_prior_terms();

CREATE TRIGGER trg_attr_ro BEFORE DELETE OR UPDATE ON public.attribution_events FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

CREATE TRIGGER trg_auto_review AFTER INSERT ON public.review_items FOR EACH ROW EXECUTE FUNCTION public.fn_auto_review_on_enqueue();

CREATE TRIGGER trg_badge_decision AFTER UPDATE ON public.review_items FOR EACH ROW EXECUTE FUNCTION public.fn_badge_apply_decision();

CREATE TRIGGER trg_badge_enqueue AFTER INSERT ON public.listing_badges FOR EACH ROW EXECUTE FUNCTION public.fn_badge_enqueue();

CREATE TRIGGER trg_badge_revoke_on_edit BEFORE UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_revoke_badge_on_edit();

CREATE TRIGGER trg_bank_assume AFTER UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.fn_bank_assume_off();

CREATE TRIGGER trg_billing_attempt_ro BEFORE DELETE OR UPDATE ON public.billing_attempts FOR EACH ROW EXECUTE FUNCTION public.fn_billing_attempt_ro();

CREATE TRIGGER trg_biz_type_guard BEFORE INSERT OR UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.fn_biz_type_guard();

CREATE TRIGGER trg_broker_gate BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_broker_gate();

CREATE TRIGGER trg_broker_guard BEFORE INSERT OR UPDATE ON public.broker_verifications FOR EACH ROW EXECUTE FUNCTION public.fn_broker_guard();

CREATE TRIGGER trg_broker_sync AFTER INSERT OR UPDATE ON public.broker_verifications FOR EACH ROW EXECUTE FUNCTION public.fn_broker_sync();

CREATE TRIGGER trg_businesses_upd BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_call_attribution AFTER INSERT ON public.call_logs FOR EACH ROW EXECUTE FUNCTION public.fn_attribute_call();

CREATE TRIGGER trg_call_logs_ro BEFORE DELETE OR UPDATE ON public.call_logs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

CREATE TRIGGER trg_category_labor_law BEFORE INSERT OR UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.fn_assert_labor_law_check();

CREATE TRIGGER trg_category_restrict_cascade AFTER UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.fn_category_restrict_cascade();

CREATE TRIGGER trg_collect_gate BEFORE INSERT OR UPDATE ON public.collect_sources FOR EACH ROW EXECUTE FUNCTION public.fn_collect_gate();

CREATE TRIGGER trg_collect_item BEFORE INSERT ON public.collect_items FOR EACH ROW EXECUTE FUNCTION public.fn_collect_item_guard();

CREATE TRIGGER trg_connection_consent BEFORE INSERT ON public.introduction_connections FOR EACH ROW EXECUTE FUNCTION public.fn_connection_requires_consent();

CREATE TRIGGER trg_contract_auto_confirm AFTER UPDATE ON public.deal_contracts FOR EACH ROW EXECUTE FUNCTION public.fn_auto_confirm_on_contract();

CREATE TRIGGER trg_contract_fulfil AFTER UPDATE ON public.deal_contracts FOR EACH ROW EXECUTE FUNCTION public.fn_contract_fulfil();

CREATE TRIGGER trg_contract_guard BEFORE UPDATE ON public.deal_contracts FOR EACH ROW EXECUTE FUNCTION public.fn_contract_guard();

CREATE TRIGGER trg_contract_lock_fee BEFORE INSERT ON public.deal_contracts FOR EACH ROW EXECUTE FUNCTION public.fn_lock_fee_on_contract();

CREATE TRIGGER trg_crev_ro BEFORE DELETE OR UPDATE ON public.contract_revisions FOR EACH ROW EXECUTE FUNCTION public.fn_crev_ro();

CREATE TRIGGER trg_deal_actor_gate BEFORE INSERT ON public.deals FOR EACH ROW EXECUTE FUNCTION public.fn_gate_deal_actor();

CREATE TRIGGER trg_deal_attr_snapshot BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.fn_assert_attribution_snapshot();

CREATE TRIGGER trg_deal_fee_lock BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.fn_assert_agreed_fee_matches_lock();

CREATE TRIGGER trg_deal_inv4 BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.fn_assert_both_confirmed();

CREATE TRIGGER trg_deal_inv4_ins BEFORE INSERT ON public.deals FOR EACH ROW EXECUTE FUNCTION public.fn_assert_both_confirmed_ins();

CREATE TRIGGER trg_deal_success_fee AFTER INSERT OR UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.fn_charge_success_fee();

CREATE TRIGGER trg_deals_upd BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_delivery_ro BEFORE DELETE OR UPDATE ON public.notification_deliveries FOR EACH ROW EXECUTE FUNCTION public.fn_delivery_ro();

CREATE TRIGGER trg_dispute_hold AFTER INSERT ON public.disputes FOR EACH ROW EXECUTE FUNCTION public.fn_hold_settlement_on_dispute();

CREATE TRIGGER trg_duty_separation BEFORE INSERT OR UPDATE ON public.account_roles FOR EACH ROW EXECUTE FUNCTION public.fn_duty_separation();

CREATE TRIGGER trg_event_guard BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.fn_event_guard();

CREATE TRIGGER trg_event_join_guard BEFORE INSERT ON public.event_joins FOR EACH ROW EXECUTE FUNCTION public.fn_event_join_guard();

CREATE TRIGGER trg_event_join_ro BEFORE DELETE ON public.event_joins FOR EACH ROW EXECUTE FUNCTION public.fn_event_join_ro();

CREATE TRIGGER trg_fee_agr_feature BEFORE INSERT ON public.fee_agreements FOR EACH ROW EXECUTE FUNCTION public.fn_block_fee_agreement_when_off();

CREATE TRIGGER trg_fee_agr_ro BEFORE DELETE OR UPDATE ON public.fee_agreements FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

CREATE TRIGGER trg_gated_category BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_gated_category_guard();

CREATE TRIGGER trg_gwan_open BEFORE UPDATE ON public.gwans FOR EACH ROW EXECUTE FUNCTION public.fn_assert_gwan_open();

CREATE TRIGGER trg_hlt_cart BEFORE INSERT OR UPDATE ON public.hlt_cart_items FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_cart_guard();

CREATE TRIGGER trg_hlt_change_ro BEFORE DELETE OR UPDATE ON public.hlt_commission_changes FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_change_ro();

CREATE TRIGGER trg_hlt_one_seller BEFORE INSERT ON public.hlt_order_items FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_one_seller();

CREATE TRIGGER trg_hlt_order_seller BEFORE INSERT ON public.hlt_order_items FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_order_seller_guard();

CREATE TRIGGER trg_hlt_pay_apply AFTER INSERT OR UPDATE ON public.hlt_payments FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_pay_apply();

CREATE TRIGGER trg_hlt_product BEFORE INSERT OR UPDATE ON public.hlt_products FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_product_guard();

CREATE TRIGGER trg_hlt_rate_cat AFTER INSERT OR UPDATE ON public.hlt_commission_rates FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_rate_changed();

CREATE TRIGGER trg_hlt_rate_log AFTER INSERT OR UPDATE ON public.hlt_commission_rates FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_rate_log();

CREATE TRIGGER trg_hlt_rate_log_ro BEFORE DELETE OR UPDATE ON public.hlt_commission_changes FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_rate_log_ro();

CREATE TRIGGER trg_hlt_rate_seller AFTER INSERT OR UPDATE ON public.hlt_sellers FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_rate_changed();

CREATE TRIGGER trg_hlt_return BEFORE INSERT OR UPDATE ON public.hlt_returns FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_return_guard();

CREATE TRIGGER trg_hlt_sale_gate BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_sale_gate();

CREATE TRIGGER trg_hlt_settle BEFORE INSERT OR UPDATE ON public.hlt_settlements FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_settle_guard();

CREATE TRIGGER trg_hlt_settle_flow BEFORE UPDATE ON public.hlt_settlements FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_settle_flow();

CREATE TRIGGER trg_hlt_settlement BEFORE INSERT OR UPDATE ON public.hlt_settlements FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_settlement_guard();

CREATE TRIGGER trg_hlt_ship AFTER INSERT ON public.hlt_shipments FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_ship_apply();

CREATE TRIGGER trg_hlt_stock BEFORE INSERT ON public.hlt_order_items FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_stock_guard();

CREATE TRIGGER trg_hub_no_listing BEFORE INSERT ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_hub_no_listing();

CREATE TRIGGER trg_infeed_label BEFORE INSERT OR UPDATE ON public.ad_slots FOR EACH ROW EXECUTE FUNCTION public.fn_infeed_label_guard();

CREATE TRIGGER trg_invite_contact_purge BEFORE UPDATE ON public.invite_deliveries FOR EACH ROW EXECUTE FUNCTION public.fn_invite_contact_purge();

CREATE TRIGGER trg_invite_delivery_guard BEFORE INSERT ON public.invite_deliveries FOR EACH ROW EXECUTE FUNCTION public.fn_invite_delivery_guard();

CREATE TRIGGER trg_invite_state BEFORE UPDATE ON public.introduction_invites FOR EACH ROW EXECUTE FUNCTION public.fn_invite_state_guard();

CREATE TRIGGER trg_invoice_no_delete BEFORE DELETE ON public.subscription_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_no_delete();

CREATE TRIGGER trg_invoice_not_cancelled BEFORE INSERT ON public.subscription_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_not_cancelled();

CREATE TRIGGER trg_invoice_paid_lock BEFORE UPDATE ON public.subscription_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_paid_lock();

CREATE TRIGGER trg_job_run_ro BEFORE DELETE OR UPDATE ON public.job_runs FOR EACH ROW EXECUTE FUNCTION public.fn_job_run_ro();

CREATE TRIGGER trg_landing_gwan BEFORE INSERT OR UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.fn_landing_gwan_guard();

CREATE TRIGGER trg_last_super BEFORE DELETE ON public.account_roles FOR EACH ROW EXECUTE FUNCTION public.fn_last_super_guard();

CREATE TRIGGER trg_lead_default_fee BEFORE INSERT OR UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.fn_lead_default_fee_guard();

CREATE TRIGGER trg_lead_fee_change AFTER UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.fn_lead_fee_change_log();

CREATE TRIGGER trg_lead_fee_nodel BEFORE DELETE ON public.lead_fees FOR EACH ROW EXECUTE FUNCTION public.fn_lead_fee_no_delete();

CREATE TRIGGER trg_lead_fee_view BEFORE INSERT ON public.lead_fees FOR EACH ROW EXECUTE FUNCTION public.fn_lead_fee_requires_view();

CREATE TRIGGER trg_lead_fee_void BEFORE INSERT OR UPDATE ON public.lead_fees FOR EACH ROW EXECUTE FUNCTION public.fn_lead_fee_void_guard();

CREATE TRIGGER trg_listing_banned_words BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_banned_words();

CREATE TRIGGER trg_listing_business_gate BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_listing_requires_business();

CREATE TRIGGER trg_listing_gwan_match BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_listing_gwan_match();

CREATE TRIGGER trg_listing_restricted BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_block_restricted_listing();

CREATE TRIGGER trg_listing_seller_gate BEFORE INSERT ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_listing_seller_gate();

CREATE TRIGGER trg_listing_slots BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_assert_listing_slots();

CREATE TRIGGER trg_listings_upd BEFORE UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_main_copy_guard BEFORE INSERT OR UPDATE ON public.main_copy FOR EACH ROW EXECUTE FUNCTION public.fn_main_copy_guard();

CREATE TRIGGER trg_main_section_guard BEFORE UPDATE ON public.main_sections FOR EACH ROW EXECUTE FUNCTION public.fn_main_section_guard();

CREATE TRIGGER trg_notification_vars BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.fn_assert_no_unresolved_vars();

CREATE TRIGGER trg_optout_guard BEFORE INSERT OR UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.fn_assert_optout_allowed();

CREATE TRIGGER trg_owner_verify_guard BEFORE INSERT OR UPDATE ON public.owner_verifications FOR EACH ROW EXECUTE FUNCTION public.fn_owner_verify_guard();

CREATE TRIGGER trg_owner_verify_ro BEFORE DELETE ON public.owner_verifications FOR EACH ROW EXECUTE FUNCTION public.fn_owner_verify_ro();

CREATE TRIGGER trg_partner_approve_guard BEFORE INSERT OR UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION public.fn_partner_approve_guard();

CREATE TRIGGER trg_partner_service_guard BEFORE INSERT OR UPDATE ON public.partner_services FOR EACH ROW EXECUTE FUNCTION public.fn_partner_service_guard();

CREATE TRIGGER trg_partner_verified BEFORE INSERT OR UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION public.fn_partner_requires_verified();

CREATE TRIGGER trg_payout BEFORE INSERT OR UPDATE ON public.payout_accounts FOR EACH ROW EXECUTE FUNCTION public.fn_payout_guard();

CREATE TRIGGER trg_persona_registered BEFORE INSERT OR UPDATE ON public.member_ad_profiles FOR EACH ROW EXECUTE FUNCTION public.fn_persona_registered_keep();

CREATE TRIGGER trg_point_ledger_ro BEFORE DELETE OR UPDATE ON public.point_ledger FOR EACH ROW EXECUTE FUNCTION public.fn_point_ledger_ro();

CREATE TRIGGER trg_point_redeemable BEFORE INSERT OR UPDATE ON public.point_ledger FOR EACH ROW EXECUTE FUNCTION public.fn_point_redeemable_guard();

CREATE TRIGGER trg_priority_label BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_apply_priority_label();

CREATE TRIGGER trg_profile_consent BEFORE INSERT OR UPDATE ON public.member_ad_profiles FOR EACH ROW EXECUTE FUNCTION public.fn_profile_consent_gate();

CREATE TRIGGER trg_promo_plan BEFORE INSERT OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.fn_assert_promo_plan();

CREATE TRIGGER trg_property_guard BEFORE UPDATE ON public.property_listings FOR EACH ROW EXECUTE FUNCTION public.fn_property_guard();

CREATE TRIGGER trg_published_terms_no_delete BEFORE DELETE ON public.terms FOR EACH ROW EXECUTE FUNCTION public.fn_published_terms_no_delete();

CREATE TRIGGER trg_qualification_guard BEFORE INSERT OR UPDATE ON public.qualification_reviews FOR EACH ROW EXECUTE FUNCTION public.fn_qualification_guard();

CREATE TRIGGER trg_qualification_ro BEFORE DELETE ON public.qualification_reviews FOR EACH ROW EXECUTE FUNCTION public.fn_qualification_ro();

CREATE TRIGGER trg_refcode_actor_gate BEFORE INSERT ON public.referral_codes FOR EACH ROW EXECUTE FUNCTION public.fn_gate_refcode_actor();

CREATE TRIGGER trg_refcode_inv8 BEFORE INSERT ON public.referral_codes FOR EACH ROW EXECUTE FUNCTION public.fn_assert_active_subscription();

CREATE TRIGGER trg_referral_no_chain BEFORE INSERT ON public.introducer_referrals FOR EACH ROW EXECUTE FUNCTION public.fn_referral_no_chain();

CREATE TRIGGER trg_refund_guard BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.fn_refund_guard();

CREATE TRIGGER trg_report_escalate AFTER INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.fn_report_escalate();

CREATE TRIGGER trg_report_guard BEFORE INSERT OR UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.fn_report_guard();

CREATE TRIGGER trg_report_ro BEFORE DELETE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.fn_report_ro();

CREATE TRIGGER trg_request_banned_words BEFORE INSERT OR UPDATE ON public.requests FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_banned_words();

CREATE TRIGGER trg_request_gwan_match BEFORE INSERT OR UPDATE ON public.requests FOR EACH ROW EXECUTE FUNCTION public.fn_listing_gwan_match();

CREATE TRIGGER trg_restriction_enforce AFTER INSERT OR UPDATE ON public.restricted_industries FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_new_restriction();

CREATE TRIGGER trg_review_event_log AFTER INSERT OR UPDATE ON public.review_items FOR EACH ROW EXECUTE FUNCTION public.fn_review_event_log();

CREATE TRIGGER trg_review_event_ro BEFORE DELETE OR UPDATE ON public.review_events FOR EACH ROW EXECUTE FUNCTION public.fn_review_event_ro();

CREATE TRIGGER trg_review_events_ro BEFORE DELETE OR UPDATE ON public.review_events FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

CREATE TRIGGER trg_revoke_on_status AFTER UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.fn_revoke_sessions_on_status();

CREATE TRIGGER trg_risk_action_reason BEFORE INSERT ON public.risk_actions FOR EACH ROW EXECUTE FUNCTION public.fn_risk_action_reason();

CREATE TRIGGER trg_risk_action_ro BEFORE DELETE OR UPDATE ON public.risk_actions FOR EACH ROW EXECUTE FUNCTION public.fn_risk_action_ro();

CREATE TRIGGER trg_risk_alert_ro BEFORE DELETE OR UPDATE ON public.risk_alerts FOR EACH ROW EXECUTE FUNCTION public.fn_risk_alert_immutable();

CREATE TRIGGER trg_role_audit AFTER INSERT OR DELETE ON public.account_roles FOR EACH ROW EXECUTE FUNCTION public.fn_role_audit();

CREATE TRIGGER trg_role_change_ro BEFORE DELETE OR UPDATE ON public.role_changes FOR EACH ROW EXECUTE FUNCTION public.fn_role_change_ro();

CREATE TRIGGER trg_setting_validate BEFORE INSERT OR UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.fn_setting_validate();

CREATE TRIGGER trg_settlement_no_delete BEFORE DELETE ON public.settlements FOR EACH ROW EXECUTE FUNCTION public.fn_settlement_no_delete();

CREATE TRIGGER trg_settlement_paid_actor BEFORE INSERT OR UPDATE ON public.settlements FOR EACH ROW EXECUTE FUNCTION public.fn_settlement_paid_actor();

CREATE TRIGGER trg_settlement_rules BEFORE INSERT OR UPDATE ON public.settlements FOR EACH ROW EXECUTE FUNCTION public.fn_assert_settlement_rules();

CREATE TRIGGER trg_sub_revoke_codes AFTER UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.fn_revoke_codes_on_subscription_end();

CREATE TRIGGER trg_success_fee_no_delete BEFORE DELETE ON public.success_fees FOR EACH ROW EXECUTE FUNCTION public.fn_success_fee_no_delete();

CREATE TRIGGER trg_success_fee_waive BEFORE UPDATE ON public.success_fees FOR EACH ROW EXECUTE FUNCTION public.fn_success_fee_waive_guard();

CREATE TRIGGER trg_term_agr_ro BEFORE DELETE OR UPDATE ON public.term_agreements FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

CREATE TRIGGER trg_term_agree_guard BEFORE INSERT OR UPDATE ON public.term_agreements FOR EACH ROW EXECUTE FUNCTION public.fn_term_agree_guard();

CREATE TRIGGER trg_term_agree_ro BEFORE DELETE ON public.term_agreements FOR EACH ROW EXECUTE FUNCTION public.fn_term_agree_ro();

CREATE TRIGGER trg_term_publish BEFORE INSERT OR UPDATE ON public.terms FOR EACH ROW EXECUTE FUNCTION public.fn_assert_term_publish();

CREATE TRIGGER trg_terms_scope BEFORE INSERT OR UPDATE ON public.terms FOR EACH ROW EXECUTE FUNCTION public.fn_terms_scope_guard();

CREATE TRIGGER trg_validate_setting BEFORE INSERT OR UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.fn_validate_setting_value();

CREATE TRIGGER trg_vi_ro BEFORE DELETE OR UPDATE ON public.visitor_identities FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

CREATE TRIGGER trg_view_quota BEFORE INSERT ON public.request_views FOR EACH ROW EXECUTE FUNCTION public.fn_assert_view_quota();

CREATE TRIGGER trg_withdrawal BEFORE INSERT OR UPDATE ON public.withdrawal_rules FOR EACH ROW EXECUTE FUNCTION public.fn_withdrawal_guard();

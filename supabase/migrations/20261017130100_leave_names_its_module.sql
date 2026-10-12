-- ============================================================================
-- NEUVTO WOS — Leave says its approvals are Leave's (D84)
--
-- In the module's own migration, beside the label it already registers
-- (20260803110000_leave_entity_label.sql), so the platform never writes the
-- word. With it, a Leave Admin can read a leave request's approval history.
-- ============================================================================

update public.approval_entity_labels
   set module_key = 'leave', updated_at = now()
 where entity_type = 'leave_request';

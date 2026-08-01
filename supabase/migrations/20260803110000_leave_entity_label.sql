-- ============================================================================
-- NEUVTO WOS — Leave says what it is called
--
-- One row, in the module's own migration. The platform reads
-- approval_entity_labels and never learns the word "leave" from anywhere in its
-- own code (D30) — the same arrangement as the `modules` row this module
-- already registers, and as the trigger by which it reacts to approval events.
--
-- Lowercase, singular, and a noun phrase that survives being dropped into the
-- middle of a sentence:
--
--   "A leave request needs your approval"
--   "Your leave request was approved"
--
-- Not "Leave Request", which reads as shouting mid-sentence, and not "leave",
-- which would render as "Your leave was approved" — true, but it loses the
-- thing the person actually submitted.
-- ============================================================================

insert into public.approval_entity_labels (entity_type, label)
values ('leave_request', 'leave request')
on conflict (entity_type) do update set label = excluded.label, updated_at = now();

-- Remove Milestone Invoice Chains.
-- The feature is retired from the product; no production data exists.
-- milestone_steps references milestone_chains (on delete cascade), so drop
-- the child table first. Policies, indexes and grants drop with the tables.

drop table if exists public.milestone_steps;
drop table if exists public.milestone_chains;

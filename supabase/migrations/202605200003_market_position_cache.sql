-- Atomic market position cache updates.
--
-- Fills can be indexed concurrently or replayed idempotently. Keeping the
-- arithmetic inside Postgres prevents lost updates on market_positions.

create or replace function public.apply_market_position_delta(
  p_market_id uuid,
  p_user_address text,
  p_outcome smallint,
  p_share_delta numeric,
  p_cost_basis_delta numeric default 0,
  p_realized_pnl_delta numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_outcome not in (0, 1) then
    raise exception 'invalid outcome %', p_outcome;
  end if;

  insert into public.market_positions (
    user_address,
    market_id,
    yes_shares,
    no_shares,
    cost_basis,
    realized_pnl,
    updated_at
  )
  values (
    lower(p_user_address),
    p_market_id,
    case when p_outcome = 1 then p_share_delta else 0 end,
    case when p_outcome = 0 then p_share_delta else 0 end,
    p_cost_basis_delta,
    p_realized_pnl_delta,
    now()
  )
  on conflict (user_address, market_id) do update
    set yes_shares = public.market_positions.yes_shares
          + case when p_outcome = 1 then p_share_delta else 0 end,
        no_shares = public.market_positions.no_shares
          + case when p_outcome = 0 then p_share_delta else 0 end,
        cost_basis = public.market_positions.cost_basis + p_cost_basis_delta,
        realized_pnl = public.market_positions.realized_pnl + p_realized_pnl_delta,
        updated_at = now();
end;
$$;

grant execute on function public.apply_market_position_delta(
  uuid,
  text,
  smallint,
  numeric,
  numeric,
  numeric
) to service_role;


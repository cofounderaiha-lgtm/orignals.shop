-- ============================================================
-- ORIGNALS SEAT INVENTORY — real, cross-device, no double-booking.
-- The UNIQUE (show_key, seat) constraint is the atomic guarantee:
-- two phones cannot hold the same seat for the same show.
-- Flow: seats_book (hold, ticket null) → seats_confirm (stamp
-- ticket on pay) → seats_free / seats_free_ticket (release).
-- Stale holds (unpaid > 12 min) are swept opportunistically.
-- ============================================================

create table if not exists seat_bookings (
  id bigint generated always as identity primary key,
  show_key text not null,          -- movieId|date|timeIdx
  seat text not null,              -- e.g. 'E5'
  device_key text,
  ticket_id text,                  -- null = pending hold
  created_at timestamptz not null default now(),
  unique (show_key, seat)
);
create index if not exists seat_show_idx on seat_bookings (show_key);

alter table seat_bookings enable row level security;
drop policy if exists sb_read on seat_bookings;
create policy sb_read on seat_bookings for select using (true);

-- hold seats atomically; returns the seats that were ALREADY taken
-- (empty array = success). Handles the concurrent-race via the
-- unique constraint, then re-reports the true conflicts.
create or replace function seats_book(p_show text, p_seats text[], p_device text)
returns text[] language plpgsql security definer set search_path = public as $$
declare conflicts text[];
begin
  -- opportunistic sweep of abandoned holds
  if random() < 0.2 then
    delete from seat_bookings where ticket_id is null and created_at < now() - interval '12 minutes';
  end if;
  select array_agg(seat) into conflicts
    from seat_bookings where show_key = p_show and seat = any(p_seats);
  if conflicts is not null then return conflicts; end if;
  insert into seat_bookings (show_key, seat, device_key)
    select p_show, unnest(p_seats), p_device;
  return array[]::text[];
exception when unique_violation then
  select array_agg(seat) into conflicts
    from seat_bookings where show_key = p_show and seat = any(p_seats);
  return coalesce(conflicts, array['race']::text[]);
end $$;

-- stamp the ticket id once payment succeeds (confirms the hold)
create or replace function seats_confirm(p_show text, p_seats text[], p_device text, p_ticket text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update seat_bookings set ticket_id = p_ticket
   where show_key = p_show and seat = any(p_seats) and device_key = p_device;
end $$;

-- release an un-paid hold (user backed out of checkout)
create or replace function seats_free(p_show text, p_seats text[], p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from seat_bookings
   where show_key = p_show and seat = any(p_seats)
     and device_key = p_device and ticket_id is null;
end $$;

-- release a confirmed booking (ticket cancelled)
create or replace function seats_free_ticket(p_ticket text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from seat_bookings where ticket_id = p_ticket and device_key = p_device;
end $$;

grant execute on function seats_book(text, text[], text) to anon;
grant execute on function seats_confirm(text, text[], text, text) to anon;
grant execute on function seats_free(text, text[], text) to anon;
grant execute on function seats_free_ticket(text, text) to anon;

select 'seat inventory ready' as status;

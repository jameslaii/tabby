-- =========================================================
-- Tabby — Core Schema (Postgres / Supabase)
-- =========================================================
-- Based on the handover schema, with the integrity and access-control gaps
-- from docs/TEST_PLAN.md closed. Changes from the original are marked [ADDED].
--
-- Design notes carried over:
--  - "Ghost" members let a host add a friend to a group before that friend
--    has an account. When they sign up and accept an invite, their
--    group_members.user_id gets linked to their real account.
--  - Expenses support MULTIPLE payers via expense_payers.
--  - Line items let one receipt break into pieces mapped to different people.
--  - expense_splits is the ground truth for "who owes what".
--  - Balances are NOT stored — they're computed from expense_splits +
--    settlements. Add a materialized cache later only if perf demands it.

create extension if not exists pgcrypto;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  phone         text,
  display_name  text not null,
  avatar_url    text,
  created_at    timestamptz not null default now()
);

create table groups (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  emoji             text,
  default_currency  text not null default 'USD',
  created_by        uuid references users(id),
  created_at        timestamptz not null default now()
);

create table group_members (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references groups(id) on delete cascade,
  user_id       uuid references users(id),
  display_name  text not null,
  is_ghost      boolean not null default true,
  joined_at     timestamptz not null default now(),
  unique (group_id, user_id),

  -- [ADDED] The receipt parser joins Claude's output to members by display
  -- name, so two members sharing a name is genuinely ambiguous. The original
  -- `unique (group_id, user_id)` doesn't help: NULL is never equal to NULL in
  -- Postgres, so it permits unlimited duplicate ghosts.
  constraint group_members_unique_name unique (group_id, display_name),

  -- [ADDED] A ghost has no account; a real member does.
  constraint group_members_ghost_has_no_user
    check ((is_ghost and user_id is null) or (not is_ghost and user_id is not null))
);

-- [ADDED] Needed as the target of the composite foreign keys below, which are
-- what stop a row in one group from referencing a member of another.
alter table group_members add constraint group_members_id_group_unique
  unique (id, group_id);

create table expenses (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references groups(id) on delete cascade,
  description     text not null,
  category        text,
  total_amount    numeric(12,2) not null,
  currency        text not null,
  expense_date    date not null default current_date,
  source_type     text not null default 'manual'
                    check (source_type in ('manual', 'receipt_ai')),
  receipt_image_url text,
  raw_comment     text,
  raw_transcript  text,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint expenses_total_positive check (total_amount > 0),
  -- [ADDED] Referenced by the composite keys on payers/line items/splits.
  constraint expenses_id_group_unique unique (id, group_id)
);

create table expense_payers (
  id            uuid primary key default gen_random_uuid(),
  expense_id    uuid not null references expenses(id) on delete cascade,
  member_id     uuid not null references group_members(id),
  -- [ADDED] Denormalized so the composite keys can enforce same-group.
  group_id      uuid not null,
  amount_paid   numeric(12,2) not null,

  constraint expense_payers_amount_positive check (amount_paid > 0),
  -- [ADDED] Payer and expense must belong to the same group. Without these,
  -- the plain FKs above happily accept a member from an unrelated group and
  -- silently corrupt two groups' balances at once.
  constraint expense_payers_same_group_expense
    foreign key (expense_id, group_id) references expenses(id, group_id) on delete cascade,
  constraint expense_payers_same_group_member
    foreign key (member_id, group_id) references group_members(id, group_id)
);

create table expense_line_items (
  id            uuid primary key default gen_random_uuid(),
  expense_id    uuid not null references expenses(id) on delete cascade,
  description   text not null,
  quantity      numeric(6,2) not null default 1,
  unit_price    numeric(12,2) not null,
  line_total    numeric(12,2) not null,

  constraint expense_line_items_quantity_positive check (quantity > 0)
);

create table expense_splits (
  id              uuid primary key default gen_random_uuid(),
  expense_id      uuid not null references expenses(id) on delete cascade,
  line_item_id    uuid references expense_line_items(id) on delete cascade,
  member_id       uuid not null references group_members(id),
  group_id        uuid not null,                                   -- [ADDED]
  split_type      text not null
                    check (split_type in ('equal','exact','percentage','shares')),
  share_value     numeric(8,4),
  amount_owed     numeric(12,2) not null,

  -- [ADDED] Same-group enforcement, as above.
  constraint expense_splits_same_group_expense
    foreign key (expense_id, group_id) references expenses(id, group_id) on delete cascade,
  constraint expense_splits_same_group_member
    foreign key (member_id, group_id) references group_members(id, group_id)
);

create table settlements (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references groups(id) on delete cascade,
  from_member   uuid not null references group_members(id),
  to_member     uuid not null references group_members(id),
  amount        numeric(12,2) not null,
  currency      text not null,
  note          text,
  settled_at    timestamptz not null default now(),

  -- [ADDED] The original permitted paying yourself, and permitted a zero or
  -- negative payment.
  constraint settlements_not_self check (from_member <> to_member),
  constraint settlements_amount_positive check (amount > 0),
  constraint settlements_same_group_from
    foreign key (from_member, group_id) references group_members(id, group_id),
  constraint settlements_same_group_to
    foreign key (to_member, group_id) references group_members(id, group_id)
);

create table activity_log (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references groups(id) on delete cascade,
  actor_id      uuid references users(id),
  action        text not null,
  entity_id     uuid,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------
-- [ADDED] Sum integrity
-- ---------------------------------------------------------
-- Nothing in the original schema required an expense's payers or splits to
-- add up to its total, so a partial write left the group's balances
-- permanently unbalanced with no error. These run at the end of a statement
-- so multi-row inserts are checked once, as a unit.

create or replace function assert_expense_balances() returns trigger
language plpgsql as $$
declare
  expense_total numeric(12,2);
  paid          numeric(12,2);
  owed          numeric(12,2);
  target        uuid := coalesce(new.expense_id, old.expense_id);
begin
  select total_amount into expense_total from expenses where id = target;
  if expense_total is null then
    return null;  -- expense was deleted; the cascade handles the children
  end if;

  select coalesce(sum(amount_paid), 0) into paid
    from expense_payers where expense_id = target;
  select coalesce(sum(amount_owed), 0) into owed
    from expense_splits where expense_id = target;

  if paid <> expense_total then
    raise exception 'Payers sum to % but the expense total is %', paid, expense_total;
  end if;
  if owed <> expense_total then
    raise exception 'Splits sum to % but the expense total is %', owed, expense_total;
  end if;
  return null;
end;
$$;

create constraint trigger expense_payers_balance
  after insert or update or delete on expense_payers
  deferrable initially deferred
  for each row execute function assert_expense_balances();

create constraint trigger expense_splits_balance
  after insert or update or delete on expense_splits
  deferrable initially deferred
  for each row execute function assert_expense_balances();

-- ---------------------------------------------------------
-- Indexes for the balance queries you'll run constantly
-- ---------------------------------------------------------
create index idx_expense_splits_member on expense_splits(member_id);
create index idx_expense_splits_expense on expense_splits(expense_id);
create index idx_expense_payers_expense on expense_payers(expense_id);
create index idx_expenses_group on expenses(group_id);
create index idx_settlements_group on settlements(group_id);
create index idx_group_members_user on group_members(user_id);
create index idx_activity_log_group on activity_log(group_id, created_at desc);

-- ---------------------------------------------------------
-- [ADDED] Row Level Security
-- ---------------------------------------------------------
-- The original schema had no policies at all. On Supabase the anon key is
-- public by design, so without RLS every group's expenses are readable by
-- anyone who opens the browser console. This is the single most important
-- block in the file.

alter table users              enable row level security;
alter table groups             enable row level security;
alter table group_members      enable row level security;
alter table expenses           enable row level security;
alter table expense_payers     enable row level security;
alter table expense_line_items enable row level security;
alter table expense_splits     enable row level security;
alter table settlements        enable row level security;
alter table activity_log       enable row level security;

-- Membership test, in a SECURITY DEFINER function so the policies below don't
-- recurse back through group_members' own policy.
create or replace function is_group_member(target_group uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_members
    where group_id = target_group and user_id = auth.uid()
  );
$$;

create policy users_self on users
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy groups_member_access on groups
  for all using (is_group_member(id)) with check (is_group_member(id));

-- Any authenticated user may create a group; they add themselves as the first
-- member in the same transaction.
create policy groups_insert on groups
  for insert with check (auth.uid() is not null);

create policy group_members_access on group_members
  for all using (is_group_member(group_id)) with check (is_group_member(group_id));

create policy expenses_access on expenses
  for all using (is_group_member(group_id)) with check (is_group_member(group_id));

create policy expense_payers_access on expense_payers
  for all using (is_group_member(group_id)) with check (is_group_member(group_id));

create policy expense_splits_access on expense_splits
  for all using (is_group_member(group_id)) with check (is_group_member(group_id));

create policy expense_line_items_access on expense_line_items
  for all using (
    exists (
      select 1 from expenses e
      where e.id = expense_line_items.expense_id and is_group_member(e.group_id)
    )
  ) with check (
    exists (
      select 1 from expenses e
      where e.id = expense_line_items.expense_id and is_group_member(e.group_id)
    )
  );

create policy settlements_access on settlements
  for all using (is_group_member(group_id)) with check (is_group_member(group_id));

create policy activity_log_access on activity_log
  for all using (is_group_member(group_id)) with check (is_group_member(group_id));

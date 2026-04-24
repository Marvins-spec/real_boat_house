alter table public.order_items
  add column if not exists set_group_id uuid,
  add column if not exists set_name text;

create index if not exists order_items_set_group_id_idx
  on public.order_items (set_group_id);

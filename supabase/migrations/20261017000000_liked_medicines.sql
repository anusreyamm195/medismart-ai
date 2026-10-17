create table if not exists public.liked_medicines (
  user_id uuid not null references auth.users (id) on delete cascade,
  medicine_id text not null references public.medicines (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, medicine_id)
);

alter table public.liked_medicines enable row level security;

drop policy if exists "Users can read their liked medicines" on public.liked_medicines;
drop policy if exists "Liked medicines ownership restriction" on public.liked_medicines;
create policy "Users can read their liked medicines"
  on public.liked_medicines
  for select
  to authenticated
  using (auth.uid() = user_id);
create policy "Liked medicines ownership restriction"
  on public.liked_medicines
  as restrictive
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can like medicines for themselves" on public.liked_medicines;
drop policy if exists "Liked medicine inserts ownership restriction" on public.liked_medicines;
create policy "Users can like medicines for themselves"
  on public.liked_medicines
  for insert
  to authenticated
  with check (auth.uid() = user_id);
create policy "Liked medicine inserts ownership restriction"
  on public.liked_medicines
  as restrictive
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can unlike medicines for themselves" on public.liked_medicines;
drop policy if exists "Liked medicine deletes ownership restriction" on public.liked_medicines;
create policy "Users can unlike medicines for themselves"
  on public.liked_medicines
  for delete
  to authenticated
  using (auth.uid() = user_id);
create policy "Liked medicine deletes ownership restriction"
  on public.liked_medicines
  as restrictive
  for delete
  to authenticated
  using (auth.uid() = user_id);

alter table public.saved_pharmacies enable row level security;

drop policy if exists "Users can read their saved pharmacies" on public.saved_pharmacies;
drop policy if exists "Saved pharmacies ownership restriction" on public.saved_pharmacies;
create policy "Users can read their saved pharmacies"
  on public.saved_pharmacies
  for select
  to authenticated
  using (auth.uid() = user_id);
create policy "Saved pharmacies ownership restriction"
  on public.saved_pharmacies
  as restrictive
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can save pharmacies for themselves" on public.saved_pharmacies;
drop policy if exists "Saved pharmacy inserts ownership restriction" on public.saved_pharmacies;
create policy "Users can save pharmacies for themselves"
  on public.saved_pharmacies
  for insert
  to authenticated
  with check (auth.uid() = user_id);
create policy "Saved pharmacy inserts ownership restriction"
  on public.saved_pharmacies
  as restrictive
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their saved pharmacies" on public.saved_pharmacies;
drop policy if exists "Saved pharmacy updates ownership restriction" on public.saved_pharmacies;
create policy "Users can update their saved pharmacies"
  on public.saved_pharmacies
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Saved pharmacy updates ownership restriction"
  on public.saved_pharmacies
  as restrictive
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their saved pharmacies" on public.saved_pharmacies;
drop policy if exists "Saved pharmacy deletes ownership restriction" on public.saved_pharmacies;
create policy "Users can remove their saved pharmacies"
  on public.saved_pharmacies
  for delete
  to authenticated
  using (auth.uid() = user_id);
create policy "Saved pharmacy deletes ownership restriction"
  on public.saved_pharmacies
  as restrictive
  for delete
  to authenticated
  using (auth.uid() = user_id);

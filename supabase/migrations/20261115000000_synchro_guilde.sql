-- Synchronisation de PiP Browser entre membres de la guilde Discord.
--
-- Principe de sécurité :
-- * personne n'écrit directement dans les tables : toutes les modifications
--   passent par des fonctions qui vérifient l'appartenance à la guilde ;
-- * l'appartenance est attestée par la fonction Edge `verify-guild`, seule à
--   écrire dans `guild_members` (clé service), et expire après 24 heures ;
-- * seules des vidéos YouTube (identifiant de 11 caractères) circulent entre
--   les membres, jamais une adresse arbitraire.

create table public.guild_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  discord_id text not null,
  display_name text not null check (char_length(display_name) between 1 and 60),
  verified_at timestamptz not null default now()
);
alter table public.guild_members enable row level security;
-- Aucune politique : lecture et écriture réservées à la clé service.

create or replace function public.is_guild_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.guild_members
    where user_id = (select auth.uid())
      and verified_at > now() - interval '24 hours'
  );
$$;

create table public.rooms (
  id text primary key check (id ~ '^[A-HJ-NP-Z2-9]{6}$'),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references auth.users (id) on delete cascade,
  video_id text check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  video_title text check (char_length(video_title) <= 200),
  playing boolean not null default false,
  position double precision not null default 0 check (position >= 0 and position < 86400),
  revision bigint not null default 0,
  state_updated_at timestamptz not null default now(),
  state_updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
create policy "Les membres de la guilde voient les salons"
  on public.rooms for select to authenticated
  using ((select public.is_guild_member()));

create table public.queue_items (
  id bigint generated always as identity primary key,
  room_id text not null references public.rooms (id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(title) between 1 and 200),
  added_by uuid references auth.users (id) on delete set null,
  added_by_name text not null,
  created_at timestamptz not null default now()
);
create index queue_items_room_order on public.queue_items (room_id, id);
alter table public.queue_items enable row level security;
create policy "Les membres de la guilde voient les listes d'attente"
  on public.queue_items for select to authenticated
  using ((select public.is_guild_member()));

-- Fonctions appelées par l'application ------------------------------------

create or replace function public.require_guild_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_guild_member() then
    raise exception 'Accès réservé aux membres vérifiés de la guilde.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$ select now(); $$;

create or replace function public.create_room(p_name text)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_guild_member();
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  result public.rooms;
begin
  if (select count(*) from public.rooms where created_by = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop de salons créés récemment.' using errcode = '54000';
  end if;
  for attempt in 1..20 loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      insert into public.rooms (id, name, created_by, state_updated_by)
      values (code, left(btrim(p_name), 60), uid, uid)
      returning * into result;
      return result;
    exception when unique_violation then
      -- Code déjà pris : on en tire un autre.
    end;
  end loop;
  raise exception 'Impossible de générer un code de salon.';
end;
$$;

create or replace function public.set_playback(p_room text, p_video_id text, p_playing boolean, p_position double precision, p_title text default null)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_guild_member();
  result public.rooms;
begin
  update public.rooms set
    video_id = p_video_id,
    video_title = case when p_video_id is distinct from video_id then left(p_title, 200) else coalesce(left(p_title, 200), video_title) end,
    playing = coalesce(p_playing, false) and p_video_id is not null,
    position = greatest(0, least(coalesce(p_position, 0), 86399)),
    revision = revision + 1,
    state_updated_at = now(),
    state_updated_by = uid
  where id = p_room
  returning * into result;
  if result is null then raise exception 'Salon introuvable.' using errcode = 'P0002'; end if;
  return result;
end;
$$;

create or replace function public.enqueue(p_room text, p_video_id text, p_title text)
returns public.queue_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_guild_member();
  result public.queue_items;
begin
  if not exists (select 1 from public.rooms where id = p_room) then
    raise exception 'Salon introuvable.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.queue_items where room_id = p_room) >= 100 then
    raise exception 'La liste d''attente est pleine (100 vidéos).' using errcode = '54000';
  end if;
  insert into public.queue_items (room_id, video_id, title, added_by, added_by_name)
  values (p_room, p_video_id, left(coalesce(nullif(btrim(p_title), ''), 'Vidéo YouTube'), 200), uid,
          (select display_name from public.guild_members where user_id = uid))
  returning * into result;
  return result;
end;
$$;

create or replace function public.remove_item(p_item bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_guild_member();
begin
  delete from public.queue_items q
  using public.rooms r
  where q.id = p_item and r.id = q.room_id and (q.added_by = uid or r.created_by = uid);
  if not found then
    raise exception 'Seule la personne qui a ajouté la vidéo ou le créateur du salon peut la retirer.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.play_item(p_item bigint)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_guild_member();
  item public.queue_items;
  result public.rooms;
begin
  delete from public.queue_items where id = p_item returning * into item;
  if item is null then raise exception 'Vidéo introuvable dans la liste.' using errcode = 'P0002'; end if;
  update public.rooms set video_id = item.video_id, video_title = item.title, playing = true, position = 0,
    revision = revision + 1, state_updated_at = now(), state_updated_by = uid
  where id = item.room_id returning * into result;
  return result;
end;
$$;

-- Passe à la vidéo suivante. `p_expected` évite que plusieurs membres qui
-- terminent la même vidéo fassent avancer la liste plusieurs fois.
create or replace function public.advance_queue(p_room text, p_expected text)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_guild_member();
  item public.queue_items;
  result public.rooms;
begin
  select * into result from public.rooms where id = p_room for update;
  if result is null then raise exception 'Salon introuvable.' using errcode = 'P0002'; end if;
  if result.video_id is distinct from p_expected then return result; end if;
  delete from public.queue_items where id = (
    select id from public.queue_items where room_id = p_room order by id limit 1
  ) returning * into item;
  if item is null then
    update public.rooms set playing = false, revision = revision + 1, state_updated_at = now(), state_updated_by = uid
    where id = p_room returning * into result;
  else
    update public.rooms set video_id = item.video_id, video_title = item.title, playing = true, position = 0,
      revision = revision + 1, state_updated_at = now(), state_updated_by = uid
    where id = p_room returning * into result;
  end if;
  return result;
end;
$$;

-- Droits : seuls les utilisateurs connectés peuvent appeler ces fonctions,
-- et chacune vérifie l'appartenance à la guilde.
revoke all on function public.is_guild_member() from public, anon;
revoke all on function public.require_guild_member() from public, anon, authenticated;
revoke all on function public.create_room(text) from public, anon;
revoke all on function public.set_playback(text, text, boolean, double precision, text) from public, anon;
revoke all on function public.enqueue(text, text, text) from public, anon;
revoke all on function public.remove_item(bigint) from public, anon;
revoke all on function public.play_item(bigint) from public, anon;
revoke all on function public.advance_queue(text, text) from public, anon;
revoke all on function public.server_now() from public, anon;
grant execute on function public.is_guild_member(), public.server_now(), public.create_room(text),
  public.set_playback(text, text, boolean, double precision, text), public.enqueue(text, text, text),
  public.remove_item(bigint), public.play_item(bigint), public.advance_queue(text, text) to authenticated;
revoke insert, update, delete on public.rooms, public.queue_items, public.guild_members from anon, authenticated;

-- Temps réel ------------------------------------------------------------------

alter publication supabase_realtime add table public.rooms, public.queue_items;

-- Canaux privés `room:<code>` utilisés pour la présence (qui regarde).
create policy "Les membres de la guilde utilisent la présence des salons"
  on realtime.messages for select to authenticated
  using ((select public.is_guild_member()) and realtime.topic() ~ '^room:[A-HJ-NP-Z2-9]{6}$');
create policy "Les membres de la guilde annoncent leur présence"
  on realtime.messages for insert to authenticated
  with check ((select public.is_guild_member()) and realtime.topic() ~ '^room:[A-HJ-NP-Z2-9]{6}$');

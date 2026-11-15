// Vérifie qu'un utilisateur connecté avec Discord fait partie de la guilde,
// puis enregistre cette attestation pour 24 heures dans `guild_members`.
//
// Secrets à définir (supabase secrets set ...) :
//   DISCORD_GUILD_ID          identifiant du serveur Discord de la guilde
//   DISCORD_REQUIRED_ROLE_ID  (facultatif) rôle(s) autorisé(s) à se brancher,
//                             séparés par des virgules : un seul suffit.
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const guildId = Deno.env.get('DISCORD_GUILD_ID');
  if (!guildId || !/^\d{5,25}$/.test(guildId)) return json(500, { error: 'guild_not_configured' });
  const allowedRoles = (Deno.env.get('DISCORD_REQUIRED_ROLE_ID') ?? '').split(',').map((role) => role.trim()).filter(Boolean);
  // Une liste mal saisie ne doit jamais ouvrir l'accès à tout le serveur.
  if (allowedRoles.some((role) => !/^\d{5,25}$/.test(role))) return json(500, { error: 'roles_not_configured' });

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'missing_session' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !user) return json(401, { error: 'invalid_session' });
  const identity = user.identities?.find((item) => item.provider === 'discord');
  const discordId = String(identity?.identity_data?.provider_id ?? identity?.identity_data?.sub ?? identity?.id ?? '');
  if (!/^\d{5,25}$/.test(discordId)) return json(403, { error: 'discord_identity_missing' });

  let providerToken: unknown;
  try { ({ provider_token: providerToken } = await req.json()); } catch { /* corps invalide */ }
  if (typeof providerToken !== 'string' || providerToken.length < 10 || providerToken.length > 300) {
    return json(400, { error: 'missing_discord_token' });
  }

  const response = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });
  if (response.status === 401) return json(401, { error: 'discord_token_invalid' });
  if (!response.ok) {
    await admin.from('guild_members').delete().eq('user_id', user.id);
    return json(403, { error: 'not_member' });
  }
  const member = await response.json();
  // Le jeton Discord doit appartenir au même compte que la session Supabase.
  if (String(member?.user?.id) !== discordId) return json(403, { error: 'identity_mismatch' });
  if (allowedRoles.length && !allowedRoles.some((role) => (member.roles ?? []).includes(role))) {
    // Visible dans Supabase → Edge Functions → verify-guild → Logs, pour
    // comparer les rôles configurés avec ceux que Discord renvoie.
    console.log('missing_role', JSON.stringify({ discordId, memberRoles: member.roles ?? [], allowedRoles }));
    await admin.from('guild_members').delete().eq('user_id', user.id);
    return json(403, { error: 'missing_role' });
  }

  const displayName = String(member.nick || member.user.global_name || member.user.username || 'Membre')
    .replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || 'Membre';
  const { error } = await admin.from('guild_members').upsert({
    user_id: user.id, discord_id: discordId, display_name: displayName, verified_at: new Date().toISOString(),
  });
  if (error) return json(500, { error: 'storage_failed' });
  return json(200, { discordId, displayName });
});

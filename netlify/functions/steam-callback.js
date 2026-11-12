// Retour de Steam : vérifie l'identité, crée/retrouve le compte Supabase lié au
// SteamID64, puis renvoie le joueur sur le site avec un jeton de session à usage unique.
const { createClient } = require('@supabase/supabase-js');
const { getOrigin, verifyOpenId, fetchSteamProfile } = require('../lib/steam');

function redirect(location) {
  return { statusCode: 302, headers: { Location: location, 'Cache-Control': 'no-store' }, body: '' };
}

exports.handler = async (event) => {
  const origin = getOrigin(event);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STEAM_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Variables SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes');
    return redirect(`${origin}/?error=config`);
  }

  let steamId;
  try {
    steamId = await verifyOpenId(event.queryStringParameters, origin);
  } catch (err) {
    console.error('Vérification Steam refusée :', err.message);
    return redirect(`${origin}/?error=steam`);
  }

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `${steamId}@steam-casino.local`;

    // Crée le compte s'il n'existe pas (l'erreur "déjà existant" est normale)
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { steam_id: steamId, provider: 'steam' },
    });
    if (created.error && !/already|exist|registered/i.test(created.error.message)) {
      throw created.error;
    }

    // Lien à usage unique ; le navigateur l'échangera contre une vraie session
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error) throw link.error;
    const user = link.data.user;
    const tokenHash = link.data.properties && link.data.properties.hashed_token;
    if (!user || !tokenHash) throw new Error('lien de connexion introuvable');

    // Profil (le solde n'est jamais modifié ici : il n'est pas dans la liste mise à jour)
    const steam = await fetchSteamProfile(steamId, STEAM_API_KEY);
    const up = await admin.from('profiles').upsert(
      {
        id: user.id,
        steam_id: steamId,
        display_name: steam.name,
        avatar_url: steam.avatar,
        last_login: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (up.error) throw up.error;

    return redirect(`${origin}/auth.html#token_hash=${encodeURIComponent(tokenHash)}`);
  } catch (err) {
    console.error('Erreur de connexion :', err && err.message ? err.message : err);
    return redirect(`${origin}/?error=server`);
  }
};

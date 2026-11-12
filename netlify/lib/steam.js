// Connexion Steam via OpenID 2.0 (Steam n'a pas d'OAuth).
// Aucune clé n'est nécessaire pour vérifier l'identité ; la clé API Steam sert
// seulement à récupérer le pseudo et l'avatar.

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const CALLBACK_PATH = '/.netlify/functions/steam-callback';
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

// Adresse publique du site (SITE_URL si défini, sinon déduite de la requête)
function getOrigin(event, env = process.env) {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/+$/, '');
  const h = event.headers || {};
  const host = h['x-forwarded-host'] || h.host;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || '');
  const proto = h['x-forwarded-proto'] || (local ? 'http' : 'https');
  return `${proto}://${host}`;
}

function buildLoginUrl(origin) {
  const p = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': origin + CALLBACK_PATH,
    'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID}?${p.toString()}`;
}

// Vérifie la réponse de Steam. Retourne le SteamID64 ou lève une erreur.
async function verifyOpenId(query, origin, fetchImpl = fetch) {
  const q = query || {};
  if (q['openid.mode'] !== 'id_res') throw new Error('mode_invalide');
  if (q['openid.op_endpoint'] !== STEAM_OPENID) throw new Error('endpoint_invalide');
  if (q['openid.return_to'] !== origin + CALLBACK_PATH) throw new Error('return_to_invalide');

  const m = CLAIMED_ID_RE.exec(q['openid.claimed_id'] || '');
  if (!m) throw new Error('claimed_id_invalide');
  if (q['openid.identity'] !== q['openid.claimed_id']) throw new Error('identity_invalide');

  // Les champs essentiels doivent faire partie de ce que Steam a signé
  const signed = String(q['openid.signed'] || '').split(',');
  for (const f of ['claimed_id', 'identity', 'return_to', 'response_nonce']) {
    if (!signed.includes(f)) throw new Error('champ_non_signe_' + f);
  }

  // Steam confirme lui-même la signature (et invalide le nonce : pas de rejeu)
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (k.startsWith('openid.')) body.set(k, v);
  }
  body.set('openid.mode', 'check_authentication');
  const res = await fetchImpl(STEAM_OPENID, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok || !/^is_valid:true\s*$/m.test(text)) throw new Error('signature_refusee');
  return m[1];
}

// Pseudo + avatar (optionnel : retombe sur un nom générique sans clé ou en cas d'erreur)
async function fetchSteamProfile(steamId, apiKey, fetchImpl = fetch) {
  const fallback = { name: `Joueur ${steamId.slice(-4)}`, avatar: null };
  if (!apiKey) return fallback;
  try {
    const url = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/' +
      `?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`;
    const res = await fetchImpl(url);
    if (!res.ok) return fallback;
    const data = await res.json();
    const p = data && data.response && data.response.players && data.response.players[0];
    if (!p) return fallback;
    const name = String(p.personaname || '').trim().slice(0, 40) || fallback.name;
    const avatar = typeof p.avatarfull === 'string' && p.avatarfull.startsWith('https://')
      ? p.avatarfull : null;
    return { name, avatar };
  } catch {
    return fallback;
  }
}

module.exports = { getOrigin, buildLoginUrl, verifyOpenId, fetchSteamProfile, CALLBACK_PATH, STEAM_OPENID };

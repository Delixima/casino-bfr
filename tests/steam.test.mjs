// Tests de la vérification Steam OpenID (avec un faux Steam).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getOrigin, buildLoginUrl, verifyOpenId, fetchSteamProfile } = require('../netlify/lib/steam.js');

const ORIGIN = 'https://casino-bfr.netlify.app';
const STEAMID = '76561199213350970';

function goodQuery(over = {}) {
  return {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAMID}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${STEAMID}`,
    'openid.return_to': `${ORIGIN}/.netlify/functions/steam-callback`,
    'openid.response_nonce': '2026-11-12T10:00:00Zabc',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
    ...over,
  };
}
const steamSays = (text, ok = true) => async () => ({ ok, text: async () => text });

test('connexion valide : retourne le SteamID64', async () => {
  let sent;
  const f = async (url, init) => { sent = { url, init }; return { ok: true, text: async () => 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n' }; };
  assert.equal(await verifyOpenId(goodQuery(), ORIGIN, f), STEAMID);
  assert.equal(sent.url, 'https://steamcommunity.com/openid/login');
  assert.match(sent.init.body, /openid\.mode=check_authentication/);
  assert.match(sent.init.body, /openid\.sig=/);
});

test('Steam répond is_valid:false : refusé', async () => {
  await assert.rejects(verifyOpenId(goodQuery(), ORIGIN, steamSays('is_valid:false\n')), /signature_refusee/);
});

test('mauvais mode, mauvais endpoint, mauvais return_to : refusés sans appeler Steam', async () => {
  const never = async () => { throw new Error('ne doit pas être appelé'); };
  await assert.rejects(verifyOpenId(goodQuery({ 'openid.mode': 'cancel' }), ORIGIN, never), /mode_invalide/);
  await assert.rejects(verifyOpenId(goodQuery({ 'openid.op_endpoint': 'https://evil.example/openid' }), ORIGIN, never), /endpoint_invalide/);
  await assert.rejects(verifyOpenId(goodQuery({ 'openid.return_to': 'https://evil.example/cb' }), ORIGIN, never), /return_to_invalide/);
  await assert.rejects(verifyOpenId(undefined, ORIGIN, never), /mode_invalide/);
});

test('claimed_id falsifié ou différent de identity : refusé', async () => {
  const never = async () => { throw new Error('ne doit pas être appelé'); };
  await assert.rejects(verifyOpenId(goodQuery({ 'openid.claimed_id': 'https://evil.example/id/76561199213350970' }), ORIGIN, never), /claimed_id_invalide/);
  await assert.rejects(verifyOpenId(goodQuery({ 'openid.claimed_id': 'https://steamcommunity.com/openid/id/123' }), ORIGIN, never), /claimed_id_invalide/);
  await assert.rejects(verifyOpenId(goodQuery({ 'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000001' }), ORIGIN, never), /identity_invalide/);
});

test('champs essentiels non signés : refusé', async () => {
  const never = async () => { throw new Error('ne doit pas être appelé'); };
  await assert.rejects(verifyOpenId(goodQuery({ 'openid.signed': 'signed,op_endpoint,assoc_handle' }), ORIGIN, never), /champ_non_signe/);
});

test('erreur réseau côté Steam : refusé', async () => {
  await assert.rejects(verifyOpenId(goodQuery(), ORIGIN, steamSays('is_valid:true', false)), /signature_refusee/);
});

test('URL de connexion et origine', () => {
  const u = new URL(buildLoginUrl(ORIGIN));
  assert.equal(u.origin + u.pathname, 'https://steamcommunity.com/openid/login');
  assert.equal(u.searchParams.get('openid.return_to'), `${ORIGIN}/.netlify/functions/steam-callback`);
  assert.equal(u.searchParams.get('openid.realm'), ORIGIN);
  assert.equal(getOrigin({ headers: { host: 'a.netlify.app' } }, {}), 'https://a.netlify.app');
  assert.equal(getOrigin({ headers: { host: 'localhost:8888' } }, {}), 'http://localhost:8888');
  assert.equal(getOrigin({ headers: { host: 'x' } }, { SITE_URL: 'https://casino.example/' }), 'https://casino.example');
});

test('profil Steam : sans clé ou en cas d\'erreur, nom générique', async () => {
  assert.deepEqual(await fetchSteamProfile(STEAMID, undefined), { name: 'Joueur 0970', avatar: null });
  const boom = async () => { throw new Error('réseau'); };
  assert.deepEqual(await fetchSteamProfile(STEAMID, 'k', boom), { name: 'Joueur 0970', avatar: null });
});

test('profil Steam : pseudo et avatar récupérés, avatar non-https ignoré', async () => {
  const ok = (avatar) => async () => ({ ok: true, json: async () => ({ response: { players: [{ personaname: '  Giyu  ', avatarfull: avatar }] } }) });
  assert.deepEqual(await fetchSteamProfile(STEAMID, 'k', ok('https://avatars.steamstatic.com/a.jpg')),
    { name: 'Giyu', avatar: 'https://avatars.steamstatic.com/a.jpg' });
  assert.equal((await fetchSteamProfile(STEAMID, 'k', ok('javascript:alert(1)'))).avatar, null);
});

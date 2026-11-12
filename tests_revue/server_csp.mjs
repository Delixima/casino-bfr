// REVUE : même banc d'essai mais avec la VRAIE politique de sécurité (CSP) de netlify.toml.
// Banc d'essai local : sert le VRAI site (public/) avec la VRAIE logique SQL (pglite).
// Seuls Supabase et Steam sont simulés. Usage : node tests/harness/server.mjs [port]
// Ouvre ensuite http://localhost:PORT/?as=joueur (ou ?as=admin, ?as=pauvre)
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PUBLIC = join(root, 'public');
const PORT = Number(process.argv[2] || 5173);

const USERS = {
  joueur: { id: '00000000-0000-0000-0000-000000000001', steam: '76561198000000001', name: 'Tanjiro Kamado', balance: 20000 },
  pauvre: { id: '00000000-0000-0000-0000-000000000002', steam: '76561198000000002', name: 'Zenitsu', balance: 0 },
  admin: { id: '00000000-0000-0000-0000-0000000000aa', steam: '76561199213350970', name: 'Finance Relation', balance: 500 },
};

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
`);
await db.exec(readFileSync(join(root, 'supabase', 'migrations', '001_init.sql'), 'utf8'));
for (const u of Object.values(USERS)) {
  await db.exec(`insert into auth.users (id) values ('${u.id}')`);
  await db.query(`insert into public.profiles (id, steam_id, display_name, balance) values ($1, $2, $3, $4)`,
    [u.id, u.steam, u.name, u.balance]);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

async function asUser(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => ok(s ? JSON.parse(s) : {})); });
const ident = (s) => { if (!/^[a-z_]+$/.test(s)) throw new Error('identifiant invalide'); return `"${s}"`; };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/.netlify/functions/config') return json(res, 200, { supabaseUrl: 'http://harness', supabaseAnonKey: 'harness' });
    if (url.pathname === '/.netlify/functions/steam-login') { res.writeHead(302, { Location: '/?as=joueur' }); return res.end(); }
    if (url.pathname === '/__rpc' && req.method === 'POST') {
      const { uid, name, args } = await body(req);
      const keys = Object.keys(args || {});
      const params = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
      const sql = `select public.${ident(name).replaceAll('"', '')}(${keys.map((k, i) => `${k} => $${i + 1}${typeof args[k] === 'object' && args[k] !== null ? '::jsonb' : ''}`).join(', ')}) as r`;
      try {
        const r = await asUser(uid, (tx) => tx.query(sql, params));
        return json(res, 200, { data: r.rows[0].r });
      } catch (e) { return json(res, 200, { error: { message: e.message } }); }
    }
    if (url.pathname === '/__select' && req.method === 'POST') {
      const { uid, table, filters, order, limit } = await body(req);
      let sql = `select * from public.${ident(table)}`;
      const params = [];
      if (filters.length) sql += ' where ' + filters.map(([c, v]) => { params.push(v); return `${ident(c)} = $${params.length}`; }).join(' and ');
      if (order.length) sql += ' order by ' + order.map(([c, asc]) => `${ident(c)} ${asc ? 'asc' : 'desc'}`).join(', ');
      if (limit) sql += ` limit ${Number(limit)}`;
      try {
        const r = await asUser(uid, (tx) => tx.query(sql, params));
        return json(res, 200, { data: r.rows });
      } catch (e) { return json(res, 200, { error: { message: e.message } }); }
    }
    if (url.pathname === '/__users') return json(res, 200, USERS);

    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    if (p === '/vendor/supabase.js') p = null;
    const file = p ? normalize(join(PUBLIC, p)) : join(root, 'tests', 'harness', 'supabase-stub.js');
    if (!file.startsWith(PUBLIC) && p) { res.writeHead(403); return res.end(); }
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.steamstatic.com https://*.akamaihd.net https://avatars.steamstatic.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'", 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });
    res.end(readFileSync(file));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, () => console.log(`Banc d'essai prêt : http://localhost:${PORT}/?as=joueur`));

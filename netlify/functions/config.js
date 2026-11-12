// Configuration publique du site (l'URL et la clé "anon" de Supabase sont publiques par conception).
exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Variables SUPABASE_URL / SUPABASE_ANON_KEY manquantes sur Netlify.' }),
    };
  }
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    body: JSON.stringify({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY }),
  };
};

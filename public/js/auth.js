// Échange le jeton à usage unique (fourni par la fonction Netlify après Steam) contre une session.
import { getClient } from './core.js';

(async () => {
  const params = new URLSearchParams(location.hash.slice(1));
  const tokenHash = params.get('token_hash');
  history.replaceState(null, '', location.pathname);   // retire le jeton de l'adresse
  if (!tokenHash) { location.replace('/?error=session'); return; }
  try {
    const sb = await getClient();
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (error) throw error;
    location.replace('/');
  } catch (e) {
    console.error(e);
    location.replace('/?error=session');
  }
})();

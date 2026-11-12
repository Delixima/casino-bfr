// Redirige le joueur vers la page de connexion officielle de Steam.
const { getOrigin, buildLoginUrl } = require('../lib/steam');

exports.handler = async (event) => {
  return {
    statusCode: 302,
    headers: { Location: buildLoginUrl(getOrigin(event)), 'Cache-Control': 'no-store' },
    body: '',
  };
};

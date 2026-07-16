const fs = require('fs');
const path = require('path');

function readBundledConfig() {
  const configPath = path.resolve(__dirname, '../google-oauth.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function getGoogleConfig() {
  const bundled = readBundledConfig();
  return {
    clientId: bundled.clientId || process.env.GOOGLE_CLIENT_ID || '',
    // Desktop OAuth clients are public clients; a secret is optional and is
    // retained only as a development fallback for older credentials.
    clientSecret: bundled.clientSecret || process.env.GOOGLE_CLIENT_SECRET || ''
  };
}

module.exports = { getGoogleConfig };

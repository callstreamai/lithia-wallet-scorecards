import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 10000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 10000}`).replace(/\/$/, ''),

  supabase: {
    url: required('SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },

  apple: {
    teamId: required('APPLE_TEAM_ID'),
    passTypeId: required('APPLE_PASS_TYPE_ID'),
    p12Path: process.env.APPLE_PASS_P12_PATH,
    p12Password: process.env.APPLE_PASS_P12_PASSWORD || '',
    // Alternative to p12: PEM files
    certPemPath: process.env.APPLE_PASS_CERT_PEM_PATH,
    keyPemPath: process.env.APPLE_PASS_KEY_PEM_PATH,
    keyPemPassword: process.env.APPLE_PASS_KEY_PEM_PASSWORD || '',
    apnsKeyPath: process.env.APPLE_APNS_KEY_PATH,
    apnsKeyId: process.env.APPLE_APNS_KEY_ID,
  },

  webhookSecret: process.env.WEBHOOK_SECRET || '',
  adminApiKey: process.env.ADMIN_API_KEY || '',
  notifyOnChange: String(process.env.NOTIFY_ON_CHANGE || 'false').toLowerCase() === 'true',
};

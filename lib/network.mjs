import * as http from 'node:http';

let configured = false;
export function configureProxy(env = process.env, configure = http.setGlobalProxyFromEnv) {
  if (configured || !['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((key) => env[key])) return;
  if (typeof configure !== 'function') {
    if (env.NODE_USE_ENV_PROXY === '1') { configured = true; return; }
    throw new Error('Proxy runners require Node 24.14+ or NODE_USE_ENV_PROXY=1 at runner startup.');
  }
  configure(env);
  configured = true;
}

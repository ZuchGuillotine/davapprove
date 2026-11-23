import { assess, ClientError, countyOptions, metadata, search } from './assessment.mjs';
import { handleMcp } from './mcp.mjs';

const cookie = '__Host-davapprove-beta';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
const json = (value, status = 200) => Response.json(value, { status, headers: privateHeaders });
const withPrivateHeaders = response => {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(privateHeaders)) result.headers.set(name, value);
  return result;
};

async function tester(request, env, bearerOnly) {
  const authorization = request.headers.get('Authorization');
  const cookies = request.headers.get('Cookie') || '';
  const token = authorization
    ? /^Bearer ([\w.-]+)$/i.exec(authorization)?.[1]
    : !bearerOnly && cookies.split(';').map(part => part.trim()).find(part => part.startsWith(cookie + '='))?.slice(cookie.length + 1);
  if (!token) throw new ClientError('Sign in with your beta invitation to continue.', 401);
  const response = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 401 || response.status === 403) throw new ClientError('Your beta sign-in has expired. Sign in again.', 401);
  if (!response.ok) throw new ClientError('Beta sign-in is temporarily unavailable.', 503);
  const user = await response.json();
  if (user.app_metadata?.davapprove_beta !== true || !user.email_confirmed_at)
    throw new ClientError('This account needs a beta invitation.', 403);
  return { id: user.id, token };
}

function sessionCookie(token) {
  return `${cookie}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/${token ? '' : '; Max-Age=0'}`;
}

async function input(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    throw new ClientError('Send a JSON request.', 415);
  const maxBytes = 4 * 1024 * 1024;
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw new ClientError('Request too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ClientError('Missing request body.');
  const decoder = new TextDecoder();
  let text = '', size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ClientError('Request too large.', 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const body = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new ClientError('Invalid JSON request.');
  }
}

function recordEvent(env, ctx, event, required) {
  // The event is already limited to server-resolved county and enumerated selections.
  const write = (async () => {
    try {
      const key = env.BETA_EVENTS_SERVICE_KEY;
      const response = await fetch(env.SUPABASE_URL + '/rest/v1/beta_events', {
        method: 'POST',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error();
    } catch {
      console.warn('Beta metrics insert unavailable');
      if (required) throw new ClientError('Could not save your county request. Please retry.', 503);
    }
  })();
  if (required) return write;
  ctx.waitUntil(write);
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    url.protocol = 'https:';
    return Response.redirect(url, 308);
  }
  const path = url.pathname;
  if (path === '/api/v1/config' && request.method === 'GET') return json({
    private_beta: true, mode: 'supabase', supabase_url: env.SUPABASE_URL,
    publishable_key: env.SUPABASE_PUBLISHABLE_KEY, email_delivery_enabled: true,
    max_pdf_bytes: env.PROJECT_MAX_PDF_BYTES,
  });
  if (path.startsWith('/api/v1/')) {
    // Protect the deferred projects UI's same-origin API proxy as well as the estimate routes.
    await tester(request, env, true);
    const target = new URL(env.PROJECT_API_ORIGIN);
    target.pathname = path;
    target.search = url.search;
    const headers = new Headers(request.headers);
    headers.delete('Cookie');
    return withPrivateHeaders(await fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: 'manual' })));
  }
  if (path === '/mcp') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) throw new ClientError('Origin is not allowed.', 403);
    const user = await tester(request, env, true);
    if (!(await env.BETA_RATE_LIMIT.limit({ key: user.id })).success) throw new ClientError('Too many requests. Try again shortly.', 429);
    return withPrivateHeaders(await handleMcp(request, (event, required) => recordEvent(env, ctx, event, required)));
  }
  if (path.startsWith('/beta-api/')) {
    if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) throw new ClientError('Origin is not allowed.', 403);
    if (path === '/beta-api/sign-out' && request.method === 'POST') {
      const response = json({});
      response.headers.set('Set-Cookie', sessionCookie(''));
      return response;
    }
    const session = path === '/beta-api/session';
    const user = await tester(request, env, session);
    if (session && request.method === 'POST') {
      const response = json({ allowed: true });
      response.headers.set('Set-Cookie', sessionCookie(user.token));
      return response;
    }
    if (path === '/beta-api/meta' && request.method === 'GET') return json(await metadata());
    if (path === '/beta-api/counties' && request.method === 'GET') return json(countyOptions);
    if (request.method !== 'POST') throw new ClientError('Route not found.', 404);
    if (!(await env.BETA_RATE_LIMIT.limit({ key: user.id })).success) throw new ClientError('Too many requests. Try again shortly.', 429);
    const body = await input(request);
    if (path === '/beta-api/search') return json(await search(body));
    if (path === '/beta-api/estimate' || path === '/beta-api/report' || path === '/beta-api/coverage')
      return json(await assess(path === '/beta-api/coverage' ? { county_code: body.county_code } : body, {
        source: 'web', detailed: path === '/beta-api/report', record: (event, required) => recordEvent(env, ctx, event, required),
      }));
    throw new ClientError('Route not found.', 404);
  }
  if (path === '/bid-assistant' || path === '/bid-assistant/' || path.startsWith('/bid-assistant/')) {
    if (!/^\/bid-assistant\/(?:index\.html|app\.js|hosted\.js|styles\.css|lib\/(?:geo|presentation|guidance|report|drafts|account-storage|exports)\.js|lib\/workspace-navigation\.(?:css|js)|vendor\/leaflet\/(?:leaflet\.(?:js|css)|images\/[\w-]+\.png))$/.test(path))
      throw new ClientError('Route not found.', 404);
    if (path.endsWith('/index.html')) {
      await tester(request, env, false);
      const response = withPrivateHeaders(await env.ASSETS.fetch(request));
      response.headers.set('X-Frame-Options', 'SAMEORIGIN');
      return response;
    }
    return env.ASSETS.fetch(request);
  }
  if (path.startsWith('/assets/')) return env.ASSETS.fetch(request);
  const shell = new URL('/index.html', url);
  return withPrivateHeaders(await env.ASSETS.fetch(new Request(shell, request)));
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      if (error instanceof ClientError) return json({ detail: error.message }, error.status);
      console.warn('Beta request could not be completed');
      return json({ detail: 'Davapprove is temporarily unavailable. Please try again.' }, 503);
    }
  },
};

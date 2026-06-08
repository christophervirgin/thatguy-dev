/**
 * Cloudflare Pages Function — proxies /api/* to the NAS API
 * via a Cloudflare Tunnel.
 *
 * Set these in Cloudflare Pages → Settings → Environment Variables:
 *   API_TUNNEL_URL  = https://merrell-api.your-tunnel.cfargotunnel.com
 *                     (the public hostname you assign to the tunnel)
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Strip /api prefix, forward rest to tunnel
  const apiPath = url.pathname.replace(/^\/api/, '');
  const target  = `${env.API_TUNNEL_URL}${apiPath}${url.search}`;

  // Forward the request
  const apiReq = new Request(target, {
    method:  request.method,
    headers: request.headers,
    body:    request.method !== 'GET' ? request.body : undefined,
  });

  // Attach internal secret so the API can verify it came from the worker
  apiReq.headers.set('X-Internal-Token', env.INTERNAL_TOKEN || '');

  const resp = await fetch(apiReq);

  // Pass response back with CORS headers stripped (CF Access handles auth)
  const newHeaders = new Headers(resp.headers);
  newHeaders.set('X-Frame-Options', 'SAMEORIGIN');

  return new Response(resp.body, {
    status:  resp.status,
    headers: newHeaders,
  });
}

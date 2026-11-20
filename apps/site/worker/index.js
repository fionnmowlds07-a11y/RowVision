// The site is static files. This Worker only runs for /get/<file>: it counts the click, then sends
// the browser on to the installer in R2. Every other path goes straight to the static files.
// The installer addresses are written into dist/downloads.json at build time, from .env.

const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|curl|wget|python|go-http/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const file = url.pathname.match(/^\/get\/([a-z]+)\/?$/)?.[1];
    if (!file) return env.ASSETS.fetch(request);

    const files = await (await env.ASSETS.fetch(new URL('/downloads.json', url))).json();
    const target = files[file];
    if (!target) return new Response('Not found', { status: 404 });

    // HEAD and link previews are not downloads.
    const agent = request.headers.get('user-agent') || '';
    if (request.method === 'GET' && agent && !BOTS.test(agent)) {
      const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      ctx.waitUntil(
        env.DB.prepare('INSERT INTO downloads (at, file, country) VALUES (?, ?, ?)')
          .bind(at, file, request.cf?.country ?? null).run()
          .catch(err => console.error('count failed', err)),
      );
    }
    return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store' } });
  },
};

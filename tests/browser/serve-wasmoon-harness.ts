const root = new URL('./', import.meta.url);

Bun.serve({
  port: 41873,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/' || path === '/wasmoon-lifecycle-harness.html') {
      return new Response(Bun.file(new URL('wasmoon-lifecycle-harness.html', root)));
    }
    if (path === '/dist/wasmoon-lifecycle-harness.js') {
      return new Response(Bun.file(new URL('dist/wasmoon-lifecycle-harness.js', root)), {
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
      });
    }
    return new Response('Not found', { status: 404 });
  },
});

import { createServer } from 'node:http';

const port = Number(process.env.IV_E2E_FAKE_API_PORT ?? 57991);

createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/ready') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }
  if (request.method === 'GET' && request.url === '/v1/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/problem+json' });
  response.end(
    JSON.stringify({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'not_found',
      request_id: 'e2e',
    }),
  );
}).listen(port, '127.0.0.1');

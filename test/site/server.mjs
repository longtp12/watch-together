// Fake movie site for tests. Serves both "animevietsub.sale" (the page) and
// "player.test" (the player iframe) on one port; the browser maps both names to 127.0.0.1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const port = Number(process.argv[2] || 8080);

const moviePage = episode => `<!doctype html><html><head><meta charset="utf-8"><title>Tập ${episode}</title></head>
<body style="background:#111;color:#eee;font-family:sans-serif">
  <h1>Phim test - Tập ${episode}</h1>
  <iframe id="player" src="http://player.test:${port}/player.html${episode === '02' ? '?ad=1' : ''}"
    width="640" height="360" allow="autoplay; fullscreen" allowfullscreen></iframe>
</body></html>`;

// ?ad=1 plays a 30 s ad first, then swaps the same video element to the movie.
const playerPage = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#000">
  <div class="jwplayer"><video id="v" controls muted width="640" height="360"></video></div>
  <script>
    const v = document.getElementById('v');
    const ad = new URLSearchParams(location.search).has('ad');
    v.src = ad ? '/media/ad.webm' : '/media/movie.webm';
    if (ad) v.addEventListener('ended', () => { v.src = '/media/movie.webm'; v.play(); }, { once: true });
  </script>
</body></html>`;

function sendFile(req, res, file, type) {
  const size = fs.statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = Number(range[1] || 0);
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const html = body => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    const episode = /tap-(\d+)/.exec(url.pathname);
    if (url.pathname.startsWith('/media/')) {
      const file = path.join(dir, 'media', path.basename(url.pathname));
      if (fs.existsSync(file)) return sendFile(req, res, file, 'video/webm');
    } else if (url.pathname === '/player.html') {
      return html(playerPage);
    } else if (episode) {
      return html(moviePage(episode[1]));
    }
    res.writeHead(404);
    res.end('not found');
  })
  .listen(port, () => console.log(`test site on :${port}`));

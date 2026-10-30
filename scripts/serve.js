// ==========================================================================
// Lightweight Static HTTP Server for EmeraldWealth HNW Retirement App
// ==========================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function fetchIrs7520RatesFromGov() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      'https://www.irs.gov/businesses/small-businesses-self-employed/section-7520-interest-rates',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000 },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`IRS.gov returned HTTP ${res.statusCode}`));
          return;
        }
        let html = '';
        res.on('data', (d) => (html += d));
        res.on('end', () => {
          const trMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
          const rates = [];
          for (const tr of trMatches) {
            const text = tr
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            // Match e.g. "October 2026 5.54 5.6 Rev. Rul. 2026-19"
            const m = text.match(
              /^((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\s+([\d.]+)\s+([\d.]+)\s+(Rev\.\s*Rul\.?\s*[\d-]+)/i
            );
            if (m) {
              rates.push({
                month: m[1].trim(),
                midterm120: parseFloat(m[2]),
                rate: parseFloat(m[3]),
                revRuling: m[4].trim()
              });
            }
          }
          rates.sort((a, b) => new Date('1 ' + b.month).getTime() - new Date('1 ' + a.month).getTime());
          resolve(rates);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('IRS.gov request timed out'));
    });
  });
}

const server = http.createServer(async (req, res) => {
  const safePath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (safePath === '/api/irs-7520-rates') {
    try {
      const liveRates = await fetchIrs7520RatesFromGov();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(JSON.stringify({ source: 'IRS.gov (Live)', rates: liveRates }));
    } catch (err) {
      res.writeHead(502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const relPath = safePath === '/' ? '/index.html' : safePath;
  const filePath = path.join(ROOT, relPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`EmeraldWealth HNW App running at http://localhost:${PORT}`);
  console.log(`Single-file bundle available at http://localhost:${PORT}/dist/retirement-planner.html`);
});

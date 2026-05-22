const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PHOTOS_DIR = path.join(__dirname, 'photos');
const COVERS_DIR = path.join(__dirname, 'covers');
const DATA_FILE = path.join(__dirname, 'data.json');
const LOCATIONS_FILE = path.join(__dirname, 'locations.json');
const MAX_BODY = 100 * 1024 * 1024;

for (const dir of [PHOTOS_DIR, COVERS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ── Metadata helpers ──
function loadMeta() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {}
  return {};
}
function saveMeta(m) { fs.writeFileSync(DATA_FILE, JSON.stringify(m, null, 2), 'utf8'); }

// ── Location helpers ──
function loadLocations() {
  try { if (fs.existsSync(LOCATIONS_FILE)) return JSON.parse(fs.readFileSync(LOCATIONS_FILE, 'utf8')); } catch (_) {}
  return {};
}
function saveLocations(l) { fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(l, null, 2), 'utf8'); }

// ── Static files ──
function serveFile(res, filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(__dirname)) { res.writeHead(403); return res.end('Forbidden'); }
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); }
    else {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    }
  });
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Photo APIs ──

function listPhotos(res, locationFilter) {
  try {
    const files = fs.readdirSync(PHOTOS_DIR)
      .filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f))
      .sort((a, b) => fs.statSync(path.join(PHOTOS_DIR, b)).mtimeMs - fs.statSync(path.join(PHOTOS_DIR, a)).mtimeMs);
    const meta = loadMeta();
    let result = files.map(f => ({
      filename: f, caption: meta[f]?.caption || '', date: meta[f]?.date || '', location: meta[f]?.location || ''
    }));
    if (locationFilter) result = result.filter(p => p.location === locationFilter);
    json(res, 200, result);
  } catch (e) { json(res, 500, { error: e.message }); }
}

function uploadPhotos(req, res) {
  let body = '', size = 0;
  req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { req.destroy(); return; } body += chunk; });
  req.on('end', () => {
    try {
      const files = JSON.parse(body);
      if (!Array.isArray(files)) return json(res, 400, { error: 'Expected array' });
      const saved = [], meta = loadMeta();
      for (const f of files) {
        const match = f.data.match(/^data:(.+);base64,(.+)$/);
        if (!match) continue;
        const safeName = f.filename.replace(/[\\/:*?"<>|]/g, '_');
        fs.writeFileSync(path.join(PHOTOS_DIR, safeName), Buffer.from(match[2], 'base64'));
        if (f.location) meta[safeName] = { caption: meta[safeName]?.caption || '', date: meta[safeName]?.date || '', location: f.location };
        saved.push(safeName);
      }
      saveMeta(meta);
      json(res, 200, { saved });
    } catch (e) { json(res, 500, { error: e.message }); }
  });
}

function updatePhoto(req, res, filename) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const { caption, date, location } = JSON.parse(body);
      const meta = loadMeta();
      meta[filename] = { caption: caption || '', date: date || '', location: location || '' };
      saveMeta(meta);
      json(res, 200, { ok: true });
    } catch (e) { json(res, 500, { error: e.message }); }
  });
}

function deletePhoto(res, filename) {
  try {
    const fp = path.join(PHOTOS_DIR, filename);
    if (!fp.startsWith(PHOTOS_DIR)) return json(res, 403, { error: 'Forbidden' });
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    const meta = loadMeta(); delete meta[filename]; saveMeta(meta);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ── Location APIs ──

function listLocations(res) {
  try {
    const locations = loadLocations(), meta = loadMeta(), counts = {};
    const diskFiles = new Set(fs.readdirSync(PHOTOS_DIR));
    for (const [fn, info] of Object.entries(meta)) {
      if (info.location && diskFiles.has(fn)) counts[info.location] = (counts[info.location] || 0) + 1;
    }
    const result = {};
    for (const [name, loc] of Object.entries(locations)) result[name] = { ...loc, photoCount: counts[name] || 0 };
    json(res, 200, result);
  } catch (e) { json(res, 500, { error: e.message }); }
}

function createLocation(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const { name, coverData, description } = data;
      const locName = (name || '').trim();
      if (!locName) return json(res, 400, { error: 'Name required' });
      const locations = loadLocations();
      if (locations[locName]) return json(res, 409, { error: 'Location exists' });

      let coverFilename = '';
      if (coverData) {
        const match = coverData.match(/^data:(.+);base64,(.+)$/);
        if (!match) return json(res, 400, { error: 'Invalid cover' });
        const ext = match[1].includes('png') ? '.png' : '.jpg';
        coverFilename = 'cover_' + locName.replace(/[\\/:*?"<>|]/g, '_') + '_' + Date.now() + ext;
        fs.writeFileSync(path.join(COVERS_DIR, coverFilename), Buffer.from(match[2], 'base64'));
      }

      locations[locName] = { name: locName, coverImage: coverFilename, description: (description || ''), createdAt: new Date().toISOString() };
      saveLocations(locations);
      json(res, 201, locations[locName]);
    } catch (e) { json(res, 500, { error: e.message }); }
  });
}

function updateLocation(req, res, locName) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const locations = loadLocations();
      if (!locations[locName]) return json(res, 404, { error: 'Not found' });
      const updates = JSON.parse(body);
      if (updates.description !== undefined) {
        locations[locName].description = updates.description;
      }
      saveLocations(locations);
      json(res, 200, locations[locName]);
    } catch (e) { json(res, 500, { error: e.message }); }
  });
}

function deleteLocation(res, locName) {
  try {
    const locations = loadLocations();
    if (!locations[locName]) return json(res, 404, { error: 'Not found' });

    const coverFile = locations[locName].coverImage;
    if (coverFile) { const cp = path.join(COVERS_DIR, coverFile); if (fs.existsSync(cp)) fs.unlinkSync(cp); }
    delete locations[locName]; saveLocations(locations);

    const meta = loadMeta();
    for (const [fn, info] of Object.entries(meta)) {
      if (info.location === locName) { const pp = path.join(PHOTOS_DIR, fn); if (fs.existsSync(pp)) fs.unlinkSync(pp); delete meta[fn]; }
    }
    saveMeta(meta);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// ── Main ──
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const m = req.method;

  if (url.pathname === '/api/locations' && m === 'GET') return listLocations(res);
  if (url.pathname === '/api/locations' && m === 'POST') return createLocation(req, res);

  if (url.pathname.startsWith('/api/locations/') && m === 'DELETE') {
    return deleteLocation(res, decodeURIComponent(url.pathname.slice('/api/locations/'.length)));
  }

  if (url.pathname.startsWith('/api/locations/') && m === 'PUT') {
    return updateLocation(req, res, decodeURIComponent(url.pathname.slice('/api/locations/'.length)));
  }

  if (url.pathname === '/api/photos' && m === 'GET')
    return listPhotos(res, url.searchParams.get('location') || '');

  if (url.pathname === '/api/upload' && m === 'POST') return uploadPhotos(req, res);

  if (url.pathname.startsWith('/api/photos/')) {
    const fn = decodeURIComponent(url.pathname.slice('/api/photos/'.length));
    if (m === 'PUT') return updatePhoto(req, res, fn);
    if (m === 'DELETE') return deletePhoto(res, fn);
    return json(res, 405, { error: 'Method not allowed' });
  }

  let filePath;
  if (url.pathname === '/') filePath = path.join(__dirname, 'index.html');
  else if (url.pathname.startsWith('/covers/')) filePath = path.join(COVERS_DIR, path.basename(decodeURIComponent(url.pathname)));
  else filePath = path.join(__dirname, decodeURIComponent(url.pathname));
  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  *  Our Memories  *');
  console.log('  -----------------');
  console.log(`  http://localhost:${PORT}`);
  console.log('');
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

loadEnvironment(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_FILE = path.join(ROOT, 'data', 'content.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-development-secret-change-before-deploying';
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const loginAttempts = new Map();

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadEnvironment(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function freshData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, DATA_FILE);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(message);
}

function safeEquals(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function passwordMatches(password) {
  const configuredHash = process.env.ADMIN_PASSWORD_HASH;
  if (configuredHash) {
    const [, salt, expected] = configuredHash.split('$');
    if (!salt || !expected) return false;
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return safeEquals(derived, expected);
  }
  return safeEquals(password, process.env.ADMIN_PASSWORD || 'change-this-password');
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', expires: Date.now() + 1000 * 60 * 60 * 12 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function sessionIsValid(req) {
  const cookie = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('insightforge_session='));
  if (!cookie) return false;
  const [payload, signature] = decodeURIComponent(cookie.slice('insightforge_session='.length)).split('.');
  if (!payload || !signature || !safeEquals(signature, sign(payload))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.role === 'admin' && Number(session.expires) > Date.now();
  } catch {
    return false;
  }
}

function setSession(res, value) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `insightforge_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
}

function clearSession(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `insightforge_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('The upload is too large. The limit is 12 MB.'));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error('Please send valid form data.');
  }
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('The upload form is missing its boundary.');
  const marker = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const rawParts = buffer.toString('latin1').split(marker).slice(1, -1);
  const fields = {};
  let file = null;
  for (let rawPart of rawParts) {
    rawPart = rawPart.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const separator = rawPart.indexOf('\r\n\r\n');
    if (separator < 0) continue;
    const headers = rawPart.slice(0, separator);
    const body = Buffer.from(rawPart.slice(separator + 4), 'latin1');
    const disposition = headers.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (!disposition) continue;
    const name = disposition[1];
    const filename = disposition[2];
    if (filename !== undefined && filename !== '') {
      const type = (headers.match(/content-type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream';
      file = { field: name, filename, contentType: type.trim(), buffer: body };
    } else {
      fields[name] = body.toString('utf8');
    }
  }
  return { fields, file };
}

function cleanText(value, maximum = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function cleanUrl(value) {
  const result = cleanText(value, 1000);
  if (!result) return '';
  if (result.startsWith('/uploads/')) return result;
  try {
    const url = new URL(result);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function cleanProject(payload, existing = {}) {
  const tags = Array.isArray(payload.tags) ? payload.tags : String(payload.tags || '').split(',');
  return {
    ...existing,
    title: cleanText(payload.title, 120),
    description: cleanText(payload.description, 1000),
    tags: tags.map((tag) => cleanText(tag, 32)).filter(Boolean).slice(0, 8),
    link: cleanUrl(payload.link),
    imageUrl: cleanUrl(payload.imageUrl),
    featured: Boolean(payload.featured)
  };
}

function mimeType(file) {
  return ({
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendText(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': mimeType(filePath), 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(filePath).pipe(res);
}

function requireAdmin(req, res) {
  if (sessionIsValid(req)) return true;
  sendJson(res, 401, { error: 'Please sign in to continue.' });
  return false;
}

function loginAllowed(ip) {
  const now = Date.now();
  const state = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  if (now - state.firstAttempt > 15 * 60 * 1000) {
    loginAttempts.set(ip, { count: 0, firstAttempt: now });
    return true;
  }
  return state.count < 5;
}

function registerLoginFailure(ip) {
  const now = Date.now();
  const state = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  loginAttempts.set(ip, { count: state.count + 1, firstAttempt: state.firstAttempt });
}

function publicPayload(data) {
  return { profile: data.profile, projects: data.projects.filter((project) => project.featured !== false) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");

  try {
    if (req.method === 'GET' && pathname === '/api/public') return sendJson(res, 200, publicPayload(freshData()));

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const ip = req.socket.remoteAddress || 'unknown';
      if (!loginAllowed(ip)) return sendJson(res, 429, { error: 'Too many attempts. Please wait 15 minutes and try again.' });
      const body = parseJson(await readBody(req));
      if (!passwordMatches(String(body.password || ''))) {
        registerLoginFailure(ip);
        return sendJson(res, 401, { error: 'That password is not correct.' });
      }
      loginAttempts.delete(ip);
      setSession(res, createSession());
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      clearSession(res);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/admin/dashboard') {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, freshData());
    }

    if (req.method === 'PATCH' && pathname === '/api/admin/profile') {
      if (!requireAdmin(req, res)) return;
      const data = freshData();
      const body = parseJson(await readBody(req));
      for (const key of ['name', 'role', 'tagline', 'summary', 'location', 'email']) data.profile[key] = cleanText(body[key], key === 'summary' ? 2000 : 160);
      for (const key of ['linkedin', 'github', 'website', 'resumeUrl', 'avatarUrl']) data.profile[key] = cleanUrl(body[key]);
      saveData(data);
      return sendJson(res, 200, { profile: data.profile });
    }

    if (req.method === 'POST' && pathname === '/api/admin/projects') {
      if (!requireAdmin(req, res)) return;
      const data = freshData();
      const project = cleanProject(parseJson(await readBody(req)));
      if (!project.title || !project.description) return sendJson(res, 422, { error: 'A project needs both a title and description.' });
      project.id = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project'}-${crypto.randomBytes(3).toString('hex')}`;
      project.createdAt = new Date().toISOString();
      data.projects.unshift(project);
      saveData(data);
      return sendJson(res, 201, { project });
    }

    const projectMatch = pathname.match(/^\/api\/admin\/projects\/([a-z0-9-]+)$/);
    if (projectMatch && req.method === 'PATCH') {
      if (!requireAdmin(req, res)) return;
      const data = freshData();
      const index = data.projects.findIndex((project) => project.id === projectMatch[1]);
      if (index < 0) return sendJson(res, 404, { error: 'Project not found.' });
      const project = cleanProject(parseJson(await readBody(req)), data.projects[index]);
      if (!project.title || !project.description) return sendJson(res, 422, { error: 'A project needs both a title and description.' });
      data.projects[index] = project;
      saveData(data);
      return sendJson(res, 200, { project });
    }

    if (projectMatch && req.method === 'DELETE') {
      if (!requireAdmin(req, res)) return;
      const data = freshData();
      const before = data.projects.length;
      data.projects = data.projects.filter((project) => project.id !== projectMatch[1]);
      if (data.projects.length === before) return sendJson(res, 404, { error: 'Project not found.' });
      saveData(data);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/admin/upload') {
      if (!requireAdmin(req, res)) return;
      const { fields, file } = parseMultipart(await readBody(req), req.headers['content-type'] || '');
      if (!file || !file.buffer.length) return sendJson(res, 422, { error: 'Choose a file to upload first.' });
      const extension = path.extname(file.filename).toLowerCase();
      const safeExtension = /^[a-z0-9.]{0,10}$/.test(extension) ? extension : '';
      const storedName = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${safeExtension}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, storedName), file.buffer);
      const data = freshData();
      const upload = { id: crypto.randomUUID(), name: cleanText(file.filename, 140), url: `/uploads/${storedName}`, type: file.contentType, uploadedAt: new Date().toISOString() };
      data.uploads.unshift(upload);
      if (fields.target === 'resume') data.profile.resumeUrl = upload.url;
      if (fields.target === 'avatar') data.profile.avatarUrl = upload.url;
      saveData(data);
      return sendJson(res, 201, { upload, profile: data.profile });
    }

    if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
      const requested = path.basename(pathname);
      return sendFile(res, path.join(UPLOAD_DIR, requested));
    }

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) return sendFile(res, path.join(PUBLIC_DIR, 'admin.html'));
    if (req.method === 'GET' && /^\/(app|admin|styles)\.js$/.test(pathname)) return sendFile(res, path.join(PUBLIC_DIR, path.basename(pathname)));
    if (req.method === 'GET' && pathname === '/styles.css') return sendFile(res, path.join(PUBLIC_DIR, 'styles.css'));

    return sendText(res, 404, 'Not found');
  } catch (error) {
    console.error(error);
    if (!res.headersSent) return sendJson(res, error.message.includes('large') ? 413 : 400, { error: error.message || 'Something went wrong.' });
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`InsightForge is running at http://localhost:${PORT}`);
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD_HASH) console.warn('Set ADMIN_PASSWORD_HASH before using this site in production.');
});

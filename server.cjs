const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const AUDIT_DIR = path.join(DATA_DIR, 'audits');
const REPORT_DIR = path.join(DATA_DIR, 'reports');
const DB_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT || 3031);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 10 * 1024 * 1024;
const sessions = new Map();
const attempts = new Map();
let db = { version: 1, users: [], tasks: [], audits: [], contacts: [], scripts: [], reports: [], spendRecords: [] };
let saveQueue = Promise.resolve();

const now = () => new Date().toISOString();
const clean = (value, max) => String(value == null ? '' : value).trim().slice(0, max || 500);
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const safeUser = user => ({ id: user.id, name: user.name, loginId: user.loginId, role: user.role, title: user.title || '', active: user.active !== false, profilePath: user.profilePath || '' });
const CRM_CHANNELS = ['Meta Ads', 'Google Ads', 'WhatsApp', 'Instagram Organic', 'Facebook Organic', 'Website', 'OTA', 'Referral', 'Travel Agent', 'Other'];
const TEAM_ASSISTANT_CONTEXT = {
  'OTA Master': 'Help with OTA listing quality, platform-specific listing checklists, rate and availability parity, amenity accuracy, photo sequencing, and review responses.',
  'Videographer + Editor': 'Help with property shot lists, shoot-day planning, framing, audio, editing handoff, versions, revisions, and delivery checklists.',
  'Meta Ads': 'Help with campaign structure, creative testing, audiences, pacing, lead quality, and reporting. Ask for actual metrics before suggesting numeric changes.',
  'Google Optimizer': 'Help with Google Business Profile, local SEO, keyword research workflows, landing pages, review responses, and measurement. Never invent rankings or search volume.',
  'Graphic Designer': 'Help with hospitality campaign concepts, layout hierarchy, image selection, ad variants, brand consistency, and feedback checklists.',
  'Sales': 'Help qualify hospitality prospects, plan discovery calls, keep CRM notes clear, set follow-ups, and prepare concise proposals. Never promise unapproved prices or results.',
  'HR': 'Help with volunteer outreach, onboarding steps, role descriptions, candidate tracking, and respectful follow-up.',
  'Social Media Manager': 'Help with hospitality content calendars, reels, captions, scripts, client approvals, posting, and content pipeline planning. Do not invent property claims.',
  Admin: 'Help the two hospitality-agency admins plan team work, review audits and CRM processes, improve handoffs, and prepare concise reports. Do not invent business metrics.'
};
const send = (res, code, body, headers) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {})); res.end(JSON.stringify(body)); };
const fail = (res, code, message) => send(res, code, { error: message });

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('The form data could not be read.'), { status: 400 }); }
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function checkPassword(password, user) {
  const given = crypto.scryptSync(password, user.salt, 64);
  const expected = Buffer.from(user.passwordHash, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function loadDb() {
  for (const folder of [DATA_DIR, UPLOAD_DIR, AUDIT_DIR, REPORT_DIR]) await fs.mkdir(folder, { recursive: true });
  try {
    const saved = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
    db = Object.assign(db, saved);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const key of ['users', 'tasks', 'audits', 'contacts', 'scripts', 'reports', 'spendRecords']) if (!Array.isArray(db[key])) db[key] = [];
}

async function loadLocalEnv() {
  try {
    const contents = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!match || match[1].startsWith('#') || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function persist() {
  const snapshot = JSON.stringify(db, null, 2);
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const temp = DB_FILE + '.tmp';
    await fs.writeFile(temp, snapshot, 'utf8');
    await fs.rename(temp, DB_FILE);
  });
  return saveQueue;
}

function cookieMap(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf('=');
    return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
  }));
}

function currentUser(req) {
  const token = cookieMap(req).growth_session;
  const session = token && sessions.get(token);
  if (!session || session.expires <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return db.users.find(user => user.id === session.userId && user.active !== false) || null;
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user) { fail(res, 401, 'Please sign in to continue.'); return null; }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (user && user.role !== 'admin') { fail(res, 403, 'This area is for admins.'); return null; }
  return user;
}

function setSession(res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_MS });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'growth_session=' + encodeURIComponent(token) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + Math.floor(SESSION_MS / 1000) + secure);
}

function clearSession(req, res) {
  const token = cookieMap(req).growth_session;
  if (token) sessions.delete(token);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'growth_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + secure);
}

function cleanTask(input, existing, user) {
  const item = Object.assign({}, existing || {});
  for (const key of ['title', 'type', 'client', 'dueDate', 'dueTime', 'description', 'priority', 'otaPlatformId', 'segment', 'location']) {
    if (input[key] !== undefined) item[key] = clean(input[key], key === 'description' ? 2000 : 180);
  }
  const memberId = input.memberId !== undefined ? clean(input.memberId, 80) : item.memberId;
  const member = db.users.find(u => u.id === memberId && u.role === 'member' && u.active !== false);
  if (!member) throw new Error('Choose an active team member for this task.');
  item.memberId = member.id;
  item.memberName = member.name;
  item.memberTitle = member.title;
  item.category = member.title;
  if (!item.title) throw new Error('Give the task a short title.');
  if (!item.dueDate) throw new Error('Add a deadline date.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)) throw new Error('Use a valid deadline date.');
  if (item.dueTime && !/^\d{2}:\d{2}$/.test(item.dueTime)) throw new Error('Use a valid deadline time.');
  item.updatedAt = now();
  item.updatedBy = user.name;
  return item;
}

function localDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function reportFor(date) {
  const tasks = db.tasks.filter(task => task.dueDate === date);
  const members = db.users.filter(user => user.role === 'member' && (user.active !== false || db.tasks.some(t => t.memberId === user.id)));
  const people = members.map(member => {
    const assigned = tasks.filter(task => task.memberId === member.id);
    const completed = assigned.filter(task => task.status === 'done');
    const completedOnDate = db.tasks.filter(task => task.memberId === member.id && task.status === 'done' && String(task.completedAt || '').slice(0, 10) === date);
    return {
      memberId: member.id, memberName: member.name, title: member.title,
      assigned: assigned.length, done: completed.length, pending: assigned.length - completed.length,
      completedToday: completedOnDate.length,
      completionRate: assigned.length ? Math.round(completed.length * 100 / assigned.length) : 0,
      late: assigned.filter(task => task.status !== 'done' && task.dueDate < localDate()).length,
      tasks: assigned.map(task => ({ id: task.id, title: task.title, client: task.client, status: task.status, dueTime: task.dueTime }))
    };
  });
  const assigned = tasks.length;
  const done = tasks.filter(task => task.status === 'done').length;
  return {
    id: crypto.randomUUID(), date, generatedAt: now(),
    totals: {
      assigned, done, pending: assigned - done,
      completedToday: db.tasks.filter(task => task.status === 'done' && String(task.completedAt || '').slice(0, 10) === date).length,
      completionRate: assigned ? Math.round(done * 100 / assigned) : 0,
      audits: db.audits.length
    },
    members: people
  };
}

async function saveAuditFile(audit) {
  await fs.writeFile(path.join(AUDIT_DIR, audit.id + '.json'), JSON.stringify(audit, null, 2), 'utf8');
}

function crmConnectionState() {
  return {
    meta: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID),
    google: Boolean(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET && process.env.GOOGLE_ADS_REFRESH_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID && process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    openai: Boolean(process.env.OPENAI_API_KEY)
  };
}

async function requestJson(url, options, label) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error && (data.error.message || data.error_description) || data.message || 'request failed';
    throw new Error((label || 'External service') + ': ' + clean(message, 300));
  }
  return data;
}

function validateDateRange(data) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(data.from || '') ? data.from : localDate();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(data.to || '') ? data.to : localDate();
  if (from > to) throw new Error('Choose a start date before the end date.');
  const span = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
  if (span > 90) throw new Error('Sync one 90-day period at a time.');
  return { from, to };
}

async function fetchMetaSpend(from, to) {
  const account = clean(process.env.META_AD_ACCOUNT_ID, 100).replace(/^act_/, '').replace(/\D/g, '');
  const token = process.env.META_ACCESS_TOKEN;
  if (!account || !token) throw new Error('Add META_AD_ACCOUNT_ID and META_ACCESS_TOKEN to .env first.');
  const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION || '') ? process.env.META_GRAPH_VERSION : 'v25.0';
  const headers = { Authorization: 'Bearer ' + token };
  const accountInfo = await requestJson('https://graph.facebook.com/' + version + '/act_' + account + '?fields=name,currency', { headers }, 'Meta Ads');
  if (accountInfo.currency && accountInfo.currency !== 'INR') throw new Error('Meta account currency is ' + accountInfo.currency + '. This workspace totals ad spend in INR; connect an INR account for comparable totals.');
  let next = new URL('https://graph.facebook.com/' + version + '/act_' + account + '/insights');
  next.searchParams.set('fields', 'campaign_id,campaign_name,spend,impressions,clicks,actions,date_start,date_stop');
  next.searchParams.set('level', 'campaign');
  next.searchParams.set('time_range', JSON.stringify({ since: from, until: to }));
  next.searchParams.set('time_increment', '1');
  next.searchParams.set('limit', '500');
  const rows = [];
  for (let page = 0; next && page < 40; page++) {
    const pageUrl = next.toString();
    const result = await requestJson(pageUrl, { headers }, 'Meta Ads');
    for (const row of result.data || []) {
      const leadAction = (row.actions || []).find(action => /lead/i.test(action.action_type || ''));
      rows.push({
        id: 'meta-' + clean(row.campaign_id || 'account', 100) + '-' + row.date_start,
        date: row.date_start, channel: 'Meta Ads', campaign: clean(row.campaign_name || 'Meta campaign', 180),
        amount: Number(row.spend || 0), currency: 'INR', impressions: Number(row.impressions || 0), clicks: Number(row.clicks || 0),
        leads: Number(leadAction && leadAction.value || 0), recordSource: 'meta-sync', externalId: clean(row.campaign_id || 'account', 100) + '-' + row.date_start,
        accountName: clean(accountInfo.name || 'Meta Ads account', 120), syncedAt: now()
      });
    }
    next = result.paging && result.paging.next ? new URL(result.paging.next) : null;
    if (next && next.hostname !== 'graph.facebook.com') throw new Error('Meta returned an unexpected pagination address.');
  }
  return rows;
}

async function fetchGoogleSpend(from, to) {
  const config = {
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    customerId: clean(process.env.GOOGLE_ADS_CUSTOMER_ID, 40).replace(/\D/g, '')
  };
  if (!config.clientId || !config.clientSecret || !config.refreshToken || !config.customerId) throw new Error('Add Google Ads OAuth credentials and GOOGLE_ADS_CUSTOMER_ID to .env first.');
  const tokenData = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken })
  }, 'Google Ads authorization');
  const version = /^v\d+$/.test(process.env.GOOGLE_ADS_API_VERSION || '') ? process.env.GOOGLE_ADS_API_VERSION : 'v26';
  const query = "SELECT segments.date, campaign.id, campaign.name, customer.currency_code, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '" + from + "' AND '" + to + "' ORDER BY segments.date";
  const headers = { Authorization: 'Bearer ' + tokenData.access_token, 'Content-Type': 'application/json' };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/\D/g, '');
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) headers['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const result = await requestJson('https://googleads.googleapis.com/' + version + '/customers/' + config.customerId + '/googleAds:searchStream', {
    method: 'POST', headers, body: JSON.stringify({ query })
  }, 'Google Ads');
  const batches = Array.isArray(result) ? result : [result];
  const rows = batches.flatMap(batch => batch.results || []);
  return rows.map(row => {
    const date = row.segments && row.segments.date || from;
    const campaignId = String(row.campaign && row.campaign.id || 'account');
    const currency = row.customer && row.customer.currencyCode || 'INR';
    if (currency !== 'INR') throw new Error('Google Ads account currency is ' + currency + '. This workspace totals ad spend in INR; connect an INR account for comparable totals.');
    const metrics = row.metrics || {};
    return {
      id: 'google-' + campaignId + '-' + date, date, channel: 'Google Ads', campaign: clean(row.campaign && row.campaign.name || 'Google campaign', 180),
      amount: Number(metrics.costMicros || 0) / 1000000, currency: 'INR', impressions: Number(metrics.impressions || 0), clicks: Number(metrics.clicks || 0),
      leads: Number(metrics.conversions || 0), conversionValue: Number(metrics.conversionsValue || 0), recordSource: 'google-sync', externalId: campaignId + '-' + date, syncedAt: now()
    };
  });
}

async function api(req, res, url) {
  const route = url.pathname;
  const method = req.method;

  if (route === '/api/bootstrap' && method === 'GET') {
    return send(res, 200, { needsSetup: db.users.filter(user => user.role === 'admin').length < 2 });
  }

  if (route === '/api/setup' && method === 'POST') {
    if (db.users.some(user => user.role === 'admin')) return fail(res, 409, 'Admin setup has already been completed.');
    const data = await readJson(req);
    const ids = [clean(data.akashLogin || 'akash', 60), clean(data.himanshuLogin || 'himanshu', 60)];
    const passwords = [String(data.akashPassword || ''), String(data.himanshuPassword || '')];
    if (!ids[0] || !ids[1] || same(ids[0], ids[1])) return fail(res, 400, 'Set two different admin sign-in IDs.');
    if (passwords.some(password => password.length < 8)) return fail(res, 400, 'Both admin passwords need at least 8 characters.');
    for (let i = 0; i < 2; i++) {
      const credentials = hashPassword(passwords[i]);
      db.users.push({
        id: crypto.randomUUID(), name: i === 0 ? 'Akash' : 'Himanshu',
        loginId: ids[i], role: 'admin', title: 'Admin', active: true, createdAt: now(),
        salt: credentials.salt, passwordHash: credentials.hash
      });
    }
    await persist();
    return send(res, 201, { ok: true });
  }

  if (route === '/api/login' && method === 'POST') {
    const key = req.socket.remoteAddress || 'local';
    const window = attempts.get(key) || { count: 0, reset: Date.now() + 10 * 60 * 1000 };
    if (window.reset < Date.now()) { window.count = 0; window.reset = Date.now() + 10 * 60 * 1000; }
    if (window.count >= 12) return fail(res, 429, 'Too many sign-in attempts. Try again later.');
    const data = await readJson(req);
    const user = db.users.find(item => same(item.loginId, clean(data.loginId, 60)) && item.active !== false);
    if (!user || !checkPassword(String(data.password || ''), user)) {
      window.count++;
      attempts.set(key, window);
      return fail(res, 401, 'That sign-in ID or password did not match.');
    }
    attempts.delete(key);
    setSession(res, user);
    return send(res, 200, { user: safeUser(user) });
  }

  if (route === '/api/logout' && method === 'POST') {
    clearSession(req, res);
    return send(res, 200, { ok: true });
  }

  if (route === '/api/profile/photo' && method === 'POST') {
    const user = requireAuth(req, res); if (!user) return;
    const data = await readJson(req);
    const match = String(data.photo || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return fail(res, 400, 'Choose a JPG, PNG, or WebP profile image.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) return fail(res, 400, 'Profile photos must be 2 MB or smaller.');
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[match[1]];
    const filename = 'profile-' + user.id + '-' + Date.now() + ext;
    await fs.writeFile(path.join(UPLOAD_DIR, filename), bytes);
    user.profilePath = '/uploads/' + filename;
    await persist();
    return send(res, 200, { user: safeUser(user) });
  }

  if (route === '/api/state' && method === 'GET') {
    const user = requireAuth(req, res); if (!user) return;
    const admin = user.role === 'admin';
    const assignedTasks = db.tasks.filter(task => admin || task.memberId === user.id);
    const contacts = db.contacts.filter(contact => admin || contact.ownerId === user.id);
    return send(res, 200, {
      user: safeUser(user),
      admins: db.users.filter(item => item.role === 'admin').map(safeUser),
      team: db.users.filter(item => item.role === 'member' && (admin || item.active !== false)).map(safeUser),
      tasks: assignedTasks.sort((a, b) => (a.dueDate + (a.dueTime || '23:59')).localeCompare(b.dueDate + (b.dueTime || '23:59'))),
      audits: admin ? db.audits.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')) : [],
      contacts,
      scripts: (admin ? db.scripts : db.scripts.filter(script => script.authorId === user.id || user.title === 'Social Media Manager')),
      reports: admin ? db.reports.slice().sort((a, b) => b.date.localeCompare(a.date) || b.generatedAt.localeCompare(a.generatedAt)) : [],
      spendRecords: admin ? db.spendRecords.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [],
      adConnections: admin ? crmConnectionState() : null,
      today: localDate(), aiEnabled: Boolean(process.env.OPENAI_API_KEY)
    });
  }

  if (route === '/api/members' && method === 'POST') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const data = await readJson(req);
    const name = clean(data.name, 100), loginId = clean(data.loginId, 60), password = String(data.password || ''), title = clean(data.title, 80);
    const allowed = ['OTA Master', 'Videographer + Editor', 'Meta Ads', 'Google Optimizer', 'Graphic Designer', 'Sales', 'HR', 'Social Media Manager'];
    if (!name || !loginId || !allowed.includes(title)) return fail(res, 400, 'Enter a name, sign-in ID, and team title.');
    if (password.length < 8) return fail(res, 400, 'Use a password with at least 8 characters.');
    if (db.users.some(user => same(user.loginId, loginId))) return fail(res, 409, 'That sign-in ID is already used.');
    const credentials = hashPassword(password);
    const member = { id: crypto.randomUUID(), name, loginId, role: 'member', title, active: true, createdAt: now(), salt: credentials.salt, passwordHash: credentials.hash };
    db.users.push(member);
    await persist();
    return send(res, 201, { member: safeUser(member) });
  }

  const memberPhotoRoute = route.match(/^\/api\/members\/([\w-]+)\/photo$/);
  if (memberPhotoRoute && method === 'POST') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const member = db.users.find(user => user.id === memberPhotoRoute[1] && user.role === 'member');
    if (!member) return fail(res, 404, 'Team member not found.');
    const data = await readJson(req);
    const match = String(data.photo || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return fail(res, 400, 'Choose a JPG, PNG, or WebP profile image.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) return fail(res, 400, 'Profile photos must be 2 MB or smaller.');
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[match[1]];
    const filename = 'profile-' + member.id + '-' + Date.now() + ext;
    await fs.writeFile(path.join(UPLOAD_DIR, filename), bytes);
    member.profilePath = '/uploads/' + filename;
    await persist();
    return send(res, 200, { member: safeUser(member) });
  }

  const memberRoute = route.match(/^\/api\/members\/([\w-]+)$/);
  if (memberRoute && method === 'PATCH') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const member = db.users.find(user => user.id === memberRoute[1] && user.role === 'member');
    if (!member) return fail(res, 404, 'Team member not found.');
    const data = await readJson(req);
    if (data.name !== undefined) member.name = clean(data.name, 100);
    if (data.loginId !== undefined) {
      const loginId = clean(data.loginId, 60);
      if (db.users.some(user => user.id !== member.id && same(user.loginId, loginId))) return fail(res, 409, 'That sign-in ID is already used.');
      member.loginId = loginId;
    }
    if (data.title !== undefined) member.title = clean(data.title, 80);
    if (data.active !== undefined) member.active = Boolean(data.active);
    if (data.password) {
      if (String(data.password).length < 8) return fail(res, 400, 'Use a password with at least 8 characters.');
      const credentials = hashPassword(String(data.password));
      member.salt = credentials.salt;
      member.passwordHash = credentials.hash;
    }
    await persist();
    return send(res, 200, { member: safeUser(member) });
  }

  if (route === '/api/tasks' && method === 'POST') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const data = await readJson(req);
    let task;
    try { task = cleanTask(data, null, admin); }
    catch (error) { return fail(res, 400, error.message); }
    task.id = crypto.randomUUID();
    task.status = 'todo';
    task.createdAt = now();
    task.createdBy = admin.name;
    task.proofPath = '';
    task.completedAt = '';
    db.tasks.push(task);
    await persist();
    return send(res, 201, { task });
  }

  const taskRoute = route.match(/^\/api\/tasks\/([\w-]+)$/);
  if (taskRoute && method === 'PATCH') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const task = db.tasks.find(item => item.id === taskRoute[1]);
    if (!task) return fail(res, 404, 'Task not found.');
    if (task.status === 'done') return fail(res, 409, 'A completed task cannot be reassigned. Reopen it first.');
    const data = await readJson(req);
    try { Object.assign(task, cleanTask(data, task, admin)); }
    catch (error) { return fail(res, 400, error.message); }
    await persist();
    return send(res, 200, { task });
  }

  const reopenRoute = route.match(/^\/api\/tasks\/([\w-]+)\/reopen$/);
  if (reopenRoute && method === 'POST') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const task = db.tasks.find(item => item.id === reopenRoute[1]);
    if (!task) return fail(res, 404, 'Task not found.');
    task.status = 'todo';
    task.proofPath = '';
    task.completedAt = '';
    task.reopenedAt = now();
    await persist();
    return send(res, 200, { task });
  }

  const completeRoute = route.match(/^\/api\/tasks\/([\w-]+)\/complete$/);
  if (completeRoute && method === 'POST') {
    const user = requireAuth(req, res); if (!user) return;
    if (user.role !== 'member') return fail(res, 403, 'Only the assigned team member can submit task proof.');
    const task = db.tasks.find(item => item.id === completeRoute[1] && item.memberId === user.id);
    if (!task) return fail(res, 404, 'This task is not assigned to your account.');
    if (task.status === 'done') return fail(res, 409, 'This task is already complete.');
    const data = await readJson(req);
    const proof = data.proof || {};
    const match = String(proof.data || '').match(/^data:(image\/(?:jpeg|png|webp|avif));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return fail(res, 400, 'Add a photo as proof before submitting.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return fail(res, 400, 'The proof photo must be 5 MB or smaller.');
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif' }[match[1]];
    const filename = task.id + '-' + Date.now() + ext;
    await fs.writeFile(path.join(UPLOAD_DIR, filename), bytes);
    task.status = 'done';
    task.completedAt = now();
    task.completedBy = user.name;
    task.proofPath = '/uploads/' + filename;
    task.completionNote = clean(data.note, 1000);
    await persist();
    return send(res, 200, { task });
  }

  if (route === '/api/audits' && method === 'POST') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const data = await readJson(req);
    const businessName = clean(data.businessName, 160);
    if (!businessName) return fail(res, 400, 'Add the property or business name.');
    let audit = data.id ? db.audits.find(item => item.id === data.id) : null;
    const created = !audit;
    if (!audit) audit = { id: crypto.randomUUID(), createdAt: now(), createdBy: admin.name };
    const fields = ['businessName','contactName','phone','email','city','state','propertyType','website','monthlyRevenue','annualRevenue','revenueNotes','rooms','guestCapacity','occupancy','seasonality','otaListings','roomTypes','rateRange','weekdayRate','weekendRate','marketingChannels','marketingBudget','socialLinks','reviews','strengths','gaps','recommendations','nextSteps','auditDate','status','guestProfile','amenities','bookingPolicies','systems','competitors','creativeAssets','operationsNotes','pricingNotes'];
    for (const field of fields) if (data[field] !== undefined) audit[field] = clean(data[field], ['revenueNotes','marketingChannels','strengths','gaps','recommendations','nextSteps','roomTypes','otaListings','guestProfile','amenities','bookingPolicies','systems','competitors','creativeAssets','operationsNotes','pricingNotes'].includes(field) ? 4000 : 400);
    audit.updatedAt = now();
    audit.updatedBy = admin.name;
    if (created) db.audits.unshift(audit);
    await saveAuditFile(audit);
    await persist();
    return send(res, created ? 201 : 200, { audit });
  }

  if (route === '/api/spend' && method === 'POST') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const data = await readJson(req);
    const amount = Number(data.amount);
    if (!CRM_CHANNELS.includes(data.channel) || !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') || !Number.isFinite(amount) || amount < 0) return fail(res, 400, 'Choose a channel, valid date, and non-negative spend amount.');
    const record = {
      id: crypto.randomUUID(), date: data.date, channel: data.channel, campaign: clean(data.campaign || 'Manual entry', 180), amount,
      currency: 'INR', impressions: Number(data.impressions) || 0, clicks: Number(data.clicks) || 0, leads: Number(data.leads) || 0,
      notes: clean(data.notes, 800), recordSource: 'manual', createdBy: admin.name, createdAt: now()
    };
    db.spendRecords.unshift(record);
    await persist();
    return send(res, 201, { record });
  }

  if (route === '/api/crm/sync' && method === 'POST') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const data = await readJson(req);
    let range;
    try { range = validateDateRange(data); }
    catch (error) { return fail(res, 400, error.message); }
    let source, records;
    try {
      if (data.provider === 'meta') { source = 'meta-sync'; records = await fetchMetaSpend(range.from, range.to); }
      else if (data.provider === 'google') { source = 'google-sync'; records = await fetchGoogleSpend(range.from, range.to); }
      else return fail(res, 400, 'Choose Meta Ads or Google Ads.');
    } catch (error) { return fail(res, 502, error.message); }
    db.spendRecords = db.spendRecords.filter(item => !(item.recordSource === source && item.date >= range.from && item.date <= range.to));
    db.spendRecords.unshift(...records);
    await persist();
    return send(res, 200, { imported: records.length, from: range.from, to: range.to, provider: data.provider });
  }

  const contactRoute = route.match(/^\/api\/contacts\/([\w-]+)$/);
  if (route === '/api/contacts' && method === 'POST') {
    const user = requireAuth(req, res); if (!user) return;
    const data = await readJson(req);
    const segment = ['Travel Agents', 'Wedding', 'B2B', 'Retreat'].includes(data.segment) ? data.segment : '';
    const name = clean(data.name, 140);
    if (!segment || !name) return fail(res, 400, 'Add a contact name and choose a sales segment.');
    const contact = {
      id: crypto.randomUUID(), segment, name, company: clean(data.company, 160), phone: clean(data.phone, 80),
      email: clean(data.email, 160), city: clean(data.city, 100), status: clean(data.status, 60) || 'New',
      followUpDate: clean(data.followUpDate, 10), notes: clean(data.notes, 1500),
      sourceChannel: CRM_CHANNELS.includes(data.sourceChannel) ? data.sourceChannel : 'Other', campaign: clean(data.campaign, 180),
      leadDate: /^\d{4}-\d{2}-\d{2}$/.test(data.leadDate || '') ? data.leadDate : localDate(),
      conversionValue: Math.max(0, Number(data.conversionValue) || 0),
      ownerId: user.role === 'admin' ? clean(data.ownerId, 80) : user.id,
      ownerName: user.role === 'admin' ? (db.users.find(item => item.id === data.ownerId) || user).name : user.name,
      createdAt: now(), updatedAt: now()
    };
    db.contacts.unshift(contact);
    await persist();
    return send(res, 201, { contact });
  }
  if (contactRoute && method === 'PATCH') {
    const user = requireAuth(req, res); if (!user) return;
    const contact = db.contacts.find(item => item.id === contactRoute[1] && (user.role === 'admin' || item.ownerId === user.id));
    if (!contact) return fail(res, 404, 'Contact not found.');
    const data = await readJson(req);
    for (const key of ['segment','name','company','phone','email','city','status','followUpDate','notes','campaign']) if (data[key] !== undefined) contact[key] = clean(data[key], key === 'notes' ? 1500 : 300);
    if (data.sourceChannel !== undefined && CRM_CHANNELS.includes(data.sourceChannel)) contact.sourceChannel = data.sourceChannel;
    if (data.leadDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(data.leadDate)) contact.leadDate = data.leadDate;
    if (data.conversionValue !== undefined) contact.conversionValue = Math.max(0, Number(data.conversionValue) || 0);
    if (user.role === 'admin' && data.ownerId !== undefined) {
      const owner = db.users.find(item => item.id === data.ownerId && item.role === 'member');
      if (owner) { contact.ownerId = owner.id; contact.ownerName = owner.name; }
    }
    contact.updatedAt = now();
    await persist();
    return send(res, 200, { contact });
  }

  if (route === '/api/scripts' && method === 'POST') {
    const user = requireAuth(req, res); if (!user) return;
    if (user.role !== 'admin' && user.title !== 'Social Media Manager') return fail(res, 403, 'Script planner access is for the social media team and admins.');
    const data = await readJson(req);
    const title = clean(data.title, 160);
    if (!title) return fail(res, 400, 'Add a script title.');
    let script = data.id ? db.scripts.find(item => item.id === data.id) : null;
    const created = !script;
    if (!script) script = { id: crypto.randomUUID(), createdAt: now(), authorId: user.id, authorName: user.name };
    for (const key of ['title','client','channel','goal','body','status']) if (data[key] !== undefined) script[key] = clean(data[key], key === 'body' ? 6000 : 300);
    script.updatedAt = now();
    if (created) db.scripts.unshift(script);
    await persist();
    return send(res, created ? 201 : 200, { script });
  }

  if (route === '/api/scripts/draft' && method === 'POST') {
    const user = requireAuth(req, res); if (!user) return;
    if (user.role !== 'admin' && user.title !== 'Social Media Manager') return fail(res, 403, 'Script planner access is for the social media team and admins.');
    if (!process.env.OPENAI_API_KEY) return fail(res, 503, 'AI drafting needs an OPENAI_API_KEY on the app server.');
    const data = await readJson(req);
    const prompt = clean(data.prompt, 3000);
    if (!prompt) return fail(res, 400, 'Describe the client, platform, audience, and content idea.');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        instructions: 'You write practical short-form hospitality marketing scripts. Do not invent property facts, prices, amenities, or claims. If details are missing, use clear placeholders. Return a hook, spoken script, shot notes, and caption.',
        input: prompt,
        max_output_tokens: 900
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return fail(res, 502, clean(result.error && result.error.message, 300) || 'AI drafting could not complete.');
    const text = (result.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
    return send(res, 200, { draft: text });
  }

  if (route === '/api/seo/draft' && method === 'POST') {
    const user = requireAuth(req, res); if (!user) return;
    if (user.role !== 'admin' && user.title !== 'Google Optimizer') return fail(res, 403, 'Local SEO drafting is for Google Optimizer and admins.');
    if (!process.env.OPENAI_API_KEY) return fail(res, 503, 'AI drafting needs an OPENAI_API_KEY on the app server.');
    const data = await readJson(req);
    const prompt = clean(data.prompt, 3000);
    if (!prompt) return fail(res, 400, 'Add the property location, audience, and SEO goal.');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        instructions: 'You are a careful local SEO assistant for hospitality businesses in India. Suggest keyword clusters by search intent, page or Google Business Profile placement, and a short measurement checklist. Never claim a ranking, search volume, competitor fact, amenity, or service without evidence. Mark all suggestions as hypotheses to validate with real keyword tools and the property owner.',
        input: prompt,
        max_output_tokens: 900
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return fail(res, 502, clean(result.error && result.error.message, 300) || 'AI keyword drafting could not complete.');
    const text = (result.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
    return send(res, 200, { draft: text });
  }

  if (route === '/api/assistant' && method === 'POST') {
    const user = requireAuth(req, res); if (!user) return;
    if (!process.env.OPENAI_API_KEY) return fail(res, 503, 'Add OPENAI_API_KEY to .env to wake Scout’s AI chat.');
    const data = await readJson(req);
    const message = clean(data.message, 1500);
    if (!message) return fail(res, 400, 'Type a question for Scout first.');
    const role = user.role === 'admin' ? 'Admin' : user.title;
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        instructions: 'You are Scout, a friendly, concise AI helper inside Hospitality Growth Desk. The signed-in user is ' + role + '. Tailor your suggestions to this role: ' + (TEAM_ASSISTANT_CONTEXT[role] || TEAM_ASSISTANT_CONTEXT.Admin) + ' Ask a short clarifying question when needed. Do not claim to see app records, ad accounts, or client facts unless the user provides them. Use practical checklists and next actions. Do not invent business metrics, property features, rankings, prices, or campaign results.',
        input: message,
        max_output_tokens: 600
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return fail(res, 502, clean(result.error && result.error.message, 300) || 'Scout could not respond right now.');
    const reply = (result.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
    return send(res, 200, { reply });
  }

  if (route === '/api/reports' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return send(res, 200, { reports: db.reports, current: reportFor(url.searchParams.get('date') || localDate()) });
  }

  if (route === '/api/reports/generate' && method === 'POST') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const data = await readJson(req);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : localDate();
    const report = reportFor(date);
    report.generatedBy = admin.name;
    db.reports.unshift(report);
    await fs.writeFile(path.join(REPORT_DIR, date + '-' + report.id + '.json'), JSON.stringify(report, null, 2), 'utf8');
    await persist();
    return send(res, 201, { report });
  }

  if (route.startsWith('/uploads/') && method === 'GET') {
    const user = requireAuth(req, res); if (!user) return;
    const filename = path.basename(decodeURIComponent(route.slice('/uploads/'.length)));
    if (!filename || filename.includes('..')) return fail(res, 404, 'Photo not found.');
    try {
      const file = await fs.readFile(path.join(UPLOAD_DIR, filename));
      const ext = path.extname(filename).toLowerCase();
      const mime = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' });
      return res.end(file);
    } catch { return fail(res, 404, 'Photo not found.'); }
  }

  return fail(res, 404, 'That page was not found.');
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
async function serve(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    try { await api(req, res, url); }
    catch (error) { fail(res, error.status || 500, error.status ? error.message : 'The request could not be completed.'); }
    return;
  }
  if (url.pathname === '/data' || url.pathname.startsWith('/data/')) return fail(res, 404, 'That page was not found.');
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.resolve(PUBLIC_DIR, '.' + requested);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return fail(res, 403, 'That file cannot be opened.');
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('App file not found.'); }
}

async function start() {
  await loadLocalEnv();
  await loadDb();
  http.createServer(serve).listen(PORT, HOST, () => console.log('Hospitality Growth Desk running at http://' + HOST + ':' + PORT));
}
start().catch(error => { console.error(error); process.exit(1); });

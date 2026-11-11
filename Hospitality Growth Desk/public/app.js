const appRoot = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast');
const brandMark = () => '<img class="brand-mark brand-logo" src="/icons/maati-living.jpg" alt="Maati Living Community sign">';
const TEAM_TITLES = ['OTA Master','Videographer + Editor','Meta Ads','Google Optimizer','Graphic Designer','Sales','HR','Social Media Manager'];
const TASK_TYPES = {
  'OTA Master':['Listing setup','Listing content update','Photo and image order','Amenity audit','Rate update','Availability check','Promotion setup','Review response','Content parity check','OTA performance check'],
  'Videographer + Editor':['Recording','Editing','Revision','Client shoot','Short-form reel','Property walkthrough','Final delivery'],
  'Meta Ads':['Campaign setup','Audience research','Creative test','Budget pacing','Lead quality review','Weekly performance report'],
  'Google Optimizer':['Google Business Profile','SEO audit','Keyword ingestion','Local citations','Landing page update','Search rank check','Review response'],
  'Graphic Designer':['Social creative','OTA image update','Ad creative','Campaign banner','Menu or brochure','Brand kit update','Revision'],
  'Sales':['Travel Agents','Wedding','B2B','Retreat','New prospect research','Follow-up call','Proposal sent'],
  'HR':['Volunteer Invites Sent','Volunteers ready to onboard','Volunteers currently listed','Volunteers assigned','Interview scheduled','Onboarding'],
  'Social Media Manager':['Instagram post','Facebook post','Content recorded','Content in editing','Content scheduled','Buffer Content','Content planning','Caption and hashtags']
};
const HR_TYPES = ['Volunteer Invites Sent','Volunteers ready to onboard','Volunteers currently listed','Volunteers assigned'];
const CRM_CHANNELS = ['Meta Ads','Google Ads','WhatsApp','Instagram Organic','Facebook Organic','Website','OTA','Referral','Travel Agent','Other'];
let state = null;
let page = 'overview';
let searchText = '';
let taskFilter = 'open';
let taskTitleFilter = '';
let platformFilter = 'All';
let auditSearch = '';
let salesSegment = 'All';
let reportDate = '';
let selectedReport = null;
let otaPlatforms = [];
let pendingPlatform = null;
let scriptDraftPrompt = '';
let crmFrom = '';
let crmTo = '';
let assistantOpen = false;
let assistantBusy = false;
let assistantMessages = [];
let installPrompt = null;
let appIsInstalled = Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  if (state) render();
});
window.addEventListener('appinstalled', () => {
  appIsInstalled = true;
  installPrompt = null;
  if (state) render();
});

const esc = value => String(value == null ? '' : value).replace(/[&<>"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
const currentUser = () => state && state.user;
const isAdmin = () => currentUser() && currentUser().role === 'admin';
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(item => item[0] || '').join('').toUpperCase();
const memberById = id => (state.team || []).find(member => member.id === id) || null;
const avatarTone = name => {
  let hash = 0;
  for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 6;
};
function avatarMarkup(user, name, extraClass) {
  const label = name || user && user.name || '?';
  const photo = user && user.profilePath;
  return '<span class="avatar avatar-tone-' + avatarTone(label) + ' ' + (extraClass || '') + '" title="' + esc(label) + '">' + (photo ? '<img src="' + esc(photo) + '" alt="' + esc(label) + ' profile photo">' : '<span>' + esc(initials(label)) + '</span>') + '</span>';
}
const todayLabel = () => new Intl.DateTimeFormat('en-IN', {weekday:'short', day:'numeric', month:'short'}).format(state && state.today ? new Date(state.today + 'T12:00:00') : new Date());
const dateLabel = value => value ? new Intl.DateTimeFormat('en-IN', {day:'numeric', month:'short', year:'numeric'}).format(new Date(value + 'T12:00:00')) : 'No deadline';
const shiftDate = (date, days) => { const value = new Date((date || state.today) + 'T12:00:00'); value.setDate(value.getDate() + days); return value.toISOString().slice(0,10); };
const money = value => '₹' + Math.round(Number(value || 0)).toLocaleString('en-IN');
const badge = (value, label) => '<span class="badge badge-' + esc(String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '-')) + '">' + esc(label || value) + '</span>';
const titleForPage = {
  overview:'Dashboard', team:'Team directory', tasks:'Daily tasks', audits:'Business audits',
  platforms:'OTA optimization', 'ota-team':'OTA lister board', 'video-team':'Video production board',
  sales:'Sales desk', crm:'CRM & marketing', scripts:'Social & scripts', reports:'Daily report',
  'meta-board':'Meta Ads board', 'google-board':'Google optimization', 'hr-board':'Volunteer desk', 'design-board':'Design board'
};

async function api(path, options) {
  const opts = options || {};
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body && typeof opts.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const response = await fetch(path, Object.assign({credentials:'same-origin'}, opts, {headers}));
  const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data && data.error || 'The request could not be completed.');
  return data;
}

function showToast(message) {
  toastRoot.textContent = message;
  toastRoot.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastRoot.classList.remove('show'), 2600);
}

function openModal(content, narrow) {
  modalRoot.innerHTML = '<div class="modal-backdrop"><section class="modal ' + (narrow ? 'modal-narrow' : '') + '">' + content + '</section></div>';
}
function closeModal() { modalRoot.innerHTML = ''; }

function authView(setup, message, setupKeyRequired) {
  const brand = '<div class="auth-brand">' + brandMark() + '<div><strong class="brand-name">Maati Living Community</strong><div class="card-sub">Sitla · Mukteshwar</div></div></div>';
  if (setup) {
    appRoot.innerHTML = '<div class="auth-wrap"><section class="auth-card">' + brand + '<div class="eyebrow">First-time setup</div><h1>Set up both admin accounts</h1><p>Akash and Himanshu share the same admin workspace, audit folder, tasks, and reports. Create a separate sign-in for each person.</p><form id="setup-form">' + (setupKeyRequired ? '<div class="field" style="margin-bottom:12px"><label>One-time deployment setup key</label><input class="input" name="setupKey" type="password" autocomplete="off" required><span class="field-help">Use the SETUP_KEY saved in Render’s environment settings.</span></div>' : '') + '<div class="fields"><div class="field"><label>Akash sign-in ID</label><input class="input" name="akashLogin" value="akash" required></div><div class="field"><label>Akash password</label><input class="input" name="akashPassword" type="password" minlength="8" required autocomplete="new-password"></div><div class="field"><label>Himanshu sign-in ID</label><input class="input" name="himanshuLogin" value="himanshu" required></div><div class="field"><label>Himanshu password</label><input class="input" name="himanshuPassword" type="password" minlength="8" required autocomplete="new-password"></div></div><div class="auth-error">' + esc(message || '') + '</div><button class="btn btn-primary" type="submit">Create shared admin workspace →</button></form><div class="auth-foot">Passwords are securely hashed. The app saves tasks, audit reports, and proof photos in this app folder.</div></section></div>';
    return;
  }
  appRoot.innerHTML = '<div class="auth-wrap"><section class="auth-card">' + brand + '<div class="eyebrow">Team sign-in</div><h1>Welcome back</h1><p>Sign in with the ID and password created by an admin.</p><form id="login-form"><div class="field"><label>Sign-in ID</label><input class="input" name="loginId" required autocomplete="username" placeholder="Your ID"></div><div class="field" style="margin-top:10px"><label>Password</label><input class="input" name="password" type="password" required autocomplete="current-password" placeholder="Your password"></div><div class="auth-error">' + esc(message || '') + '</div><button class="btn btn-primary" type="submit">Sign in →</button></form><div class="auth-foot">Need access? Ask Akash or Himanshu to create your team account.</div></section></div>';
}

async function refresh() {
  state = await api('/api/state');
  if (!titleForPage[page]) page = 'overview';
  render();
}

function adminNav() {
  return [
    {label:'Overview',items:[['overview','◫','Dashboard']]},
    {label:'Work management',items:[['tasks','☑','Daily tasks'],['team','♙','Team directory']]},
    {label:'Growth & clients',items:[['crm','▤','CRM & marketing'],['audits','◈','Business audits'],['sales','⇄','Sales desk']]},
    {label:'Delivery teams',items:[['platforms','◎','OTA directory'],['ota-team','◉','OTA lister'],['video-team','▣','Video production'],['meta-board','◌','Meta Ads'],['google-board','⌕','Google optimize'],['design-board','✳','Graphic design'],['hr-board','♡','Volunteer desk'],['scripts','✎','Social & scripts']]},
    {label:'Reporting',items:[['reports','▧','Daily report']]}
  ];
}
function memberNav() {
  const list = [['overview','◫','My dashboard'],['tasks','☑','My daily tasks']];
  const rolePages = {
    'OTA Master':['ota-team','◉','OTA lister board'],
    'Videographer + Editor':['video-team','▣','Video production'],
    'Meta Ads':['meta-board','◌','Meta Ads board'],
    'Google Optimizer':['google-board','⌕','Google optimize'],
    'Graphic Designer':['design-board','✳','Design board'],
    'HR':['hr-board','♡','Volunteer desk']
  };
  if (currentUser().title === 'OTA Master') list.push(['platforms','◎','OTA directory']);
  if (rolePages[currentUser().title]) list.push(rolePages[currentUser().title]);
  if (currentUser().title === 'Sales') list.push(['sales','⇄','My contacts']);
  if (currentUser().title === 'Social Media Manager') list.push(['scripts','✎','Content planner']);
  return list;
}

function sidebarPeople() {
  const people = [...(state.admins || []), ...(state.team || [])];
  const faces = people.map(person => {
    const face = avatarMarkup(person, person.name, 'avatar-sidebar');
    return isAdmin()
      ? '<button class="team-avatar-button" data-page="team" aria-label="Open team directory: ' + esc(person.name) + '" title="' + esc(person.name + (person.role === 'admin' ? ' · Admin' : ' · ' + person.title)) + '">' + face + '</button>'
      : '<span class="team-avatar-button" title="' + esc(person.name + (person.role === 'admin' ? ' · Admin' : ' · ' + person.title)) + '">' + face + '</span>';
  }).join('');
  return '<section class="sidebar-people"><div class="sidebar-people-head"><strong>Workspace people</strong><span>' + people.length + '</span></div><div class="sidebar-people-grid">' + (faces || '<span class="field-help">No team members yet</span>') + '</div></section>';
}

function renderShell(content) {
  document.body.classList.remove('nav-open');
  const me = currentUser();
  const groups = isAdmin() ? adminNav() : [{label:'My workspace',items:memberNav()}];
  const nav = groups.map(group => '<div class="nav-group"><div class="nav-group-label">' + esc(group.label) + '</div>' + group.items.map(item => '<button class="' + (page === item[0] ? 'active' : '') + '" data-page="' + item[0] + '" title="' + esc(item[2]) + '"><span class="nav-icon">' + item[1] + '</span><span>' + esc(item[2]) + '</span>' + (item[0] === 'tasks' && !isAdmin() ? '<span class="nav-badge">' + state.tasks.filter(task => task.status !== 'done').length + '</span>' : '') + '</button>').join('') + '</div>').join('');
  appRoot.innerHTML = '<div class="app-shell"><button class="sidebar-backdrop" data-action="close-mobile-nav" aria-label="Close navigation"></button><aside class="sidebar"><div class="brand">' + brandMark() + '<div class="brand-name">Maati Living Community<small>Team operations</small></div></div><div class="workspace-chip"><div class="workspace-dot">M</div><div><strong>Maati Living</strong><span>Sitla · Mukteshwar</span></div></div>' + sidebarPeople() + '<div class="nav-scroll"><nav class="nav" id="workspace-nav">' + nav + '</nav></div><div class="sidebar-bottom"><div class="sidebar-note"><strong>' + (isAdmin() ? 'Client work, in one place' : 'Your day, your pace') + '</strong><p>' + (isAdmin() ? 'Audits, assignments, proof, and reports stay together for both admins.' : 'Check off a task, add a photo, and the team dashboard updates.') + '</p></div><div class="identity"><button class="identity-photo" data-action="edit-profile" aria-label="Edit profile photo">' + avatarMarkup(me) + '</button><button class="identity-info identity-info-button" data-action="edit-profile"><strong>' + esc(me.name) + '</strong><small>' + (isAdmin() ? 'Shared admin · edit profile' : esc(me.title) + ' · edit profile') + '</small></button><button class="logout" data-action="logout" title="Sign out">↪</button></div></div></aside><main class="main"><header class="topbar"><button class="mobile-menu" data-action="toggle-mobile-nav" aria-controls="workspace-nav" aria-expanded="false" aria-label="Open navigation">☰</button><div class="crumb">Maati Living&nbsp; / &nbsp;<b>' + esc(titleForPage[page] || 'Workspace') + '</b></div><div class="top-spacer"></div>' + (appIsInstalled ? '' : '<button class="install-app-btn" data-action="install-app">⇩ Install</button>') + '<div class="date-chip">' + todayLabel() + '</div><button class="top-user" data-action="edit-profile">' + avatarMarkup(me) + '<span>' + esc(me.name.split(' ')[0]) + '</span></button></header><section class="content">' + content + '</section></main>' + assistantWidget() + '</div>';
}

function pageHead(title, subtitle, actions) {
  return '<div class="page-heading"><div class="heading-main"><div class="eyebrow">' + (isAdmin() ? 'Team operations' : esc(currentUser().title)) + '</div><h1>' + esc(title) + '</h1><p>' + esc(subtitle) + '</p></div><div class="heading-actions">' + (actions || '') + '</div></div>';
}

function assistantPrompts() {
  const title = isAdmin() ? 'Admin' : currentUser().title;
  const prompts = {
    'OTA Master':['Give me a property listing checklist','How should I review rate and content parity?'],
    'Videographer + Editor':['Build a shoot-day checklist for a hotel','Help me plan a 30-second property reel'],
    'Meta Ads':['What should I check before changing a campaign?','Help me review lead quality'],
    'Google Optimizer':['Draft a local keyword research workflow','What should I check in a Google Business Profile?'],
    'Graphic Designer':['Suggest three hospitality creative directions','Help me prepare a design handoff checklist'],
    Sales:['Help me qualify a hotel lead','Write a concise follow-up message'],
    HR:['Create a volunteer onboarding checklist','Help me write a volunteer invite'],
    'Social Media Manager':['Plan this week’s hospitality content','Give me a reel script structure'],
    Admin:['Help me review this week’s team pipeline','Suggest a simple daily operating rhythm']
  };
  return prompts[title] || prompts.Admin;
}

function assistantWidget() {
  const role = isAdmin() ? 'Admin' : currentUser().title;
  const suggestions = assistantPrompts().map(prompt => '<button class="assistant-chip" data-action="assistant-prompt" data-prompt="' + esc(prompt) + '">' + esc(prompt) + '</button>').join('');
  const initial = '<div class="assistant-welcome"><div class="assistant-welcome-pet">🦊</div><strong>Hi ' + esc(currentUser().name.split(' ')[0]) + ', I’m Scout.</strong><p>I tailor suggestions for <b>' + esc(role) + '</b>. ' + (state.aiEnabled ? 'Ask about your workflow, planning, or next steps.' : 'Configure an OpenAI API key in the app server settings to start Scout.') + '</p><div class="assistant-suggestions">' + suggestions + '</div></div>';
  const messages = assistantMessages.length ? assistantMessages.map(message => '<div class="assistant-message assistant-' + message.role + '"><span>' + esc(message.text) + '</span></div>').join('') : initial;
  const panel = assistantOpen ? '<section class="assistant-panel"><header class="assistant-head"><div class="assistant-pet-small">🦊</div><div><strong>Scout</strong><small>' + esc(role) + ' · role-aware helper</small></div><button class="assistant-clear" data-action="clear-assistant">Clear chat</button><button class="modal-close" data-action="close-assistant" aria-label="Close assistant">×</button></header><div class="assistant-messages" id="assistant-messages">' + messages + (assistantBusy ? '<div class="assistant-message assistant-reply"><span class="typing"><i></i><i></i><i></i></span></div>' : '') + '</div><form id="assistant-form" class="assistant-composer"><input id="assistant-input" class="input" name="message" maxlength="1500" placeholder="Ask Scout for a next step…" required><button class="btn btn-primary" type="submit" aria-label="Send">↑</button></form></section>' : '';
  return '<div class="assistant-dock">' + panel + '<button class="assistant-launcher" data-action="toggle-assistant" aria-label="Open Scout AI assistant"><span class="assistant-pet">🦊</span><span>Ask Scout</span><i></i></button></div>';
}

function refreshAssistantMessages() {
  const list = document.getElementById('assistant-messages');
  if (!list) return;
  list.innerHTML = assistantMessages.map(message => '<div class="assistant-message assistant-' + message.role + '"><span>' + esc(message.text) + '</span></div>').join('') + (assistantBusy ? '<div class="assistant-message assistant-reply"><span class="typing"><i></i><i></i><i></i></span></div>' : '');
  list.scrollTop = list.scrollHeight;
}

async function askAssistant(message) {
  const prompt = String(message || '').trim();
  if (!prompt) return;
  assistantMessages.push({role:'user',text:prompt});
  assistantBusy = true;
  refreshAssistantMessages();
  const input = document.getElementById('assistant-input');
  if (input) input.value = '';
  try {
    const history = assistantMessages.slice(0, -1).slice(-10).map(item => ({role:item.role === 'reply' ? 'assistant' : 'user', content:item.text}));
    const result = await api('/api/assistant',{method:'POST',body:{message:prompt,history}});
    assistantMessages.push({role:'reply',text:result.reply});
  } catch(error) {
    assistantMessages.push({role:'reply',text:error.message});
  } finally {
    assistantBusy = false;
    refreshAssistantMessages();
  }
}

function stat(label, value, foot, icon) {
  return '<article class="card stat"><div class="stat-head"><span>' + esc(label) + '</span><i class="stat-icon">' + icon + '</i></div><div class="stat-value">' + esc(value) + '</div><div class="stat-foot">' + esc(foot) + '</div></article>';
}
function taskDueText(task) { return dateLabel(task.dueDate) + (task.dueTime ? ' · ' + task.dueTime : ''); }

function taskCard(task) {
  const owner = isAdmin() ? memberById(task.memberId) : null;
  const status = task.status === 'done' ? badge('done', 'Done') : badge('todo', 'To do');
  const proof = task.status === 'done' && task.proofPath ? '<a href="' + esc(task.proofPath) + '" target="_blank" class="btn btn-small">View proof</a>' : '';
  const action = isAdmin()
    ? (task.status === 'done' ? proof + '<button class="btn btn-small" data-action="reopen-task" data-id="' + task.id + '">Reopen</button>' : '<button class="btn btn-small" data-action="edit-task" data-id="' + task.id + '">Edit</button>')
    : (task.status === 'done' ? proof : '<button class="btn btn-primary btn-small" data-action="complete-task" data-id="' + task.id + '">✓ Complete</button>');
  return '<article class="card task-card"><div class="task-top"><div class="task-check ' + (task.status === 'done' ? 'done' : '') + '">' + (task.status === 'done' ? '✓' : '·') + '</div><div class="task-copy"><h3>' + esc(task.title) + '</h3><p>' + esc(task.description || 'No extra instructions added.') + '</p></div></div><div class="task-meta">' + status + badge('medium', task.type || task.memberTitle || 'Task') + (task.priority ? badge(task.priority.toLowerCase(), task.priority + ' priority') : '') + '</div><div class="task-footer"><small>' + (task.client ? '<b>' + esc(task.client) + '</b> · ' : '') + esc(taskDueText(task)) + (owner ? ' · ' + esc(owner.name) : '') + '</small><div class="list-actions">' + action + '</div></div>' + (task.status === 'done' && task.completionNote ? '<div class="field-help" style="margin-top:9px">Submitted note: ' + esc(task.completionNote) + '</div>' : '') + '</article>';
}

const VOLUNTEER_STAGES = ['Invited','Ready to onboard','Listed','Assigned','Inactive'];
function volunteerModal(volunteer) {
  const edit = Boolean(volunteer);
  const value = key => esc(edit ? volunteer[key] || '' : '');
  const owners = state.team.filter(person => person.active !== false).map(person => '<option value="' + person.id + '" ' + (edit && volunteer.assignedToId === person.id ? 'selected' : '') + '>' + esc(person.name) + ' · ' + esc(person.title) + '</option>').join('');
  openModal('<div class="modal-head"><div><h2>' + (edit ? 'Edit volunteer' : 'Add volunteer') + '</h2><p>Keep outreach stage, listing details, availability, and assignment in the shared HR roster.</p></div><button class="modal-close" data-action="close" aria-label="Close">×</button></div><form id="volunteer-form"><input type="hidden" name="volunteerId" value="' + (edit ? volunteer.id : '') + '"><div class="fields"><div class="field"><label>Volunteer name</label><input class="input" name="name" value="' + value('name') + '" required></div><div class="field"><label>Stage</label><select class="select" name="status">' + VOLUNTEER_STAGES.map(stage => '<option ' + ((edit ? volunteer.status : 'Invited') === stage ? 'selected' : '') + '>' + stage + '</option>').join('') + '</select></div><div class="field"><label>Phone</label><input class="input" name="phone" type="tel" value="' + value('phone') + '"></div><div class="field"><label>Email</label><input class="input" name="email" type="email" value="' + value('email') + '"></div><div class="field"><label>City</label><input class="input" name="city" value="' + value('city') + '"></div><div class="field"><label>Invite date</label><input class="input" name="inviteDate" type="date" value="' + value('inviteDate') + '"></div><div class="field"><label>Availability</label><input class="input" name="availability" value="' + value('availability') + '" placeholder="Days, hours, or start date"></div><div class="field"><label>Assigned to</label><select class="select" name="assignedToId"><option value="">Unassigned</option>' + owners + '</select></div><div class="field wide"><label>Skills / interests</label><input class="input" name="skills" value="' + value('skills') + '" placeholder="Relevant experience or preferred work"></div><div class="field"><label>Listing / directory reference</label><input class="input" name="listingReference" value="' + value('listingReference') + '" placeholder="Directory name or profile ID"></div><div class="field"><label>Listing link (optional)</label><input class="input" name="listingUrl" type="url" value="' + value('listingUrl') + '" placeholder="https://…"></div><div class="field wide"><label>HR notes</label><textarea class="textarea" name="notes" placeholder="Follow-up context and onboarding notes">' + value('notes') + '</textarea></div></div><div class="modal-actions"><button class="btn" type="button" data-action="close">Cancel</button><button class="btn btn-primary" type="submit">' + (edit ? 'Save volunteer' : 'Add to roster') + '</button></div></form>');
}

function volunteerRoster() {
  const rows = (state.volunteers || []).map(person => '<tr><td><div class="primary-cell">' + esc(person.name) + '</div><div class="field-help">' + esc(person.listingReference || person.phone || person.email || 'No contact or listing reference') + '</div></td><td>' + badge(person.status === 'Inactive' ? 'todo' : person.status === 'Assigned' ? 'done' : 'medium', person.status) + (person.listingUrl ? ' <a class="btn btn-small" href="' + esc(person.listingUrl) + '" target="_blank" rel="noopener noreferrer">Open listing</a>' : '') + '</td><td>' + esc(person.city || '—') + '</td><td>' + esc(person.assignedToName || 'Unassigned') + '</td><td>' + esc(person.inviteDate ? dateLabel(person.inviteDate) : '—') + '</td><td><button class="btn btn-small" data-action="edit-volunteer" data-id="' + person.id + '">Edit</button></td></tr>').join('');
  const totals = VOLUNTEER_STAGES.slice(0, 4).map(stage => stat(stage, (state.volunteers || []).filter(person => person.status === stage).length, 'Volunteer records', '♡')).join('');
  return '<section class="card form-card" style="margin:14px 0"><div class="card-head"><div><div class="card-title">Volunteer roster</div><div class="card-sub">HR and admins can add records, update stages, and assign volunteers.</div></div><button class="btn btn-primary" data-action="new-volunteer">＋ Add volunteer</button></div><div class="grid grid-4" style="margin-top:12px">' + totals + '</div><div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>Volunteer</th><th>Stage</th><th>City</th><th>Assigned to</th><th>Invite date</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6"><div class="empty"><strong>No volunteers listed yet</strong>Add a record to track invites, onboarding, and assignments.</div></td></tr>') + '</tbody></table></div><div class="notice" style="margin-top:12px">Volunteer contact details are visible to HR and admins only.</div></section>';
}

function adminOverview() {
  const tasks = state.tasks;
  const todayTasks = tasks.filter(task => task.dueDate === state.today);
  const done = todayTasks.filter(task => task.status === 'done').length;
  const open = tasks.filter(task => task.status !== 'done').length;
  const people = state.team.filter(member => member.active !== false);
  const todayRows = todayTasks.slice().sort((a,b) => (a.dueTime || '23:59').localeCompare(b.dueTime || '23:59')).slice(0, 6).map(task => '<div class="list-row"><div class="list-main"><strong>' + esc(task.title) + '</strong><small>' + esc(task.memberName) + ' · ' + esc(task.client || task.type || 'General') + ' · due ' + esc(task.dueTime || 'today') + '</small></div>' + badge(task.status === 'done' ? 'done' : 'todo', task.status === 'done' ? 'Done' : 'Pending') + '</div>').join('');
  const memberRows = people.slice().sort((a,b) => state.tasks.filter(task => task.memberId === b.id && task.status === 'done').length - state.tasks.filter(task => task.memberId === a.id && task.status === 'done').length).slice(0, 7).map(member => {
    const assigned = tasks.filter(task => task.memberId === member.id).length;
    const completed = tasks.filter(task => task.memberId === member.id && task.status === 'done').length;
    const pct = assigned ? Math.round(completed * 100 / assigned) : 0;
    return '<div class="member-row">' + avatarMarkup(member) + '<div class="member-info"><strong>' + esc(member.name) + ' · ' + esc(member.title) + '</strong><span>' + completed + ' of ' + assigned + ' tasks complete</span></div><div class="progress"><i style="width:' + pct + '%"></i></div></div>';
  }).join('');
  return pageHead('Good ' + (new Date().getHours() < 12 ? 'morning' : 'afternoon') + ', ' + currentUser().name.split(' ')[0], 'A shared view for Akash and Himanshu: client audits, daily delivery, and team performance.', '<button class="btn" data-page="audits">＋ New business audit</button><button class="btn btn-primary" data-action="new-task">＋ Assign a task</button>') +
    '<div class="grid grid-4">' + stat('Tasks due today', todayTasks.length, done + ' completed · ' + (todayTasks.length - done) + ' open', '☑') + stat('Open tasks', open, 'Across all active team members', '◷') + stat('Team members', people.length, 'Across ' + new Set(people.map(member => member.title)).size + ' roles', '♙') + stat('Business audits', state.audits.length, 'Shared audit folder', '▤') + '</div>' +
    '<div class="grid grid-2"><section class="card"><div class="card-head"><div><div class="card-title">Today’s task board</div><div class="card-sub">Deadlines and ownership across the team</div></div><button class="btn-link" data-page="tasks">All tasks →</button></div><div class="list-pad">' + (todayRows || '<div class="empty"><strong>No tasks assigned for today</strong>Create tasks from the Daily Tasks page.</div>') + '</div></section><div class="grid"><section class="card"><div class="card-head"><div><div class="card-title">Team completion</div><div class="card-sub">Tasks closed across each member profile</div></div><button class="btn-link" data-page="team">Team →</button></div><div class="list-pad">' + (memberRows || '<div class="empty">Add team members to start tracking work.</div>') + '</div></section><section class="card form-card"><div class="card-title">Role boards</div><div class="toolbar"><button class="btn btn-small" data-page="ota-team">OTA team</button><button class="btn btn-small" data-page="video-team">Video & edit</button><button class="btn btn-small" data-page="hr-board">HR volunteers</button><button class="btn btn-small" data-page="sales">Sales desk</button></div><div class="notice" style="margin-top:12px">Proof photos, shared audits, task deadlines, and daily reports all stay in this app folder.</div></section></div></div>';
}

function memberOverview() {
  const tasks = state.tasks;
  const assigned = tasks.length;
  const done = tasks.filter(task => task.status === 'done').length;
  const pending = tasks.filter(task => task.status !== 'done');
  const dueToday = tasks.filter(task => task.dueDate === state.today);
  const pct = assigned ? Math.round(done * 100 / assigned) : 0;
  let extra = '';
  if (currentUser().title === 'HR') {
    const counts = HR_TYPES.map(type => tasks.filter(task => task.type === type && task.status === 'done').length);
    extra = '<section class="card form-card" style="margin-top:14px"><div class="card-title">Volunteer workflow</div><div class="grid grid-4">' + HR_TYPES.map((type, i) => stat(type, counts[i], 'Completed by you', '♡')).join('') + '</div></section>';
  }
  if (currentUser().title === 'Social Media Manager') {
    const stages = ['Content recorded','Content in editing','Content scheduled','Buffer Content'];
    extra = '<section class="card form-card" style="margin-top:14px"><div class="card-title">Content pipeline</div><div class="grid grid-4">' + stages.map(stage => stat(stage, tasks.filter(task => task.type === stage).length, 'Assigned cards', '✎')).join('') + '</div><div class="toolbar" style="margin-top:12px"><button class="btn btn-soft" data-page="scripts">Open content planner & AI scripts →</button></div></section>';
  }
  if (currentUser().title === 'Sales') extra = '<section class="card form-card" style="margin-top:14px"><div class="card-title">My sales segments</div><div class="toolbar"><button class="btn btn-small" data-action="new-contact" data-segment="Travel Agents">＋ Travel agents</button><button class="btn btn-small" data-action="new-contact" data-segment="Wedding">＋ Wedding</button><button class="btn btn-small" data-action="new-contact" data-segment="B2B">＋ B2B</button><button class="btn btn-small" data-action="new-contact" data-segment="Retreat">＋ Retreat</button><button class="btn btn-primary btn-small" data-page="sales">Open my sales desk →</button></div></section>';
  const rows = pending.slice(0, 5).map(task => '<div class="list-row"><div class="list-main"><strong>' + esc(task.title) + '</strong><small>' + esc(task.client || task.type || 'Task') + ' · ' + esc(taskDueText(task)) + '</small></div>' + badge('todo', 'To do') + '</div>').join('');
  return pageHead('Good ' + (new Date().getHours() < 12 ? 'morning' : 'afternoon') + ', ' + currentUser().name.split(' ')[0], 'Work through your assigned tasks at your own pace. Add a proof photo when you submit each one.', '<button class="btn btn-primary" data-page="tasks">Open my task sheet →</button>') +
    '<div class="grid grid-4">' + stat('Tasks assigned', assigned, 'All time on your profile', '☑') + stat('Tasks completed', done, 'Submitted with proof', '✓') + stat('Open tasks', pending.length, 'Still on your list', '◷') + stat('Due today', dueToday.filter(task => task.status !== 'done').length, pct + '% complete overall', '⌛') + '</div>' +
    '<div class="grid grid-2"><section class="card"><div class="card-head"><div><div class="card-title">Next in your task sheet</div><div class="card-sub">' + dueToday.length + ' tasks due today</div></div><button class="btn-link" data-page="tasks">All assigned →</button></div><div class="list-pad">' + (rows || '<div class="empty"><strong>You’re caught up</strong>No open tasks are assigned to you.</div>') + '</div></section><section class="card form-card"><div class="card-title">Your completion rate</div><div class="stat-value">' + pct + '%</div><div class="progress" style="height:10px;margin-top:12px"><i style="width:' + pct + '%"></i></div><p class="card-sub" style="line-height:1.6;margin-top:12px">Every submitted task keeps its timestamp, notes, and image proof. Your dashboard updates immediately.</p></section></div>' + extra;
}

function teamPage() {
  const admins = (state.admins || []).map(admin => '<article class="card admin-profile-card">' + avatarMarkup(admin, admin.name, 'avatar-large') + '<div><strong>' + esc(admin.name) + '</strong><small>Workspace admin' + (admin.id === currentUser().id ? ' · You' : '') + '</small></div>' + (admin.id === currentUser().id ? '<button class="btn btn-small" data-action="edit-profile">Edit photo</button>' : '') + '</article>').join('');
  const rows = state.team.map(member => {
    const assigned = state.tasks.filter(task => task.memberId === member.id);
    const done = assigned.filter(task => task.status === 'done').length;
    return '<tr><td><div style="display:flex;align-items:center;gap:8px">' + avatarMarkup(member) + '<div><div class="primary-cell">' + esc(member.name) + '</div><div class="field-help">' + esc(member.loginId) + '</div></div></div></td><td>' + esc(member.title) + '</td><td>' + (member.active === false ? badge('todo', 'Paused') : badge('done', 'Active')) + '</td><td>' + done + ' / ' + assigned.length + '</td><td><button class="btn btn-small" data-action="edit-member" data-id="' + member.id + '">Edit profile & access</button></td></tr>';
  }).join('');
  return pageHead('Team directory', 'Create individual sign-ins and choose a team title. People with the same title use the same type of task workspace.', '<button class="btn btn-primary" data-action="new-member">＋ Add team member</button>') +
    '<div class="admin-profiles">' + admins + '</div><section class="card table-card"><div class="card-head"><div><div class="card-title">Current team</div><div class="card-sub">' + state.team.length + ' member accounts</div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Member / ID</th><th>Team title</th><th>Account</th><th>Tasks done / assigned</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="5"><div class="empty">No team members yet. Add the first account.</div></td></tr>') + '</tbody></table></div></section><div class="notice" style="margin-top:12px">Admin accounts for Akash and Himanshu are created together during first-time setup. Each admin can update their own profile photo.</div>';
}

function tasksPage(filterTitle) {
  let tasks = state.tasks.slice();
  if (filterTitle) tasks = tasks.filter(task => task.memberTitle === filterTitle);
  if (!isAdmin()) tasks = tasks.filter(task => task.memberId === currentUser().id);
  if (taskFilter === 'open') tasks = tasks.filter(task => task.status !== 'done');
  if (taskFilter === 'done') tasks = tasks.filter(task => task.status === 'done');
  if (searchText) tasks = tasks.filter(task => [task.title, task.client, task.type, task.memberName].join(' ').toLowerCase().includes(searchText.toLowerCase()));
  const rows = tasks.map(taskCard).join('');
  const heading = filterTitle === 'OTA Master' ? 'OTA lister task sheet' : filterTitle === 'Videographer + Editor' ? 'Recording & editing task sheet' : filterTitle ? filterTitle + ' task board' : isAdmin() ? 'Daily task assignments' : 'My daily tasks';
  const intro = filterTitle === 'OTA Master' ? 'Review each assigned listing task, finish it when ready, and attach a proof photo.' : filterTitle === 'Videographer + Editor' ? 'Client shoots and edits with deadlines, client names, and time windows.' : isAdmin() ? 'Assign work to one team member with a client, task type, and deadline.' : 'Complete work in your own order. A photo is required when you submit a task.';
  return pageHead(heading, intro, isAdmin() ? '<button class="btn btn-primary" data-action="new-task" data-category="' + esc(filterTitle || '') + '">＋ Assign task</button>' : '') +
    '<div class="filter-bar"><input class="input search-input" id="task-search" placeholder="Search task, client, or person" value="' + esc(searchText) + '"><select class="select select-small" id="task-filter"><option value="open" ' + (taskFilter === 'open' ? 'selected' : '') + '>Open tasks</option><option value="all" ' + (taskFilter === 'all' ? 'selected' : '') + '>All tasks</option><option value="done" ' + (taskFilter === 'done' ? 'selected' : '') + '>Completed</option></select><span class="field-help">' + tasks.length + ' tasks in this view</span></div><div class="task-grid">' + (rows || '<div class="card empty"><strong>No tasks in this view</strong>' + (isAdmin() ? 'Create an assignment or choose another filter.' : 'Ask an admin to add tasks to your sheet.') + '</div>') + '</div>';
}

function teamBoardPage(title, memberTitle) {
  const members = state.team.filter(member => member.title === memberTitle);
  const count = state.tasks.filter(task => task.memberTitle === memberTitle).length;
  return pageHead(title, members.length + ' ' + memberTitle + ' profiles · ' + count + ' tracked tasks. Admins can see task completion, ownership, deadlines, and proof.', '<button class="btn" data-page="team">Manage team accounts</button><button class="btn btn-primary" data-action="new-task" data-category="' + esc(memberTitle) + '">＋ Assign task</button>') +
    '<div class="grid grid-3">' + members.map(member => {
      const tasks = state.tasks.filter(task => task.memberId === member.id && task.memberTitle === memberTitle);
      const done = tasks.filter(task => task.status === 'done').length;
      return '<article class="card form-card"><div class="task-top">' + avatarMarkup(member) + '<div class="task-copy"><h3>' + esc(member.name) + '</h3><p>' + done + ' completed · ' + (tasks.length - done) + ' open</p></div></div><div class="progress" style="margin-top:12px"><i style="width:' + (tasks.length ? Math.round(done * 100 / tasks.length) : 0) + '%"></i></div><button class="btn btn-small" style="margin-top:12px" data-page="tasks" data-title-filter="' + esc(memberTitle) + '">Open role task board</button></article>';
    }).join('') + '</div><section class="card table-card"><div class="card-head"><div><div class="card-title">' + esc(memberTitle) + ' task activity</div><div class="card-sub">Every assigned task, including submitted proof</div></div></div><div class="task-grid" style="padding:0 14px 14px">' + (state.tasks.filter(task => task.memberTitle === memberTitle).map(taskCard).join('') || '<div class="empty">No tasks assigned to this role yet.</div>') + '</div></section>';
}

function auditPage() {
  const audits = state.audits.filter(audit => !auditSearch || [audit.businessName, audit.city, audit.state, audit.propertyType, audit.contactName].join(' ').toLowerCase().includes(auditSearch.toLowerCase()));
  const rows = audits.map(audit => '<button class="list-row" style="width:100%;text-align:left;border:0;background:white" data-action="edit-audit" data-id="' + audit.id + '"><div class="platform-icon">▤</div><div class="list-main"><strong>' + esc(audit.businessName) + '</strong><small>' + esc([audit.propertyType, audit.city, audit.state].filter(Boolean).join(' · ') || 'Property details not set') + ' · updated ' + esc(dateLabel(String(audit.updatedAt || '').slice(0,10))) + '</small></div><div class="list-actions">' + badge('admin', audit.status || 'Draft') + '<span class="muted-cell">›</span></div></button>').join('');
  return pageHead('Business audit folder', 'Shared by Akash and Himanshu. Save a consistent property, revenue, marketing, OTA, pricing, and opportunity review for every business you pitch.', '<button class="btn btn-primary" data-action="new-audit">＋ New property audit</button>') +
    '<div class="grid grid-2"><section class="card"><div class="card-head"><div><div class="card-title">Saved audits</div><div class="card-sub">Stored as separate records in the app’s audit folder</div></div></div><div class="filter-bar" style="padding:0 14px 10px"><input class="input" id="audit-search" placeholder="Search property, city, or contact" value="' + esc(auditSearch) + '"></div><div class="list-pad">' + (rows || '<div class="empty"><strong>No business audits yet</strong>Create one to start the shared audit folder.</div>') + '</div></section><section class="card form-card"><div class="card-title">Audit checklist</div><div class="list-row"><span class="stat-icon">₹</span><div class="list-main"><strong>Revenue picture</strong><small>Current revenue, occupancy, seasonality, rate range</small></div></div><div class="list-row"><span class="stat-icon">⌂</span><div class="list-main"><strong>Property profile</strong><small>Room count, guest capacity, room types, location</small></div></div><div class="list-row"><span class="stat-icon">◎</span><div class="list-main"><strong>Distribution & marketing</strong><small>OTA listings, direct site, social, ads, budget, reviews</small></div></div><div class="list-row"><span class="stat-icon">↗</span><div class="list-main"><strong>Pitch opportunity</strong><small>Gaps, recommendations, next steps, audit status</small></div></div><div class="notice notice-warm" style="margin-top:13px">Both admin logins edit the same records. Each save also writes a JSON copy under <b>data/audits</b>.</div></section></div>';
}

function otaLogo(item) {
  const searchHosts = {
    '1hotelrez':'1hotelrez.com','adriacamps':'adriacamps.eu','alaric':'alarichotels.com','ascend-travel':'ascendtravel.com',
    'atlantis-ors':'atlantisors.com','auto-accommodation':'autoaccommodation.com','b2b-global':'b2bglobal.com','bakuun':'bakuun.com',
    'bedshero':'bedshero.com','bookeasy':'bookeasy.com','bookola':'bookola.com','cakrahub':'cakrahub.com','gopaddi':'gopaddi.com'
  };
  let host = searchHosts[item.id] || item.id + '.com';
  try { if (item.url) host = new URL(item.url).hostname.replace(/^www\./,''); } catch {}
  return '<span class="ota-logo"><img class="ota-logo-image" src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64" alt="" loading="lazy"><span class="logo-fallback">' + esc(initials(item.name)) + '</span></span>';
}

function otaPage() {
  const filters = ['All','India core','Global channels','Asia-Pacific','Europe','Americas','Metasearch','B2B distribution','Direct booking','Niche stays','Channel partner','Corporate travel','Travel agent'];
  const list = otaPlatforms.filter(item => (platformFilter === 'All' || item.category === platformFilter) && (!searchText || (item.name + ' ' + item.category + ' ' + item.fit).toLowerCase().includes(searchText.toLowerCase())));
  const cards = list.map(item => {
    const target = item.searchOnly ? 'https://www.google.com/search?q=' + encodeURIComponent(item.name + ' official hotel partner') : item.url;
    const label = item.searchOnly ? 'Find site' : 'Open';
    return '<article class="platform-card"><div class="platform-icon">' + otaLogo(item) + '</div><div class="platform-copy"><strong>' + esc(item.name) + '</strong><small>' + esc(item.category) + ' · ' + esc(item.fit) + '</small></div><div class="list-actions"><a class="btn btn-small" href="' + esc(target) + '" target="_blank" rel="noopener">' + label + '</a>' + (isAdmin() ? '<button class="btn btn-small btn-soft" data-action="assign-platform" data-id="' + item.id + '">Assign</button>' : '') + '</div></article>';
  }).join('');
  return pageHead('OTA & booking channel directory', 'A 100-channel starter list with India-focused channels first, plus global, regional, metasearch, direct-booking, and B2B options. Confirm property fit and partner access before assigning.', '') +
    '<div class="notice notice-blue" style="margin-top:14px">The first 20 are marked for India-first review. Direct partner portals open directly; channels without a verified public hotel portal use “Find site” to search the official partner information.</div><div class="filter-bar"><input class="input search-input" id="platform-search" value="' + esc(searchText) + '" placeholder="Search 100 channels"><select class="select select-small" id="platform-filter">' + filters.map(filter => '<option ' + (platformFilter === filter ? 'selected' : '') + '>' + esc(filter) + '</option>').join('') + '</select><span class="field-help">' + list.length + ' of ' + otaPlatforms.length + ' channels</span></div><div class="platform-grid">' + (cards || '<div class="card empty">No channels match this search.</div>') + '</div>';
}

function crmPage() {
  const from = crmFrom || shiftDate(state.today, -29);
  const to = crmTo || state.today;
  const inRange = date => date >= from && date <= to;
  const leads = state.contacts.filter(item => inRange(item.leadDate || String(item.createdAt || '').slice(0,10)));
  const spend = (state.spendRecords || []).filter(item => inRange(item.date));
  const spendINR = spend.filter(item => !item.currency || item.currency === 'INR').reduce((sum,item) => sum + Number(item.amount || 0),0);
  const won = leads.filter(item => item.status === 'Won');
  const active = leads.filter(item => !['Won','Lost'].includes(item.status));
  const followUps = state.contacts.filter(item => item.followUpDate && inRange(item.followUpDate) && !['Won','Lost'].includes(item.status));
  const overdue = state.contacts.filter(item => item.followUpDate && item.followUpDate < state.today && !['Won','Lost'].includes(item.status));
  const pipelineValue = active.reduce((sum,item) => sum + Number(item.conversionValue || 0),0);
  const wonValue = won.reduce((sum,item) => sum + Number(item.conversionValue || 0),0);
  const cpl = leads.length ? spendINR / leads.length : 0;
  const conversionRate = leads.length ? Math.round(won.length * 100 / leads.length) : 0;
  const channelStats = CRM_CHANNELS.map(channel => ({
    channel,
    leads: leads.filter(item => item.sourceChannel === channel).length,
    spend: spend.filter(item => item.channel === channel && (!item.currency || item.currency === 'INR')).reduce((sum,item) => sum + Number(item.amount || 0),0)
  })).filter(item => item.leads || item.spend).sort((a,b) => b.spend - a.spend || b.leads - a.leads);
  const maxSpend = Math.max(1, ...channelStats.map(item => item.spend));
  const sources = channelStats.map(item => '<div class="channel-performance"><div class="channel-head"><strong>' + esc(item.channel) + '</strong><span>' + money(item.spend) + ' · ' + item.leads + ' leads</span></div><div class="channel-bar"><i style="width:' + Math.round(item.spend * 100 / maxSpend) + '%"></i></div></div>').join('');
  const stages = ['New','Contacted','Qualified','Proposal','Follow-up','Won','Lost'];
  const stageRows = stages.map(stage => {
    const count = leads.filter(item => item.status === stage).length;
    return '<div class="pipeline-stage"><span>' + esc(stage) + '</span><b>' + count + '</b><i style="width:' + Math.round(count * 100 / Math.max(1,leads.length)) + '%"></i></div>';
  }).join('');
  const recent = leads.slice().sort((a,b) => String(b.leadDate || '').localeCompare(a.leadDate || '')).slice(0,8).map(item => '<tr><td><strong>' + esc(item.name) + '</strong><small class="field-help">' + esc(item.company || item.city || 'Lead') + '</small></td><td>' + esc(item.sourceChannel || 'Other') + '<small class="field-help">' + esc(item.campaign || '—') + '</small></td><td>' + esc(item.ownerName || '—') + '</td><td>' + badge(item.status === 'Won' ? 'done' : item.status === 'Lost' ? 'todo' : 'medium', item.status || 'New') + '</td><td>' + esc(dateLabel(item.followUpDate)) + '</td><td>' + (item.status === 'Won' ? money(item.conversionValue) : '—') + '</td><td><button class="btn btn-small" data-action="edit-contact" data-id="' + item.id + '">Open</button></td></tr>').join('');
  const followRows = state.contacts.filter(item => item.followUpDate && !['Won','Lost'].includes(item.status)).sort((a,b) => a.followUpDate.localeCompare(b.followUpDate)).slice(0,6).map(item => '<div class="list-row"><div class="follow-date">' + esc(String(item.followUpDate).slice(8,10)) + '<small>' + esc(new Intl.DateTimeFormat('en-IN',{month:'short'}).format(new Date(item.followUpDate + 'T12:00:00'))) + '</small></div><div class="list-main"><strong>' + esc(item.name) + '</strong><small>' + esc(item.sourceChannel || item.segment) + ' · ' + esc(item.ownerName || 'Unassigned') + '</small></div>' + badge(item.followUpDate < state.today ? 'high' : 'todo', item.followUpDate < state.today ? 'Overdue' : 'Follow-up') + '</div>').join('');
  const metaStatus = state.adConnections && state.adConnections.meta;
  const googleStatus = state.adConnections && state.adConnections.google;
  const otherCurrencyCount = spend.filter(item => item.currency && item.currency !== 'INR').length;
  return pageHead('CRM & marketing performance', 'One admin view for channel spend, lead sources, follow-ups, and closed revenue. Sales members keep lead records current from their Sales Desk.', '<button class="btn" data-action="new-spend">＋ Add channel spend</button><button class="btn btn-primary" data-action="export-crm">Export CRM CSV ↓</button>') +
    '<section class="crm-filter card"><div><div class="card-title">Reporting window</div><div class="card-sub">Spend, leads and pipeline are filtered together</div></div><label>From<input class="input" type="date" id="crm-from" value="' + esc(from) + '"></label><label>To<input class="input" type="date" id="crm-to" value="' + esc(to) + '"></label><button class="btn btn-soft" data-action="apply-crm-range">Apply range</button></section>' +
    '<div class="grid grid-4 crm-stats">' + stat('Marketing spend',money(spendINR),'Tracked in INR · ' + spend.length + ' spend rows','₹') + stat('Leads captured',leads.length,'In selected period · ' + active.length + ' active','↗') + stat('Follow-ups aligned',followUps.length,overdue.length + ' overdue across all dates','◷') + stat('Conversions',won.length,conversionRate + '% lead conversion · ' + money(wonValue) + ' value','✓') + '</div>' +
    '<div class="grid grid-4 crm-stats crm-secondary-stats">' + stat('Cost per lead',money(cpl),'Spend ÷ CRM leads','◎') + stat('Open pipeline',active.length,money(pipelineValue) + ' estimated value','⇢') + stat('Overdue follow-ups',overdue.length,'Needs owner attention','!') + stat('Ad connectors',(metaStatus ? '1' : '0') + ' / 2', (metaStatus ? 'Meta configured' : 'Meta pending') + ' · ' + (googleStatus ? 'Google configured' : 'Google pending'),'⌁') + '</div>' +
    '<div class="grid grid-2 crm-grid"><section class="card form-card"><div class="card-head"><div><div class="card-title">Channel spend & lead attribution</div><div class="card-sub">Spend from sync or manual entries; leads from the sales CRM</div></div><button class="btn-link" data-action="new-spend">Add spend →</button></div><div class="channel-list">' + (sources || '<div class="empty">Add spend rows and log leads with their source to see channel performance.</div>') + '</div><div class="notice" style="margin-top:12px">Cost per lead uses all captured CRM leads and INR spend in this period. Attribute each lead to the first known source.</div></section>' +
    '<section class="card form-card"><div class="card-head"><div><div class="card-title">Pipeline health</div><div class="card-sub">Lead stage counts · selected period</div></div></div><div class="pipeline-list">' + stageRows + '</div><div class="roi-strip"><div><small>Closed value</small><b>' + money(wonValue) + '</b></div><div><small>Spend to closed value</small><b>' + (spendINR ? (wonValue / spendINR).toFixed(1) + '×' : '—') + '</b></div></div></section></div>' +
    '<div class="grid grid-2 crm-grid"><section class="card"><div class="card-head"><div><div class="card-title">Ad account connections</div><div class="card-sub">Read-only spend sync · secrets stay in server .env</div></div></div><div class="connection-list">' +
    '<div class="connection-row"><div class="connection-brand meta-brand">M</div><div class="list-main"><strong>Meta Ads</strong><small>' + (metaStatus ? 'Credentials configured · sync available' : 'Add an Ads read token and account ID to .env') + '</small></div>' + badge(metaStatus ? 'done' : 'todo',metaStatus ? 'Configured' : 'Setup needed') + '<button class="btn btn-small" data-action="sync-meta" ' + (metaStatus ? '' : 'disabled') + '>Sync spend</button></div>' +
    '<div class="connection-row"><div class="connection-brand google-brand">G</div><div class="list-main"><strong>Google Ads</strong><small>' + (googleStatus ? 'OAuth credentials configured · sync available' : 'Add Google Ads OAuth details, customer ID, and developer token to .env') + '</small></div>' + badge(googleStatus ? 'done' : 'todo',googleStatus ? 'Configured' : 'Setup needed') + '<button class="btn btn-small" data-action="sync-google" ' + (googleStatus ? '' : 'disabled') + '>Sync spend</button></div>' +
    '<div class="connection-row"><div class="connection-brand whatsapp-brand">W</div><div class="list-main"><strong>WhatsApp & other channels</strong><small>Enter provider spend manually; CRM leads can be attributed to WhatsApp</small></div>' + badge('admin','Manual') + '<button class="btn btn-small" data-action="new-spend" data-channel="WhatsApp">Add spend</button></div></div>' +
    '<div class="notice notice-blue" style="margin-top:12px">Meta and Google sync spend and reported ad conversions only. Sales outcomes still need lead records and status updates. Ads must use INR for combined spend totals.' + (otherCurrencyCount ? ' ' + otherCurrencyCount + ' non-INR rows are excluded from totals.' : '') + '</div></section>' +
    '<section class="card"><div class="card-head"><div><div class="card-title">Next follow-ups</div><div class="card-sub">Open leads across the whole team</div></div><button class="btn-link" data-page="sales">Sales desk →</button></div><div class="list-pad">' + (followRows || '<div class="empty">No follow-ups are scheduled.</div>') + '</div></section></div>' +
    '<section class="card table-card"><div class="card-head"><div><div class="card-title">Recent leads</div><div class="card-sub">' + leads.length + ' leads in the selected period</div></div><button class="btn-link" data-page="sales">Manage all leads →</button></div><div class="table-wrap"><table class="table crm-table"><thead><tr><th>Lead / property</th><th>Source / campaign</th><th>Owner</th><th>Stage</th><th>Follow-up</th><th>Closed value</th><th></th></tr></thead><tbody>' + (recent || '<tr><td colspan="7"><div class="empty">No leads in this period yet. Add them from the Sales Desk.</div></td></tr>') + '</tbody></table></div></section>' +
    '<section class="card form-card" style="margin-top:14px"><div class="card-title">Syncing & attribution notes</div><p class="card-sub" style="line-height:1.7">Meta and Google account sync need admin credentials in the server .env file, network access, and read permission. Configure the matching values in .env.example, restart, and then sync a date range. WhatsApp, OTA, website, and offline costs can be added manually. Capture each lead’s source, campaign, owner, status, and follow-up in Sales Desk to connect spend to outcomes.</p></section>';
}

function salesPage() {
  const segments = ['All','Travel Agents','Wedding','B2B','Retreat'];
  const contacts = state.contacts.filter(item => salesSegment === 'All' || item.segment === salesSegment);
  const open = contacts.filter(item => !['Won','Lost'].includes(item.status));
  const dueToday = contacts.filter(item => item.followUpDate === state.today && !['Won','Lost'].includes(item.status));
  const won = contacts.filter(item => item.status === 'Won');
  const rows = contacts.slice().sort((a,b) => String(a.followUpDate || '9999').localeCompare(b.followUpDate || '9999')).map(item => '<tr><td><strong>' + esc(item.name) + '</strong><small class="field-help">' + esc(item.company || item.city || item.segment) + '</small></td><td>' + esc(item.sourceChannel || 'Other') + '<small class="field-help">' + esc(item.campaign || '—') + '</small></td><td>' + esc(item.phone || '—') + '</td><td>' + esc(item.ownerName || '—') + '</td><td>' + esc(dateLabel(item.followUpDate)) + '</td><td>' + badge(item.status === 'Won' ? 'done' : item.status === 'Lost' ? 'todo' : 'medium', item.status || 'New') + '</td><td><button class="btn btn-small" data-action="edit-contact" data-id="' + item.id + '">Update</button></td></tr>').join('');
  const byStage = ['New','Contacted','Qualified','Proposal','Follow-up'].map(stage => '<div class="pipeline-stage"><span>' + esc(stage) + '</span><b>' + contacts.filter(item => item.status === stage).length + '</b></div>').join('');
  return pageHead('Sales desk', 'Keep every Travel Agent, Wedding, B2B, and Retreat lead owned, qualified, and moving to its next follow-up.', '<button class="btn btn-primary" data-action="new-contact">＋ Add lead</button>') +
    '<div class="grid grid-4">' + stat('Open opportunities',open.length,'Across your selected view','⇢') + stat('Follow-ups today',dueToday.length,'Calls or messages to make','◷') + stat('Converted',won.length,'Closed won','✓') + stat('Closed value',money(won.reduce((sum,item) => sum + Number(item.conversionValue || 0),0)),'Won deals on your list','₹') + '</div>' +
    '<div class="grid grid-2 sales-grid"><section class="card table-card"><div class="card-head"><div><div class="card-title">Lead pipeline</div><div class="card-sub">' + contacts.length + ' records' + (isAdmin() ? ' · all owners' : ' · assigned to you') + '</div></div></div><div class="filter-bar" style="padding:0 15px 12px"><div class="segment-tabs">' + segments.map(segment => '<button class="' + (salesSegment === segment ? 'active' : '') + '" data-action="sales-filter" data-value="' + esc(segment) + '">' + esc(segment) + '</button>').join('') + '</div></div><div class="table-wrap"><table class="table sales-table"><thead><tr><th>Lead / property</th><th>Source</th><th>Phone</th><th>Owner</th><th>Follow-up</th><th>Stage</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="7"><div class="empty">Add a lead to start building this sales segment.</div></td></tr>') + '</tbody></table></div></section><section class="card form-card"><div class="card-title">Pipeline stages</div><div class="card-sub">Update stage after every meaningful discussion</div><div class="pipeline-list" style="margin-top:12px">' + byStage + '</div><div class="notice" style="margin-top:12px">Lead source and campaign carry into the admin CRM dashboard for channel attribution.</div></section></div>';
}

function scriptsPage() {
  const stages = ['Content recorded','Content in editing','Content scheduled','Buffer Content'];
  return pageHead('Content planner & script room', 'Plan content for every client, track recorded and scheduled material, and save drafts in one shared library.', '<button class="btn btn-primary" data-action="new-script">＋ New script</button>') +
    '<div class="grid grid-4">' + stages.map(stage => stat(stage, state.tasks.filter(task => task.type === stage).length, 'Tasks in this content stage', '✎')).join('') + '</div><div class="grid grid-2"><section class="card form-card"><div class="card-title">AI script assistant</div><p class="card-sub" style="line-height:1.6;margin:7px 0 12px">Add a client, channel, audience, and content idea. AI returns a hook, spoken script, shot notes, and caption. Review facts before saving.</p><div class="field"><label>Prompt</label><textarea class="textarea" id="ai-prompt" placeholder="Client/property, platform, target guest, campaign idea, tone, and any verified details…">' + esc(scriptDraftPrompt) + '</textarea></div><div class="toolbar" style="margin-top:10px"><button class="btn btn-primary" data-action="draft-script">✦ Draft with AI</button><span class="field-help">' + (state.aiEnabled ? 'AI is connected on the app server.' : 'Needs OPENAI_API_KEY on the app server.') + '</span></div><div id="ai-result"></div></section><section class="card form-card"><div class="card-title">Saved scripts</div><div class="list-pad">' + (state.scripts.map(script => '<div class="list-row"><div class="list-main"><strong>' + esc(script.title) + '</strong><small>' + esc(script.client || 'No client') + ' · ' + esc(script.channel || 'Draft') + ' · ' + esc(script.updatedAt ? new Date(script.updatedAt).toLocaleDateString() : '') + '</small><div class="field-help" style="margin-top:5px;white-space:pre-wrap">' + esc(script.body || '').slice(0, 300) + '</div></div></div>').join('') || '<div class="empty">Scripts saved here remain in the app folder for your team.</div>') + '</div></section></div><section class="card form-card" style="margin-top:14px"><div class="card-title">Content planning stages</div><div class="grid grid-4">' + stages.map(stage => '<div class="notice"><b>' + esc(stage) + '</b><br>' + state.tasks.filter(task => task.type === stage).length + ' assigned task cards</div>').join('') + '</div></section>';
}

function reportSummary(report, memberId) {
  if (!report) return '';
  const people = report.members || [];
  const chosen = memberId ? people.filter(person => person.memberId === memberId) : people;
  if (memberId) {
    const person = chosen[0];
    return person ? '*Daily report · ' + person.memberName + ' · ' + report.date + '*\n' + person.title + '\nTasks: ' + person.done + '/' + person.assigned + ' complete · ' + person.pending + ' open · ' + person.completionRate + '%\n' + person.tasks.map(task => (task.status === 'done' ? '✓ ' : '○ ') + task.title + (task.client ? ' — ' + task.client : '') + (task.dueTime ? ' · ' + task.dueTime : '')).join('\n') : 'No member report.';
  }
  return '*Maati Living · Team report · ' + report.date + '*\n' + report.totals.done + '/' + report.totals.assigned + ' tasks complete · ' + report.totals.pending + ' open · ' + report.totals.completionRate + '% team completion\n' + chosen.map(person => '\n*' + person.memberName + ' · ' + person.title + '* — ' + person.done + '/' + person.assigned + ' done, ' + person.pending + ' open' + (person.late ? ', ' + person.late + ' late' : '')).join('') + '\n\nGenerated by ' + (report.generatedBy || 'admin') + ' at ' + new Date(report.generatedAt).toLocaleTimeString();
}

function reportsPage() {
  const current = selectedReport || (state.reports || []).find(report => report.date === (reportDate || state.today)) || null;
  const personOptions = state.team.map(member => '<option value="' + member.id + '">' + esc(member.name) + ' · ' + esc(member.title) + '</option>').join('');
  const reportText = current ? reportSummary(current, '') : '';
  const memberTable = current ? current.members.map(person => '<tr><td class="primary-cell">' + esc(person.memberName) + '</td><td>' + esc(person.title) + '</td><td>' + person.assigned + '</td><td>' + person.done + '</td><td>' + person.pending + '</td><td>' + person.completionRate + '%</td></tr>').join('') : '';
  const saved = state.reports.map(report => '<button class="list-row" style="width:100%;text-align:left;background:white;border:0" data-action="open-report" data-id="' + report.id + '"><div class="list-main"><strong>' + esc(dateLabel(report.date)) + '</strong><small>' + report.totals.done + '/' + report.totals.assigned + ' tasks complete · generated by ' + esc(report.generatedBy || 'admin') + '</small></div><span class="muted-cell">›</span></button>').join('');
  return pageHead('Daily reports', 'Generate a compact individual or team summary for WhatsApp. The report is saved in the shared reports folder before you share it.', '<button class="btn" data-action="copy-team-report" ' + (!current ? 'disabled' : '') + '>Copy team report</button><button class="btn btn-primary" data-action="share-team-report" ' + (!current ? 'disabled' : '') + '>Share team report ↗</button>') +
    '<div class="grid grid-2"><section class="card form-card"><div class="card-title">Generate report</div><div class="fields" style="margin-top:12px"><div class="field"><label>Report date</label><input class="input" type="date" id="report-date" value="' + esc(reportDate || state.today) + '"></div><div class="field"><label>Individual report</label><select class="select" id="report-member"><option value="">Choose a team member</option>' + personOptions + '</select></div></div><div class="toolbar" style="margin-top:12px"><button class="btn btn-primary" data-action="generate-report">Generate and save report</button><button class="btn" data-action="share-individual-report" ' + (!current ? 'disabled' : '') + '>Share individual ↗</button></div><div class="notice" style="margin-top:13px">WhatsApp opens with the text ready. Choose the team group or recipient in WhatsApp and send when ready.</div>' + (current ? '<div class="grid grid-4" style="margin-top:15px">' + stat('Assigned',current.totals.assigned,'Tasks due on report date','☑') + stat('Done',current.totals.done,'Proof submitted','✓') + stat('Open',current.totals.pending,'Not yet completed','◷') + stat('Team completion',current.totals.completionRate + '%','Across assigned tasks','↗') + '</div>' : '') + '</section><section class="card"><div class="card-head"><div><div class="card-title">Saved report history</div><div class="card-sub">A record of each generated daily wrap-up</div></div></div><div class="list-pad">' + (saved || '<div class="empty">No reports generated yet.</div>') + '</div></section></div>' +
    (current ? '<section class="card table-card"><div class="card-head"><div><div class="card-title">Individual task performance</div><div class="card-sub">' + esc(dateLabel(current.date)) + '</div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Team member</th><th>Title</th><th>Assigned</th><th>Done</th><th>Open</th><th>Completion</th></tr></thead><tbody>' + memberTable + '</tbody></table></div></section><section class="card report-box form-card" style="margin-top:14px"><div class="card-title">Team message preview</div><div class="report-summary" id="report-message">' + esc(reportText) + '</div></section>' : '');
}

function genericBoard(pageKey) {
  const map = {
    'meta-board':['Meta Ads','Meta Ads'],
    'google-board':['Google Optimizer','Google Optimizer'],
    'design-board':['Graphic Designer','Graphic Designer'],
    'hr-board':['HR','HR']
  };
  const data = map[pageKey];
  if (!data) return tasksPage();
  const title = data[0];
  const roleTasks = state.tasks.filter(task => task.memberTitle === title);
  const header = isAdmin() ? 'Shared admin view of every ' + title + ' assignment, deadline, completion state, and submitted proof.' : 'Your role workspace for assigned work, deadlines, and submitted proof.';
  let extra = '';
  if (title === 'Google Optimizer') extra = '<section class="card form-card" style="margin-top:14px"><div class="card-title">Local SEO & keyword assistant</div><p class="card-sub" style="line-height:1.6;margin:7px 0 12px">Draft keyword clusters and placement ideas for a property. Verify suggestions with keyword tools and the property owner.</p><div class="field"><label>Property, city, target guest, and SEO goal</label><textarea class="textarea" id="seo-prompt" placeholder="Example: boutique homestay in Jaipur, couples and weekend travellers, improve direct booking discovery. Verified features: ..."></textarea></div><div class="toolbar" style="margin-top:10px"><button class="btn btn-primary" data-action="draft-seo">✦ Draft local SEO ideas</button><span class="field-help">' + (state.aiEnabled ? 'AI is connected on the app server.' : 'Needs OPENAI_API_KEY on the app server.') + '</span></div><div id="seo-result"></div></section>';
  if (title === 'HR') extra = '<section class="card form-card" style="margin-top:14px"><div class="card-title">Volunteer activity tasks</div><div class="grid grid-4">' + HR_TYPES.map(type => stat(type, roleTasks.filter(task => task.type === type).length, 'Assigned tasks', '♡')).join('') + '</div></section>' + volunteerRoster();
  const actions = (isAdmin() || title === 'HR') ? (title === 'HR' ? '<button class="btn" data-action="new-volunteer">＋ Add volunteer</button>' : '') + (isAdmin() ? '<button class="btn btn-primary" data-action="new-task" data-category="' + esc(title) + '">＋ Assign ' + esc(title) + ' task</button>' : '') : '';
  return pageHead(title === 'HR' ? 'Volunteer desk & HR tasks' : title + ' task board', title === 'HR' ? header + ' Add and update volunteer records in the shared roster below.' : header, actions) +
    '<div class="grid grid-4">' + stat('Assigned',roleTasks.length,'All task records','☑') + stat('Completed',roleTasks.filter(task => task.status === 'done').length,'Photo proof submitted','✓') + stat('Open',roleTasks.filter(task => task.status !== 'done').length,'Still in progress','◷') + stat('Team profiles',isAdmin() ? state.team.filter(member => member.title === title).length : 1,'Assigned to this role','♙') + '</div>' + extra + '<div class="task-grid">' + (roleTasks.map(taskCard).join('') || '<div class="card empty"><strong>No tasks assigned</strong>' + (isAdmin() ? 'Assign work to this role to see progress here.' : 'Ask an admin to add tasks to your sheet.') + '</div>') + '</div>';
}

function render() {
  if (!state) return;
  let content = '';
  if (page === 'overview') content = isAdmin() ? adminOverview() : memberOverview();
  else if (page === 'team') content = isAdmin() ? teamPage() : memberOverview();
  else if (page === 'tasks') content = tasksPage(taskTitleFilter);
  else if (page === 'crm') content = isAdmin() ? crmPage() : memberOverview();
  else if (page === 'audits') content = isAdmin() ? auditPage() : memberOverview();
  else if (page === 'platforms') content = otaPage();
  else if (page === 'ota-team') content = isAdmin() ? teamBoardPage('OTA lister board', 'OTA Master') : tasksPage('OTA Master');
  else if (page === 'video-team') content = isAdmin() ? teamBoardPage('Video production board', 'Videographer + Editor') : tasksPage('Videographer + Editor');
  else if (page === 'sales') content = salesPage();
  else if (page === 'scripts') content = scriptsPage();
  else if (page === 'reports') content = isAdmin() ? reportsPage() : memberOverview();
  else if (page.endsWith('-board')) {
    const roles = {'meta-board':'Meta Ads','google-board':'Google Optimizer','design-board':'Graphic Designer','hr-board':'HR'};
    content = isAdmin() || roles[page] === currentUser().title ? genericBoard(page) : tasksPage();
  }
  else content = memberOverview();
  renderShell(content);
}

function memberModal(member) {
  const edit = Boolean(member);
  const titleOptions = TEAM_TITLES.map(title => '<option ' + (member && member.title === title ? 'selected' : '') + '>' + esc(title) + '</option>').join('');
  openModal('<div class="modal-head"><div><h2>' + (edit ? 'Edit team account' : 'Add a team member') + '</h2><p>Each person signs in individually and gets the workspace for their title.</p></div><button class="modal-close" data-action="close">×</button></div><form id="member-form"><input type="hidden" name="memberId" value="' + (edit ? member.id : '') + '"><div class="fields"><div class="field"><label>Full name</label><input class="input" name="name" value="' + esc(edit ? member.name : '') + '" required></div><div class="field"><label>Sign-in ID</label><input class="input" name="loginId" value="' + esc(edit ? member.loginId : '') + '" required></div><div class="field"><label>Team title</label><select class="select" name="title">' + titleOptions + '</select></div><div class="field"><label>' + (edit ? 'Reset password (optional)' : 'Password') + '</label><input class="input" name="password" type="password" minlength="8" ' + (!edit ? 'required' : '') + ' placeholder="At least 8 characters"></div>' + (edit ? '<div class="field"><label>Account status</label><select class="select" name="active"><option value="true" ' + (member.active !== false ? 'selected' : '') + '>Active</option><option value="false" ' + (member.active === false ? 'selected' : '') + '>Paused</option></select></div>' : '') + '<div class="field wide"><label>Profile image (optional)</label><div class="profile-picker"><span id="member-avatar-preview">' + avatarMarkup(edit ? member : null, edit ? member.name : 'New member', 'avatar-large') + '</span><div><input class="input" id="member-profile-photo" name="profilePhoto" type="file" accept="image/jpeg,image/png,image/webp"><span class="field-help">Square JPG, PNG, or WebP · up to 2 MB</span></div></div></div></div><div class="modal-actions"><button class="btn" type="button" data-action="close">Cancel</button><button class="btn btn-primary" type="submit">' + (edit ? 'Save account' : 'Create sign-in') + '</button></div></form>', true);
}

function profileModal() {
  const me = currentUser();
  openModal('<div class="modal-head"><div><h2>Your profile</h2><p>Choose the photo shown beside your name across the workspace.</p></div><button class="modal-close" data-action="close">×</button></div><form id="profile-form"><div class="profile-picker">' + avatarMarkup(me, me.name, 'avatar-large') + '<div class="field"><label>Profile photo</label><input class="input" id="profile-photo" name="profilePhoto" type="file" accept="image/jpeg,image/png,image/webp" required><span class="field-help">Square JPG, PNG, or WebP · maximum 2 MB</span></div></div><div class="upload-preview" id="profile-preview">Preview your photo before saving</div><div class="modal-actions"><button class="btn" type="button" data-action="close">Cancel</button><button class="btn btn-primary" type="submit">Save profile photo</button></div></form>', true);
}

function spendModal(channel) {
  const channelOptions = CRM_CHANNELS.map(item => '<option ' + (channel === item ? 'selected' : '') + '>' + esc(item) + '</option>').join('');
  openModal('<div class="modal-head"><div><h2>Add marketing spend</h2><p>Track one channel and campaign for a single date. Amounts are recorded in INR.</p></div><button class="modal-close" data-action="close">×</button></div><form id="spend-form"><div class="fields"><div class="field"><label>Date</label><input class="input" type="date" name="date" value="' + esc(state.today) + '" required></div><div class="field"><label>Marketing channel</label><select class="select" name="channel">' + channelOptions + '</select></div><div class="field wide"><label>Campaign / activity</label><input class="input" name="campaign" placeholder="Campaign name or invoice reference"></div><div class="field"><label>Spend (₹)</label><input class="input" type="number" name="amount" min="0" step="0.01" required></div><div class="field"><label>Attributed leads (optional)</label><input class="input" type="number" name="leads" min="0" step="1"></div><div class="field"><label>Impressions</label><input class="input" type="number" name="impressions" min="0" step="1"></div><div class="field"><label>Clicks</label><input class="input" type="number" name="clicks" min="0" step="1"></div><div class="field wide"><label>Notes</label><textarea class="textarea" name="notes" placeholder="Source file, invoice, client, or attribution note"></textarea></div></div><div class="modal-actions"><button class="btn" type="button" data-action="close">Cancel</button><button class="btn btn-primary" type="submit">Save spend row</button></div></form>');
}

function taskModal(task, category, platform) {
  const edit = Boolean(task);
  const memberOptions = state.team.filter(member => member.active !== false).map(member => '<option value="' + member.id + '" ' + ((task && task.memberId === member.id) || (!task && category && member.title === category) ? 'selected' : '') + '>' + esc(member.name) + ' · ' + esc(member.title) + '</option>').join('');
  const selectedTitle = task ? task.memberTitle : (category || (memberById(state.team[0] && state.team[0].id) || {}).title || '');
  const types = TASK_TYPES[selectedTitle] || [];
  const type = task ? task.type : (platform ? 'Listing optimization' : '');
  const selectedPlatform = platform || (task && otaPlatforms.find(item => item.id === task.otaPlatformId));
  openModal('<div class="modal-head"><div><h2>' + (edit ? 'Edit task assignment' : 'Assign a daily task') + '</h2><p>Assign one owner, a client, a task type, and a clear deadline.</p></div><button class="modal-close" data-action="close">×</button></div><form id="task-form"><input type="hidden" name="taskId" value="' + (edit ? task.id : '') + '"><input type="hidden" name="otaPlatformId" value="' + esc(selectedPlatform ? selectedPlatform.id : '') + '"><div class="fields"><div class="field wide"><label>Task title</label><input class="input" name="title" value="' + esc(edit ? task.title : (selectedPlatform ? selectedPlatform.name + ' listing optimization' : '')) + '" required placeholder="What needs to be completed?"></div><div class="field"><label>Team member</label><select class="select" id="task-member" name="memberId" required><option value="">Choose owner</option>' + memberOptions + '</select></div><div class="field"><label>Task type</label><input class="input" name="type" list="task-types" value="' + esc(type) + '" placeholder="Choose or type a task type"><datalist id="task-types">' + types.map(item => '<option value="' + esc(item) + '"></option>').join('') + '</datalist><div class="field-help">Categories can be expanded as you define each role’s workflow.</div></div><div class="field"><label>Client / property</label><input class="input" name="client" value="' + esc(edit ? task.client : '') + '" placeholder="Property or client name"></div><div class="field"><label>Deadline date</label><input class="input" type="date" name="dueDate" value="' + esc(edit ? task.dueDate : state.today) + '" required></div><div class="field"><label>Deadline time</label><input class="input" type="time" name="dueTime" value="' + esc(edit ? task.dueTime : '') + '"></div><div class="field"><label>Priority</label><select class="select" name="priority"><option value="">Normal</option><option ' + ((edit && task.priority === 'High') ? 'selected' : '') + '>High</option><option ' + ((edit && task.priority === 'Medium') ? 'selected' : '') + '>Medium</option><option ' + ((edit && task.priority === 'Low') ? 'selected' : '') + '>Low</option></select></div><div class="field"><label>Sales segment</label><select class="select" name="segment"><option value="">Not applicable</option>' + ['Travel Agents','Wedding','B2B','Retreat'].map(item => '<option ' + (edit && task.segment === item ? 'selected' : '') + '>' + item + '</option>').join('') + '</select></div><div class="field wide"><label>Task details / brief</label><textarea class="textarea" name="description" placeholder="Clear outcome, reference, or client instructions">' + esc(edit ? task.description : '') + '</textarea></div></div><div class="modal-actions"><button class="btn" type="button" data-action="close">Cancel</button><button class="btn btn-primary" type="submit">' + (edit ? 'Save changes' : 'Assign task') + '</button></div></form>');
}

function completionModal(task) {
  openModal('<div class="modal-head"><div><h2>Submit completed task</h2><p>' + esc(task.title) + (task.client ? ' · ' + esc(task.client) : '') + '</p></div><button class="modal-close" data-action="close">×</button></div><form id="task-complete-form"><input type="hidden" name="taskId" value="' + task.id + '"><div class="field"><label>Confirmation</label><div class="notice">I confirm this task is complete and ready for admin review.</div></div><div class="field" style="margin-top:12px"><label>Photo proof <span style="color:var(--red)">*</span></label><input class="input" id="proof-file" name="proof" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required><span class="field-help">Photo required · JPG, PNG, WebP, or AVIF · maximum 5 MB</span><div class="upload-preview" id="proof-preview">Choose an image to preview</div></div><div class="field" style="margin-top:12px"><label>Completion note (optional)</label><textarea class="textarea" name="note" placeholder="Any useful handover, outcome, or follow-up"></textarea></div><div class="modal-actions"><button class="btn" type="button" data-action="close">Not yet</button><button class="btn btn-primary" type="submit">Submit with photo ✓</button></div></form>', true);
}

function auditModal(audit) {
  const edit = Boolean(audit);
  const value = key => esc(edit ? audit[key] || '' : '');
  const textField = (label, name, help) => '<div class="field"><label>' + label + '</label><input class="input" name="' + name + '" value="' + value(name) + '">' + (help ? '<span class="field-help">' + help + '</span>' : '') + '</div>';
  const area = (label, name, placeholder) => '<div class="field wide"><label>' + label + '</label><textarea class="textarea" name="' + name + '" placeholder="' + esc(placeholder || '') + '">' + value(name) + '</textarea></div>';
  openModal('<div class="modal-head"><div><h2>' + (edit ? 'Update property audit' : 'New property audit') + '</h2><p>This audit is shared between both admins and stored in the audit folder.</p></div><button class="modal-close" data-action="close">×</button></div><form id="audit-form"><input type="hidden" name="auditId" value="' + (edit ? audit.id : '') + '"><div class="fields">' +
    textField('Business / property name','businessName','Required') + textField('Contact person','contactName') + textField('Contact number','phone') + textField('Email','email') + textField('City','city') + textField('State','state') + textField('Property type','propertyType','Hotel, resort, homestay, villa…') + textField('Website','website') +
    textField('Current monthly revenue (₹)','monthlyRevenue') + textField('Current annual revenue (₹)','annualRevenue') + textField('Rooms / units','rooms') + textField('Guest capacity','guestCapacity') + textField('Occupancy (%)','occupancy') + textField('Seasonality / peak months','seasonality') + textField('Weekday average rate (₹)','weekdayRate') + textField('Weekend average rate (₹)','weekendRate') + textField('Rate range (₹)','rateRange') + textField('Room types','roomTypes') + textField('Audit status','status') +
    area('Guest profile & target audience','guestProfile','Families, couples, corporate, weddings, retreats, domestic/international…') + area('Amenities & facilities','amenities','List verified property facilities, room amenities, dining, activities…') + area('Booking, check-in & cancellation policies','bookingPolicies','Check-in/out, deposits, cancellation windows, child/pet policy…') + area('PMS, channel manager & direct booking systems','systems','Property software, booking engine, channel manager, integration gaps…') + area('Competitors & price comparison','competitors','Comparable properties, prices, positioning, observed strengths…') + area('Photo & video asset inventory','creativeAssets','Current photos, video, room coverage, quality, gaps…') + area('Operations notes','operationsNotes','Seasonal constraints, staffing, service capacity, operational blockers…') + area('Pricing notes','pricingNotes','Taxes, meal plans, packages, extra guest charges, discounts…') +
    area('Current revenue notes','revenueNotes','Revenue mix, seasonality, margins, known occupancy…') + area('Current marketing strategies','marketingChannels','OTAs, paid ads, organic, social, email, direct…') + area('Current OTA listings','otaListings','List the platforms and current property URLs') + area('Marketing budget & performance','marketingBudget','Budget, CPL, ROAS, attribution or gaps') + area('Social / review presence','socialLinks','Instagram, Facebook, Google Business Profile, rating…') + area('What is working','strengths') + area('Audit gaps / blockers','gaps') + area('Recommended opportunities','recommendations') + area('Next steps for the pitch','nextSteps') +
    '</div><div class="modal-actions"><button class="btn" type="button" data-action="close">Cancel</button><button class="btn btn-primary" type="submit">Save to shared audit folder</button></div></form>');
}

function contactModal(contact, segment) {
  const edit = Boolean(contact);
  const value = key => esc(edit ? contact[key] || '' : '');
  const segments = ['Travel Agents','Wedding','B2B','Retreat'];
  const owner = '<option value="" ' + (!edit || !contact.ownerId ? 'selected' : '') + '>Unassigned</option>' + state.team.filter(member => member.active !== false && member.title === 'Sales').map(member => '<option value="' + member.id + '" ' + (edit && contact.ownerId === member.id ? 'selected' : '') + '>' + esc(member.name) + '</option>').join('');
  const channelOptions = CRM_CHANNELS.map(item => '<option ' + ((edit ? contact.sourceChannel : 'Other') === item ? 'selected' : '') + '>' + esc(item) + '</option>').join('');
  openModal('<div class="modal-head"><div><h2>' + (edit ? 'Edit sales lead' : 'Add sales lead') + '</h2><p>Track the source, next follow-up, pipeline stage, and closed value.</p></div><button class="modal-close" data-action="close">×</button></div><form id="contact-form"><input type="hidden" name="contactId" value="' + (edit ? contact.id : '') + '"><div class="fields"><div class="field"><label>Segment</label><select class="select" name="segment">' + segments.map(item => '<option ' + ((edit ? contact.segment : segment) === item ? 'selected' : '') + '>' + item + '</option>').join('') + '</select></div><div class="field"><label>Lead / contact name</label><input class="input" name="name" value="' + value('name') + '" required></div><div class="field"><label>Company / property</label><input class="input" name="company" value="' + value('company') + '"></div><div class="field"><label>Phone</label><input class="input" name="phone" value="' + value('phone') + '" type="tel"></div><div class="field"><label>Email</label><input class="input" name="email" value="' + value('email') + '" type="email"></div><div class="field"><label>City</label><input class="input" name="city" value="' + value('city') + '"></div><div class="field"><label>Lead source</label><select class="select" name="sourceChannel">' + channelOptions + '</select></div><div class="field"><label>Campaign</label><input class="input" name="campaign" value="' + value('campaign') + '" placeholder="Campaign, UTM, or referral"></div><div class="field"><label>Lead date</label><input class="input" type="date" name="leadDate" value="' + esc(edit ? contact.leadDate || String(contact.createdAt || '').slice(0,10) : state.today) + '"></div><div class="field"><label>Pipeline stage</label><select class="select" name="status">' + ['New','Contacted','Qualified','Proposal','Follow-up','Won','Lost'].map(item => '<option ' + ((edit ? contact.status : 'New') === item ? 'selected' : '') + '>' + item + '</option>').join('') + '</select></div><div class="field"><label>Follow-up date</label><input class="input" type="date" name="followUpDate" value="' + value('followUpDate') + '"></div><div class="field"><label>Deal value (₹)</label><input class="input" type="number" name="conversionValue" min="0" step="1000" value="' + value('conversionValue') + '" placeholder="Fill when closed"></div>' + (isAdmin() ? '<div class="field"><label>Owner</label><select class="select" name="ownerId">' + owner + '</select></div>' : '') + '<div class="field wide"><label>Discussion notes</label><textarea class="textarea" name="notes">' + value('notes') + '</textarea></div></div><div class="modal-actions"><button class="btn" type="button" data-action="close">Cancel</button><button class="btn btn-primary" type="submit">Save lead</button></div></form>');
}

function scriptModal(script) {
  const edit = Boolean(script);
  const value = key => esc(edit ? script[key] || '' : '');
  openModal('<div class="modal-head"><div><h2>' + (edit ? 'Edit script' : 'Save a content script') + '</h2><p>Keep the client, channel, and approved script together.</p></div><button class="modal-close" data-action="close">×</button></div><form id="script-form"><input type="hidden" name="scriptId" value="' + (edit ? script.id : '') + '"><div class="fields"><div class="field"><label>Script title</label><input class="input" name="title" value="' + value('title') + '" required></div><div class="field"><label>Client / property</label><input class="input" name="client" value="' + value('client') + '"></div><div class="field"><label>Channel</label><input class="input" name="channel" value="' + value('channel') + '" placeholder="Instagram Reel, Facebook…"></div><div class="field"><label>Goal</label><input class="input" name="goal" value="' + value('goal') + '" placeholder="Awareness, enquiry, booking…"></div><div class="field wide"><label>Script</label><textarea class="textarea" name="body" style="min-height:180px">' + value('body') + '</textarea></div></div><div class="modal-actions"><button class="btn" type="button" data-action="close">Cancel</button><button class="btn btn-primary" type="submit">Save script</button></div></form>');
}

function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function fileAsDataURL(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.readAsDataURL(file);
  });
}

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-page]');
  if (nav) {
    page = nav.dataset.page;
    searchText = '';
    taskFilter = 'open';
    if (nav.dataset.titleFilter) {
      taskTitleFilter = nav.dataset.titleFilter;
      taskFilter = 'all';
      render();
      return;
    }
    taskTitleFilter = '';
    render();
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const key = action.dataset.action;
  try {
    if (key === 'toggle-mobile-nav') {
      const shell = appRoot.querySelector('.app-shell');
      if (shell) {
        const open = shell.classList.toggle('mobile-nav-open');
        document.body.classList.toggle('nav-open', open);
        action.setAttribute('aria-expanded', String(open));
        action.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      }
      return;
    }
    if (key === 'close-mobile-nav') {
      const shell = appRoot.querySelector('.app-shell');
      if (shell) shell.classList.remove('mobile-nav-open');
      document.body.classList.remove('nav-open');
      return;
    }
    if (key === 'install-app') {
      if (installPrompt) {
        const promptEvent = installPrompt;
        installPrompt = null;
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === 'accepted') appIsInstalled = true;
        render();
      } else if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !appIsInstalled) {
        showToast('In Safari, tap Share, then Add to Home Screen');
      } else if (!appIsInstalled) {
        showToast('Open your browser menu and choose Install app or Add to Home screen');
      }
      return;
    }
    if (key === 'close') { closeModal(); return; }
    if (key === 'edit-profile') { profileModal(); return; }
    if (key === 'logout') { await api('/api/logout',{method:'POST'}); state=null; page='overview'; assistantMessages=[]; assistantOpen=false; assistantBusy=false; const boot=await api('/api/bootstrap'); authView(boot.needsSetup, '', boot.setupKeyRequired); return; }
    if (key === 'toggle-assistant') { assistantOpen = !assistantOpen; render(); if (assistantOpen && assistantMessages.length) refreshAssistantMessages(); return; }
    if (key === 'close-assistant') { assistantOpen = false; render(); return; }
    if (key === 'clear-assistant') { assistantMessages=[]; assistantBusy=false; render(); return; }
    if (key === 'assistant-prompt') {
      assistantOpen = true;
      render();
      const input = document.getElementById('assistant-input');
      if (input) { input.value = action.dataset.prompt || ''; input.focus(); }
      return;
    }
    if (key === 'apply-crm-range') {
      crmFrom = document.getElementById('crm-from').value;
      crmTo = document.getElementById('crm-to').value;
      if (crmFrom && crmTo && crmFrom > crmTo) { showToast('Choose a start date before the end date'); return; }
      render();
      return;
    }
    if (key === 'new-spend') { spendModal(action.dataset.channel || ''); return; }
    if (key === 'export-crm') { exportCRM(); return; }
    if (key === 'sync-meta' || key === 'sync-google') {
      const from = document.getElementById('crm-from').value || shiftDate(state.today,-29);
      const to = document.getElementById('crm-to').value || state.today;
      const result = await api('/api/crm/sync',{method:'POST',body:{provider:key === 'sync-meta' ? 'meta' : 'google',from,to}});
      await refresh();
      showToast((key === 'sync-meta' ? 'Meta Ads' : 'Google Ads') + ' synced · ' + result.imported + ' daily campaign rows');
      return;
    }
    if (key === 'new-member') { memberModal(null); return; }
    if (key === 'edit-member') { memberModal(state.team.find(member => member.id === action.dataset.id)); return; }
    if (key === 'new-volunteer') { volunteerModal(null); return; }
    if (key === 'edit-volunteer') { volunteerModal((state.volunteers || []).find(person => person.id === action.dataset.id)); return; }
    if (key === 'new-task') { taskModal(null, action.dataset.category || '', pendingPlatform); pendingPlatform=null; return; }
    if (key === 'edit-task') { taskModal(state.tasks.find(task => task.id === action.dataset.id)); return; }
    if (key === 'complete-task') { completionModal(state.tasks.find(task => task.id === action.dataset.id)); return; }
    if (key === 'reopen-task') { await api('/api/tasks/' + action.dataset.id + '/reopen',{method:'POST'}); await refresh(); showToast('Task reopened'); return; }
    if (key === 'new-audit') { auditModal(null); return; }
    if (key === 'edit-audit') { auditModal(state.audits.find(item => item.id === action.dataset.id)); return; }
    if (key === 'new-contact') { contactModal(null, action.dataset.segment || ''); return; }
    if (key === 'edit-contact') { contactModal(state.contacts.find(item => item.id === action.dataset.id)); return; }
    if (key === 'new-script') { scriptModal(null); return; }
    if (key === 'assign-platform') { pendingPlatform = otaPlatforms.find(item => item.id === action.dataset.id); taskModal(null, 'OTA Master', pendingPlatform); pendingPlatform=null; return; }
    if (key === 'sales-filter') { salesSegment = action.dataset.value; render(); return; }
    if (key === 'generate-report') {
      reportDate = document.getElementById('report-date').value || state.today;
      const result = await api('/api/reports/generate',{method:'POST',body:{date:reportDate}});
      selectedReport = result.report;
      await refresh();
      showToast('Daily report saved');
      return;
    }
    if (key === 'open-report') {
      selectedReport = state.reports.find(report => report.id === action.dataset.id) || null;
      if (selectedReport) reportDate = selectedReport.date;
      render();
      return;
    }
    if (key === 'copy-team-report') { if (selectedReport || state.reports.length) await copyText(reportSummary(selectedReport || state.reports[0],'')); return; }
    if (key === 'share-team-report') { shareText(reportSummary(selectedReport || state.reports[0],'')); return; }
    if (key === 'share-individual-report') {
      const report = selectedReport || state.reports.find(item => item.date === (reportDate || state.today));
      const memberId = document.getElementById('report-member').value;
      if (!memberId) { showToast('Choose a member for the individual report'); return; }
      shareText(reportSummary(report, memberId));
      return;
    }
    if (key === 'draft-script') { await draftScript(); return; }
    if (key === 'draft-seo') { await draftSeo(); return; }
    if (key === 'copy-seo') { await copyText(document.getElementById('seo-result-text').value); return; }
    if (key === 'save-draft-script') { scriptDraftPrompt = document.getElementById('ai-prompt').value; scriptModal({title:'AI draft · ' + (state.user.name || ''), client:'', channel:'Instagram Reel', goal:'', body:document.getElementById('ai-result-text').value}); return; }
  } catch (error) { showToast(error.message); }
});

document.addEventListener('input', event => {
  if (event.target.id === 'task-search' || event.target.id === 'platform-search' || event.target.id === 'audit-search') {
    const cursor = event.target.selectionStart;
    if (event.target.id === 'task-search') searchText = event.target.value;
    if (event.target.id === 'platform-search') searchText = event.target.value;
    if (event.target.id === 'audit-search') auditSearch = event.target.value;
    render();
    const replacement = document.getElementById(event.target.id);
    if (replacement) { replacement.focus(); replacement.setSelectionRange(cursor,cursor); }
  }
  if (event.target.id === 'proof-file') {
    const file = event.target.files && event.target.files[0];
    const preview = document.getElementById('proof-preview');
    if (file && preview) {
      const reader = new FileReader();
      reader.onload = () => { preview.innerHTML = '<img src="' + reader.result + '" alt="Proof preview">'; };
      reader.readAsDataURL(file);
    } else if (preview) preview.textContent = 'Choose an image to preview';
  }
});

document.addEventListener('change', event => {
  if (event.target.id === 'task-filter') { taskFilter = event.target.value; render(); }
  if (event.target.id === 'platform-filter') { platformFilter = event.target.value; render(); }
  if (event.target.id === 'report-date') { reportDate = event.target.value; selectedReport = state.reports.find(report => report.date === reportDate) || null; render(); }
  if (event.target.id === 'profile-photo' || event.target.id === 'member-profile-photo') {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Profile photos must be 2 MB or smaller'); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (event.target.id === 'profile-photo') {
        const preview = document.getElementById('profile-preview');
        if (preview) preview.innerHTML = '<img src="' + reader.result + '" alt="Profile preview">';
      } else {
        const preview = document.getElementById('member-avatar-preview');
        if (preview) preview.innerHTML = '<span class="avatar avatar-large"><img src="' + reader.result + '" alt="Profile preview"></span>';
      }
    };
    reader.readAsDataURL(file);
  }
  if (event.target.id === 'task-member') {
    const member = memberById(event.target.value);
    const typeInput = document.querySelector('#task-form [name="type"]');
    const list = document.getElementById('task-types');
    if (member && typeInput && list && !typeInput.value) list.innerHTML = (TASK_TYPES[member.title] || []).map(type => '<option value="' + esc(type) + '"></option>').join('');
  }
});

document.addEventListener('error', event => {
  if (event.target && event.target.classList && event.target.classList.contains('ota-logo-image')) {
    const logo = event.target.closest('.ota-logo');
    if (logo) logo.classList.add('logo-failed');
  }
}, true);

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.id) return;
  event.preventDefault();
  const data = formData(form);
  try {
    if (form.id === 'assistant-form') { await askAssistant(data.message); return; }
    if (form.id === 'setup-form') {
      await api('/api/setup',{method:'POST',body:data});
      authView(false,'Both admin accounts are ready. Sign in with either ID.');
      return;
    }
    if (form.id === 'login-form') { assistantMessages=[]; assistantBusy=false; await api('/api/login',{method:'POST',body:data}); await refresh(); return; }
    if (form.id === 'member-form') {
      const id=data.memberId;
      const body={name:data.name,loginId:data.loginId,title:data.title,password:data.password||undefined};
      if (form.elements.active) body.active=data.active==='true';
      const saved=await api(id?'/api/members/'+id:'/api/members',{method:id?'PATCH':'POST',body});
      const memberId=id||saved.member.id;
      const photo=form.elements.profilePhoto.files&&form.elements.profilePhoto.files[0];
      if(photo) await api('/api/members/'+memberId+'/photo',{method:'POST',body:{photo:await fileAsDataURL(photo)}});
      closeModal(); await refresh(); showToast(id?'Team access updated':'Team member added'); return;
    }
    if (form.id === 'volunteer-form') {
      const id = data.volunteerId;
      delete data.volunteerId;
      await api(id ? '/api/volunteers/' + id : '/api/volunteers', {method:id ? 'PATCH' : 'POST', body:data});
      closeModal(); await refresh(); showToast(id ? 'Volunteer record updated' : 'Volunteer added to roster'); return;
    }
    if (form.id === 'profile-form') {
      const photo=form.elements.profilePhoto.files&&form.elements.profilePhoto.files[0];
      if(!photo){showToast('Choose a profile photo first');return;}
      if(photo.size>2*1024*1024){showToast('Profile photos must be 2 MB or smaller');return;}
      await api('/api/profile/photo',{method:'POST',body:{photo:await fileAsDataURL(photo)}});
      closeModal();await refresh();showToast('Profile photo updated');return;
    }
    if (form.id === 'spend-form') {
      await api('/api/spend',{method:'POST',body:data});
      closeModal();await refresh();showToast('Marketing spend saved');return;
    }
    if (form.id === 'task-form') {
      const id=data.taskId;
      const body={title:data.title,memberId:data.memberId,type:data.type,client:data.client,dueDate:data.dueDate,dueTime:data.dueTime,priority:data.priority,segment:data.segment,description:data.description,otaPlatformId:data.otaPlatformId};
      await api(id?'/api/tasks/'+id:'/api/tasks',{method:id?'PATCH':'POST',body});
      closeModal(); await refresh(); showToast(id?'Task updated':'Task assigned'); return;
    }
    if (form.id === 'task-complete-form') {
      const file=form.elements.proof.files && form.elements.proof.files[0];
      if (!file) { showToast('Choose a proof photo before submitting'); return; }
      if (file.size > 5 * 1024 * 1024) { showToast('Use a proof photo under 5 MB'); return; }
      const reader=new FileReader();
      reader.onload=async function() {
        try {
          await api('/api/tasks/'+data.taskId+'/complete',{method:'POST',body:{proof:{name:file.name,mime:file.type,data:reader.result},note:data.note}});
          closeModal(); await refresh(); showToast('Task submitted with proof');
        } catch(error) { showToast(error.message); }
      };
      reader.readAsDataURL(file);
      return;
    }
    if (form.id === 'audit-form') {
      const id=data.auditId; delete data.auditId;
      data.id=id;
      const result=await api('/api/audits',{method:'POST',body:data});
      closeModal(); await refresh(); showToast(result.audit.businessName+' audit saved'); return;
    }
    if (form.id === 'contact-form') {
      const id=data.contactId; delete data.contactId;
      await api(id?'/api/contacts/'+id:'/api/contacts',{method:id?'PATCH':'POST',body:data});
      closeModal(); await refresh(); showToast(id?'Sales contact updated':'Sales contact saved'); return;
    }
    if (form.id === 'script-form') {
      const id=data.scriptId; delete data.scriptId;
      await api('/api/scripts',{method:'POST',body:Object.assign(data,id?{id}: {})});
      closeModal(); await refresh(); showToast('Script saved to the content planner'); return;
    }
  } catch(error) {
    const target=form.querySelector('.auth-error');
    if (target) target.textContent=error.message;
    else showToast(error.message);
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const shell = appRoot.querySelector('.app-shell.mobile-nav-open');
    if (shell) { shell.classList.remove('mobile-nav-open'); document.body.classList.remove('nav-open'); }
  }
});

async function draftScript() {
  const prompt=document.getElementById('ai-prompt').value.trim();
  if (!prompt) { showToast('Add the client and content idea first'); return; }
  const result=document.getElementById('ai-result');
  result.innerHTML='<div class="notice" style="margin-top:12px">Drafting a script…</div>';
  try {
    const data=await api('/api/scripts/draft',{method:'POST',body:{prompt}});
    result.innerHTML='<div class="field" style="margin-top:12px"><label>AI draft · review all client facts</label><textarea class="textarea" id="ai-result-text" style="min-height:200px">' + esc(data.draft) + '</textarea><button class="btn btn-soft" style="margin-top:8px" data-action="save-draft-script">Save this draft</button></div>';
  } catch(error) {
    result.innerHTML='<div class="notice notice-warm" style="margin-top:12px">' + esc(error.message) + '</div>';
  }
}

async function draftSeo() {
  const prompt = document.getElementById('seo-prompt').value.trim();
  if (!prompt) { showToast('Add the property location, audience, and SEO goal first'); return; }
  const result = document.getElementById('seo-result');
  result.innerHTML = '<div class="notice" style="margin-top:12px">Preparing local SEO ideas…</div>';
  try {
    const data = await api('/api/seo/draft', {method:'POST', body:{prompt}});
    result.innerHTML = '<div class="field" style="margin-top:12px"><label>AI suggestions · validate before publishing</label><textarea class="textarea" id="seo-result-text" style="min-height:200px">' + esc(data.draft) + '</textarea><button class="btn btn-soft" style="margin-top:8px" data-action="copy-seo">Copy suggestions</button></div>';
  } catch (error) {
    result.innerHTML = '<div class="notice notice-warm" style="margin-top:12px">' + esc(error.message) + '</div>';
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); showToast('Report copied'); }
  catch { showToast('Copy is unavailable in this browser'); }
}
function exportCRM() {
  const from = crmFrom || shiftDate(state.today, -29);
  const to = crmTo || state.today;
  const contacts = state.contacts.filter(item => {
    const date = item.leadDate || String(item.createdAt || '').slice(0,10);
    return date >= from && date <= to;
  });
  const spendRecords = (state.spendRecords || []).filter(item => item.date >= from && item.date <= to);
  const fields = ['record_type','date','contact','company','segment','source_channel','campaign','status','follow_up_date','owner','city','phone','email','conversion_value_inr','marketing_channel','spend_inr','impressions','clicks','leads','notes'];
  const quote = value => {
    let cell = String(value == null ? '' : value);
    if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replace(/"/g,'""') + '"';
  };
  const rows = [fields];
  for (const item of contacts) rows.push(['lead',item.leadDate || String(item.createdAt || '').slice(0,10),item.name,item.company,item.segment,item.sourceChannel,item.campaign,item.status,item.followUpDate,item.ownerName,item.city,item.phone,item.email,item.conversionValue,'','','','','',item.notes]);
  for (const item of spendRecords) rows.push(['spend',item.date,'','','',item.channel,item.campaign,'','','','','','',item.conversionValue,item.channel,item.amount,item.impressions,item.clicks,item.leads,item.notes]);
  const blob = new Blob(['\ufeff' + rows.map(row => row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'hospitality-growth-crm-' + from + '-to-' + to + '.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('CRM CSV downloaded');
}
function shareText(text) {
  if (!text) { showToast('Generate a report first'); return; }
  window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank','noopener,noreferrer');
}

async function start() {
  try {
    otaPlatforms=await fetch('/ota-platforms.json').then(response=>response.json()).catch(()=>[]);
    const boot=await api('/api/bootstrap');
    if (boot.needsSetup) { authView(true, '', boot.setupKeyRequired); return; }
    try { await refresh(); }
    catch(error) { if (error.message.includes('sign in')) authView(false); else throw error; }
  } catch(error) {
    appRoot.innerHTML='<div class="auth-wrap"><section class="auth-card"><div class="auth-brand">' + brandMark() + '<strong>Maati Living Community</strong></div><h1>Workspace server not running</h1><p>Start the app from its launch file, then reopen <b>http://localhost:3031</b>.</p><div class="notice">Open <b>Start Hospitality Growth Desk.cmd</b> in the app folder. The app needs its server to save audits, proof photos, and reports.</div></section></div>';
  }
}
start();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

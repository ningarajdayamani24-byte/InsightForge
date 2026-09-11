const $ = (selector, scope = document) => scope.querySelector(selector);
let dashboardData = null;

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function showNotice(message, kind = '') {
  const notice = $('#notice');
  notice.textContent = message;
  notice.className = `notice ${kind}`;
}

function fillForm(form, values) {
  [...form.elements].forEach((element) => {
    if (!element.name || values[element.name] === undefined) return;
    if (element.type === 'checkbox') element.checked = Boolean(values[element.name]);
    else element.value = values[element.name];
  });
}

function renderUploads(uploads) {
  const list = $('#upload-list');
  list.innerHTML = '';
  if (!uploads.length) {
    list.innerHTML = '<p class="muted">Your uploaded files will appear here.</p>';
    return;
  }
  uploads.slice(0, 5).forEach((upload) => {
    const row = document.createElement('a');
    row.className = 'upload-row';
    row.href = upload.url;
    row.target = '_blank';
    row.rel = 'noreferrer';
    row.innerHTML = `<span>${escapeHtml(upload.name)}</span><small>${escapeHtml((upload.type || 'file').split('/').pop())} ↗</small>`;
    list.append(row);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function renderProjects(projects) {
  const list = $('#admin-project-list');
  list.innerHTML = '';
  if (!projects.length) {
    list.innerHTML = '<p class="muted">Add your first project above.</p>';
    return;
  }
  projects.forEach((project) => {
    const card = document.createElement('article');
    card.className = 'admin-project';
    card.innerHTML = `<div><p>${escapeHtml(project.title)}</p><small>${escapeHtml((project.tags || []).join(' · ') || 'No tags')} ${project.featured ? '' : ' · Hidden'}</small></div><div><button class="edit-project" type="button">Edit</button><button class="delete-project" type="button">Delete</button></div>`;
    $('.edit-project', card).addEventListener('click', () => editProject(project));
    $('.delete-project', card).addEventListener('click', () => deleteProject(project));
    list.append(card);
  });
}

function renderDashboard(data) {
  dashboardData = data;
  fillForm($('#profile-form'), data.profile);
  renderUploads(data.uploads || []);
  renderProjects(data.projects || []);
}

async function loadDashboard() {
  const data = await api('/api/admin/dashboard');
  $('#login-panel').hidden = true;
  $('#dashboard').hidden = false;
  renderDashboard(data);
}

async function editProject(project) {
  const form = $('#project-form');
  fillForm(form, { ...project, tags: (project.tags || []).join(', ') });
  form.querySelector('button').textContent = 'Save project →';
  form.dataset.editingId = project.id;
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function deleteProject(project) {
  if (!window.confirm(`Delete “${project.title}”? This cannot be undone.`)) return;
  try {
    await api(`/api/admin/projects/${project.id}`, { method: 'DELETE' });
    await loadDashboard();
    showNotice('Project deleted.', 'success');
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('#login-message');
  message.textContent = 'Signing in…';
  try {
    await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: new FormData(event.currentTarget).get('password') }) });
    await loadDashboard();
  } catch (error) {
    message.textContent = error.message;
  }
});

$('#logout-button').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  $('#dashboard').hidden = true;
  $('#login-panel').hidden = false;
  $('#login-form').reset();
});

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const result = await api('/api/admin/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    dashboardData.profile = result.profile;
    showNotice('Profile saved. Your public site is updated.', 'success');
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

$('#upload-form input[type="file"]').addEventListener('change', (event) => {
  $('#selected-file').textContent = event.target.files[0]?.name || 'No file selected';
});

$('#upload-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/admin/upload', { method: 'POST', body: new FormData(event.currentTarget) });
    dashboardData.profile = result.profile;
    event.currentTarget.reset();
    $('#selected-file').textContent = 'No file selected';
    await loadDashboard();
    showNotice(`Uploaded ${result.upload.name}. ${result.upload.url}`, 'success');
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.featured = form.elements.featured.checked;
  const editingId = form.dataset.editingId;
  try {
    await api(editingId ? `/api/admin/projects/${editingId}` : '/api/admin/projects', { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    form.reset();
    delete form.dataset.editingId;
    form.querySelector('button').textContent = 'Add project +';
    await loadDashboard();
    showNotice(editingId ? 'Project updated.' : 'Project added.', 'success');
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

loadDashboard().catch(() => {});

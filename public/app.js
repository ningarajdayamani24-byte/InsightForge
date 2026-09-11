const $ = (selector, scope = document) => scope.querySelector(selector);

function setText(selector, value) {
  if (value) $(selector).textContent = value;
}

function validHref(value) {
  return typeof value === 'string' && value.length > 0;
}

function renderProjects(projects) {
  const grid = $('#project-grid');
  const template = $('#project-template');
  grid.innerHTML = '';
  if (!projects.length) {
    grid.innerHTML = '<p class="empty-state">Selected projects will be added soon.</p>';
    return;
  }
  projects.forEach((project, index) => {
    const fragment = template.content.cloneNode(true);
    $('.project-number', fragment).textContent = String(index + 1).padStart(2, '0');
    $('.project-title', fragment).textContent = project.title;
    $('.project-description', fragment).textContent = project.description;
    const visual = $('.project-visual', fragment);
    const placeholder = $('.image-placeholder', fragment);
    if (validHref(project.imageUrl)) {
      visual.style.backgroundImage = `linear-gradient(180deg, rgba(11,16,14,.05), rgba(11,16,14,.38)), url("${project.imageUrl}")`;
      visual.classList.add('has-image');
      placeholder.remove();
    }
    (project.tags || []).forEach((tag) => {
      const item = document.createElement('span');
      item.textContent = tag;
      $('.tags', fragment).append(item);
    });
    if (validHref(project.link)) {
      const link = $('.project-link', fragment);
      link.href = project.link;
      link.hidden = false;
    }
    grid.append(fragment);
  });
}

function addSocialLink(container, label, url) {
  if (!validHref(url)) return;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = `${label} ↗`;
  container.append(link);
}

async function loadPortfolio() {
  try {
    const response = await fetch('/api/public');
    if (!response.ok) throw new Error('Unable to load portfolio');
    const { profile, projects } = await response.json();
    document.title = `${profile.name || 'InsightForge'} — Portfolio`;
    setText('#location', profile.location);
    setText('#role', profile.role);
    setText('#tagline', profile.tagline);
    setText('#summary', profile.summary);
    setText('#footer-name', profile.name || 'InsightForge');
    const email = $('#email');
    if (profile.email) {
      email.href = `mailto:${profile.email}`;
      email.firstChild.textContent = `${profile.email} `;
    }
    if (validHref(profile.avatarUrl)) {
      const avatar = $('#avatar');
      avatar.style.backgroundImage = `url("${profile.avatarUrl}")`;
      avatar.classList.add('has-avatar');
      avatar.textContent = '';
    } else if (profile.name) {
      $('#avatar').textContent = profile.name.split(/\s+/).map((name) => name[0]).slice(0, 2).join('').toUpperCase();
    }
    if (validHref(profile.resumeUrl)) {
      const resume = $('.resume-link');
      resume.href = profile.resumeUrl;
      resume.hidden = false;
    }
    const socials = $('#social-links');
    addSocialLink(socials, 'LinkedIn', profile.linkedin);
    addSocialLink(socials, 'GitHub', profile.github);
    addSocialLink(socials, 'Website', profile.website);
    renderProjects(projects || []);
  } catch {
    $('#project-grid').innerHTML = '<p class="empty-state">The portfolio is being updated. Please check back shortly.</p>';
  }
}

$('#year').textContent = new Date().getFullYear();
loadPortfolio();

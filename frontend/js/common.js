/**
 * Shared helpers used by every page.
 * Paths are relative, so the app works no matter which folder it's installed
 * under — only the position of frontend/html/*.html relative to backend/api
 * matters (../../backend/api from here).
 */
const API_BASE = '../../backend/api';

/**
 * Call a backend JSON API endpoint.
 * `body`, if given as an object, is auto-serialized to JSON.
 */
async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const opts = {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: controller.signal,
    ...options,
  };
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
  }
  let res, data;
  try {
    res = await fetch(`${API_BASE}/${path}`, opts);
  } catch (e) {
    return { ok: false, status: 0, data: { message: e.name === 'AbortError' ? 'The server did not respond. Make sure Apache and MySQL are running.' : 'Network error — is the PHP server running?' } };
  }
  clearTimeout(timeout);
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function avatarUrl(name, photoPath) {
  return photoPath || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`;
}

/**
 * Check the session and enforce access rules for the current page.
 * Redirects to index.html if not logged in, or to portal.html if an
 * admin-only page is hit by a non-admin. Returns the user object.
 */
async function requireAuth({ adminOnly = false, lecturerOnly = false } = {}) {
  const { ok, data } = await apiFetch('auth/session.php');
  if (!ok || !data || !data.authenticated) {
    window.location.href = 'index.html';
    return null;
  }
  if (adminOnly && data.user.role !== 'admin') {
    window.location.href = 'portal.html';
    return null;
  }
  if (lecturerOnly && !['employee', 'admin'].includes(data.user.role)) {
    window.location.href = 'portal.html';
    return null;
  }
  return data.user;
}

/** Render the shared top navbar into #navbar. `active` is 'checkin' | 'portal' | 'admin' | 'lecturer'. */
function renderNavbar(user, active) {
  const el = document.getElementById('navbar');
  if (!el) return;

  el.innerHTML = `
    <div class="navbar">
      <div class="nav-left">
        <div class="nav-logo"><i class="fa-solid fa-shield-halved"></i></div>
        <div class="nav-title">
          <b>OmniAuth Attendance <span class="badge-version">v3.4 Multi-Factor</span></b>
          <span>QR &bull; Face &bull; GPS &bull; Biometric System</span>
        </div>
      </div>
      <div class="nav-links">
        <a class="nav-link ${active === 'checkin' ? 'active' : ''}" href="checkin.html">
          <i class="fa-solid fa-table-cells-large"></i> Live Check-in
        </a>
        <a class="nav-link ${active === 'portal' ? 'active' : ''}" href="portal.html">
          <i class="fa-solid fa-user"></i> My Portal &amp; Logs
        </a>
        ${user.role === 'employee' ? `
        <a class="nav-link ${active === 'lecturer' ? 'active' : ''}" href="lecturer-dashboard.html">
          <i class="fa-solid fa-chalkboard-user"></i> Lecturer Dashboard
        </a>` : ''}
        ${user.role === 'admin' ? `
        <a class="nav-link ${active === 'admin' ? 'active' : ''}" href="admin-dashboard.html">
          <i class="fa-solid fa-shield-halved"></i> Admin Dashboard
        </a>` : ''}
      </div>
      <div class="nav-user">
        <img src="${escapeHtml(avatarUrl(user.full_name, user.photo_path))}" alt="">
        <div>
          <div class="name">${escapeHtml(user.full_name)}</div>
          <div class="role">${escapeHtml(user.role.charAt(0).toUpperCase() + user.role.slice(1))} &bull; ${escapeHtml(user.user_code)}</div>
        </div>
        <a href="#" id="logoutLink" title="Log out" style="color:var(--text-dim);font-size:14px;">
          <i class="fa-solid fa-power-off"></i>
        </a>
      </div>
    </div>`;

  document.getElementById('logoutLink').addEventListener('click', async (e) => {
    e.preventDefault();
    await apiFetch('auth/logout.php', { method: 'POST' });
    window.location.href = 'index.html';
  });
}

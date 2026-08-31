let latestData = null;

(async function init() {
  const user = await requireAuth({ adminOnly: true });
  if (!user) return;
  renderNavbar(user, 'admin');

  wireTabs();
  wireSearch();
  wireModals();
  wireForms();

  await loadDashboard();
})();

function wireTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });
}

function wireSearch() {
  const logSearch = document.getElementById('logSearch');
  logSearch.addEventListener('input', () => {
    const q = logSearch.value.trim().toLowerCase();
    document.querySelectorAll('#logsTable tbody tr').forEach((row) => {
      const haystack = row.dataset.search || '';
      row.style.display = haystack.includes(q) ? '' : 'none';
    });
  });
}

function wireModals() {
  document.getElementById('openEnrollModalBtn').addEventListener('click', () => {
    document.getElementById('enrollModal').style.display = 'flex';
  });
  document.getElementById('cancelEnrollBtn').addEventListener('click', () => {
    document.getElementById('enrollModal').style.display = 'none';
  });
  document.getElementById('closeAdminQrBtn').addEventListener('click', () => {
    document.getElementById('adminQrModal').style.display = 'none';
  });

  // Recalibrate a geofence's exact GPS from the admin's current device location —
  // use this while physically standing at the check-in point on campus.
  document.getElementById('useMyGpsBtn').addEventListener('click', () => {
    const statusEl = document.getElementById('gpsCaptureStatus');
    if (!navigator.geolocation) {
      statusEl.textContent = 'Geolocation not supported by this browser.';
      return;
    }
    statusEl.textContent = 'Requesting your current location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById('geoLat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('geoLng').value = pos.coords.longitude.toFixed(6);
        statusEl.textContent = `Captured (±${Math.round(pos.coords.accuracy)}m accuracy). Adjust the radius above if needed.`;
      },
      () => { statusEl.textContent = 'Location permission denied.'; },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  document.getElementById('useSessionGpsBtn').addEventListener('click', () => {
    const statusEl = document.getElementById('sessionGpsStatus');
    if (!navigator.geolocation) {
      statusEl.textContent = 'Geolocation not supported by this browser.';
      return;
    }
    statusEl.textContent = 'Requesting your current location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById('sessionLat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('sessionLng').value = pos.coords.longitude.toFixed(6);
        statusEl.textContent = `Location picked (±${Math.round(pos.coords.accuracy)}m accuracy).`;
      },
      () => { statusEl.textContent = 'Location permission denied.'; },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

function wireForms() {
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const { ok, data } = await apiFetch('admin/actions.php', {
      method: 'POST',
      body: {
        action: 'update_settings',
        require_mfa: form.require_mfa.checked,
        grace_period_minutes: form.grace_period_minutes.value,
      },
    });
    if (ok && data && data.success) await loadDashboard();
  });

  document.getElementById('geofenceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const { ok, data } = await apiFetch('admin/actions.php', {
      method: 'POST',
      body: {
        action: 'add_geofence',
        name: form.name.value.trim(),
        address: form.address.value.trim(),
        latitude: form.latitude.value,
        longitude: form.longitude.value,
        radius_m: form.radius_m.value,
      },
    });
    if (ok && data && data.success) {
      form.reset();
      form.radius_m.value = 5;
      document.getElementById('gpsCaptureStatus').textContent = '';
      await loadDashboard();
    }
  });

  document.getElementById('enrollForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const { ok, data } = await apiFetch('admin/actions.php', {
      method: 'POST',
      body: {
        action: 'enroll_user',
        full_name: form.full_name.value.trim(),
        email: form.email.value.trim(),
        role: form.role.value,
        level: form.level.value,
        department: form.department.value.trim(),
        password: form.password.value,
      },
    });
    if (ok && data && data.success) {
      document.getElementById('enrollModal').style.display = 'none';
      form.reset();
      if (data.password) {
        window.alert(`Account created. Temporary password: ${data.password}`);
      }
      await loadDashboard();
    }
  });
}

async function reviewLeave(leaveId, decision) {
  const { ok, data } = await apiFetch('admin/actions.php', {
    method: 'POST',
    body: { action: 'review_leave', leave_id: leaveId, decision },
  });
  if (ok && data && data.success) await loadDashboard();
}

async function loadDashboard() {
  const { ok, data } = await apiFetch('admin/dashboard-data.php');
  if (!ok || !data) return;
  latestData = data;
  renderStats(data.stats);
  renderLogsTab(data.logs);
  renderUsersTab(data.users);
  renderAttendanceTab(data.sessions || []);
  renderGeofencesTab(data.geofences, data.settings);
  renderLeaveTab(data.leaves);
  document.querySelector('.tab[data-tab="users"]').innerHTML =
    `<i class="fa-solid fa-users"></i> User Directory (${data.users.length})`;
  document.querySelector('.tab[data-tab="leave"]').innerHTML =
    `<i class="fa-solid fa-calendar-days"></i> Leave Requests (${data.pending_leave_count} Pending)`;
  document.querySelectorAll('.adminQrBtn').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('adminQrModal').style.display = 'flex';
      document.getElementById('adminQrTitle').textContent = `${button.dataset.name} — ${button.dataset.code}`;
      const qr = document.getElementById('adminQrCanvas');
      qr.innerHTML = '';
      new QRCode(qr, { text: button.dataset.secret, width: 220, height: 220, colorDark: '#0b0f0e', colorLight: '#ffffff' });
    });
  });
}

function renderAttendanceTab(sessions) {
  const list = document.getElementById('attendanceSessionList');
  if (!sessions.length) {
    list.innerHTML = '<p style="color:var(--text-dim);">No course attendance sessions created yet.</p>';
    return;
  }
  list.innerHTML = sessions.map((session) => {
    const open = Number(session.is_active) === 1 && new Date(session.ends_at.replace(' ', 'T')) >= new Date();
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:start;">
        <div><b>${escapeHtml(session.course_code)} — ${escapeHtml(session.course_name)}</b><br>
        <span style="font-size:12px;color:var(--text-dim);">${escapeHtml(session.starts_at)} to ${escapeHtml(session.ends_at)}</span><br>
        <span style="font-size:11px;color:var(--text-faint);">GPS: ${escapeHtml(session.latitude)}, ${escapeHtml(session.longitude)} · Radius: ${escapeHtml(session.radius_m)}m · ${escapeHtml(session.attendance_count)} marked</span></div>
        ${open ? `<button class="btn btn-danger" onclick="closeAttendanceSession(${session.id})"><i class="fa-solid fa-stop"></i> Close</button>` : '<span class="badge badge-gray">CLOSED</span>'}
      </div>
    </div>`;
  }).join('');
}

async function closeAttendanceSession(sessionId) {
  const { ok, data } = await apiFetch('admin/actions.php', {
    method: 'POST',
    body: { action: 'close_attendance_session', session_id: sessionId },
  });
  if (ok && data && data.success) await loadDashboard();
}

function renderStats(stats) {
  document.getElementById('statTotalUsers').textContent = `${stats.total_users} Users`;
  document.getElementById('statOnTime').textContent = stats.on_time_count;
  document.getElementById('statOnTimeRate').textContent = `${stats.target_rate}% Target Rate`;
  document.getElementById('statLate').textContent = stats.late_count;
  document.getElementById('statViolations').textContent = stats.violation_count;
}

function renderLogsTab(logs) {
  const tbody = document.querySelector('#logsTable tbody');
  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-dim);">No attendance logs recorded yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = logs.map((log) => {
    const d = new Date(log.check_in_time.replace(' ', 'T'));
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    const dateStr = d.toLocaleDateString('en-US');
    const search = `${log.full_name} ${log.user_code} ${log.department || ''}`.toLowerCase();
    return `
      <tr data-search="${escapeHtml(search)}">
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <img src="${escapeHtml(avatarUrl(log.full_name, log.photo_path))}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
            <div><b>${escapeHtml(log.full_name)}</b><br><span style="color:var(--text-faint);font-size:11px;">${escapeHtml(log.user_code)}</span></div>
          </div>
        </td>
        <td>${escapeHtml(log.role.charAt(0).toUpperCase() + log.role.slice(1))}<br><span style="color:var(--text-faint);font-size:11px;">${escapeHtml(log.department || '—')}</span></td>
        <td>${escapeHtml(timeStr)}<br><span style="color:var(--text-faint);font-size:11px;">${escapeHtml(dateStr)}</span></td>
        <td><span class="badge ${log.badge_class}">${escapeHtml(log.status_label)}</span></td>
        <td>${escapeHtml(log.methods_used.replace(/,/g, ' + '))}</td>
        <td style="color:${log.status === 'geofence_violation' ? 'var(--red)' : 'var(--green)'};">${log.gps_distance_m !== null ? `${log.gps_distance_m}m` : 'N/A'}</td>
        <td>${log.face_match_pct !== null ? `${log.face_match_pct}%` : 'N/A'}</td>
      </tr>`;
  }).join('');
}

function renderUsersTab(users) {
  const grid = document.getElementById('usersGrid');
  grid.innerHTML = users.map((u) => `
    <div class="stat-card" style="align-items:center;">
      <div style="display:flex;gap:12px;align-items:center;">
        <img src="${escapeHtml(avatarUrl(u.full_name, u.photo_path))}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">
        <div>
          <b>${escapeHtml(u.full_name)}</b><br>
          <span style="color:var(--text-dim);font-size:12px;">${escapeHtml(u.role.charAt(0).toUpperCase() + u.role.slice(1))} &bull; ${escapeHtml(u.department || '—')}</span><br>
          <span style="color:var(--text-faint);font-size:11px;">${escapeHtml(u.user_code)}</span><br>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-outline adminQrBtn" data-name="${escapeHtml(u.full_name)}" data-code="${escapeHtml(u.user_code)}" data-secret="${escapeHtml(u.qr_secret)}"><i class="fa-solid fa-qrcode"></i> Show QR</button>
            ${u.face_enrolled ? '<span class="badge" style="background:#241a3d;color:#a78bfa;"><i class="fa-solid fa-face-smile"></i> Face Enrolled</span>' : ''}
          </div>
        </div>
      </div>
    </div>`).join('');
}

function renderGeofencesTab(geofences, settings) {
  document.getElementById('requireMfaInput').checked = settings.require_mfa === '1';
  document.getElementById('graceMinutesInput').value = settings.grace_period_minutes;

  const list = document.getElementById('geofenceList');
  list.innerHTML = geofences.map((g) => `
    <div style="display:flex;justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
      <div>
        <b>${escapeHtml(g.name)}</b><br>
        <span style="font-size:12px;color:var(--text-dim);">${escapeHtml(g.address)}</span><br>
        <span style="font-size:11px;color:var(--text-faint);">GPS: ${escapeHtml(g.latitude)}, ${escapeHtml(g.longitude)}</span>
      </div>
      <div style="color:var(--green);font-weight:700;font-size:13px;">Radius: ${escapeHtml(g.radius_m)}m</div>
    </div>`).join('');
}

function renderLeaveTab(leaves) {
  const wrap = document.getElementById('leaveList');
  if (!leaves.length) {
    wrap.innerHTML = `<p style="color:var(--text-dim);">No absence requests submitted.</p>`;
    return;
  }
  wrap.innerHTML = leaves.map((lv) => {
    let actions = '<span class="badge badge-green">APPROVED</span>';
    if (lv.status === 'rejected') actions = '<span class="badge badge-red">REJECTED</span>';
    if (lv.status === 'pending') {
      actions = `
        <button class="btn btn-primary" onclick="reviewLeave(${lv.id}, 'approved')"><i class="fa-solid fa-check"></i> Approve</button>
        <button class="btn btn-danger" onclick="reviewLeave(${lv.id}, 'rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>`;
    }
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);padding:14px 0;flex-wrap:wrap;gap:10px;">
        <div>
          <b>${escapeHtml(lv.full_name)}</b>
          <span class="badge badge-gray" style="text-transform:capitalize;">${escapeHtml(lv.leave_type)} Leave</span>
          <div style="color:var(--text-dim);font-size:13px;margin-top:4px;">${escapeHtml(lv.reason)}</div>
          <div style="color:var(--text-faint);font-size:11.5px;margin-top:2px;">Dates: ${escapeHtml(lv.start_date)} to ${escapeHtml(lv.end_date)}</div>
        </div>
        <div>${actions}</div>
      </div>`;
  }).join('');
}

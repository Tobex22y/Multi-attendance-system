(async function init() {
  const user = await requireAuth({ lecturerOnly: true });
  if (!user) return;
  renderNavbar(user, 'lecturer');
  wireGps();
  wireForm();
  await loadDashboard();
})();

function wireGps() {
  const btn = document.getElementById('useSessionGpsBtn');
  btn.addEventListener('click', () => {
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

function wireForm() {
  document.getElementById('attendanceSessionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const { ok, data } = await apiFetch('lecturer/actions.php', {
      method: 'POST',
      body: {
        action: 'create_attendance_session',
        course_code: form.course_code.value.trim(),
        course_name: form.course_name.value.trim(),
        starts_at: form.starts_at.value,
        ends_at: form.ends_at.value,
        latitude: form.latitude.value,
        longitude: form.longitude.value,
        radius_m: form.radius_m.value,
      },
    });

    if (ok && data && data.success) {
      form.reset();
      form.radius_m.value = 100;
      document.getElementById('sessionGpsStatus').textContent = '';
      await loadDashboard();
      return;
    }

    alert((data && data.message) || 'Unable to create attendance session.');
  });
}

async function loadDashboard() {
  const { ok, data } = await apiFetch('lecturer/dashboard-data.php');
  if (!ok || !data) return;

  const sessions = data.sessions || [];
  const logs = data.logs || [];
  const active = sessions.filter((session) => Number(session.is_active) === 1 && new Date(session.ends_at.replace(' ', 'T')) >= new Date()).length;
  document.getElementById('statSessions').textContent = sessions.length;
  document.getElementById('statMarked').textContent = sessions.reduce((sum, session) => sum + Number(session.attendance_count || 0), 0);
  document.getElementById('statActive').textContent = active;

  const list = document.getElementById('attendanceSessionList');
  if (!sessions.length) {
    list.innerHTML = '<p style="color:var(--text-dim);">No course attendance sessions created yet.</p>';
  } else {
    list.innerHTML = sessions.map((session) => {
      const open = Number(session.is_active) === 1 && new Date(session.ends_at.replace(' ', 'T')) >= new Date();
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:start;">
          <div><b>${escapeHtml(session.course_code)} — ${escapeHtml(session.course_name)}</b><br>
          <span style="font-size:12px;color:var(--text-dim);">${escapeHtml(session.starts_at)} to ${escapeHtml(session.ends_at)}</span><br>
          <span style="font-size:11px;color:var(--text-faint);">GPS: ${escapeHtml(session.latitude)}, ${escapeHtml(session.longitude)} · Radius: ${escapeHtml(session.radius_m)}m · ${escapeHtml(session.attendance_count)} marked</span></div>
          ${open ? '<button class="btn btn-danger" onclick="closeAttendanceSession(' + session.id + ')"><i class="fa-solid fa-stop"></i> Close</button>' : '<span class="badge badge-gray">CLOSED</span>'}
        </div>
      </div>`;
    }).join('');
  }

  const logsBody = document.getElementById('logsBody');
  if (!logs.length) {
    logsBody.innerHTML = '<tr><td colspan="5" style="color:var(--text-dim);">No attendance logs recorded yet.</td></tr>';
  } else {
    logsBody.innerHTML = logs.map((log) => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <img src="${escapeHtml(avatarUrl(log.full_name, log.photo_path))}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
            <div><b>${escapeHtml(log.full_name)}</b><br><span style="color:var(--text-faint);font-size:11px;">${escapeHtml(log.user_code)}</span></div>
          </div>
        </td>
        <td>${escapeHtml(log.course_code ? `${log.course_code} — ${log.course_name}` : 'General check-in')}</td>
        <td>${escapeHtml(new Date(log.check_in_time.replace(' ', 'T')).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }))}</td>
        <td><span class="badge ${log.badge_class}">${escapeHtml(log.status_label)}</span></td>
        <td>${escapeHtml(log.methods_used.replace(/,/g, ' + '))}</td>
      </tr>
    `).join('');
  }
}

async function closeAttendanceSession(sessionId) {
  const { ok, data } = await apiFetch('lecturer/actions.php', {
    method: 'POST',
    body: { action: 'close_attendance_session', session_id: sessionId },
  });
  if (ok && data && data.success) await loadDashboard();
}

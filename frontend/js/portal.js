(async function init() {
  const user = await requireAuth();
  if (!user) return;
  renderNavbar(user, 'portal');
  await loadPortal();

  document.getElementById('showLeaveBtn').addEventListener('click', () => {
    document.getElementById('leaveModal').style.display = 'flex';
  });
  document.getElementById('cancelLeaveBtn').addEventListener('click', () => {
    document.getElementById('leaveModal').style.display = 'none';
  });

  document.getElementById('leaveForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errorBox = document.getElementById('leaveErrorBox');
    errorBox.style.display = 'none';

    const payload = {
      leave_type: form.leave_type.value,
      reason: form.reason.value.trim(),
      start_date: form.start_date.value,
      end_date: form.end_date.value,
    };

    const { ok, data } = await apiFetch('portal/leave.php', { method: 'POST', body: payload });

    if (ok && data && data.success) {
      document.getElementById('leaveModal').style.display = 'none';
      form.reset();
      showSuccessBanner('Your absence request has been submitted for review.');
      await loadPortal();
    } else {
      errorBox.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml((data && data.message) || 'Could not submit request.')}`;
      errorBox.style.display = 'block';
    }
  });
})();

function showSuccessBanner(message) {
  const box = document.getElementById('successBox');
  box.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(message)}`;
  box.style.display = 'block';
  setTimeout(() => { box.style.display = 'none'; }, 6000);
}

async function loadPortal() {
  const { ok, data } = await apiFetch('portal/data.php');
  if (!ok || !data) return;

  const { user, stats, logs, leaves, sessions = [] } = data;

  document.getElementById('profilePhoto').src = avatarUrl(user.full_name, user.photo_path);
  document.getElementById('profileNameText').textContent = user.full_name;
  document.getElementById('profileRole').textContent = user.role.toUpperCase();
  document.getElementById('profileDept').textContent = user.department || '—';
  document.getElementById('profileCode').textContent = user.user_code;
  document.getElementById('profileShift').textContent =
    `${user.shift_start.slice(0, 5)} - ${user.shift_end.slice(0, 5)}`;

  document.getElementById('punctualityValue').textContent = `${stats.punctuality}%`;
  document.getElementById('onTimeSub').textContent = `${stats.on_time} On-time check-ins`;
  document.getElementById('lateValue').textContent = stats.late;
  document.getElementById('totalValue').textContent = stats.total;

  const sessionsEl = document.getElementById('attendanceSessions');
  sessionsEl.innerHTML = sessions.length ? sessions.map((session) => `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);padding:12px 0;gap:12px;flex-wrap:wrap;">
      <div><b>${escapeHtml(session.course_code)} — ${escapeHtml(session.course_name)}</b><br>
        <span style="font-size:12px;color:var(--text-dim);">${escapeHtml(session.starts_at)} to ${escapeHtml(session.ends_at)}</span><br>
        <span style="font-size:11px;color:var(--text-faint);">Attendance location radius: ${escapeHtml(session.radius_m)}m</span>
      </div>
      ${Number(session.already_marked) ? '<span class="badge badge-green">MARKED</span>' : `<a class="btn btn-primary" href="checkin.html?session_id=${encodeURIComponent(session.id)}"><i class="fa-solid fa-location-dot"></i> Mark Attendance</a>`}
    </div>`).join('') : '<p style="color:var(--text-dim);">No course attendance is open right now.</p>';

  const logsBody = document.getElementById('logsBody');
  if (!logs.length) {
    logsBody.innerHTML = `<tr><td colspan="6" style="color:var(--text-dim);">No attendance logs yet — mark an open course attendance above.</td></tr>`;
  } else {
    logsBody.innerHTML = logs.map((log) => `
      <tr>
        <td>${log.course_code ? `${escapeHtml(log.course_code)} — ${escapeHtml(log.course_name)}` : 'General check-in'}</td>
        <td>${escapeHtml(formatDateTime(log.check_in_time))}</td>
        <td><span class="badge ${log.badge_class}">${escapeHtml(log.status_label)}</span></td>
        <td style="color:var(--green);font-weight:600;">${escapeHtml(log.methods_used.replace(/,/g, ' + '))}</td>
        <td>${log.gps_distance_m !== null ? `${log.gps_distance_m}m (${log.status === 'geofence_violation' ? 'Invalid' : 'Valid'})` : 'N/A'}</td>
        <td>${log.face_match_pct !== null ? `${log.face_match_pct}%` : 'N/A'}</td>
      </tr>`).join('');
  }

  const leavesBody = document.getElementById('leavesBody');
  if (!leaves.length) {
    leavesBody.innerHTML = `<tr><td colspan="4" style="color:var(--text-dim);">No absence requests submitted.</td></tr>`;
  } else {
    leavesBody.innerHTML = leaves.map((lv) => {
      let badge = '<span class="badge badge-amber">PENDING</span>';
      if (lv.status === 'approved') badge = '<span class="badge badge-green">APPROVED</span>';
      if (lv.status === 'rejected') badge = '<span class="badge badge-red">REJECTED</span>';
      return `
        <tr>
          <td style="text-transform:capitalize;">${escapeHtml(lv.leave_type)}</td>
          <td>${escapeHtml(lv.reason)}</td>
          <td>${escapeHtml(lv.start_date)} to ${escapeHtml(lv.end_date)}</td>
          <td>${badge}</td>
        </tr>`;
    }).join('');
  }
}

function formatDateTime(sqlDateTime) {
  const d = new Date(sqlDateTime.replace(' ', 'T'));
  return d.toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

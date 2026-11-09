(async function init() {
  const user = await requireAuth({ lecturerOnly: true });
  if (!user) return;
  renderNavbar(user, 'lecturer');
  wireGps();
  wireForm();
  wireFilters();
  await loadDashboard();
})();

// Dashboard state
let allSessions = [];
let allLogs = [];
let showAllCourses = false;
let showAllLogs = false;
const expandedCourseSessions = new Set(); // Stores courseKeys that have "Show more" toggled
const collapsedCourseCards = new Set();   // Stores courseKeys that are collapsed
let currentCourseFilter = '';
let currentStatusFilter = 'all'; // 'all' | 'open' | 'closed'
const DEFAULT_COURSES_VISIBLE = 3;
const DEFAULT_SESSIONS_PER_COURSE = 2;
const DEFAULT_LOGS_VISIBLE = 10;

function wireGps() {
  const btn = document.getElementById('useSessionGpsBtn');
  if (!btn) return;
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
  const form = document.getElementById('attendanceSessionForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
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

function wireFilters() {
  const filterInput = document.getElementById('courseFilterInput');
  const statusSelect = document.getElementById('statusFilterSelect');
  const expandAllBtn = document.getElementById('toggleAllCoursesExpandBtn');

  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      currentCourseFilter = e.target.value.trim();
      renderSessionList();
      updateExpandAllBtnText();
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      currentStatusFilter = e.target.value;
      renderSessionList();
      updateExpandAllBtnText();
    });
  }

  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', () => {
      toggleAllGroupsCollapse();
    });
  }
}

async function loadDashboard() {
  const { ok, data } = await apiFetch('lecturer/dashboard-data.php');
  if (!ok || !data) return;

  allSessions = data.sessions || [];
  allLogs = data.logs || [];

  const active = allSessions.filter(isSessionOpen).length;
  document.getElementById('statSessions').textContent = allSessions.length;
  document.getElementById('statMarked').textContent = allSessions.reduce((sum, s) => sum + Number(s.attendance_count || 0), 0);
  document.getElementById('statActive').textContent = active;

<<<<<<< HEAD
  renderSessionList();
  renderLogs(allLogs);
  updateExpandAllBtnText();
}

function isSessionOpen(session) {
  return Number(session.is_active) === 1 && new Date(session.ends_at.replace(' ', 'T')) >= new Date();
}

function formatDateTime(str) {
  if (!str) return '';
  const d = new Date(str.replace(' ', 'T'));
  if (isNaN(d.getTime())) return str;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Group sessions by Course Code, sort courses alphabetically (A to Z),
 * and sort sessions inside each course (Open sessions first, then by date descending).
 */
function groupAndSortSessions(sessions, filterText = '', statusFilter = 'all') {
  const normalizedFilter = filterText.toLowerCase();

  // Filter sessions by status
  let filtered = sessions;
  if (statusFilter === 'open') {
    filtered = filtered.filter(isSessionOpen);
  } else if (statusFilter === 'closed') {
    filtered = filtered.filter((s) => !isSessionOpen(s));
=======
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
          ${open ? `
            <div class="session-actions">

                <button
                    type="button"
                    class="btn btn-danger"
                    onclick="closeAttendanceSession(${session.id})"
                >
                    <i class="fa-solid fa-stop"></i>
                    Close
                </button>

                <button
                    type="button"
                    class="btn btn-qr"
                    onclick="generateAttendanceQR(${session.id})"
                >
                    <i class="fa-solid fa-qrcode"></i>
                    QR
                </button>

            </div>
        ` : `
            <span class="badge badge-gray">CLOSED</span>
        `}

        </div>
      </div>`;
    }).join('');
    
>>>>>>> 238382013a627addc001ce8e96ed013e91b7dc3a
  }

  // Filter sessions by course code or name
  if (normalizedFilter) {
    filtered = filtered.filter((s) => {
      const code = (s.course_code || '').toLowerCase();
      const name = (s.course_name || '').toLowerCase();
      return code.includes(normalizedFilter) || name.includes(normalizedFilter);
    });
  }

  // Group by normalized course code
  const groupsMap = new Map();
  for (const session of filtered) {
    const rawCode = (session.course_code || 'General').trim();
    const rawName = (session.course_name || '').trim();
    const courseKey = rawCode.toUpperCase();

    if (!groupsMap.has(courseKey)) {
      groupsMap.set(courseKey, {
        courseKey,
        courseCode: rawCode,
        courseName: rawName,
        sessions: [],
      });
    } else {
      const g = groupsMap.get(courseKey);
      if (!g.courseName && rawName) {
        g.courseName = rawName;
      }
    }
    groupsMap.get(courseKey).sessions.push(session);
  }

  // Sort course groups ALPHABETICALLY (A to Z) by course code, then course name
  const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => {
    const codeCmp = a.courseCode.localeCompare(b.courseCode, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (codeCmp !== 0) return codeCmp;
    return a.courseName.localeCompare(b.courseName, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  // Sort sessions within each course:
  // Open sessions first, then most recent starts_at DESC
  for (const group of sortedGroups) {
    group.sessions.sort((a, b) => {
      const aOpen = isSessionOpen(a);
      const bOpen = isSessionOpen(b);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      return new Date(b.starts_at.replace(' ', 'T')) - new Date(a.starts_at.replace(' ', 'T'));
    });
  }

  return sortedGroups;
}

function renderSessionList() {
  const list = document.getElementById('attendanceSessionList');
  if (!list) return;

  const groups = groupAndSortSessions(allSessions, currentCourseFilter, currentStatusFilter);

  if (!groups.length) {
    if (allSessions.length === 0) {
      list.innerHTML = '<p style="color:var(--text-dim);padding:14px 0;margin:0;">No course attendance sessions created yet.</p>';
    } else {
      list.innerHTML = '<p style="color:var(--text-dim);padding:14px 0;margin:0;"><i class="fa-solid fa-magnifying-glass"></i> No attendance sessions match your search/filter.</p>';
    }
    return;
  }

  const totalCourses = groups.length;
  // If user is searching or filtering, show all matching courses; otherwise respect showAllCourses
  const isFiltering = Boolean(currentCourseFilter || currentStatusFilter !== 'all');
  const visibleGroups = (showAllCourses || isFiltering)
    ? groups
    : groups.slice(0, DEFAULT_COURSES_VISIBLE);

  const html = visibleGroups.map((group) => {
    const openCount = group.sessions.filter(isSessionOpen).length;
    const totalSessions = group.sessions.length;
    const isCollapsed = collapsedCourseCards.has(group.courseKey);
    const isExpandedSessions = expandedCourseSessions.has(group.courseKey);

    // Limit sessions per course unless expanded or total <= default
    const visibleSessions = (isExpandedSessions || totalSessions <= DEFAULT_SESSIONS_PER_COURSE)
      ? group.sessions
      : group.sessions.slice(0, DEFAULT_SESSIONS_PER_COURSE);

    const hasMoreSessions = totalSessions > DEFAULT_SESSIONS_PER_COURSE;
    const hiddenSessionsCount = totalSessions - DEFAULT_SESSIONS_PER_COURSE;

    return `
      <div class="course-group-card" data-course="${escapeHtml(group.courseKey)}">
        <div class="course-group-header" onclick="toggleCourseCardCollapse('${escapeHtml(group.courseKey)}')">
          <div class="course-group-title">
            <div class="course-icon-badge"><i class="fa-solid fa-graduation-cap"></i></div>
            <div style="min-width:0;">
              <span class="course-code-text">${escapeHtml(group.courseCode)}</span>
              ${group.courseName ? `<span class="course-name-text"> &mdash; ${escapeHtml(group.courseName)}</span>` : ''}
            </div>
          </div>
          <div class="course-group-meta">
            ${openCount > 0 ? `<span class="badge badge-green"><i class="fa-solid fa-circle-dot"></i> ${openCount} Open</span>` : ''}
            <span class="badge badge-gray">${totalSessions} Session${totalSessions === 1 ? '' : 's'}</span>
            <i class="fa-solid fa-chevron-${isCollapsed ? 'down' : 'up'}" style="color:var(--text-faint);font-size:12px;margin-left:4px;"></i>
          </div>
        </div>

        <div class="course-group-body ${isCollapsed ? 'collapsed' : ''}">
          ${visibleSessions.map(renderSingleSessionItem).join('')}

          ${hasMoreSessions ? `
            <button type="button" class="show-more-btn" onclick="toggleCourseSessionsExpand('${escapeHtml(group.courseKey)}', event)">
              <i class="fa-solid fa-chevron-${isExpandedSessions ? 'up' : 'down'}"></i>
              ${isExpandedSessions ? 'Show less sessions' : `Show more (${hiddenSessionsCount} more session${hiddenSessionsCount === 1 ? '' : 's'})`}
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Course-level Show More / Show Less button
  let showMoreCoursesButton = '';
  if (!isFiltering && totalCourses > DEFAULT_COURSES_VISIBLE) {
    const hiddenCoursesCount = totalCourses - DEFAULT_COURSES_VISIBLE;
    showMoreCoursesButton = `
      <button type="button" class="btn btn-outline btn-block" onclick="toggleAllCoursesExpand()" style="margin-top:8px;padding:10px;font-size:12.5px;">
        <i class="fa-solid fa-layer-group" style="color:var(--green);"></i>
        ${showAllCourses ? 'Show less courses' : `Show more courses (${hiddenCoursesCount} more course${hiddenCoursesCount === 1 ? '' : 's'})`}
        <i class="fa-solid fa-chevron-${showAllCourses ? 'up' : 'down'}" style="margin-left:6px;"></i>
      </button>
    `;
  }

  list.innerHTML = html + showMoreCoursesButton;
}

function renderSingleSessionItem(session) {
  const open = isSessionOpen(session);
  const formattedStart = formatDateTime(session.starts_at);
  const formattedEnd = formatDateTime(session.ends_at);
  const attendanceCount = Number(session.attendance_count || 0);

  return `
    <div class="session-card ${open ? 'is-open' : 'is-closed'}">
      <div class="session-header">
        <div class="session-info">
          <div class="session-time">
            <i class="fa-regular fa-clock" style="color:${open ? 'var(--green)' : 'var(--text-faint)'};"></i>
            <span>${escapeHtml(formattedStart)} &ndash; ${escapeHtml(formattedEnd)}</span>
          </div>
          <div class="session-meta-row">
            <span class="session-meta-item">
              <i class="fa-solid fa-user-check" style="color:var(--amber);"></i>
              <b>${attendanceCount}</b> marked
            </span>
            <span class="session-meta-item">
              <i class="fa-solid fa-location-crosshairs" style="color:var(--text-dim);"></i>
              GPS: ${escapeHtml(session.latitude)}, ${escapeHtml(session.longitude)} (&plusmn;${escapeHtml(session.radius_m)}m)
            </span>
          </div>
        </div>
        <div>
          ${open ? `
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="badge badge-green"><i class="fa-solid fa-circle-dot"></i> OPEN</span>
              <button type="button" class="btn btn-danger btn-sm" onclick="closeAttendanceSession(${session.id})">
                <i class="fa-solid fa-stop"></i> Close
              </button>
            </div>
          ` : `
            <span class="badge badge-gray">CLOSED</span>
          `}
        </div>
      </div>
    </div>
  `;
}

function renderLogs(logs) {
  const logsBody = document.getElementById('logsBody');
  const countBadge = document.getElementById('logsCountBadge');
  const showMoreContainer = document.getElementById('logsShowMoreContainer');
  if (!logsBody) return;

  if (countBadge) {
    countBadge.textContent = `${logs.length} Total Record${logs.length === 1 ? '' : 's'}`;
  }

  if (!logs.length) {
    logsBody.innerHTML = '<tr><td colspan="5" style="color:var(--text-dim);text-align:center;padding:20px;">No attendance logs recorded yet.</td></tr>';
    if (showMoreContainer) showMoreContainer.innerHTML = '';
    return;
  }

  const visibleLogs = (showAllLogs || logs.length <= DEFAULT_LOGS_VISIBLE)
    ? logs
    : logs.slice(0, DEFAULT_LOGS_VISIBLE);

  logsBody.innerHTML = visibleLogs.map((log) => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="${escapeHtml(avatarUrl(log.full_name, log.photo_path))}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
          <div><b>${escapeHtml(log.full_name)}</b><br><span style="color:var(--text-faint);font-size:11px;">${escapeHtml(log.user_code)}</span></div>
        </div>
      </td>
      <td>${escapeHtml(log.course_code ? `${log.course_code} — ${log.course_name}` : 'General check-in')}</td>
      <td>${escapeHtml(formatDateTime(log.check_in_time))}</td>
      <td><span class="badge ${log.badge_class}">${escapeHtml(log.status_label)}</span></td>
      <td>${escapeHtml((log.methods_used || '').replace(/,/g, ' + '))}</td>
    </tr>
  `).join('');

  if (showMoreContainer) {
    if (logs.length > DEFAULT_LOGS_VISIBLE) {
      const hiddenCount = logs.length - DEFAULT_LOGS_VISIBLE;
      showMoreContainer.innerHTML = `
        <button type="button" class="btn btn-outline" onclick="toggleLogsExpand()" style="padding:8px 16px;font-size:12.5px;">
          <i class="fa-solid fa-chevron-${showAllLogs ? 'up' : 'down'}"></i>
          ${showAllLogs ? 'Show less logs' : `Show more logs (${hiddenCount} more)`}
        </button>
      `;
    } else {
      showMoreContainer.innerHTML = '';
    }
  }
}

// Global action handlers accessible from onclick attributes
window.toggleCourseCardCollapse = function(courseKey) {
  if (collapsedCourseCards.has(courseKey)) {
    collapsedCourseCards.delete(courseKey);
  } else {
    collapsedCourseCards.add(courseKey);
  }
  renderSessionList();
  updateExpandAllBtnText();
};

window.toggleCourseSessionsExpand = function(courseKey, event) {
  if (event) event.stopPropagation();
  if (expandedCourseSessions.has(courseKey)) {
    expandedCourseSessions.delete(courseKey);
  } else {
    expandedCourseSessions.add(courseKey);
  }
  renderSessionList();
};

window.toggleAllCoursesExpand = function() {
  showAllCourses = !showAllCourses;
  renderSessionList();
};

window.toggleAllGroupsCollapse = function() {
  const groups = groupAndSortSessions(allSessions, currentCourseFilter, currentStatusFilter);
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsedCourseCards.has(g.courseKey));
  if (allCollapsed) {
    collapsedCourseCards.clear();
  } else {
    groups.forEach((g) => collapsedCourseCards.add(g.courseKey));
  }
  renderSessionList();
  updateExpandAllBtnText();
};

function updateExpandAllBtnText() {
  const btn = document.getElementById('toggleAllCoursesExpandBtn');
  if (!btn) return;
  const groups = groupAndSortSessions(allSessions, currentCourseFilter, currentStatusFilter);
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsedCourseCards.has(g.courseKey));
  btn.innerHTML = allCollapsed
    ? '<i class="fa-solid fa-up-right-and-down-left-from-center"></i> Expand All'
    : '<i class="fa-solid fa-down-left-and-up-right-to-center"></i> Collapse All';
}

window.toggleLogsExpand = function() {
  showAllLogs = !showAllLogs;
  renderLogs(allLogs);
};

window.closeAttendanceSession = async function(sessionId) {
  if (!confirm('Are you sure you want to close this attendance session? Students will no longer be able to check in.')) {
    return;
  }
  const { ok, data } = await apiFetch('lecturer/actions.php', {
    method: 'POST',
    body: { action: 'close_attendance_session', session_id: sessionId },
  });
<<<<<<< HEAD
  if (ok && data && data.success) {
    await loadDashboard();
  } else {
    alert((data && data.message) || 'Unable to close attendance session.');
  }
};
=======
  if (ok && data && data.success) await loadDashboard();
}

let currentQrSessionId = null;
let qrModal = null;
let qrCountdownInterval = null;

async function generateAttendanceQR(sessionId) {
    try {
        const { ok, data } = await apiFetch('lecturer/actions.php', {
            method: 'POST',
            body: {
                action: 'generate_attendance_qr',
                session_id: sessionId
            }
        });

        if (!ok || !data || !data.success) {
            alert(
                data?.message ||
                'Unable to generate attendance QR code.'
            );
            return;
        }

        currentQrSessionId = sessionId;

        showAttendanceQR(
            data.token,
            data.expires_in || 180
        );

    } catch (error) {
        console.error(error);

        alert(
            'Unable to communicate with the attendance server.'
        );
    }
}

async function generateNewQRFromModal() {

    if (!currentQrSessionId) {
        return;
    }

    await generateAttendanceQR(currentQrSessionId);
}

function showAttendanceQR(token, expiresIn) {

    closeAttendanceQR();

    qrModal = document.createElement('div');

    qrModal.id = 'attendanceQrModal';

    qrModal.innerHTML = `
        <div class="attendance-qr-overlay">

            <div class="attendance-qr-modal">

                <button
                    class="attendance-qr-close"
                    onclick="closeAttendanceQR()"
                    aria-label="Close QR"
                >
                    <i class="fa-solid fa-xmark"></i>
                </button>

                <div class="attendance-qr-header">
                    <i class="fa-solid fa-qrcode"></i>

                    <h2>Attendance QR Code</h2>

                    <p>
                        Students should scan this code to verify
                        their attendance session.
                    </p>
                </div>

                <div class="attendance-qr-code">
                    <canvas id="attendanceQrCanvas"></canvas>
                </div>

                <div class="attendance-qr-timer">
                    <i class="fa-solid fa-clock"></i>

                    <span id="attendanceQrCountdown">
                        ${expiresIn}s
                    </span>
                </div>

                <div
                    id="attendanceQrStatus"
                    class="attendance-qr-status"
                >
                    Active — students can scan now.
                </div>

                <button
                    class="btn btn-outline"
                    onclick="generateNewQRFromModal()"
                >
                    <i class="fa-solid fa-rotate"></i>
                    Generate New QR
                </button>

            </div>

        </div>
    `;

    document.body.appendChild(qrModal);

    const canvas = document.getElementById(
        'attendanceQrCanvas'
    );

    /*
     * Requires QRCode library.
     */
    QRCode.toCanvas(
        canvas,
        token,
        {
            width: 280,
            margin: 2
        },
        function (error) {

            if (error) {
                console.error(error);

                document.getElementById(
                    'attendanceQrStatus'
                ).textContent =
                    'Unable to render QR code.';
            }
        }
    );

    startQrCountdown(expiresIn);
}

function startQrCountdown(seconds) {

    if (qrCountdownInterval) {
        clearInterval(qrCountdownInterval);
    }

    let remaining = seconds;

    const countdownEl = document.getElementById(
        'attendanceQrCountdown'
    );

    const statusEl = document.getElementById(
        'attendanceQrStatus'
    );

    countdownEl.textContent = `${remaining}s`;

    qrCountdownInterval = setInterval(() => {

        remaining--;

        countdownEl.textContent = `${remaining}s`;

        if (remaining <= 0) {

            clearInterval(qrCountdownInterval);
            qrCountdownInterval = null;

            statusEl.textContent =
                'This QR code has expired. Generate a new one.';

            countdownEl.textContent = 'Expired';
        }

    }, 1000);
}

function closeAttendanceQR() {

    if (qrCountdownInterval) {
        clearInterval(qrCountdownInterval);
        qrCountdownInterval = null;
    }

    if (qrModal) {
        qrModal.remove();
        qrModal = null;
    }

    const existing = document.getElementById(
        'attendanceQrModal'
    );

    if (existing) {
        existing.remove();
    }
}
>>>>>>> 238382013a627addc001ce8e96ed013e91b7dc3a

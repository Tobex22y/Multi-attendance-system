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

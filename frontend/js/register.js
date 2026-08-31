(async function init() {
  const { ok, data } = await apiFetch('auth/session.php');
  if (ok && data && data.authenticated) {
    window.location.href = 'portal.html';
    return;
  }

  const form = document.getElementById('registerForm');
  const errorBox = document.getElementById('errorBox');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const payload = {
      full_name: form.full_name.value.trim(),
      email: form.email.value.trim(),
      role: form.role.value,
      level: form.level.value,
      department: form.department.value.trim(),
      password: form.password.value,
      face_descriptor: document.getElementById('faceDescriptorInput').value,
    };

    const { ok, data: res } = await apiFetch('auth/register.php', {
      method: 'POST',
      body: payload,
    });

    if (ok && res && res.success) {
      window.location.href = res.redirect;
      return;
    }

    submitBtn.disabled = false;
    errorBox.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml((res && res.message) || 'Registration failed.')}`;
    errorBox.style.display = 'block';
  });
})();

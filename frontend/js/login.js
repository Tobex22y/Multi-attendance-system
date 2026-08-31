(async function init() {
  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('errorBox');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const email = form.email.value.trim();
    const password = form.password.value;

    const { ok, data: res } = await apiFetch('auth/login.php', {
      method: 'POST',
      body: { email, password },
    });

    if (ok && res && res.success) {
      window.location.href = res.redirect;
      return;
    }

    submitBtn.disabled = false;
    errorBox.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml((res && res.message) || 'Unable to sign in. Start Apache and MySQL, then try again.')}`;
    errorBox.style.display = 'block';
  });

  // Check the existing session after the form is ready, so a slow API cannot
  // leave the sign-in form without a submit handler.
  const { ok, data } = await apiFetch('auth/session.php');
  if (ok && data && data.authenticated) {
    const redirect = data.user.role === 'admin'
      ? 'admin-dashboard.html'
      : data.user.role === 'employee'
        ? 'lecturer-dashboard.html'
        : 'portal.html';
    window.location.href = redirect;
  }
})();

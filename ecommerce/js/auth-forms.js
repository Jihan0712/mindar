/* Small helpers shared by the account forms (sign in, create account,
   forgot / reset password, account settings): inline field errors (red
   border + helper text under the field), a status line, and show/hide
   password toggles. */
(function () {
  function check(input, ok) {
    const field = input.closest('.field');
    if (field) {
      field.classList.toggle('is-error', !ok);
      const help = field.querySelector('[data-err]');
      if (help) help.hidden = ok;
    }
    input.setAttribute('aria-invalid', ok ? 'false' : 'true');
    if (!ok && !document.querySelector('[aria-invalid="true"]:focus')) input.focus();
    return ok;
  }

  function status(msg, kind, el) {
    const s = el || document.getElementById('status');
    if (!s) return;
    s.textContent = msg || '';
    s.classList.toggle('is-error', kind === 'error');
    s.classList.toggle('is-ok', kind === 'ok');
  }

  document.addEventListener('click', function (e) {
    const t = e.target.closest('[data-pw-toggle]');
    if (!t) return;
    const input = document.getElementById(t.getAttribute('data-pw-toggle'));
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    t.textContent = show ? 'Hide' : 'Show';
    t.setAttribute('aria-pressed', show ? 'true' : 'false');
  });

  document.addEventListener('input', function (e) {
    const field = e.target.closest && e.target.closest('.field.is-error');
    if (!field) return;
    field.classList.remove('is-error');
    const help = field.querySelector('[data-err]');
    if (help) help.hidden = true;
    e.target.setAttribute('aria-invalid', 'false');
  });

  window.AuthForms = { check, status };
})();

(() => {
  const dialog = document.querySelector('#beta-dialog');
  const trigger = document.querySelector('.signup-trigger');
  const form = document.querySelector('#beta-form');
  const status = document.querySelector('#signup-status');
  const button = form.querySelector('button[type="submit"]');
  let widget;
  let token = '';
  let sending = false;
  const update = () => { button.disabled = sending || !token; };
  const reset = () => { token = ''; update(); if (widget !== undefined) window.turnstile.reset(widget); };
  const security = document.querySelector('#signup-security');
  let widgetSize;
  const renderSecurity = () => {
    if (!dialog.open || !security.clientWidth || !window.turnstile) return;
    const size = security.clientWidth < 300 ? 'compact' : 'flexible';
    if (size === widgetSize) return;
    widgetSize = size;
    token = ''; update();
    if (widget !== undefined) window.turnstile.remove(widget);
    widget = window.turnstile.render('#signup-security', {
      sitekey: '0x4AAAAAAFZiGr9mXng2FOOE', theme: 'dark', size, action: 'beta_signup',
      callback: (value) => { token = value; status.textContent = ''; update(); },
      'expired-callback': () => { token = ''; update(); },
      'error-callback': () => {
        token = ''; update();
        status.textContent = 'The security check could not load. Please refresh to try again.';
      },
    });
  };
  window.onTurnstileLoad = () => {
    renderSecurity();
    new ResizeObserver(() => {
      if (security.clientWidth) renderSecurity();
    }).observe(security);
  };
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
  script.async = true;
  script.onerror = () => { status.textContent = 'The security check could not load. Please refresh to try again.'; };
  let securityLoaded = false;
  trigger.addEventListener('click', () => {
    dialog.showModal();
    if (!form.querySelector('.signup-fields').hidden) form.querySelector('[name="name"]').focus();
    if (!securityLoaded) {
      securityLoaded = true;
      document.head.append(script);
    } else { renderSecurity(); }
  });
  dialog.querySelector('.signup-close').addEventListener('click', () => dialog.close());
  // Only dismiss when both the press and release happen on the backdrop.
  const outside = (event) => {
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  let backdropPress = false;
  dialog.addEventListener('pointerdown', (event) => { backdropPress = event.target === dialog && outside(event); });
  dialog.addEventListener('click', (event) => {
    if (backdropPress && event.target === dialog && outside(event)) dialog.close();
    backdropPress = false;
  });
  dialog.addEventListener('close', () => trigger.focus({ preventScroll: true }));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !token || !form.reportValidity()) return;
    sending = true; update(); button.textContent = 'Signing up…'; status.textContent = '';
    const fields = new FormData(form);
    try {
      const response = await fetch('https://website-api.foxpreygames.workers.dev/beta-signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fields.get('name'), email: fields.get('email'), website: fields.get('website'), token }),
        signal: AbortSignal.timeout(35000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Signup unavailable. Please try again later.');
      form.reset();
      status.textContent = result.message;
      form.querySelector('.signup-fields').hidden = true;
    } catch (error) {
      status.textContent = error instanceof TypeError || error.name === 'TimeoutError'
        ? 'Unable to confirm your signup. Please check your connection and try again later.' : error.message;
      reset();
    } finally { sending = false; button.textContent = 'Join the list'; update(); }
  });
})();

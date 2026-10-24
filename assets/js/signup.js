(() => {
  const dialog = document.querySelector('#beta-dialog');
  const trigger = document.querySelector('.signup-trigger');
  const form = document.querySelector('#beta-form');
  const status = document.querySelector('#signup-status');
  const button = form.querySelector('button[type="submit"]');
  let completed = false;
  let securityObserver;
  let widget;
  let token = '';
  let sending = false;
  const update = () => { button.disabled = sending || !token; };
  const reset = () => { token = ''; update(); if (widget !== undefined) window.turnstile.reset(widget); };
  const security = document.querySelector('#signup-security');
  let widgetSize;
  const renderSecurity = () => {
    if (completed || !dialog.open || !security.clientWidth || !window.turnstile) return;
    const size = security.clientWidth < 300 ? 'compact' : 'flexible';
    if (size === widgetSize) return;
    widgetSize = size;
    token = ''; update();
    if (widget !== undefined) window.turnstile.remove(widget);
    widget = window.turnstile.render('#signup-security', {
      sitekey: '0x4AAAAAAFZiGr9mXng2FOOE', theme: 'dark', size, action: 'beta_signup',
      callback: (value) => { if (completed) return; token = value; status.textContent = ''; update(); },
      'expired-callback': () => { if (completed) return; token = ''; update(); },
      'error-callback': () => {
        if (completed) return;
        token = ''; update();
        status.textContent = 'The security check could not load. Please refresh to try again.';
      },
    });
  };
  window.onTurnstileLoad = () => {
    renderSecurity();
    securityObserver = new ResizeObserver(() => {
      if (security.clientWidth) renderSecurity();
    });
    securityObserver.observe(security);
    window.dispatchEvent(new Event('foxprey-turnstile-ready'));
  };
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
  script.async = true;
  script.onerror = () => { status.textContent = 'The security check could not load. Please refresh to try again.'; window.dispatchEvent(new Event('foxprey-turnstile-error')); };
  let securityLoaded = false;
  window.loadFoxpreyTurnstile = () => {
    if (!securityLoaded) { securityLoaded = true; document.head.append(script); }
  };
  trigger.addEventListener('click', (event) => {
    dialog.toggleAttribute('data-quiet-focus', window.matchMedia('(max-width: 560px)').matches && event.detail > 0);
    dialog.showModal();
    if (window.matchMedia('(max-width: 560px)').matches) {
      dialog.querySelector('.signup-close').focus({ preventScroll: true });
    } else if (!form.querySelector('.signup-fields').hidden) {
      form.querySelector('[name="name"]').focus();
    }
    window.loadFoxpreyTurnstile();
    renderSecurity();
  });
  dialog.addEventListener('keydown', () => dialog.removeAttribute('data-quiet-focus'));
  dialog.querySelector('.signup-close').addEventListener('blur', () => dialog.removeAttribute('data-quiet-focus'));
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
      completed = true;
      token = '';
      securityObserver?.disconnect();
      if (widget !== undefined) {
        window.turnstile.remove(widget);
        widget = undefined;
      }
      dialog.removeAttribute('aria-describedby');
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

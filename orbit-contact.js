(() => {
  'use strict';
  const form = document.getElementById('contactForm');
  const status = document.getElementById('formStatus');
  const button = form?.querySelector('button[type="submit"]');
  if (!form || !status || !button) return;
  const config = window.ORBIT_CONTACT_CONFIG;
  const localOrigins = ['http://127.0.0.1:5500', 'http://localhost:5500', 'http://192.168.1.248:5500'];
  const protectedMode = config?.mode === 'protected';
  const allowedOrigins = protectedMode ? config.allowedOrigins || [] : localOrigins;
  const configured = config && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(config.endpoint)
    && (protectedMode ? /^[A-Za-z0-9_-]{10,}$/.test(config.siteKey || '') : /^[a-f0-9]{64}$/.test(config.demoToken));
  if (!configured || !allowedOrigins.includes(location.origin)) {
    status.textContent = protectedMode ? 'החיבור המאובטח לטופס עדיין אינו זמין. נסו שוב מאוחר יותר.'
      : 'שליחת הפנייה בחיבור זה זמינה כרגע לבדיקה מקומית בלבד.';
    return;
  }
  form.removeAttribute('onsubmit');
  button.disabled = protectedMode;
  const frame = document.createElement('iframe');
  frame.name = 'orbit-contact-response';
  frame.title = 'אישור קליטת הפנייה';
  frame.hidden = true;
  document.body.appendChild(frame);
  let pending = null;
  let busy = false;
  let timeout;
  let statusPollTimers = [];
  let pollSerial = 0;
  let captchaWidget;
  let captchaToken = '';
  function resetCaptcha() {
    if (!protectedMode) return;
    captchaToken = '';
    button.disabled = true;
    if (captchaWidget !== undefined && window.grecaptcha) window.grecaptcha.reset(captchaWidget);
  }
  if (protectedMode) {
    const widget = document.createElement('div');
    widget.className = 'orbit-contact-captcha';
    widget.style.cssText = 'margin:16px 0;min-height:78px';
    button.before(widget);
    show('טוענים אימות נגד רובוטים…');
    window.orbitCaptchaReady = () => {
      try {
        captchaWidget = window.grecaptcha.render(widget, {
          sitekey: config.siteKey,
          size: window.innerWidth < 380 ? 'compact' : 'normal',
          callback: token => { captchaToken = token; button.disabled = busy; if (!busy) show(''); },
          'expired-callback': () => { captchaToken = ''; button.disabled = true; show('האימות פג. השלימו אותו שוב לפני השליחה.'); },
          'error-callback': () => { captchaToken = ''; button.disabled = true; show('לא ניתן לטעון את האימות. רעננו את העמוד ונסו שוב.'); }
        });
        show('השלימו את אימות הרובוטים לפני השליחה.');
      } catch (_) { show('האימות אינו זמין כרגע. הפרטים לא נשלחו.'); }
    };
    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?onload=orbitCaptchaReady&render=explicit&hl=iw';
    script.async = true;
    script.defer = true;
    script.onerror = () => { button.disabled = true; show('לא ניתן לטעון את האימות. הפרטים לא נשלחו.'); };
    document.head.appendChild(script);
  }
  function show(message, success = false) {
    status.textContent = message;
    status.classList.toggle('form-status-success', success);
  }
  function finish() {
    clearTimeout(timeout);
    statusPollTimers.forEach(clearTimeout);
    statusPollTimers = [];
    pollSerial++;
    busy = false;
    button.disabled = protectedMode && !captchaToken;
    form.removeAttribute('aria-busy');
  }
  // Check whether Apps Script saved this UUID. This works even if Google's iframe reply is blocked.
  // The server returns ONLY a boolean for an unguessable request ID, never lead details.
  function checkSaved(id, serial) {
    if (!busy || !pending || pending.id !== id || serial !== pollSerial) return;
    const callbackName = 'orbitStatus_' + id.replace(/-/g, '');
    const script = document.createElement('script');
    const cleanup = () => { delete window[callbackName]; script.remove(); };
    const guard = setTimeout(cleanup, 7000);
    window[callbackName] = data => {
      clearTimeout(guard);
      cleanup();
      if (!busy || !pending || pending.id !== id || serial !== pollSerial) return;
      if (data && data.requestId === id && data.saved === true) {
        completeSuccess();
      }
    };
    script.onerror = () => { clearTimeout(guard); cleanup(); };
    script.src = config.endpoint + '?action=orbitStatus&requestId=' + encodeURIComponent(id)
      + '&callback=' + encodeURIComponent(callbackName) + '&_=' + Date.now();
    document.head.appendChild(script);
  }
  function startStatusPolling(id) {
    const serial = ++pollSerial;
    [2500, 6000, 12000, 22000, 34000].forEach(delay => {
      statusPollTimers.push(setTimeout(() => checkSaved(id, serial), delay));
    });
  }
  function completeSuccess() {
    finish();
    resetCaptcha();
    pending = null;
    form.reset();
    form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    const phoneError = document.getElementById('phoneError');
    if (phoneError) phoneError.hidden = true;
    show('הפנייה התקבלה ונשמרה. תודה שפניתם! אחזור אליכם בקרוב.', true);
    status.tabIndex = -1;
    status.focus({ preventScroll: true });
    status.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
  function hidden(name, value) {
    let input = form.querySelector('input[name="' + name + '"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
  }
  function newId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    if (!form.reportValidity()) {
      const firstInvalid = form.querySelector(':invalid');
      if (firstInvalid) firstInvalid.focus();
      show('יש להשלים את שדות החובה ולתקן שדות שאינם תקינים.');
      return;
    }
    if (protectedMode && !captchaToken) {
      show('השלימו את אימות הרובוטים לפני השליחה.');
      return;
    }
    const fields = ['fullName', 'businessName', 'phone', 'email', 'message'];
    const values = fields.map(name => form.elements.namedItem(name).value.trim());
    const phone = values[2];
    if (!/^[+0-9()\s-]{7,20}$/.test(phone) || phone.replace(/\D/g, '').length < 7) {
      show('יש להזין מספר טלפון תקין.');
      form.elements.namedItem('phone').focus();
      return;
    }
    if (values[0].length > 100 || values[1].length > 150 || values[3].length > 254 || values[4].length > 4000) {
      show('הפרטים ארוכים מדי. קצרו את ההודעה ונסו שוב.');
      return;
    }
    const fingerprint = JSON.stringify(values);
    if (!pending || pending.fingerprint !== fingerprint) pending = { id: newId(), fingerprint };
    hidden('requestId', pending.id);
    hidden('origin', location.origin);
    if (protectedMode) {
      hidden('captchaToken', captchaToken);
      form.querySelector('input[name="demoToken"]')?.remove();
    } else hidden('demoToken', config.demoToken);
    form.action = config.endpoint;
    form.method = 'post';
    form.target = frame.name;
    busy = true;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    show('שולחים את הפנייה וממתינים לאישור קליטה…');
    startStatusPolling(pending.id);
    timeout = setTimeout(() => {
      finish();
      resetCaptcha();
      show('עדיין לא התקבל אישור קליטה. בדקו את החיבור ונסו שוב; הפרטים נשמרו בטופס.');
    }, 45000);
    try {
      HTMLFormElement.prototype.submit.call(form);
    } catch (_) {
      finish();
      resetCaptcha();
      show('לא ניתן לשלוח כרגע. הפרטים נשמרו בטופס, נסו שוב.');
    }
  });
  window.addEventListener('message', event => {
    // Apps Script replies from an inner Google-hosted frame, not the outer iframe window.
    const trustedOrigin = event.origin === 'https://script.google.com'
      || /^https:\/\/(?:[a-z0-9-]+-)?script\.googleusercontent\.com$/.test(event.origin);
    const data = event.data;
    if (!trustedOrigin || !pending || !data || data.type !== 'orbit-contact-result'
      || data.requestId !== pending.id || typeof data.ok !== 'boolean') return;
    if (!data.ok) {
      finish();
      resetCaptcha();
    }
    if (!data.ok) {
      const messages = {
        captcha: 'האימות לא אושר או שפג תוקפו. השלימו אותו שוב ונסו לשלוח.',
        rate: 'נשלחו כמה פניות ברצף. המתינו דקה ונסו שוב.',
        phone: 'יש להזין מספר טלפון תקין.',
        email: 'יש להזין כתובת אימייל תקינה.'
      };
      show(messages[data.code] || 'הפנייה לא הושלמה. בדקו את הפרטים ונסו שוב.');
      return;
    }
    completeSuccess();
  });
})();

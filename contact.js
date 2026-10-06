(() => {
  'use strict';

  const form = document.getElementById('contactForm');
  const submit = document.getElementById('contactSubmit');
  const status = document.getElementById('contactStatus');
  const emailLink = document.getElementById('contactEmail');
  if (!form || !submit || !status) return;

  function setStatus(message, kind = '') {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  async function checkDelivery() {
    try {
      const response = await fetch('/api/contact/status', { cache: 'no-store' });
      const result = await response.json();
      if (response.ok && typeof result.publicEmail === 'string' && emailLink) {
        emailLink.href = `mailto:${result.publicEmail}?subject=Aura%20feedback`;
        emailLink.hidden = false;
      }
      if (!response.ok || !result.available) {
        submit.disabled = true;
        setStatus(result.publicEmail ? 'Message delivery is not set up yet. Please use the email link.' : 'Message delivery is not set up yet.', 'error');
        return;
      }
      setStatus('Ready to receive your feedback.');
    } catch {
      submit.disabled = true;
      setStatus('Could not check message delivery. Please try again later.', 'error');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || submit.disabled) return;
    const fields = new FormData(form);
    submit.disabled = true;
    setStatus('Sending your message…');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: fields.get('type'),
          name: fields.get('name'),
          email: fields.get('email'),
          message: fields.get('message'),
          website: fields.get('website')
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.sent) throw new Error(result.error || 'Message could not be sent. Please try again later.');
      form.reset();
      setStatus('Thank you! Your message was sent.', 'success');
    } catch (error) {
      setStatus(error.message || 'Message could not be sent. Please try again later.', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  checkDelivery();
})();

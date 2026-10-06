# Contact form setup

The final scene has a feedback form and an optional **Email directly** link. Recipient addresses and API keys are configured on the server, not committed to GitHub.

To enable the form on Render:

1. Create a Resend account and a sending API key.
2. In the Render service dashboard, open **Environment** and add `RESEND_API_KEY` as a secret and `CONTACT_TO_EMAIL` as the inbox that should receive messages. Do not put either in GitHub or client-side JavaScript.
3. If you want a direct mail link, also set `CONTACT_PUBLIC_EMAIL` to an address you are comfortable showing to every visitor. This value is sent to browsers, so use a public/contact address rather than a private one. Leave it unset to keep the link hidden.
4. For initial testing, the server defaults to `Aura Feedback <onboarding@resend.dev>`. Resend may limit this testing sender to the email address that owns the Resend account. If your account uses another email address, verify a domain in Resend, then set `CONTACT_FROM_EMAIL` to a sender on that domain, such as `Aura Feedback <feedback@yourdomain.com>`.
5. Redeploy and visit the contact section. The form says **Ready to receive your feedback** when the API key and recipient are configured. Submit a test message and verify it arrives in your inbox. A ready indicator checks configuration only; a successful test message confirms delivery.

The form accepts suggestions, bug reports, and other feedback. It validates input on both client and server, limits requests, includes a honeypot field, and shows an explicit error if delivery fails. If `CONTACT_PUBLIC_EMAIL` is set, the direct email link stays available even when Resend is not configured.

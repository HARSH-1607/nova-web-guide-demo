# Add Dork to any website

Dork is a portable 3D website guide. Add one script and the character appears over your page with chat, gestures, voice, section navigation, and a guided tour. The model comes from this project; Unity is not required. Try the [sample site](https://nova-web-guide-demo.onrender.com/embed/demo.html).

## Install

Place this before `</body>`:

```html
<script src="https://nova-web-guide-demo.onrender.com/embed/dork-embed.js"></script>
```

The script creates an isolated iframe. It reads only your public page title, meta description, first heading, and visible section headings or descriptions you explicitly mark. It does not read form entries or the entire page body. It discovers sections with headings automatically. For reliable destinations, mark sections:

```html
<section id="pricing" data-nova-guide="pricing" data-nova-aliases="plans,cost"
         data-nova-description="Compare our plans and choose the right one.">
  <h2>Pricing</h2>
</section>
```

`data-nova-*` attributes remain supported so existing integrations do not break. Dork highlights and scrolls only to an element present on the host page. It never clicks a button or submits a form without the visitor.

## Personality and site profile

Put this before the install script:

```html
<script>
  window.DorkEmbedConfig = {
    site: { title: 'Acme Studio', description: 'Design and development for small teams.' },
    personality: {
      name: 'Dork',
      tone: 'friendly', // friendly, professional, or playful
      greeting: 'Hi, I am {name}. Welcome to {site}!',
      instructions: 'Keep answers practical and encouraging.'
    },
    targets: {
      support: { selector: '#help', label: 'Support', description: 'Our help options are here.' }
    }
  };
</script>
<script src="https://nova-web-guide-demo.onrender.com/embed/dork-embed.js"></script>
```

The personality, page profile, and up to 12 section descriptions are sent to the hosted chat API for open-ended questions. Dork keeps the chosen name and tone while tailoring answers to each site. The AI may suggest a listed destination; the host script validates its key before scrolling. Mark factual descriptions carefully because Dork should not invent prices, features, or policies.

## Chat and voice

The hosted chat uses the server's `OPENAI_API_KEY`; never put a provider key in your page. Set `EMBED_AI_ENABLED=true` on your server to expose the bounded embed API. Requests are limited to 30 paid operations per hour globally by default (`ONLINE_REQUEST_LIMIT`) and 12 per visitor IP per hour. For a public production service, use an external persistent rate limiter and provider spend limits: process restarts reset these in-memory limits. If the API is unavailable, section navigation and built-in replies continue to work.

Visitors on supported desktop Chrome can click **Use on-device AI · no credits** under the chat box. Chrome may download its built-in model the first time; this can take a while and requires a capable device and enough disk space. The guide switches to the browser voice in this mode, so chat and speech need no provider credits. The button is hidden when Chrome reports that its on-device model is unavailable. Other browsers can still use the hosted API or built-in section guidance. A cross-origin host must allow the widget iframe's `language-model` permission; the installer adds this automatically.

The voice button cycles through **Natural**, **Browser**, and **Off** when the server has a natural voice. Natural mode uses an ElevenLabs voice if `ELEVENLABS_API_KEY` and `EMBED_ELEVENLABS_VOICE_ID` are set; otherwise it uses OpenAI speech with the existing OpenAI key. The browser voice remains a fallback when natural audio fails. The widget tells visitors when the natural voice is AI generated. Voice audio and chat share the hourly paid-operation limit.

A host can disable hosted chat with `ai: false` and provide its own `onQuestion` callback. It receives `(question, destinations, context)` where context includes the site, personality, current target, and history. Return a string or `{ text, target: 'pricing' }`. Keep your own API key on your backend.

## Host controls

```js
window.DorkEmbed.ask('What can I find here?');
window.DorkEmbed.navigate('pricing');
window.DorkEmbed.refreshTargets(); // After your page adds or changes sections.
window.DorkEmbed.show();
window.DorkEmbed.hide();
window.DorkEmbed.destroy();
```

The older `window.NovaEmbedConfig`, `window.NovaEmbed`, and `nova-embed.js` URL remain aliases for existing installations. For a strict Content Security Policy, allow the widget origin in `script-src`, `frame-src`, and `connect-src`. The character needs WebGL; a still image appears if WebGL cannot start.

# Add Nova to another website

Nova can now run as an isolated 3D guide on a separate site. The widget uses the Blender-made Drok character from this project, voice fallback, keyed gestures, and approximate vowel-driven mouth motion. If 3D loading fails, it shows a still image of Drok. It does **not** require Unity or a WebGL build.

For a first test, open `/embed/demo.html` on the Nova server. The demo website itself is unrelated to Aura.

## One-line install

Add this before the closing `</body>` tag on an HTML page:

```html
<script src="https://nova-web-guide-demo.onrender.com/embed/nova-embed.js"></script>
```

The script creates one fixed, transparent iframe in the lower-right corner. It scans visible sections with headings automatically, including sections without IDs, and it also recognizes any element marked `data-nova-guide`. Its CSS and WebGL canvas stay inside the iframe, so they do not restyle your website. The avatar files are public static assets; the protected Aura demo page and paid AI API remain behind their existing authentication.

Nova reads the host page's public title, meta description, first heading, and marked guide sections to tailor her greeting and section explanations. She does not read form entries or the full page body. Add `data-nova-description` to important sections for accurate, site-specific answers. Sections without IDs get a generated key from their heading (for example, “Shipping & Returns” becomes `shipping-returns`); explicit `data-nova-guide` keys are more stable when page text changes. A conversation can ask “what is this site?”, name a section, or follow up with “tell me more about that.”

## Change Nova's personality

Put configuration before the install script. The default is Nova with a friendly, concise tone. Choose `friendly`, `professional`, or `playful`, and optionally provide a name, greeting, and instructions for your AI backend:

```html
<script>
  window.NovaEmbedConfig = {
    site: { title: 'Acme Studio', description: 'Design and development for small teams.' },
    personality: {
      name: 'Mira',
      tone: 'professional',
      greeting: 'Hello, I am {name}. Welcome to {site}.',
      instructions: 'Use short, practical answers and a calm voice.'
    }
  };
</script>
<script src="https://nova-web-guide-demo.onrender.com/embed/nova-embed.js"></script>
```

The name, tone, and greeting change the built-in dialogue. `instructions` and the discovered site profile are passed to the optional `onQuestion` callback so your backend can keep the same character personality in AI answers. Try the [professional demo](https://nova-web-guide-demo.onrender.com/embed/demo.html?personality=professional) or [playful demo](https://nova-web-guide-demo.onrender.com/embed/demo.html?personality=playful).

Visitors can minimize the guide to a small floating button and reopen it. On narrow screens, the character and chat panel scale down to leave more room for the host page.
The **Take a tour** button walks through up to 12 discovered destinations, one stop at a time. Visitors can also type “show me around,” “next,” “back,” or “stop tour.” They can go back, advance, or exit without losing access to the site. Pressing Escape minimizes the guide.
The **Moves** menu lets visitors trigger Wave, Nod, Shake, Think, Bump, Jump, Dance, and Cheer. Clicking the character cycles through a few friendly reactions. Nova takes a thinking pose while awaiting a chat answer. The rig follows the pointer across the host page, not just inside the widget. Short idle glances and occasional nods make Nova feel less static; browsers requesting reduced motion skip those automatic gestures.

Mark useful destinations with descriptions:

```html
<section id="pricing" data-nova-guide="pricing" data-nova-aliases="plans,cost"
         data-nova-description="Here are our plans. Choose one to see more details.">
  <h2>Pricing</h2>
</section>
```

Or configure existing elements without changing their markup. Put this **before** the install script:

```html
<script>
  window.NovaEmbedConfig = {
    targets: {
      pricing: { selector: '#plans', label: 'Pricing', description: 'Here are our plans.', aliases: ['cost'] },
      support: { selector: '#help', label: 'Support', description: 'Our help options are here.' }
    }
  };
</script>
<script src="https://nova-web-guide-demo.onrender.com/embed/nova-embed.js"></script>
```

Nova scrolls to and highlights only a target found on the host page. Without AI, she can navigate known sections, wave, and dance; unknown questions receive a helpful list of destinations.

To react when Nova shows a destination, add an optional callback. It receives the guide key and the actual host-page element, so your site can record analytics or update its own UI. It is not called for AI-only chat answers:

```html
<script>
  window.NovaEmbedConfig = {
    onNavigate(key, element) {
      console.log('Nova showed', key, element);
    }
  };
</script>
<script src="https://nova-web-guide-demo.onrender.com/embed/nova-embed.js"></script>
```

## Optional AI on the host website

Give the widget an `onQuestion` callback that calls **your own backend**. Never put an AI API key in page JavaScript:

```html
<script>
  window.NovaEmbedConfig = {
    async onQuestion(question, destinations, context) {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, destinations, context })
      });
      if (!response.ok) throw new Error('Assistant unavailable');
      const { reply } = await response.json();
      return reply;
    }
  };
</script>
<script src="https://nova-web-guide-demo.onrender.com/embed/nova-embed.js"></script>
```

The host backend is responsible for authentication, rate limiting, cost limits, and any AI provider key. The `context` argument contains `{ site, personality, currentTarget, history }`. The callback may return `{ text, target: 'pricing' }` to make Nova highlight a configured destination. The widget stops waiting after 15 seconds if the callback does not respond. The default embed sends the site profile and configured section names/descriptions to its iframe—not the full page content.

The host page can call `window.NovaEmbed.show()`, `.hide()`, `.refreshTargets()` after dynamic navigation, or `.destroy()`. Its own buttons can ask the guide to act:

```js
window.NovaEmbed.navigate('pricing'); // Returns false if that key is not on the page.
window.NovaEmbed.ask('How do I contact you?');
```

Both methods reopen a minimized guide. An `ask()` call made before the iframe finishes loading is queued and delivered when ready.

For a strict Content Security Policy, allow the widget origin in `script-src` and `frame-src`. If a production host forbids cross-site frames, self-host the same `Builds` assets and use that origin instead. This prototype's frame needs browser WebGL for the animated model; if WebGL fails, it shows a still image of Drok.

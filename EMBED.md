# Add Nova to another website

Nova can now run as an isolated 3D guide on a separate site. The widget uses the Blender-made Drok character from this project, voice fallback, gestures, and approximate vowel-driven mouth motion. The previous RobotExpressive character remains a loading fallback. It does **not** require Unity or a WebGL build.

For a first test, open `/embed/demo.html` on the Nova server. The demo website itself is unrelated to Aura.

## One-line install

Add this before the closing `</body>` tag on an HTML page:

```html
<script src="https://nova-web-guide-demo.onrender.com/embed/nova-embed.js"></script>
```

The script creates one fixed, transparent iframe in the lower-right corner. It scans sections with IDs automatically, and it also recognizes any element marked `data-nova-guide`. Its CSS and WebGL canvas stay inside the iframe, so they do not restyle your website. The avatar files are public static assets; the protected Aura demo page and paid AI API remain behind their existing authentication.

Visitors can minimize the guide to a small floating button and reopen it. On narrow screens, the character and chat panel scale down to leave more room for the host page.
The **Take a tour** button walks through up to 12 discovered destinations, one stop at a time. Visitors can go back, advance, or exit without losing access to the site. Pressing Escape minimizes the guide.
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
    async onQuestion(question, destinations) {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, destinations })
      });
      if (!response.ok) throw new Error('Assistant unavailable');
      const { reply } = await response.json();
      return reply;
    }
  };
</script>
<script src="https://nova-web-guide-demo.onrender.com/embed/nova-embed.js"></script>
```

The host backend is responsible for authentication, rate limiting, cost limits, and any AI provider key. The default embed sends only the page title and configured section names/descriptions to its iframe—not the full page content.

The host page can call `window.NovaEmbed.show()`, `.hide()`, `.refreshTargets()` after dynamic navigation, or `.destroy()`.

For a strict Content Security Policy, allow the widget origin in `script-src` and `frame-src`. If a production host forbids cross-site frames, self-host the same `Builds` assets and use that origin instead. This prototype's frame needs browser WebGL for the rigged model; if WebGL fails, it shows a simple fallback icon.

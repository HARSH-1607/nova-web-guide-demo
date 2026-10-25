# Run Dork with Gemini's free tier

The server defaults to the Gemini free tier for Dork's private Aura chat and public embed chat. Its default chat model is `gemini-3.5-flash-lite`. Speech uses `gemini-3.8-flash-lite-tts` with the warm `Orus` voice when the model is available within the project's free-tier quota. Dork falls back to a masculine browser voice if speech generation is unavailable. An existing OpenAI key is not used unless `AI_CHAT_PROVIDER=openai` is set explicitly.

1. In [Google AI Studio API Keys](https://aistudio.google.com/app/apikey), create a key in a **free-tier project**. Check the project's current quota in AI Studio. Do not send the key in chat or add it to GitHub.
2. In the existing Render web service, open **Environment** and add `GEMINI_API_KEY` with the key as its value. Add `AI_CHAT_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.5-flash-lite`, `GEMINI_TTS_ENABLED=true`, `GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts`, `GEMINI_TTS_VOICE=Orus`, `PAID_VOICE_ENABLED=false`, and `EMBED_AI_ENABLED=true`. Keep the existing `DEMO_PASSWORD`. Save and deploy. Blueprint-managed services may receive non-secret values from `render.yaml`, while `GEMINI_API_KEY` must remain a Render secret.
3. Check `https://nova-web-guide-demo.onrender.com/api/embed/status`. It should report `chat: true`, `naturalVoice: true`, and `voiceProvider: "gemini"`. Then ask Dork a question on the [embed demo](https://nova-web-guide-demo.onrender.com/embed/demo.html).

The server keeps the key private. Its `ONLINE_REQUEST_LIMIT` and per-visitor limits reduce abuse; Google applies additional free-tier limits per project. When those limits are reached, chat may return a temporary 429 response. Free-tier input and output may be used to improve Google's products; review Google's terms before submitting private content.

To use OpenAI instead, set `AI_CHAT_PROVIDER=openai` and a server-side `OPENAI_API_KEY`. The app does not automatically fall back to the paid provider when Gemini is selected.

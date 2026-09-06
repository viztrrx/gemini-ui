/*!
 * Gemini Page Assistant — injectable console/bookmarklet AI overlay
 * -------------------------------------------------------------
 * WHAT THIS DOES
 *  - Reads the visible TEXT of the current page (document.body.innerText)
 *    and/or captures an actual SCREENSHOT (via getDisplayMedia), and sends
 *    either or both to Gemini to summarize, analyze, or answer questions.
 *  - A general "Ask AI" chat section, independent of page content.
 *  - A "Music" section with two ways to play something:
 *      1) Type a song name/description ("mi historia entre tus dedos by
 *         eslabon armado") and it searches YouTube's official Data API
 *         for the closest match and plays it via YouTube's own embed
 *         player. Needs a free YouTube Data API v3 key (see below).
 *      2) Paste a SoundCloud link directly, played via SoundCloud's own
 *         official embeddable player.
 *    Either way it's an official embed API, not a scrape/proxy, and
 *    playback keeps running in the background while you switch tabs
 *    (the iframe stays in the DOM, just visually hidden).
 *  - A "Browser" section: a plain iframe with a URL bar. It only loads
 *    sites that allow being embedded (most publisher sites, wikis,
 *    many docs sites). Sites that set X-Frame-Options / CSP
 *    frame-ancestors to block embedding — banks, most social apps,
 *    soundcloud.com's own site — won't load here. That's a security
 *    protection those sites intentionally set, and this script does not
 *    attempt to circumvent it.
 *  - A "Theme" section to change the panel's color scheme.
 *  - All sections are switched via a dropdown in place of tabs.
 *  - Draggable panel, minimize/restore toggle.
 *
 * SETUP
 *  1. Get a free Gemini API key from https://aistudio.google.com/apikey
 *     — and/or an OpenAI API key from https://platform.openai.com/api-keys
 *     (starts with "sk-"). Pick which one to use via "AI provider" in the
 *     Theme tab; each key is asked for and stored separately, so you can
 *     switch back and forth without re-entering anything.
 *  2. For the Music search feature: get a free YouTube Data API v3 key
 *     at console.cloud.google.com — create/select a project, enable
 *     "YouTube Data API v3" under APIs & Services, then create an API
 *     key under Credentials. Free tier covers roughly 100 searches/day.
 *  3. Host this file somewhere you control (a GitHub Gist "raw" URL,
 *     a repo on GitHub Pages, etc).
 *  4. On any page, open DevTools console and run:
 *       fetch('https://YOUR-RAW-URL/gemini-page-assistant.js').then(r=>r.text()).then(eval)
 *  5. The first time you use each feature, it'll ask you to paste the
 *     relevant API key. Keys are stored in localStorage FOR THAT SITE'S
 *     ORIGIN ONLY (browser security — a script can't share localStorage
 *     across different domains). You'll be asked again on a new domain
 *     unless you paste your own Gemini key directly into API_KEY_DEFAULT
 *     below before hosting your own copy.
 *
 * SCREEN CAPTURE
 *  - "Capture Screen" uses the browser's native getDisplayMedia prompt —
 *    Chrome will ask YOU to pick a tab/window/screen to share, take one
 *    frame, then immediately stop sharing. It cannot capture silently;
 *    that permission dialog is a browser-level protection and can't be
 *    skipped by this or any page script.
 *  - Requires a secure context (https) and a real click on the button.
 *
 * NOTES / LIMITS
 *  - This is plain injected JS, not a Chrome extension — it disappears
 *    on page reload/navigation. Re-run the fetch command each time, or
 *    turn it into a browser bookmarklet / DevTools Snippet.
 *  - Page text is truncated (see MAX_PAGE_CHARS) and screenshots are
 *    downscaled (see MAX_IMAGE_WIDTH) to keep requests fast and within
 *    token limits.
 *  - Uses the public Generative Language REST API directly from the
 *    browser with your API key as a query param — that's how Google's
 *    docs show client-side usage, but it does mean the key is visible
 *    in network requests made from your own browser session.
 */
(function () {
  'use strict';

  // ---- Config -------------------------------------------------------
  const MODEL = 'gemini-3.6-flash';
  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const STORAGE_KEY = 'gpa_gemini_api_key';
  const OPENAI_STORAGE_KEY = 'gpa_openai_api_key';
  const OPENAI_MODEL = 'gpt-4o-mini';
  const PROVIDER_KEY = 'gpa_ai_provider';
  const SPEED_KEY = 'gpa_type_speed';
  const FONT_KEY = 'gpa_response_font';
  const PARTICLE_KEY = 'gpa_particle_style';
  const PARTICLE_DENSITY_KEY = 'gpa_particle_density';
  const PARTICLE_MARGIN = 40;
  const PARTICLE_BASE_W = 360 + PARTICLE_MARGIN * 2;
  const PARTICLE_BASE_H = 480 + PARTICLE_MARGIN * 2;
  const YT_STORAGE_KEY = 'gpa_youtube_api_key';
  const THEME_KEY = 'gpa_theme';
  const CUSTOM_COLOR_KEY = 'gpa_custom_accent';
  const MAX_PAGE_CHARS = 18000;
  const MAX_IMAGE_WIDTH = 1280;
  const API_KEY_DEFAULT = ''; // paste your own key here if hosting a private copy

  // Prevent duplicate instances — toggle instead of re-injecting
  const existing = document.getElementById('gpa-root-host');
  if (existing) {
    existing.dispatchEvent(new CustomEvent('gpa-toggle'));
    return;
  }

  // ---- Themes ---------------------------------------------------------
  const THEMES = {
    dark:      { bg: '#0b0b0f', panel: '#16161c', field: '#1e1e26', text: '#eaeaf0', sub: '#9a9aa8', accent: '#5b8cff', border: '#26262f' },
    matte:     { bg: '#131313', panel: '#1a1a1a', field: '#222222', text: '#e6e6e6', sub: '#9c9c9c', accent: '#b0b0b0', border: '#2b2b2b' },
    red:       { bg: '#180a0a', panel: '#241010', field: '#2e1414', text: '#f5e9e9', sub: '#cf9d9d', accent: '#e5453a', border: '#3a1818' },
    blue:      { bg: '#081420', panel: '#0f1e2e', field: '#132840', text: '#e7eef7', sub: '#9db4c9', accent: '#4da3ff', border: '#1b3149' },
    purple:    { bg: '#120c1e', panel: '#1c1430', field: '#251c3d', text: '#efe9fb', sub: '#b6a8d1', accent: '#8b5cf6', border: '#2f2350' },
    pink:      { bg: '#1e0c16', panel: '#301425', field: '#3d1b30', text: '#fbe9f2', sub: '#d1a8bf', accent: '#ec4899', border: '#4a2038' },
    lightblue: { bg: '#eaf6ff', panel: '#f5fbff', field: '#ffffff', text: '#0f2740', sub: '#5b7c93', accent: '#0ea5e9', border: '#cfe8f7' },
    white:  { bg: '#ffffff', panel: '#f5f5f7', field: '#ffffff', text: '#17171a', sub: '#6b6b70', accent: '#2563eb', border: '#e1e1e6' }
  };

  let theme = localStorage.getItem(THEME_KEY) || 'matte';
  const savedCustomAccent = localStorage.getItem(CUSTOM_COLOR_KEY) || '#8b5cf6';
  THEMES.custom = { ...THEMES.dark, accent: savedCustomAccent };
  if (!THEMES[theme]) theme = 'matte';

  // ---- Host + Shadow DOM (isolates styles from the host page) -------
  const host = document.createElement('div');
  host.id = 'gpa-root-host';
  host.style.cssText = 'all:initial; position:fixed; top:80px; left:80px; z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  // Best-effort load of a nicer monospace font for AI responses. If the
  // host page's CSP blocks external stylesheets, this silently no-ops and
  // the CSS font-family fallback stack (system monospace fonts) is used.
  if (!document.getElementById('gpa-font-link')) {
    try {
      const fontLink = document.createElement('link');
      fontLink.id = 'gpa-font-link';
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap';
      document.head.appendChild(fontLink);
    } catch (e) { /* ignore — falls back to system monospace fonts */ }
  }

  const style = document.createElement('style');
  root.appendChild(style);

  // Wrapper lets an ambient particle canvas float around the panel's edges
  // without sitting on top of (or blocking clicks on) any actual content.
  const particleWrap = document.createElement('div');
  particleWrap.className = 'gpa-particle-wrap';
  root.appendChild(particleWrap);

  const particleCanvas = document.createElement('canvas');
  particleCanvas.id = 'gpa-particles';
  particleWrap.appendChild(particleCanvas);

  const panel = document.createElement('div');
  panel.className = 'gpa-panel';
  particleWrap.appendChild(panel);

  panel.innerHTML = `
    <div class="gpa-header" id="gpa-drag">
      <button id="gpa-min" title="Minimize">&minus;</button>
      <span class="gpa-title">Gemini Page Assistant</span>
      <span class="gpa-dot"></span>
      <button id="gpa-close" title="Close">&times;</button>
    </div>
    <div class="gpa-body" id="gpa-body">
      <div class="gpa-dropdown" id="gpa-dropdown">
        <button class="gpa-dropdown-btn" id="gpa-dropdown-btn">
          <span id="gpa-dropdown-label">Scan &amp; Analyze</span>
          <svg class="gpa-chevron" viewBox="0 0 20 20" width="13" height="13"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="gpa-dropdown-menu" id="gpa-dropdown-menu">
          <button class="gpa-dropdown-item active" data-tab="scan">Scan &amp; Analyze</button>
          <button class="gpa-dropdown-item" data-tab="ask">Ask AI</button>
          <button class="gpa-dropdown-item" data-tab="music">Music</button>
          <button class="gpa-dropdown-item" data-tab="browser">Browser</button>
          <button class="gpa-dropdown-item" data-tab="theme">Theme</button>
        </div>
      </div>

      <div class="gpa-pane active" data-pane="scan">
        <div class="gpa-row">
          <button id="gpa-scan-btn" class="gpa-btn">Scan page text</button>
          <button id="gpa-capture-btn" class="gpa-btn">Capture screen</button>
        </div>
        <div class="gpa-row" id="gpa-status-row" style="display:none;">
          <img id="gpa-thumb" alt="captured screen" />
          <span id="gpa-scan-status" class="gpa-sub"></span>
          <button id="gpa-clear-context" class="gpa-btn" title="Clear captured page text and screenshot">Clear</button>
        </div>
        <div class="gpa-row gpa-actions" id="gpa-scan-actions" style="display:none;">
          <button class="gpa-btn primary" data-action="summarize">Summarize</button>
          <button class="gpa-btn primary" data-action="analyze">Analyze</button>
        </div>
        <div class="gpa-row" id="gpa-question-row" style="display:none;">
          <input id="gpa-question" class="gpa-input" placeholder="Ask a question about this page…" />
          <button id="gpa-question-btn" class="gpa-btn primary">Answer</button>
        </div>
        <div id="gpa-scan-output" class="gpa-output"></div>
      </div>

      <div class="gpa-pane" data-pane="ask">
        <div id="gpa-chat" class="gpa-chat"></div>
        <div class="gpa-row">
          <input id="gpa-ask-input" class="gpa-input" placeholder="Ask me anything…" />
          <button id="gpa-ask-btn" class="gpa-btn primary">Send</button>
        </div>
      </div>

      <div class="gpa-pane" data-pane="music">
        <div class="gpa-row">
          <input id="gpa-music-query" class="gpa-input" placeholder="Type a song name or description…" />
          <button id="gpa-music-search" class="gpa-btn primary">Play</button>
        </div>
        <div id="gpa-music-status" class="gpa-sub" style="margin-bottom:6px;"></div>
        <div id="gpa-music-wrap" class="gpa-sc-wrap"></div>

        <div class="gpa-sub" style="margin:12px 0 6px;">Or paste a SoundCloud link directly:</div>
        <div class="gpa-row">
          <input id="gpa-sc-url" class="gpa-input" placeholder="soundcloud.com/…" />
          <button id="gpa-sc-load" class="gpa-btn">Load</button>
        </div>
        <div id="gpa-sc-wrap" class="gpa-sc-wrap"></div>
      </div>

      <div class="gpa-pane" data-pane="browser">
        <div class="gpa-row">
          <input id="gpa-browser-url" class="gpa-input" placeholder="Enter a URL…" />
          <button id="gpa-browser-go" class="gpa-btn primary">Go</button>
        </div>
        <div class="gpa-sub" style="margin-bottom:8px;">Sites that block embedding (banks, most social apps, soundcloud.com itself) won't load here — that's a security setting on their end which this doesn't try to bypass. Use the Music tab for actual SoundCloud playback.</div>
        <iframe id="gpa-browser-frame" class="gpa-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
      </div>

      <div class="gpa-pane" data-pane="theme">
        <div class="gpa-sub" style="margin-bottom:8px;">Choose a color theme</div>
        <div class="gpa-swatches">
          <button class="gpa-swatch" data-theme="dark" style="background:#0b0b0f;border-color:#5b8cff;">Dark</button>
          <button class="gpa-swatch" data-theme="matte" style="background:#1a1a1a;border-color:#b0b0b0;">Matte Black</button>
          <button class="gpa-swatch" data-theme="red" style="background:#241010;border-color:#e5453a;">Red</button>
          <button class="gpa-swatch" data-theme="blue" style="background:#0f1e2e;border-color:#4da3ff;">Blue</button>
          <button class="gpa-swatch" data-theme="white" style="background:#f5f5f7;border-color:#2563eb;color:#111;">White</button>
          <button class="gpa-swatch" data-theme="purple" style="background:#1c1430;border-color:#8b5cf6;">Purple</button>
          <button class="gpa-swatch" data-theme="pink" style="background:#301425;border-color:#ec4899;">Pink</button>
          <button class="gpa-swatch" data-theme="lightblue" style="background:#eaf6ff;border-color:#0ea5e9;color:#111;">Light Blue</button>
        </div>
        <div class="gpa-row" style="margin-top:12px;">
          <label for="gpa-custom-color" class="gpa-sub" style="flex:1;">Custom color (pick any shade)</label>
          <input type="color" id="gpa-custom-color" class="gpa-color-input" value="#8b5cf6" />
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">AI provider</div>
        <div class="gpa-row">
          <button class="gpa-btn provider-btn primary" data-provider="gemini">Gemini</button>
          <button class="gpa-btn provider-btn" data-provider="openai">OpenAI</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Typing animation speed</div>
        <div class="gpa-row">
          <button class="gpa-btn speed-btn" data-speed="slow">Slow</button>
          <button class="gpa-btn speed-btn primary" data-speed="normal">Normal</button>
          <button class="gpa-btn speed-btn" data-speed="fast">Fast</button>
          <button class="gpa-btn speed-btn" data-speed="instant">Instant</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Response font</div>
        <div class="gpa-row">
          <button class="gpa-btn font-btn primary" data-font="mono">Typewriter</button>
          <button class="gpa-btn font-btn" data-font="system">Standard</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Background particles</div>
        <div class="gpa-row" style="flex-wrap: wrap;">
          <button class="gpa-btn particle-btn primary" data-particle="off">Off</button>
          <button class="gpa-btn particle-btn" data-particle="sparkles">Sparkles</button>
          <button class="gpa-btn particle-btn" data-particle="snow">Snow</button>
          <button class="gpa-btn particle-btn" data-particle="bubbles">Bubbles</button>
          <button class="gpa-btn particle-btn" data-particle="stars">Stars</button>
        </div>
        <div class="gpa-row" style="margin-top:6px;">
          <button class="gpa-btn density-btn" data-density="low">Low</button>
          <button class="gpa-btn density-btn primary" data-density="medium">Medium</button>
          <button class="gpa-btn density-btn" data-density="high">High</button>
        </div>
        <div class="gpa-row" style="margin-top:8px; flex-wrap: wrap;">
          <button id="gpa-clear-key" class="gpa-btn">Clear saved Gemini key</button>
          <button id="gpa-clear-openai-key" class="gpa-btn">Clear saved OpenAI key</button>
          <button id="gpa-clear-yt-key" class="gpa-btn">Clear saved YouTube key</button>
        </div>
      </div>
    </div>
  `;

  const minimized = document.createElement('div');
  minimized.className = 'gpa-mini';
  minimized.textContent = '✦';
  minimized.style.display = 'none';
  panel.appendChild(minimized);

  function applyTheme(name) {
    theme = THEMES[name] ? name : 'matte';
    localStorage.setItem(THEME_KEY, theme);
    const t = THEMES[theme];
    style.textContent = `
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .gpa-particle-wrap { position: relative; }
      #gpa-particles {
        position: absolute; inset: -40px; z-index: 0; pointer-events: none; display: none;
      }
      .gpa-panel { position: relative; z-index: 1; }
      .gpa-panel {
        width: 360px;
        height: 480px;
        display: flex;
        flex-direction: column;
        background: ${t.panel};
        color: ${t.text};
        border: 1px solid ${t.border};
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.45);
        overflow: hidden;
        user-select: none;
        animation: gpa-panel-in 0.32s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes gpa-panel-in {
        from { opacity: 0; transform: scale(0.92) translateY(8px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .gpa-header {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 10px;
        background: ${t.bg};
        cursor: grab;
        border-bottom: 1px solid ${t.border};
        flex-shrink: 0;
      }
      .gpa-header:active { cursor: grabbing; }
      #gpa-min {
        width: 20px; height: 20px; border-radius: 5px;
        border: 1px solid ${t.border};
        background: ${t.field};
        color: ${t.text};
        font-size: 14px; line-height: 1; cursor: pointer;
        display:flex; align-items:center; justify-content:center;
        flex-shrink: 0;
      }
      .gpa-title { font-size: 12.5px; font-weight: 600; letter-spacing: 0.2px; flex: 1; }
      .gpa-dot {
        width: 7px; height: 7px; border-radius: 50%; background: ${t.accent}; flex-shrink:0;
        box-shadow: 0 0 0 0 ${t.accent}80;
        animation: gpa-dot-pulse 2.4s ease-in-out infinite;
      }
      @keyframes gpa-dot-pulse {
        0%, 100% { box-shadow: 0 0 0 0 ${t.accent}66; }
        50% { box-shadow: 0 0 0 4px ${t.accent}00; }
      }
      #gpa-close {
        width: 20px; height: 20px; border-radius: 5px;
        border: 1px solid ${t.border};
        background: ${t.field};
        color: ${t.text};
        font-size: 14px; line-height: 1; cursor: pointer;
        display:flex; align-items:center; justify-content:center;
        flex-shrink: 0;
      }
      #gpa-close:hover { background: #e5453a; border-color: #e5453a; color: #fff; }
      .gpa-body { padding: 10px; user-select: text; flex: 1; overflow-y: auto; display: flex; flex-direction: column; min-height: 0; }
      .gpa-dropdown { position: relative; margin-bottom: 10px; flex-shrink: 0; }
      .gpa-dropdown-btn {
        width: 100%; display: flex; align-items: center; justify-content: space-between;
        padding: 9px 12px; font-size: 12.5px; font-weight: 700; letter-spacing: 0.2px;
        border-radius: 9px; cursor: pointer; color: ${t.text};
        border: 1px solid ${t.border};
        background: linear-gradient(180deg, ${t.field}, ${t.panel});
        box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .gpa-dropdown-btn:hover { border-color: ${t.accent}; }
      .gpa-dropdown.open .gpa-dropdown-btn {
        border-color: ${t.accent};
        box-shadow: 0 0 0 3px ${t.accent}33;
      }
      .gpa-chevron { color: ${t.accent}; flex-shrink: 0; transition: transform 0.18s ease; }
      .gpa-dropdown.open .gpa-chevron { transform: rotate(180deg); }
      .gpa-dropdown-menu {
        position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 5;
        background: ${t.panel}; border: 1px solid ${t.border}; border-radius: 10px;
        box-shadow: 0 14px 30px rgba(0,0,0,0.5);
        overflow: hidden; opacity: 0; transform: translateY(-4px) scale(0.98);
        pointer-events: none; transition: opacity 0.14s ease, transform 0.14s ease;
      }
      .gpa-dropdown.open .gpa-dropdown-menu { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
      .gpa-dropdown-item {
        display: block; width: 100%; text-align: left; padding: 9px 12px;
        font-size: 12px; font-weight: 600; color: ${t.sub};
        background: transparent; border: none; border-bottom: 1px solid ${t.border};
        cursor: pointer;
      }
      .gpa-dropdown-item:last-child { border-bottom: none; }
      .gpa-dropdown-item:hover { background: ${t.field}; color: ${t.text}; }
      .gpa-dropdown-item.active { color: ${t.accent}; }
      .gpa-dropdown-item.active::before { content: '● '; }
      .gpa-pane { display: none; }
      .gpa-pane.active {
        display: flex; flex-direction: column; flex: 1; min-height: 0;
        animation: gpa-pane-in 0.22s ease both;
      }
      @keyframes gpa-pane-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .gpa-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-shrink: 0; }
      .gpa-actions { flex-wrap: wrap; }
      .gpa-input {
        flex: 1; padding: 7px 9px; border-radius: 7px;
        border: 1px solid ${t.border}; background: ${t.field}; color: ${t.text};
        font-size: 12.5px; outline: none;
      }
      .gpa-input:focus { border-color: ${t.accent}; }
      .gpa-btn {
        padding: 7px 10px; border-radius: 7px; border: 1px solid ${t.border};
        background: ${t.field}; color: ${t.text}; font-size: 12px; font-weight: 600;
        cursor: pointer; white-space: nowrap;
        transition: border-color 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
      }
      .gpa-btn:hover { border-color: ${t.accent}; transform: translateY(-1px); }
      .gpa-btn:active { transform: translateY(0) scale(0.96); }
      .gpa-btn.primary { background: ${t.accent}; color: #fff; border-color: ${t.accent}; }
      .gpa-btn.primary:hover { box-shadow: 0 0 0 3px ${t.accent}33; }
      .gpa-sub { color: ${t.sub}; font-size: 11px; flex: 1; }
      .gpa-output {
        margin-top: 6px; flex: 1; min-height: 80px; overflow-y: auto;
        font-size: 12.5px; line-height: 1.6; white-space: pre-wrap;
        overflow-wrap: break-word; word-break: break-word;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        padding: 8px; background: ${t.field}; border-radius: 8px;
        border: 1px solid ${t.border};
      }
      .gpa-error {
        display: flex; align-items: flex-start; gap: 8px;
        background: rgba(229, 69, 58, 0.1); border: 1px solid rgba(229, 69, 58, 0.35);
        border-radius: 8px; padding: 9px 10px; color: ${t.text};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .gpa-error-icon { flex-shrink: 0; font-size: 14px; line-height: 1.4; }
      .gpa-cursor {
        display: inline-block; width: 2px; height: 1em;
        background: ${t.accent}; margin-left: 1px; vertical-align: text-bottom;
        animation: gpa-blink 0.85s steps(1) infinite;
      }
      @keyframes gpa-blink { 50% { opacity: 0; } }
      .gpa-answer-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
        gap: 8px;
      }
      .gpa-grid-cell {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 3px; padding: 9px 4px; border-radius: 9px;
        background: ${t.panel}; border: 1px solid ${t.border};
        animation: gpa-cell-in 0.3s ease both;
      }
      .gpa-grid-q { font-size: 10px; font-weight: 700; letter-spacing: 0.3px; color: ${t.sub}; }
      .gpa-grid-a {
        font-size: 16px; font-weight: 800; color: ${t.accent};
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      }
      @keyframes gpa-cell-in {
        from { opacity: 0; transform: scale(0.82) translateY(5px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .gpa-chat {
        flex: 1; min-height: 80px; overflow-y: auto; margin-bottom: 8px;
        display: flex; flex-direction: column; gap: 6px;
      }
      .gpa-msg { padding: 7px 9px; border-radius: 8px; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word; }
      .gpa-msg.user { background: ${t.accent}; color: #fff; align-self: flex-end; max-width: 85%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .gpa-msg.ai { background: ${t.field}; border: 1px solid ${t.border}; align-self: flex-start; max-width: 90%; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace; }
      .gpa-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
      .gpa-swatch {
        width: 56px; height: 34px; border-radius: 8px; border: 2px solid transparent;
        cursor: pointer; font-size: 9px; color: #fff; font-weight: 700;
      }
      .gpa-color-input {
        width: 34px; height: 28px; padding: 0; border: 1px solid ${t.border};
        border-radius: 6px; background: ${t.field}; cursor: pointer;
      }
      .provider-btn { flex: 1; }
      .provider-btn.primary { background: ${t.accent}; color: #fff; border-color: ${t.accent}; }
      .speed-btn, .font-btn, .particle-btn, .density-btn { flex: 1; padding: 6px 4px; font-size: 11px; }
      .speed-btn.primary, .font-btn.primary, .particle-btn.primary, .density-btn.primary { background: ${t.accent}; color: #fff; border-color: ${t.accent}; }
      .gpa-font-system .gpa-output, .gpa-font-system .gpa-msg.ai {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      .gpa-mini {
        width: 40px; height: 40px; border-radius: 50%;
        background: ${t.accent}; color: #fff; display: flex;
        align-items: center; justify-content: center; font-size: 18px;
        cursor: grab; box-shadow: 0 8px 20px rgba(0,0,0,0.4);
      }
      #gpa-thumb {
        display: none; width: 34px; height: 34px; object-fit: cover;
        border-radius: 6px; border: 1px solid ${t.border}; flex-shrink: 0;
      }
      #gpa-thumb.show { display: block; }
      .gpa-iframe {
        flex: 1; width: 100%; min-height: 120px; border-radius: 8px;
        border: 1px solid ${t.border}; background: #000;
      }
      .gpa-sc-wrap { flex: 1; overflow-y: auto; }
      .gpa-sc-frame { width: 100%; height: 166px; border: 0; border-radius: 8px; }

      /* Themed scrollbars — thumb matches the current accent color */
      .gpa-body, .gpa-output, .gpa-chat, .gpa-sc-wrap {
        scrollbar-width: thin;
        scrollbar-color: ${t.accent} ${t.field};
      }
      .gpa-body::-webkit-scrollbar, .gpa-output::-webkit-scrollbar,
      .gpa-chat::-webkit-scrollbar, .gpa-sc-wrap::-webkit-scrollbar {
        width: 8px; height: 8px;
      }
      .gpa-body::-webkit-scrollbar-track, .gpa-output::-webkit-scrollbar-track,
      .gpa-chat::-webkit-scrollbar-track, .gpa-sc-wrap::-webkit-scrollbar-track {
        background: ${t.field}; border-radius: 8px;
      }
      .gpa-body::-webkit-scrollbar-thumb, .gpa-output::-webkit-scrollbar-thumb,
      .gpa-chat::-webkit-scrollbar-thumb, .gpa-sc-wrap::-webkit-scrollbar-thumb {
        background: ${t.accent}; border-radius: 8px; border: 2px solid ${t.field};
      }
      .gpa-body::-webkit-scrollbar-thumb:hover, .gpa-output::-webkit-scrollbar-thumb:hover,
      .gpa-chat::-webkit-scrollbar-thumb:hover, .gpa-sc-wrap::-webkit-scrollbar-thumb:hover {
        background: ${t.sub};
      }
      .gpa-body::-webkit-scrollbar-corner { background: transparent; }
    `;
  }
  applyTheme(theme);

  // ---- Drag logic -----------------------------------------------------
  (function makeDraggable() {
    let dragging = null, offX = 0, offY = 0;

    function start(e) {
      dragging = host;
      const rect = host.getBoundingClientRect();
      const p = 'touches' in e ? e.touches[0] : e;
      offX = p.clientX - rect.left;
      offY = p.clientY - rect.top;
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      const p = 'touches' in e ? e.touches[0] : e;
      let x = p.clientX - offX, y = p.clientY - offY;
      x = Math.max(0, Math.min(window.innerWidth - 60, x));
      y = Math.max(0, Math.min(window.innerHeight - 40, y));
      host.style.left = x + 'px';
      host.style.top = y + 'px';
    }
    function end() { dragging = null; }

    root.addEventListener('mousedown', (e) => {
      if (e.target.closest('#gpa-drag') || e.target.closest('.gpa-mini')) start(e);
    });
    root.addEventListener('touchstart', (e) => {
      if (e.target.closest('#gpa-drag') || e.target.closest('.gpa-mini')) start(e);
    }, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
  })();

  // ---- Minimize / restore ---------------------------------------------
  const body = panel.querySelector('#gpa-body');
  const headerEl = panel.querySelector('.gpa-header');
  panel.querySelector('#gpa-min').addEventListener('click', () => setMinimized(true));
  minimized.addEventListener('click', () => setMinimized(false));
  host.addEventListener('gpa-toggle', () => setMinimized(!isMin));
  panel.querySelector('#gpa-close').addEventListener('click', () => host.remove());

  let isMin = false;
  function setMinimized(v) {
    isMin = v;
    body.style.display = v ? 'none' : 'flex';
    headerEl.style.display = v ? 'none' : 'flex';
    minimized.style.display = v ? 'flex' : 'none';
    panel.style.width = v ? 'auto' : '';
    panel.style.height = v ? 'auto' : '';
    panel.style.background = v ? 'transparent' : THEMES[theme].panel;
    panel.style.boxShadow = v ? 'none' : '';
    panel.style.border = v ? 'none' : '';

    const activeParticleStyle = localStorage.getItem(PARTICLE_KEY) || 'off';
    if (v) {
      particleCanvas.style.display = 'none';
      if (particleAnimId) { cancelAnimationFrame(particleAnimId); particleAnimId = null; }
    } else if (activeParticleStyle !== 'off') {
      particleCanvas.style.display = 'block';
      if (!particleAnimId) stepParticles();
    }
  }

  // ---- Dropdown section switcher -----------------------------------------
  const dropdown = panel.querySelector('#gpa-dropdown');
  const dropdownBtn = panel.querySelector('#gpa-dropdown-btn');
  const dropdownLabel = panel.querySelector('#gpa-dropdown-label');

  dropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  root.addEventListener('click', (e) => {
    if (!e.target.closest('#gpa-dropdown')) dropdown.classList.remove('open');
  });

  panel.querySelectorAll('.gpa-dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
      panel.querySelectorAll('.gpa-dropdown-item').forEach((b) => b.classList.remove('active'));
      panel.querySelectorAll('.gpa-pane').forEach((p) => p.classList.remove('active'));
      item.classList.add('active');
      panel.querySelector(`.gpa-pane[data-pane="${item.dataset.tab}"]`).classList.add('active');
      dropdownLabel.textContent = item.textContent;
      dropdown.classList.remove('open');
    });
  });

  // ---- Theme swatches -----------------------------------------------------
  panel.querySelectorAll('.gpa-swatch').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  const customColorInput = panel.querySelector('#gpa-custom-color');
  customColorInput.value = savedCustomAccent;
  customColorInput.addEventListener('input', (e) => {
    const color = e.target.value;
    localStorage.setItem(CUSTOM_COLOR_KEY, color);
    THEMES.custom = { ...THEMES.dark, accent: color };
    applyTheme('custom');
  });

  panel.querySelector('#gpa-clear-key').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    alert('Saved Gemini API key cleared for this site.');
  });
  panel.querySelector('#gpa-clear-openai-key').addEventListener('click', () => {
    localStorage.removeItem(OPENAI_STORAGE_KEY);
    alert('Saved OpenAI API key cleared for this site.');
  });
  panel.querySelector('#gpa-clear-yt-key').addEventListener('click', () => {
    localStorage.removeItem(YT_STORAGE_KEY);
    alert('Saved YouTube API key cleared for this site.');
  });

  // ---- AI provider toggle (Gemini / OpenAI) ------------------------------
  const providerBtns = panel.querySelectorAll('.provider-btn');
  function setProviderUI(p) {
    providerBtns.forEach((b) => b.classList.toggle('primary', b.dataset.provider === p));
  }
  setProviderUI(localStorage.getItem(PROVIDER_KEY) || 'gemini');
  providerBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(PROVIDER_KEY, btn.dataset.provider);
      setProviderUI(btn.dataset.provider);
    });
  });

  // ---- Typing speed toggle ------------------------------------------------
  const speedBtns = panel.querySelectorAll('.speed-btn');
  function setSpeedUI(s) {
    speedBtns.forEach((b) => b.classList.toggle('primary', b.dataset.speed === s));
  }
  setSpeedUI(localStorage.getItem(SPEED_KEY) || 'normal');
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(SPEED_KEY, btn.dataset.speed);
      setSpeedUI(btn.dataset.speed);
    });
  });

  // ---- Response font toggle ------------------------------------------------
  const fontBtns = panel.querySelectorAll('.font-btn');
  function setFontUI(f) {
    fontBtns.forEach((b) => b.classList.toggle('primary', b.dataset.font === f));
    panel.classList.toggle('gpa-font-system', f === 'system');
  }
  setFontUI(localStorage.getItem(FONT_KEY) || 'mono');
  fontBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(FONT_KEY, btn.dataset.font);
      setFontUI(btn.dataset.font);
    });
  });

  // ---- Ambient particle background ---------------------------------------
  // A canvas that floats around the panel's edges (not on top of content,
  // so it never blocks a click) with a few interactive styles. Particles
  // gently drift away from the cursor and are tinted with the current
  // theme's accent color, so switching themes re-colors them automatically.
  const particleCtx = particleCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  particleCanvas.width = PARTICLE_BASE_W * dpr;
  particleCanvas.height = PARTICLE_BASE_H * dpr;
  particleCtx.scale(dpr, dpr);

  let particles = [];
  let particleAnimId = null;
  let mouseX = -9999, mouseY = -9999;

  particleWrap.addEventListener('mousemove', (e) => {
    const rect = particleCanvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  });
  particleWrap.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const num = parseInt(full, 16);
    return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`;
  }

  function makeParticle(styleName) {
    const w = PARTICLE_BASE_W, h = PARTICLE_BASE_H;
    const p = { style: styleName };
    if (styleName === 'snow') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.3; p.vy = 0.3 + Math.random() * 0.6;
      p.r = 1 + Math.random() * 2; p.alpha = 0.4 + Math.random() * 0.5; p.sway = Math.random() * Math.PI * 2;
    } else if (styleName === 'bubbles') {
      p.x = Math.random() * w; p.y = h + Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.2; p.vy = -(0.3 + Math.random() * 0.5);
      p.r = 2 + Math.random() * 4; p.alpha = 0.15 + Math.random() * 0.25; p.wobble = Math.random() * Math.PI * 2;
    } else if (styleName === 'stars') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = 0; p.vy = 0; p.r = 1 + Math.random() * 1.8;
      p.phase = Math.random() * Math.PI * 2; p.speed = 0.015 + Math.random() * 0.03;
    } else { // sparkles (default)
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.15; p.vy = (Math.random() - 0.5) * 0.15;
      p.r = 0.6 + Math.random() * 1.6; p.phase = Math.random() * Math.PI * 2; p.speed = 0.02 + Math.random() * 0.04;
    }
    return p;
  }

  function initParticles(styleName) {
    particles = [];
    if (styleName === 'off') return;
    const density = localStorage.getItem(PARTICLE_DENSITY_KEY) || 'medium';
    const count = { low: 18, medium: 34, high: 55 }[density] || 34;
    for (let i = 0; i < count; i++) particles.push(makeParticle(styleName));
  }

  function stepParticles() {
    const styleName = localStorage.getItem(PARTICLE_KEY) || 'off';
    if (styleName === 'off') {
      particleCtx.clearRect(0, 0, PARTICLE_BASE_W, PARTICLE_BASE_H);
      particleAnimId = null;
      return;
    }
    const w = PARTICLE_BASE_W, h = PARTICLE_BASE_H;
    particleCtx.clearRect(0, 0, w, h);
    const accent = THEMES[theme].accent;
    particles.forEach((p) => {
      const dx = p.x - mouseX, dy = p.y - mouseY;
      const dist = Math.hypot(dx, dy);
      if (dist < 60 && dist > 0.01) {
        const force = ((60 - dist) / 60) * 1.4;
        p.x += (dx / dist) * force;
        p.y += (dy / dist) * force;
      }
      let alpha = 0.6;
      if (p.style === 'snow') {
        p.sway += 0.02;
        p.x += p.vx + Math.sin(p.sway) * 0.3;
        p.y += p.vy;
        if (p.y > h + 5) { p.y = -5; p.x = Math.random() * w; }
        alpha = p.alpha;
      } else if (p.style === 'bubbles') {
        p.wobble += 0.03;
        p.x += p.vx + Math.sin(p.wobble) * 0.4;
        p.y += p.vy;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        alpha = p.alpha;
      } else if (p.style === 'stars') {
        p.phase += p.speed;
        alpha = 0.2 + Math.abs(Math.sin(p.phase)) * 0.8;
      } else { // sparkles
        p.x += p.vx; p.y += p.vy;
        p.phase += p.speed;
        alpha = 0.25 + Math.abs(Math.sin(p.phase)) * 0.75;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      }
      particleCtx.beginPath();
      particleCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      particleCtx.fillStyle = hexToRgba(accent, alpha);
      particleCtx.fill();
    });
    particleAnimId = requestAnimationFrame(stepParticles);
  }

  function setParticleStyle(styleName) {
    localStorage.setItem(PARTICLE_KEY, styleName);
    particleCanvas.style.display = styleName === 'off' || isMin ? 'none' : 'block';
    initParticles(styleName);
    if (particleAnimId) cancelAnimationFrame(particleAnimId);
    particleAnimId = null;
    if (styleName !== 'off' && !isMin) stepParticles();
  }

  const particleBtns = panel.querySelectorAll('.particle-btn');
  function setParticleUI(s) {
    particleBtns.forEach((b) => b.classList.toggle('primary', b.dataset.particle === s));
  }
  const densityBtns = panel.querySelectorAll('.density-btn');
  function setDensityUI(d) {
    densityBtns.forEach((b) => b.classList.toggle('primary', b.dataset.density === d));
  }
  setParticleUI(localStorage.getItem(PARTICLE_KEY) || 'off');
  setDensityUI(localStorage.getItem(PARTICLE_DENSITY_KEY) || 'medium');
  setParticleStyle(localStorage.getItem(PARTICLE_KEY) || 'off');

  particleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setParticleUI(btn.dataset.particle);
      setParticleStyle(btn.dataset.particle);
    });
  });
  densityBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(PARTICLE_DENSITY_KEY, btn.dataset.density);
      setDensityUI(btn.dataset.density);
      initParticles(localStorage.getItem(PARTICLE_KEY) || 'off');
    });
  });

  // ---- Gemini API helpers -----------------------------------------------
  function getApiKey() {
    let key = API_KEY_DEFAULT || localStorage.getItem(STORAGE_KEY);
    if (!key) {
      key = prompt('Paste your Gemini API key (from aistudio.google.com/apikey):');
      if (key) localStorage.setItem(STORAGE_KEY, key.trim());
    }
    return key ? key.trim() : null;
  }

  async function callGemini(userText, systemText, imageDataUrls) {
    const key = getApiKey();
    if (!key) throw new Error('No API key provided.');

    const parts = [];
    if (userText) parts.push({ text: userText });
    if (imageDataUrls && imageDataUrls.length) {
      imageDataUrls.forEach((dataUrl) => {
        const match = dataUrl.match(/^data:(.+);base64,(.*)$/);
        if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
      });
    }
    if (!parts.length) throw new Error('Nothing to send.');

    const body = { contents: [{ role: 'user', parts }] };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

    const res = await fetch(`${API_BASE}${MODEL}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '(no response)';
    return text;
  }

  // ---- OpenAI API helpers -------------------------------------------------
  function getOpenAiKey() {
    let key = localStorage.getItem(OPENAI_STORAGE_KEY);
    if (!key) {
      key = prompt('Paste your OpenAI API key (starts with "sk-"):');
      if (key) {
        key = key.trim();
        if (!key.startsWith('sk-')) {
          alert('That doesn\'t look like an OpenAI key — they normally start with "sk-". Saving it anyway; double-check if requests fail.');
        }
        localStorage.setItem(OPENAI_STORAGE_KEY, key);
      }
    }
    return key ? key.trim() : null;
  }

  async function callOpenAI(userText, systemText, imageDataUrls) {
    const key = getOpenAiKey();
    if (!key) throw new Error('No OpenAI API key provided.');

    const content = [];
    if (userText) content.push({ type: 'text', text: userText });
    if (imageDataUrls && imageDataUrls.length) {
      imageDataUrls.forEach((dataUrl) => content.push({ type: 'image_url', image_url: { url: dataUrl } }));
    }
    if (!content.length) throw new Error('Nothing to send.');

    const messages = [];
    if (systemText) messages.push({ role: 'system', content: systemText });
    messages.push({ role: 'user', content });

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({ model: OPENAI_MODEL, messages })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI API error (${res.status}): ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '(no response)';
  }

  // Dispatches to whichever provider is selected in the Theme tab.
  async function callAI(userText, systemText, imageDataUrls) {
    const provider = localStorage.getItem(PROVIDER_KEY) || 'gemini';
    return provider === 'openai'
      ? callOpenAI(userText, systemText, imageDataUrls)
      : callGemini(userText, systemText, imageDataUrls);
  }

  // ---- Friendly error display ---------------------------------------------
  // Turns raw API error text (status codes, JSON bodies) into one plain
  // sentence, and renders it in a small styled box instead of a code dump.
  function explainError(err, label) {
    const msg = (err && err.message) || String(err);
    const statusMatch = msg.match(/\((\d{3})\)/);
    const status = statusMatch ? statusMatch[1] : null;

    if (/No .*API key provided/i.test(msg)) return 'No API key entered yet — try again and paste one when prompted.';
    if (/Nothing to send|Nothing to analyze/i.test(msg)) return 'Nothing to work with yet — scan the page, capture the screen, or type something first.';
    if (status === '401' || /invalid.*key|unauthorized|API key not valid/i.test(msg)) {
      return `${label} rejected your API key. Double-check it (or clear and re-enter it) in the Theme tab.`;
    }
    if (status === '429' || /quota|credit|rate.?limit/i.test(msg)) {
      return `${label} says you're out of credits or hitting a rate limit. Check your billing/usage there, or switch providers in the Theme tab.`;
    }
    if (status === '404' || /model.*(not found|no longer available)/i.test(msg)) {
      return `${label}'s model name may have changed on their end and needs updating in the script.`;
    }
    if (/network|failed to fetch/i.test(msg)) {
      return `Couldn't reach ${label} — check your connection and try again.`;
    }
    return `Something went wrong talking to ${label}${status ? ` (error ${status})` : ''}. Try again in a moment.`;
  }

  function showError(el, err, label) {
    el.innerHTML = `<div class="gpa-error"><span class="gpa-error-icon">⚠</span><span>${explainError(err, label)}</span></div>`;
  }

  function currentProviderLabel() {
    return (localStorage.getItem(PROVIDER_KEY) || 'gemini') === 'openai' ? 'OpenAI' : 'Gemini';
  }

  // ---- Typewriter effect for AI responses ---------------------------------
  // Reveals text a few characters at a time with a blinking cursor. Speed
  // scales with length so long answers don't take forever to finish, and
  // is user-adjustable (Slow/Normal/Fast/Instant) in the Theme tab.
  function typeText(el, fullText, scrollContainer) {
    const speedSetting = localStorage.getItem(SPEED_KEY) || 'normal';
    if (speedSetting === 'instant') {
      el.classList.remove('gpa-typing');
      el.textContent = fullText;
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      return;
    }
    const delayMs = { slow: 28, normal: 12, fast: 4 }[speedSetting] || 12;
    el.classList.add('gpa-typing');
    el.textContent = '';
    const cursor = document.createElement('span');
    cursor.className = 'gpa-cursor';
    el.appendChild(cursor);
    const total = fullText.length;
    const chunk = Math.max(1, Math.ceil(total / 400));
    let i = 0;
    function step() {
      if (i >= total) {
        cursor.remove();
        el.classList.remove('gpa-typing');
        return;
      }
      cursor.insertAdjacentText('beforebegin', fullText.slice(i, i + chunk));
      i += chunk;
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      setTimeout(step, delayMs);
    }
    step();
  }

  // ---- Structured answer grid (for "answers to questions 1-10" style asks) --
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function tryParseAnswerGrid(text) {
    const trimmed = text.trim();
    if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) return null;
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.length && arr.every((it) => it && typeof it === 'object' && 'q' in it && 'a' in it)) {
        return arr;
      }
    } catch (e) { /* not JSON — fall through to plain text */ }
    return null;
  }

  function renderAnswerGrid(el, arr) {
    el.classList.remove('gpa-typing');
    const cells = arr.map((it, idx) =>
      `<div class="gpa-grid-cell" style="animation-delay:${idx * 35}ms">
         <span class="gpa-grid-q">${escapeHtml(it.q)}</span>
         <span class="gpa-grid-a">${escapeHtml(it.a)}</span>
       </div>`
    ).join('');
    el.innerHTML = `<div class="gpa-answer-grid">${cells}</div>`;
  }

  function extractPageText() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,svg,canvas,iframe').forEach((el) => el.remove());
    let text = clone.innerText || clone.textContent || '';
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > MAX_PAGE_CHARS) text = text.slice(0, MAX_PAGE_CHARS) + '\n\n[...truncated...]';
    return text;
  }

  // Opens the browser's native screen/window/tab picker, grabs ONE frame,
  // then immediately stops sharing. Requires a genuine user click and https.
  async function captureScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Screen capture is not supported in this context (needs https).');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'never' },
      audio: false
    });
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const vw = video.videoWidth, vh = video.videoHeight;
      const scale = Math.min(1, MAX_IMAGE_WIDTH / vw);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

      return canvas.toDataURL('image/png');
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  // ---- Scan & Analyze tab ------------------------------------------------
  let pageText = '';
  let screenshotDataUrl = '';

  const scanBtn = panel.querySelector('#gpa-scan-btn');
  const captureBtn = panel.querySelector('#gpa-capture-btn');
  const statusRow = panel.querySelector('#gpa-status-row');
  const scanStatus = panel.querySelector('#gpa-scan-status');
  const thumb = panel.querySelector('#gpa-thumb');
  const clearBtn = panel.querySelector('#gpa-clear-context');
  const scanActions = panel.querySelector('#gpa-scan-actions');
  const questionRow = panel.querySelector('#gpa-question-row');
  const scanOutput = panel.querySelector('#gpa-scan-output');

  function refreshStatus() {
    const parts = [];
    if (pageText) parts.push(`${pageText.length.toLocaleString()} chars of page text`);
    if (screenshotDataUrl) parts.push('screenshot captured');
    const has = parts.length > 0;
    statusRow.style.display = has ? 'flex' : 'none';
    scanActions.style.display = has ? 'flex' : 'none';
    questionRow.style.display = has ? 'flex' : 'none';
    scanStatus.textContent = has ? parts.join(' + ') : '';
    thumb.classList.toggle('show', !!screenshotDataUrl);
    thumb.src = screenshotDataUrl || '';
  }

  scanBtn.addEventListener('click', () => {
    pageText = extractPageText();
    scanOutput.textContent = '';
    refreshStatus();
  });

  captureBtn.addEventListener('click', async () => {
    const prevLabel = captureBtn.textContent;
    captureBtn.textContent = 'Choose a tab/window…';
    captureBtn.disabled = true;
    try {
      screenshotDataUrl = await captureScreen();
      scanOutput.textContent = '';
      refreshStatus();
    } catch (e) {
      scanOutput.textContent = 'Screen capture cancelled or failed: ' + e.message;
    } finally {
      captureBtn.textContent = prevLabel;
      captureBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', () => {
    pageText = '';
    screenshotDataUrl = '';
    scanOutput.textContent = '';
    refreshStatus();
  });

  panel.querySelectorAll('#gpa-scan-actions .gpa-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!pageText && !screenshotDataUrl) { scanOutput.textContent = 'Scan the page or capture the screen first.'; return; }
      const action = btn.dataset.action;
      const sys = action === 'summarize'
        ? 'Summarize the provided content in plain, everyday sentences — the shortest version that still covers the essentials. No markdown formatting (no asterisks, headers, or numbered/bulleted lists) since this is shown as plain text. If both page text and a screenshot are provided, use both together.'
        : 'Give a brief, plain-language read on the provided content: what it\'s about, the main point, and anything notable — a few sentences, not a breakdown. No markdown formatting (no asterisks, headers, or numbered/bulleted lists) since this is shown as plain text. If both page text and a screenshot are provided, use both together.';
      scanOutput.textContent = 'Thinking…';
      try {
        const textPart = pageText ? `PAGE TEXT:\n${pageText}` : '(no page text captured — use the screenshot)';
        const out = await callAI(textPart, sys, screenshotDataUrl ? [screenshotDataUrl] : null);
        typeText(scanOutput, out, scanOutput);
      } catch (e) {
        showError(scanOutput, e, currentProviderLabel());
      }
    });
  });

  panel.querySelector('#gpa-question-btn').addEventListener('click', askPageQuestion);
  panel.querySelector('#gpa-question').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') askPageQuestion();
  });

  async function askPageQuestion() {
    const input = panel.querySelector('#gpa-question');
    const q = input.value.trim();
    if (!q) return;
    if (!pageText && !screenshotDataUrl) { scanOutput.textContent = 'Scan the page or capture the screen first.'; return; }
    scanOutput.textContent = 'Thinking…';
    try {
      const sys = 'Answer the question using ONLY the provided context (page text and/or screenshot). If — and only if — the question is asking for answers to multiple numbered items (like a quiz, worksheet, or multiple-choice list), respond with ONLY a JSON array and nothing else, in exactly this shape: [{"q":"1","a":"B"},{"q":"2","a":"D"}] — "q" is the item number/label as a string, "a" is the short answer, one object per item, no extra commentary. For any other kind of question, answer in brief plain sentences with no markdown formatting (no asterisks, headers, or lists) since this is shown as plain text. If the answer is not in the content, say so in one short sentence.';
      const textPart = `${pageText ? `PAGE TEXT:\n${pageText}\n\n` : ''}QUESTION:\n${q}`;
      const out = await callAI(textPart, sys, screenshotDataUrl ? [screenshotDataUrl] : null);
      const grid = tryParseAnswerGrid(out);
      if (grid) renderAnswerGrid(scanOutput, grid);
      else typeText(scanOutput, out, scanOutput);
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    }
  }

  function getYoutubeApiKey() {
    let key = localStorage.getItem(YT_STORAGE_KEY);
    if (!key) {
      key = prompt('Paste a YouTube Data API v3 key (free, from console.cloud.google.com — enable "YouTube Data API v3" then create an API key):');
      if (key) localStorage.setItem(YT_STORAGE_KEY, key.trim());
    }
    return key ? key.trim() : null;
  }

  async function searchYoutube(query) {
    const key = getYoutubeApiKey();
    if (!key) throw new Error('No YouTube API key provided.');
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=1&q=${encodeURIComponent(query)}&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`YouTube API error (${res.status}): ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const item = data.items && data.items[0];
    if (!item) throw new Error('No matching song found.');
    return { id: item.id.videoId, title: item.snippet.title, channel: item.snippet.channelTitle };
  }

  // ---- SoundCloud tab (official embeddable player, no proxy) ------------
  const scInput = panel.querySelector('#gpa-sc-url');
  const scLoadBtn = panel.querySelector('#gpa-sc-load');
  const scWrap = panel.querySelector('#gpa-sc-wrap');

  function loadSoundCloud() {
    const url = scInput.value.trim();
    if (!/^https?:\/\/(www\.)?(soundcloud\.com|on\.soundcloud\.com)\//i.test(url)) {
      scWrap.textContent = 'Paste a valid soundcloud.com track or playlist link.';
      return;
    }
    const accentHex = THEMES[theme].accent.replace('#', '');
    const embedSrc = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23${accentHex}&auto_play=false&show_user=true&show_reposts=false&visual=false`;
    scWrap.innerHTML = `<iframe class="gpa-sc-frame" scrolling="no" frameborder="no" allow="autoplay" src="${embedSrc}"></iframe>`;
  }
  scLoadBtn.addEventListener('click', loadSoundCloud);
  scInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSoundCloud(); });

  // ---- Music search & play (YouTube Data API + official embed player) ----
  const musicQuery = panel.querySelector('#gpa-music-query');
  const musicSearchBtn = panel.querySelector('#gpa-music-search');
  const musicStatus = panel.querySelector('#gpa-music-status');
  const musicWrap = panel.querySelector('#gpa-music-wrap');

  async function playMusicSearch() {
    const q = musicQuery.value.trim();
    if (!q) return;
    musicStatus.textContent = 'Searching…';
    musicWrap.innerHTML = '';
    musicSearchBtn.disabled = true;
    try {
      const match = await searchYoutube(q);
      musicStatus.textContent = `Playing closest match: "${match.title}" — ${match.channel}`;
      musicWrap.innerHTML = `<iframe class="gpa-sc-frame" allow="autoplay; encrypted-media" src="https://www.youtube.com/embed/${match.id}?autoplay=1"></iframe>`;
    } catch (e) {
      showError(musicStatus, e, 'YouTube');
    } finally {
      musicSearchBtn.disabled = false;
    }
  }
  musicSearchBtn.addEventListener('click', playMusicSearch);
  musicQuery.addEventListener('keydown', (e) => { if (e.key === 'Enter') playMusicSearch(); });

  // ---- Browser tab (plain iframe — only loads sites that allow embedding) --
  const browserUrlInput = panel.querySelector('#gpa-browser-url');
  const browserGoBtn = panel.querySelector('#gpa-browser-go');
  const browserFrame = panel.querySelector('#gpa-browser-frame');

  function loadBrowserUrl() {
    let url = browserUrlInput.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    browserFrame.src = url;
  }
  browserGoBtn.addEventListener('click', loadBrowserUrl);
  browserUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBrowserUrl(); });

  // ---- Ask AI tab (general chat) -----------------------------------------
  const chatEl = panel.querySelector('#gpa-chat');
  const askInput = panel.querySelector('#gpa-ask-input');
  const askBtn = panel.querySelector('#gpa-ask-btn');

  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'gpa-msg ' + role;
    div.textContent = text;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  async function sendChat() {
    const q = askInput.value.trim();
    if (!q) return;
    addMsg('user', q);
    askInput.value = '';
    const thinking = document.createElement('div');
    thinking.className = 'gpa-msg ai';
    thinking.textContent = 'Thinking…';
    chatEl.appendChild(thinking);
    chatEl.scrollTop = chatEl.scrollHeight;
    try {
      const out = await callAI(q, 'You are a helpful, concise assistant. Reply in plain conversational sentences only — no markdown formatting (no asterisks, headers, or lists) since this is shown as plain text. Keep answers as short as possible while still being useful.');
      typeText(thinking, out, chatEl);
    } catch (e) {
      showError(thinking, e, currentProviderLabel());
    }
  }
  askBtn.addEventListener('click', sendChat);
  askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

})();

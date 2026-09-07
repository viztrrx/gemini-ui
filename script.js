/*!
 * Gemini Page Assistant — injectable console/bookmarklet AI overlay
 * -------------------------------------------------------------
 * WHAT THIS DOES
 *  - "Page Insights" tab: reads the visible TEXT of the current page
 *    (document.body.innerText) and/or captures an actual SCREENSHOT (via
 *    getDisplayMedia), and sends either or both to Gemini/OpenAI to
 *    summarize, analyze, or answer questions. Includes a "Solve quiz on
 *    this page" button that also reads dropdown (<select>) options and
 *    radio/checkbox choices the AI can't see from plain page text, then
 *    returns one answer per question — including multi-part ones like
 *    "2a"/"2b" — as a small animated answer grid.
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
 *  - A "Theme" section to change the panel's color scheme, plus optional
 *    ambient background particles (several styles, adjustable play area)
 *    and AI provider/typing-speed/response-font controls.
 *  - All sections are switched via a dropdown in place of tabs.
 *  - Draggable panel. Minimizing flies it to the bottom-right corner as
 *    a resting spot (still fully draggable from there); the minimized
 *    button's icon is customizable in Settings (original icon styles,
 *    not any company's actual logo — see note in Settings section).
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
  const ICON_KEY = 'gpa_mini_icon';
  const PANEL_SIZE_KEY = 'gpa_panel_size';
  const PANEL_SIZES = {
    compact: { w: 300, h: 400 },
    normal: { w: 360, h: 480 },
    large: { w: 420, h: 560 },
    xl: { w: 480, h: 640 }
  };
  const PARTICLE_KEY = 'gpa_particle_style';
  const PARTICLE_SIZE_KEY = 'gpa_particle_margin';
  let PARTICLE_PANEL_W = PANEL_SIZES.normal.w;
  let PARTICLE_PANEL_H = PANEL_SIZES.normal.h;
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
          <span id="gpa-dropdown-label">Page Insights</span>
          <svg class="gpa-chevron" viewBox="0 0 20 20" width="13" height="13"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="gpa-dropdown-menu" id="gpa-dropdown-menu">
          <button class="gpa-dropdown-item active" data-tab="scan">Page Insights</button>
          <button class="gpa-dropdown-item" data-tab="ask">Ask AI</button>
          <button class="gpa-dropdown-item" data-tab="music">Music</button>
          <button class="gpa-dropdown-item" data-tab="browser">Browser</button>
          <button class="gpa-dropdown-item" data-tab="theme">Settings</button>
        </div>
      </div>

      <div class="gpa-pane active" data-pane="scan">
        <div class="gpa-row">
          <button id="gpa-quiz-btn" class="gpa-btn quiz-btn">✨ Solve quiz on this page</button>
        </div>
        <div class="gpa-row">
          <button id="gpa-scan-btn" class="gpa-btn">Scan page text</button>
          <button id="gpa-capture-btn" class="gpa-btn">Capture screen</button>
        </div>
        <div class="gpa-row">
          <button id="gpa-upload-btn" class="gpa-btn">Upload image</button>
          <span class="gpa-sub">or paste (Ctrl+V) a screenshot anywhere in this panel</span>
          <input type="file" id="gpa-image-upload" accept="image/*" style="display:none" />
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
        <div class="gpa-sub" style="margin:14px 0 6px;">Minimized button icon</div>
        <div class="gpa-row" style="flex-wrap: wrap;">
          <button class="gpa-btn icon-btn primary" data-icon="dot">Dot</button>
          <button class="gpa-btn icon-btn" data-icon="sparkle">Sparkle</button>
          <button class="gpa-btn icon-btn" data-icon="bolt">Bolt</button>
          <button class="gpa-btn icon-btn" data-icon="orbit">Orbit</button>
          <button class="gpa-btn icon-btn" data-icon="chat">Chat</button>
          <button class="gpa-btn icon-btn" data-icon="letter">Letter (G/O)</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Interface size</div>
        <div class="gpa-row">
          <button class="gpa-btn size-btn" data-size="compact">Compact</button>
          <button class="gpa-btn size-btn primary" data-size="normal">Normal</button>
          <button class="gpa-btn size-btn" data-size="large">Large</button>
          <button class="gpa-btn size-btn" data-size="xl">XL</button>
        </div>
        <div class="gpa-sub" style="margin:14px 0 6px;">Background particles</div>
        <div class="gpa-row" style="flex-wrap: wrap;">
          <button class="gpa-btn particle-btn primary" data-particle="off">Off</button>
          <button class="gpa-btn particle-btn" data-particle="sparkles">Sparkles</button>
          <button class="gpa-btn particle-btn" data-particle="snow">Snow</button>
          <button class="gpa-btn particle-btn" data-particle="bubbles">Bubbles</button>
          <button class="gpa-btn particle-btn" data-particle="stars">Stars</button>
          <button class="gpa-btn particle-btn" data-particle="network">Network</button>
          <button class="gpa-btn particle-btn" data-particle="fireflies">Fireflies</button>
          <button class="gpa-btn particle-btn" data-particle="confetti">Confetti</button>
        </div>
        <div class="gpa-row" style="margin-top:8px;">
          <label for="gpa-particle-size" class="gpa-sub" style="flex:1;">Particle play area size</label>
        </div>
        <div class="gpa-row">
          <input type="range" id="gpa-particle-size" class="gpa-range" min="0" max="260" step="10" />
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
  minimized.style.display = 'none';
  panel.appendChild(minimized);

  // Original, non-trademarked icon options for the minimized button — not
  // reproductions of any company's actual logo. "Letter" shows G or O
  // depending on whichever AI provider is currently active.
  const MINI_ICONS = {
    dot: '✦',
    sparkle: '<svg viewBox="0 0 24 24"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
    orbit: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.4"/><ellipse cx="12" cy="12" rx="9" ry="4" fill="none" stroke="#fff" stroke-width="1.6"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 4h16v11H8l-4 4z"/></svg>'
  };

  function renderMiniIcon() {
    const style = localStorage.getItem(ICON_KEY) || 'dot';
    if (style === 'letter') {
      const provider = localStorage.getItem(PROVIDER_KEY) || 'gemini';
      minimized.textContent = provider === 'openai' ? 'O' : 'G';
    } else {
      minimized.innerHTML = MINI_ICONS[style] || MINI_ICONS.dot;
    }
  }
  renderMiniIcon();

  function applyTheme(name) {
    theme = THEMES[name] ? name : 'matte';
    localStorage.setItem(THEME_KEY, theme);
    const t = THEMES[theme];
    style.textContent = `
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .gpa-particle-wrap { position: relative; }
      #gpa-particles {
        position: absolute; z-index: 0; pointer-events: none; display: none;
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
      .quiz-btn {
        width: 100%; padding: 11px; font-size: 12.5px; font-weight: 800;
        letter-spacing: 0.3px; border: none; border-radius: 10px; cursor: pointer;
        color: #fff; background: linear-gradient(120deg, ${t.accent}, ${t.accent}99, ${t.accent});
        background-size: 220% 220%;
        box-shadow: 0 4px 16px ${t.accent}55;
        animation: gpa-shimmer 3.2s ease infinite;
      }
      @keyframes gpa-shimmer {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
      .quiz-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px ${t.accent}77; }
      .quiz-btn:active { transform: translateY(0) scale(0.97); }
      .quiz-btn:disabled { opacity: 0.65; cursor: default; transform: none; }
      .gpa-sub { color: ${t.sub}; font-size: 11px; flex: 1; }
      .gpa-output {
        margin-top: 6px; flex: 0 1 auto; min-height: 0; max-height: 260px; overflow-y: auto;
        font-size: 12.5px; line-height: 1.6; white-space: pre-wrap;
        overflow-wrap: break-word; word-break: break-word;
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
        padding: 8px; background: ${t.field}; border-radius: 8px;
        border: 1px solid ${t.border};
      }
      .gpa-output:empty { display: none; }
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
      .gpa-grid-conf {
        font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 8px; margin-top: 1px;
      }
      .gpa-confidence-line { margin-top: 8px; }
      .gpa-conf-high { background: rgba(34, 197, 94, 0.18); color: #22c55e; }
      .gpa-conf-mid { background: rgba(234, 179, 8, 0.18); color: #eab308; }
      .gpa-conf-low { background: rgba(239, 68, 68, 0.18); color: #ef4444; }
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
      .speed-btn, .font-btn, .particle-btn, .icon-btn, .size-btn { flex: 1; padding: 6px 4px; font-size: 11px; }
      .speed-btn.primary, .font-btn.primary, .particle-btn.primary, .icon-btn.primary, .size-btn.primary { background: ${t.accent}; color: #fff; border-color: ${t.accent}; }
      .gpa-range {
        width: 100%; -webkit-appearance: none; appearance: none;
        height: 4px; border-radius: 2px; background: ${t.border}; outline: none;
      }
      .gpa-range::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 14px; height: 14px; border-radius: 50%;
        background: ${t.accent}; cursor: pointer; border: 2px solid ${t.panel};
        box-shadow: 0 0 0 2px ${t.accent}55;
      }
      .gpa-range::-moz-range-thumb {
        width: 14px; height: 14px; border-radius: 50%; border: 2px solid ${t.panel};
        background: ${t.accent}; cursor: pointer;
      }
      .gpa-font-system .gpa-output, .gpa-font-system .gpa-msg.ai {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      .gpa-mini {
        width: 40px; height: 40px; border-radius: 50%;
        background: ${t.accent}; color: #fff; display: flex;
        align-items: center; justify-content: center; font-size: 18px;
        font-weight: 800; cursor: grab; box-shadow: 0 8px 20px rgba(0,0,0,0.4);
      }
      .gpa-mini svg { width: 20px; height: 20px; fill: #fff; }
      #gpa-root-host.gpa-settling {
        transition: left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
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
      host.classList.remove('gpa-settling'); // grabbing mid-flight should feel instant, not laggy
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
      // Clamp against the panel's ACTUAL current size (mini dot, settled
      // panel, or whichever size preset is active) so it can never be
      // dragged past the edge of the visible window.
      const rect = host.getBoundingClientRect();
      x = Math.max(0, Math.min(window.innerWidth - rect.width, x));
      y = Math.max(0, Math.min(window.innerHeight - rect.height, y));
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
    panel.style.width = v ? 'auto' : (PANEL_SIZES[panelSizeKey] || PANEL_SIZES.normal).w + 'px';
    panel.style.height = v ? 'auto' : (PANEL_SIZES[panelSizeKey] || PANEL_SIZES.normal).h + 'px';
    panel.style.background = v ? 'transparent' : THEMES[theme].panel;
    panel.style.boxShadow = v ? 'none' : '';
    panel.style.border = v ? 'none' : '';

    if (v) {
      // Animate to a resting spot in the bottom-right corner. Still fully
      // draggable afterward — grabbing it mid-flight (see `start()` above)
      // cancels the transition immediately so it never fights your cursor.
      const margin = 24, size = 40;
      const targetLeft = Math.max(0, window.innerWidth - size - margin);
      const targetTop = Math.max(0, window.innerHeight - size - margin);
      host.classList.add('gpa-settling');
      host.style.left = targetLeft + 'px';
      host.style.top = targetTop + 'px';
      host.addEventListener('transitionend', () => host.classList.remove('gpa-settling'), { once: true });
    } else {
      host.classList.remove('gpa-settling');
    }

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
      renderMiniIcon(); // in case "Letter" style is active — it tracks the provider
    });
  });

  // ---- Minimized-button icon toggle --------------------------------------
  const iconBtns = panel.querySelectorAll('.icon-btn');
  function setIconUI(i) {
    iconBtns.forEach((b) => b.classList.toggle('primary', b.dataset.icon === i));
  }
  setIconUI(localStorage.getItem(ICON_KEY) || 'dot');
  iconBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(ICON_KEY, btn.dataset.icon);
      setIconUI(btn.dataset.icon);
      renderMiniIcon();
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
  // so it never blocks a click) with several interactive styles. Particles
  // gently drift away from the cursor and are tinted with the current
  // theme's accent color, so switching themes re-colors them automatically.
  // The "play area" (how far the particle field extends past the panel's
  // edges) is adjustable via a slider in Settings.
  const particleCtx = particleCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let particleMargin = parseInt(localStorage.getItem(PARTICLE_SIZE_KEY), 10);
  if (isNaN(particleMargin)) particleMargin = 40;
  let PW = PARTICLE_PANEL_W + particleMargin * 2;
  let PH = PARTICLE_PANEL_H + particleMargin * 2;

  function resizeParticleCanvas() {
    PW = PARTICLE_PANEL_W + particleMargin * 2;
    PH = PARTICLE_PANEL_H + particleMargin * 2;
    particleCanvas.style.inset = `-${particleMargin}px`;
    particleCanvas.width = PW * dpr;
    particleCanvas.height = PH * dpr;
    particleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeParticleCanvas();

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
    const w = PW, h = PH;
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
    } else if (styleName === 'network') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.5; p.vy = (Math.random() - 0.5) * 0.5;
      p.r = 1.8; p.alpha = 0.85;
    } else if (styleName === 'fireflies') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() - 0.5) * 0.18; p.vy = (Math.random() - 0.5) * 0.18;
      p.r = 2 + Math.random() * 2.5; p.phase = Math.random() * Math.PI * 2; p.speed = 0.01 + Math.random() * 0.02;
    } else if (styleName === 'confetti') {
      p.x = Math.random() * w; p.y = Math.random() * h - h;
      p.vx = (Math.random() - 0.5) * 0.6; p.vy = 0.6 + Math.random() * 1.1;
      p.rw = 4 + Math.random() * 4; p.rh = 3 + Math.random() * 3;
      p.rot = Math.random() * Math.PI; p.vr = (Math.random() - 0.5) * 0.08;
      p.shade = Math.floor(Math.random() * 3);
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
    // Density scales with the play area so a bigger canvas doesn't look sparse.
    const count = Math.max(16, Math.min(90, Math.round((PW * PH) / 4200)));
    for (let i = 0; i < count; i++) particles.push(makeParticle(styleName));
  }

  function stepParticles() {
    const styleName = localStorage.getItem(PARTICLE_KEY) || 'off';
    if (styleName === 'off') {
      particleCtx.clearRect(0, 0, PW, PH);
      particleAnimId = null;
      return;
    }
    const w = PW, h = PH;
    particleCtx.clearRect(0, 0, w, h);
    const accent = THEMES[theme].accent;
    const shadeColors = [accent, THEMES[theme].text, THEMES[theme].sub];

    if (styleName === 'network') {
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      });
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const linkDist = Math.min(w, h) * 0.18;
          if (d < linkDist) {
            particleCtx.strokeStyle = hexToRgba(accent, 0.22 * (1 - d / linkDist));
            particleCtx.lineWidth = 1;
            particleCtx.beginPath();
            particleCtx.moveTo(a.x, a.y);
            particleCtx.lineTo(b.x, b.y);
            particleCtx.stroke();
          }
        }
      }
      particles.forEach((p) => {
        particleCtx.beginPath();
        particleCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        particleCtx.fillStyle = hexToRgba(accent, p.alpha);
        particleCtx.fill();
      });
      particleAnimId = requestAnimationFrame(stepParticles);
      return;
    }

    if (styleName === 'confetti') {
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
        particleCtx.save();
        particleCtx.translate(p.x, p.y);
        particleCtx.rotate(p.rot);
        particleCtx.globalAlpha = 0.85;
        particleCtx.fillStyle = shadeColors[p.shade % shadeColors.length];
        particleCtx.fillRect(-p.rw / 2, -p.rh / 2, p.rw, p.rh);
        particleCtx.restore();
      });
      particleAnimId = requestAnimationFrame(stepParticles);
      return;
    }

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
      } else if (p.style === 'fireflies') {
        p.x += p.vx; p.y += p.vy;
        p.phase += p.speed;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        alpha = 0.25 + Math.abs(Math.sin(p.phase)) * 0.6;
        const glow = particleCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        glow.addColorStop(0, hexToRgba(accent, alpha));
        glow.addColorStop(1, hexToRgba(accent, 0));
        particleCtx.fillStyle = glow;
        particleCtx.beginPath();
        particleCtx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        particleCtx.fill();
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
  setParticleUI(localStorage.getItem(PARTICLE_KEY) || 'off');
  setParticleStyle(localStorage.getItem(PARTICLE_KEY) || 'off');

  particleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setParticleUI(btn.dataset.particle);
      setParticleStyle(btn.dataset.particle);
    });
  });

  const particleSizeInput = panel.querySelector('#gpa-particle-size');
  particleSizeInput.value = particleMargin;
  particleSizeInput.addEventListener('input', (e) => {
    particleMargin = parseInt(e.target.value, 10);
    localStorage.setItem(PARTICLE_SIZE_KEY, String(particleMargin));
    resizeParticleCanvas();
    initParticles(localStorage.getItem(PARTICLE_KEY) || 'off');
  });

  // ---- Interface size presets ---------------------------------------------
  let panelSizeKey = localStorage.getItem(PANEL_SIZE_KEY) || 'normal';
  if (!PANEL_SIZES[panelSizeKey]) panelSizeKey = 'normal';
  const sizeBtns = panel.querySelectorAll('.size-btn');
  function setSizeUI(s) {
    sizeBtns.forEach((b) => b.classList.toggle('primary', b.dataset.size === s));
  }
  function applyPanelSize(key) {
    panelSizeKey = PANEL_SIZES[key] ? key : 'normal';
    localStorage.setItem(PANEL_SIZE_KEY, panelSizeKey);
    const { w, h } = PANEL_SIZES[panelSizeKey];
    if (!isMin) {
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
    }
    // Keep the ambient particle field sized to whatever the panel is now.
    PARTICLE_PANEL_W = w;
    PARTICLE_PANEL_H = h;
    resizeParticleCanvas();
    initParticles(localStorage.getItem(PARTICLE_KEY) || 'off');
  }
  setSizeUI(panelSizeKey);
  applyPanelSize(panelSizeKey);
  sizeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setSizeUI(btn.dataset.size);
      applyPanelSize(btn.dataset.size);
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

  // Real second-pass check for quiz/answer-grid results: sends the draft
  // answers back to the AI alongside the original context and asks it to
  // re-verify each one, fixing anything wrong and returning a final,
  // calibrated confidence per item. Falls back to the draft if the
  // verification call fails or comes back unparsable, so a bad second
  // pass never wipes out a good first one.
  async function verifyGridAnswers(contextText, draftGrid, imageDataUrls) {
    const sys = 'You previously drafted answers to a set of questions. Re-check EACH answer against the original context on its own, independently — do not just assume the draft is correct. Fix anything wrong, then return a final JSON array in this exact shape and nothing else: [{"q":"1","a":"B","c":92}] — "c" is your honest confidence (0-100) that this specific final answer is correct. Do not include any text outside the JSON array.';
    const userText = `ORIGINAL CONTEXT:\n${contextText}\n\nDRAFT ANSWERS TO VERIFY:\n${JSON.stringify(draftGrid)}`;
    try {
      const out = await callAI(userText, sys, imageDataUrls);
      const verified = tryParseAnswerGrid(out);
      return verified || draftGrid;
    } catch (e) {
      return draftGrid;
    }
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
  function typeText(el, fullText, scrollContainer, onDone) {
    const speedSetting = localStorage.getItem(SPEED_KEY) || 'normal';
    if (speedSetting === 'instant') {
      el.classList.remove('gpa-typing');
      el.textContent = fullText;
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      if (onDone) onDone();
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
        if (onDone) onDone();
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

  function confidenceClass(pct) {
    return pct >= 85 ? 'gpa-conf-high' : pct >= 60 ? 'gpa-conf-mid' : 'gpa-conf-low';
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
    const cells = arr.map((it, idx) => {
      const hasConf = typeof it.c === 'number' && !isNaN(it.c);
      const pct = hasConf ? Math.max(0, Math.min(100, Math.round(it.c))) : null;
      const badge = pct === null ? '' : `<span class="gpa-grid-conf ${confidenceClass(pct)}">${pct}%</span>`;
      return `<div class="gpa-grid-cell" style="animation-delay:${idx * 35}ms">
         <span class="gpa-grid-q">${escapeHtml(it.q)}</span>
         <span class="gpa-grid-a">${escapeHtml(it.a)}</span>
         ${badge}
       </div>`;
    }).join('');
    el.innerHTML = `<div class="gpa-answer-grid">${cells}</div>`;
  }

  // For a single free-text answer, the model appends a trailing
  // "CONFIDENCE: NN" line — pull it out and show it as a small badge
  // instead of leaving it as literal text in the answer.
  function extractConfidenceLine(text) {
    const match = text.match(/\n?\s*CONFIDENCE:\s*(\d{1,3})\s*%?\s*$/i);
    if (!match) return { text, confidence: null };
    const confidence = Math.max(0, Math.min(100, parseInt(match[1], 10)));
    return { text: text.slice(0, match.index).trim(), confidence };
  }

  function appendConfidenceBadge(container, confidence) {
    if (confidence === null || typeof confidence !== 'number' || isNaN(confidence)) return;
    const badge = document.createElement('div');
    badge.className = 'gpa-confidence-line';
    badge.innerHTML = `<span class="gpa-grid-conf ${confidenceClass(confidence)}">${confidence}% confident this is correct</span>`;
    container.appendChild(badge);
  }

  function extractPageText() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,svg,canvas,iframe').forEach((el) => el.remove());
    let text = clone.innerText || clone.textContent || '';
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > MAX_PAGE_CHARS) text = text.slice(0, MAX_PAGE_CHARS) + '\n\n[...truncated...]';
    return text;
  }

  // Reads answer choices the AI can't see from plain page text: closed
  // <select> dropdowns (only the currently-picked option renders as text)
  // and radio/checkbox groups (their option labels aren't always adjacent
  // to visible question text in a way innerText captures cleanly).
  function extractQuizChoices() {
    const lines = [];
    document.querySelectorAll('select').forEach((sel, idx) => {
      const opts = Array.from(sel.options).map((o) => o.text.trim()).filter(Boolean);
      if (opts.length) {
        const hint = sel.getAttribute('aria-label') || sel.name || sel.id || `dropdown ${idx + 1}`;
        lines.push(`Dropdown "${hint}" choices: ${opts.join(' | ')}`);
      }
    });
    function labelFor(input) {
      if (input.id) {
        try {
          const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
          if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
        } catch (e) { /* invalid id for CSS.escape — ignore */ }
      }
      const wrapLabel = input.closest('label');
      if (wrapLabel && wrapLabel.textContent.trim()) return wrapLabel.textContent.trim();
      return input.value || '';
    }
    const groups = {};
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input) => {
      const key = `${input.type}:${input.name || 'unnamed'}`;
      const text = labelFor(input);
      if (text) (groups[key] = groups[key] || []).push(text);
    });
    Object.entries(groups).forEach(([key, opts]) => {
      if (opts.length > 1) lines.push(`Multiple-choice options for "${key.split(':')[1]}": ${opts.join(' | ')}`);
    });
    return lines.join('\n');
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

  // ---- Upload / paste an image (for the AI to read text from or analyze) --
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function downscaleDataUrl(dataUrl, maxWidth) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = dataUrl;
    });
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

  // ---- Quiz solver: reads page text + dropdown/radio/checkbox choices,
  // returns one answer per question (including multi-part like "2a"/"2b")
  // as the same structured grid used for plain answer-key questions.
  const quizBtn = panel.querySelector('#gpa-quiz-btn');
  quizBtn.addEventListener('click', async () => {
    if (!pageText) pageText = extractPageText();
    refreshStatus();
    const choices = extractQuizChoices();
    const combinedText = choices
      ? `${pageText}\n\nFORM CONTROLS ON THIS PAGE (dropdowns / multiple-choice / checkboxes):\n${choices}`
      : pageText;

    const prevLabel = quizBtn.textContent;
    quizBtn.textContent = 'Solving…';
    quizBtn.disabled = true;
    scanOutput.innerHTML = '';
    scanOutput.textContent = 'Reading the page…';
    try {
      const sys = 'You are analyzing a quiz, exam, or worksheet on this web page, including any dropdown menus and multiple-choice/checkbox options listed under FORM CONTROLS ON THIS PAGE. Identify every question — including multi-part questions like "2a"/"2b" — and give the single best correct answer for each, using the dropdown/multiple-choice options where relevant. Respond with ONLY a JSON array in this exact shape and nothing else: [{"q":"1","a":"B","c":85}] — "q" is the question number/label as a string (use sub-labels for multi-part questions), "a" is the short correct answer, "c" is your confidence (0-100) that this specific answer is correct. If you genuinely cannot determine an answer for an item, use "a":"Unclear" and a low "c". Do not include any text outside the JSON array.';
      const out = await callAI(combinedText, sys, screenshotDataUrl ? [screenshotDataUrl] : null);
      const grid = tryParseAnswerGrid(out);
      if (grid) {
        quizBtn.textContent = 'Double-checking…';
        const verified = await verifyGridAnswers(combinedText, grid, screenshotDataUrl ? [screenshotDataUrl] : null);
        renderAnswerGrid(scanOutput, verified);
      } else {
        typeText(scanOutput, out, scanOutput);
      }
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    } finally {
      quizBtn.textContent = prevLabel;
      quizBtn.disabled = false;
    }
  });

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

  // Upload an image file directly.
  const imageUploadInput = panel.querySelector('#gpa-image-upload');
  const uploadBtn = panel.querySelector('#gpa-upload-btn');
  uploadBtn.addEventListener('click', () => imageUploadInput.click());
  imageUploadInput.addEventListener('change', async () => {
    const file = imageUploadInput.files && imageUploadInput.files[0];
    imageUploadInput.value = '';
    if (!file) return;
    try {
      const raw = await blobToDataUrl(file);
      screenshotDataUrl = await downscaleDataUrl(raw, MAX_IMAGE_WIDTH);
      scanOutput.textContent = '';
      refreshStatus();
    } catch (e) {
      showError(scanOutput, e, currentProviderLabel());
    }
  });

  // Paste an image (Ctrl+V) anywhere in the panel — e.g. a screenshot
  // copied from another app or the OS's own screenshot tool.
  root.addEventListener('paste', async (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        e.preventDefault();
        try {
          const raw = await blobToDataUrl(blob);
          screenshotDataUrl = await downscaleDataUrl(raw, MAX_IMAGE_WIDTH);
          scanOutput.textContent = '';
          refreshStatus();
        } catch (err) {
          showError(scanOutput, err, currentProviderLabel());
        }
        break;
      }
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
        ? 'Summarize the provided content in plain, everyday sentences — the shortest version that still covers the essentials. No markdown formatting (no asterisks, headers, or numbered/bulleted lists) since this is shown as plain text. If both page text and a screenshot are provided, use both together. Then, on its own final line, write exactly "CONFIDENCE: NN" where NN (0-100) is how confident you are that this summary faithfully and accurately represents the source content.'
        : 'Give a brief, plain-language read on the provided content: what it\'s about, the main point, and anything notable — a few sentences, not a breakdown. No markdown formatting (no asterisks, headers, or numbered/bulleted lists) since this is shown as plain text. If both page text and a screenshot are provided, use both together. Then, on its own final line, write exactly "CONFIDENCE: NN" where NN (0-100) is how confident you are that this analysis is accurate.';
      scanOutput.textContent = 'Thinking…';
      try {
        const textPart = pageText ? `PAGE TEXT:\n${pageText}` : '(no page text captured — use the screenshot)';
        const out = await callAI(textPart, sys, screenshotDataUrl ? [screenshotDataUrl] : null);
        const { text: cleanText, confidence } = extractConfidenceLine(out);
        typeText(scanOutput, cleanText, scanOutput, () => appendConfidenceBadge(scanOutput, confidence));
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
      const sys = 'Answer the question using ONLY the provided context (page text and/or screenshot). Before finalizing, double-check your answer against the context. If — and only if — the question is asking for answers to multiple numbered items (like a quiz, worksheet, or multiple-choice list), respond with ONLY a JSON array and nothing else, in exactly this shape: [{"q":"1","a":"B","c":90}] — "q" is the item number/label as a string, "a" is the short answer, "c" is your confidence (0-100) that this specific answer is correct, one object per item, no extra commentary. For any other kind of question, answer in brief plain sentences with no markdown formatting (no asterisks, headers, or lists), then on its own final line write exactly "CONFIDENCE: NN" where NN is your confidence percentage (0-100) that the answer is correct. If the answer is not in the content, say so in one short sentence and use a low confidence number.';
      const textPart = `${pageText ? `PAGE TEXT:\n${pageText}\n\n` : ''}QUESTION:\n${q}`;
      const images = screenshotDataUrl ? [screenshotDataUrl] : null;
      const out = await callAI(textPart, sys, images);
      const grid = tryParseAnswerGrid(out);
      if (grid) {
        const verified = await verifyGridAnswers(textPart, grid, images);
        renderAnswerGrid(scanOutput, verified);
      } else {
        const { text: cleanText, confidence } = extractConfidenceLine(out);
        typeText(scanOutput, cleanText, scanOutput, () => appendConfidenceBadge(scanOutput, confidence));
      }
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
      const sys = 'You are a helpful, concise assistant. Reply in plain conversational sentences only — no markdown formatting (no asterisks, headers, or lists) since this is shown as plain text. Keep answers as short as possible while still being useful. Then, on its own final line, write exactly "CONFIDENCE: NN" where NN (0-100) is your confidence that the answer is accurate.';
      const out = await callAI(q, sys);
      const { text: cleanText, confidence } = extractConfidenceLine(out);
      typeText(thinking, cleanText, chatEl, () => appendConfidenceBadge(thinking, confidence));
    } catch (e) {
      showError(thinking, e, currentProviderLabel());
    }
  }
  askBtn.addEventListener('click', sendChat);
  askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

})();

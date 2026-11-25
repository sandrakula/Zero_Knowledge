(function () {
  try {
    var LIGHT_THEMES = ['snow', 'paper', 'mist', 'sage', 'rose', 'lavender', 'sand', 'graphite'];
    var DARK_THEMES = ['night', 'midnight', 'nord', 'obsidian', 'forest', 'espresso'];
    var THEMES = LIGHT_THEMES.concat(DARK_THEMES);

    var params = new URLSearchParams(window.location.search);
    var fromQuery = params.get('theme');
    var stored = null;
    var storedAccent = null;
    var storedPattern = null;
    var storedRadius = null;
    try {
      stored = window.localStorage.getItem('lh_theme');
      storedAccent = window.localStorage.getItem('lh_accent');
      storedPattern = window.localStorage.getItem('lh_bg_pattern');
      storedRadius = window.localStorage.getItem('lh_radius');
    } catch (e) {
      stored = null;
    }

    var theme =
      fromQuery && THEMES.indexOf(fromQuery) >= 0
        ? fromQuery
        : stored && THEMES.indexOf(stored) >= 0
          ? stored
          : 'snow';

    var mode = DARK_THEMES.indexOf(theme) >= 0 ? 'dark' : 'light';
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-mode', mode);
    if (mode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    if (storedPattern && ['none', 'dots', 'grid', 'glow', 'mesh'].indexOf(storedPattern) >= 0) {
      root.setAttribute('data-bg-pattern', storedPattern);
    }
    if (storedRadius && ['sharp', 'default', 'round'].indexOf(storedRadius) >= 0) {
      root.setAttribute('data-radius', storedRadius);
    }

    if (storedAccent && /^#[0-9a-fA-F]{6}$/.test(storedAccent)) {
      var clean = storedAccent.slice(1);
      var r = parseInt(clean.slice(0, 2), 16) / 255;
      var g = parseInt(clean.slice(2, 4), 16) / 255;
      var b = parseInt(clean.slice(4, 6), 16) / 255;
      var lum =
        0.2126 * (r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)) +
        0.7152 * (g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)) +
        0.0722 * (b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4));
      var ink = lum > 0.36 ? '#0a0a0a' : '#ffffff';
      root.style.setProperty('--t-accent', storedAccent.toLowerCase());
      root.style.setProperty('--t-accent-ink', ink);
    }
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'snow');
    document.documentElement.setAttribute('data-theme-mode', 'light');
  }
})();

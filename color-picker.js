/* color-picker.js — PEMILIH WARNA (port vanilla dari komponen React "ColorPicker": kanvas saturasi/kecerahan +
   rel hue + kolom HEX/RGB/HSL + pipet + swatch). HSV jadi sumber kebenaran supaya menyeret lewat hitam/putih murni
   tidak membuang hue/saturasi. Tanpa alpha (sampul selalu opak).
   API: const cp = NovelColorPicker.create(hostEl, { value: "#3b82f6", swatches: [...], onChange(hex) {} });
        cp.set("#ff0000")  cp.get() -> "#rrggbb"  cp.el (elemen panel)
   Dipakai modal Add / Edit project (app.js, bagian ADD / EDIT PROJECT MODAL). CSS: style.css ".ncp-*". */
(function () {
  "use strict";
  const clamp = (n, min = 0, max = 100) => Math.min(max, Math.max(min, n));
  const round = (n, d = 0) => { const p = 10 ** d; return Math.round(n * p) / p; };

  function hsvToRgb({ h, s, v }) {
    const hh = (((h % 360) + 360) % 360) / 60, ss = s / 100, vv = v / 100;
    const c = vv * ss, x = c * (1 - Math.abs((hh % 2) - 1)), m = vv - c;
    const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hh) % 6] || [c, x, 0];
    return { r: Math.round((seg[0] + m) * 255), g: Math.round((seg[1] + m) * 255), b: Math.round((seg[2] + m) * 255) };
  }
  function rgbToHsv({ r, g, b }) {
    const rr = r / 255, gg = g / 255, bb = b / 255, max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
    let h = 0;
    if (d) h = max === rr ? 60 * (((gg - bb) / d) % 6) : max === gg ? 60 * ((bb - rr) / d + 2) : 60 * ((rr - gg) / d + 4);
    if (h < 0) h += 360;
    return { h: round(h, 1), s: max === 0 ? 0 : round((d / max) * 100, 1), v: round(max * 100, 1) };
  }
  function hsvToHsl({ h, s, v }) {
    const vv = v / 100, ss = s / 100, l = vv * (1 - ss / 2), sl = l === 0 || l === 1 ? 0 : (vv - l) / Math.min(l, 1 - l);
    return { h: Math.round(h), s: Math.round(sl * 100), l: Math.round(l * 100) };
  }
  function hslToHsv(h, s, l) {
    const ll = l / 100, ss = s / 100, v = ll + ss * Math.min(ll, 1 - ll);
    return { h: ((h % 360) + 360) % 360, s: v === 0 ? 0 : 2 * (1 - ll / v) * 100, v: v * 100 };
  }
  const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  const rgbToHex = ({ r, g, b }) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  function parseHex(input) {
    const raw = String(input || "").trim().replace(/^#/, "");
    if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return null;
    const f = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    return { r: parseInt(f.slice(0, 2), 16), g: parseInt(f.slice(2, 4), 16), b: parseInt(f.slice(4, 6), 16) };
  }
  // luminansi relatif WCAG — tanda centang gelap di swatch terang
  function isLight({ r, g, b }) {
    const ch = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b) > 0.45;
  }
  const ratio = (el, e) => {
    const r = el.getBoundingClientRect();
    return { x: r.width ? clamp((e.clientX - r.left) / r.width, 0, 1) : 0, y: r.height ? clamp((e.clientY - r.top) / r.height, 0, 1) : 0 };
  };
  // panah/PageUp/PageDown — sama untuk kanvas dan rel
  function arrowStep(key, step, big) {
    return ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step], PageUp: [big, big], PageDown: [-big, -big] })[key] || null;
  }
  function drag(el, onMove) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId); el.dataset.dragging = ""; el.focus(); onMove(e);
    });
    el.addEventListener("pointermove", (e) => { if (el.hasPointerCapture(e.pointerId)) { e.preventDefault(); onMove(e); } });
    const stop = (e) => { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); delete el.dataset.dragging; };
    el.addEventListener("pointerup", stop); el.addEventListener("pointercancel", stop);
  }
  const ICON = {
    dropper: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 7l6 6"/><path d="M4 16l11.7 -11.7a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-11.7 11.7h-4v-4z"/></svg>',
    selector: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 9l4 -4l4 4"/><path d="M16 15l-4 4l-4 -4"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5l10 -10"/></svg>'
  };
  const FORMATS = ["hex", "rgb", "hsl"];

  function create(host, opts = {}) {
    let hsv = rgbToHsv(parseHex(opts.value) || parseHex("#3b82f6"));
    let format = FORMATS.includes(opts.format) ? opts.format : "hex";
    const root = document.createElement("div");
    root.className = "ncp";
    root.innerHTML = `
      <div class="ncp-sv" role="slider" tabindex="0" aria-label="Saturasi dan kecerahan"><div class="ncp-sv-w"></div><div class="ncp-sv-b"></div><span class="ncp-thumb ncp-sv-thumb"></span></div>
      <div class="ncp-body">
        <div class="ncp-row">
          ${"EyeDropper" in window ? `<button type="button" class="ncp-ibtn ncp-dropper" aria-label="Ambil warna dari layar" title="Ambil warna dari layar">${ICON.dropper}</button>` : ""}
          <span class="ncp-current" aria-hidden="true"></span>
          <div class="ncp-hue" role="slider" tabindex="0" aria-label="Hue" aria-valuemin="0" aria-valuemax="360"><span class="ncp-thumb ncp-hue-thumb"></span></div>
        </div>
        <div class="ncp-fields-row"><div class="ncp-fields"></div><button type="button" class="ncp-ibtn ncp-fmt" aria-label="Ganti format warna">${ICON.selector}</button></div>
        ${opts.swatches && opts.swatches.length ? '<div class="ncp-swatches"></div>' : ""}
      </div>`;
    host.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const sv = $(".ncp-sv"), hue = $(".ncp-hue"), fields = $(".ncp-fields");
    const hex = () => rgbToHex(hsvToRgb(hsv));

    function commit(next, silent) {
      hsv = next;
      render();
      if (!silent && opts.onChange) opts.onChange(hex());
    }
    // dari RGB: hue dipertahankan kalau warnanya akromatik (abu-abu, hitam, putih)
    function fromRgb(rgb, silent) {
      const n = rgbToHsv(rgb);
      commit({ ...n, h: n.s === 0 || n.v === 0 ? hsv.h : n.h }, silent);
    }

    function field(label, value, min, max, onCommit) {
      const wrap = document.createElement("label");
      wrap.className = "ncp-field";
      wrap.innerHTML = `<span class="ncp-field-shell"><input type="text" inputmode="numeric" aria-label="${label}" spellcheck="false" autocomplete="off" /></span><span class="ncp-field-label">${label}</span>`;
      const inp = wrap.querySelector("input");
      inp.value = String(Math.round(value));
      const go = () => { const v = parseFloat(inp.value); if (!isNaN(v)) onCommit(clamp(Math.round(v), min, max)); else inp.value = String(Math.round(value)); };
      inp.addEventListener("blur", go);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); go(); }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); onCommit(clamp(Math.round(value) + (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1), min, max)); }
      });
      return wrap;
    }
    function renderFields() {
      const active = document.activeElement && fields.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label") : null;
      fields.innerHTML = "";
      const rgb = hsvToRgb(hsv), hsl = hsvToHsl(hsv);
      if (format === "hex") {
        const wrap = document.createElement("label");
        wrap.className = "ncp-field";
        wrap.innerHTML = `<span class="ncp-field-shell"><span class="ncp-hash">#</span><input type="text" class="ncp-hex" aria-label="HEX" spellcheck="false" autocomplete="off" maxlength="7" /></span><span class="ncp-field-label">HEX</span>`;
        const inp = wrap.querySelector("input");
        inp.value = hex().slice(1).toUpperCase();
        const go = () => { const p = parseHex(inp.value); if (p) fromRgb(p); else inp.value = hex().slice(1).toUpperCase(); };
        inp.addEventListener("blur", go);
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); go(); } });
        fields.appendChild(wrap);
      } else if (format === "rgb") {
        fields.append(field("R", rgb.r, 0, 255, (r) => fromRgb({ ...rgb, r })), field("G", rgb.g, 0, 255, (g) => fromRgb({ ...rgb, g })), field("B", rgb.b, 0, 255, (b) => fromRgb({ ...rgb, b })));
      } else {
        fields.append(field("H", hsl.h, 0, 360, (h) => commit(hslToHsv(h, hsl.s, hsl.l))), field("S", hsl.s, 0, 100, (s) => commit(hslToHsv(hsl.h, s, hsl.l))), field("L", hsl.l, 0, 100, (l) => commit(hslToHsv(hsl.h, hsl.s, l))));
      }
      if (active) { const f = fields.querySelector(`input[aria-label="${active}"]`); if (f) { f.focus(); f.select(); } }
    }
    function renderSwatches() {
      const box = $(".ncp-swatches");
      if (!box) return;
      box.innerHTML = "";
      const cur = hex().toLowerCase();
      opts.swatches.forEach((sw) => {
        const p = parseHex(sw); if (!p) return;
        const b = document.createElement("button");
        b.type = "button"; b.className = "ncp-swatch" + (isLight(p) ? " is-light" : "");
        b.style.backgroundColor = sw; b.setAttribute("aria-label", sw);
        b.setAttribute("aria-pressed", String(sw.toLowerCase() === cur));
        b.innerHTML = ICON.check;
        b.onclick = () => fromRgb(p);
        box.appendChild(b);
      });
    }
    function render() {
      const solid = hex();
      sv.style.backgroundColor = `hsl(${hsv.h} 100% 50%)`;
      const t = $(".ncp-sv-thumb");
      t.style.left = `clamp(8px, ${hsv.s}%, calc(100% - 8px))`;
      t.style.top = `clamp(8px, ${100 - hsv.v}%, calc(100% - 8px))`;
      t.style.backgroundColor = solid;
      sv.setAttribute("aria-valuetext", `Saturasi ${Math.round(hsv.s)}%, kecerahan ${Math.round(hsv.v)}%`);
      const ht = $(".ncp-hue-thumb");
      ht.style.left = `calc(9px + ${hsv.h / 360} * (100% - 18px))`;
      ht.style.background = `hsl(${hsv.h} 100% 50%)`;
      hue.setAttribute("aria-valuenow", String(Math.round(hsv.h)));
      hue.setAttribute("aria-valuetext", `${Math.round(hsv.h)} derajat`);
      $(".ncp-current").style.backgroundColor = solid;
      $(".ncp-fmt").setAttribute("aria-label", `Format warna: ${format.toUpperCase()}. Ganti format`);
      renderFields(); renderSwatches();
    }

    drag(sv, (e) => { const { x, y } = ratio(sv, e); commit({ ...hsv, s: round(x * 100, 1), v: round((1 - y) * 100, 1) }); });
    sv.addEventListener("keydown", (e) => {
      if (e.key === "Home" || e.key === "End") { e.preventDefault(); commit({ ...hsv, s: e.key === "Home" ? 0 : 100, v: 100 }); return; }
      const d = arrowStep(e.key, e.shiftKey ? 10 : 1, 10); if (!d) return;
      e.preventDefault(); commit({ ...hsv, s: clamp(hsv.s + d[0]), v: clamp(hsv.v + d[1]) });
    });
    drag(hue, (e) => commit({ ...hsv, h: round(ratio(hue, e).x * 360, 2) }));
    hue.addEventListener("keydown", (e) => {
      if (e.key === "Home" || e.key === "End") { e.preventDefault(); commit({ ...hsv, h: e.key === "Home" ? 0 : 360 }); return; }
      const d = arrowStep(e.key, e.shiftKey ? 10 : 1, 10); if (!d) return;
      e.preventDefault(); commit({ ...hsv, h: clamp(hsv.h + (d[0] || d[1]), 0, 360) });
    });
    $(".ncp-fmt").onclick = () => { format = FORMATS[(FORMATS.indexOf(format) + 1) % FORMATS.length]; render(); };
    const dropper = $(".ncp-dropper");
    if (dropper) dropper.onclick = async () => {
      try { const r = await new window.EyeDropper().open(); const p = parseHex(r.sRGBHex); if (p) fromRgb(p); } catch (e) { /* dibatalkan (Esc) */ }
    };
    render();
    return {
      el: root,
      get: hex,
      set(v) { const p = parseHex(v); if (p && rgbToHex(p) !== hex()) fromRgb(p, true); }
    };
  }

  // warna gelap pasangan gradien sampul (#rrggbb -> versi lebih gelap, hue sama)
  function shade(hexStr, k = 0.38) {
    const p = parseHex(hexStr); if (!p) return hexStr;
    const n = rgbToHsv(p);
    return rgbToHex(hsvToRgb({ h: n.h, s: Math.min(100, n.s * 1.05), v: n.v * k }));
  }
  window.NovelColorPicker = { create, parseHex, shade, isLight };
})();

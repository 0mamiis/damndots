// Subagent model/effort selection for the composer orchestrator popup.
/* The subagent model selection is stored per chat (like the main picker), a new chat starts from the "draft:new" selection. */
var CODEX_ORCH_SUBMODEL_KEY = { toString: function () { var sc = window.__codexSubScopeOverride; if (!sc) { try { sc = codexOrchestratorComposerScope(); } catch (e) { sc = "draft:new"; } } return "codex-orchestrator-subagent-model-v2:" + (sc || "draft:new"); } };
try { window.__codexOrchScope = function () { return codexOrchestratorComposerScope(); }; } catch (e) {}
try { var __legacySub = localStorage.getItem("codex-orchestrator-subagent-model-v1"); if (__legacySub && localStorage.getItem("codex-orchestrator-subagent-model-v2:draft:new") == null) localStorage.setItem("codex-orchestrator-subagent-model-v2:draft:new", __legacySub); } catch (e) {}
// Picker text follows the app language: Turkish for a Turkish system, English otherwise.
var CODEX_ORCH_EN = {"Yok":"None","Minimal":"Minimal","Düşük":"Low","Orta":"Medium","Yüksek":"High","Çok yüksek":"Extra high","Varsayılan (ayar dosyası)":"Default (config file)","config.toml [agents] varsayılanı":"config.toml [agents] default","Modeller yükleniyor…":"Loading models…","Alt ajan modeli seç":"Choose subagent model","Varsayılan":"Default","Model varsayılanı":"Model default","Ayar dosyası":"Config file","Alt ajan düşünme seviyesi":"Subagent reasoning level","Kapalı":"Off","Mesajlar normal gider":"Messages are sent normally","Hatayı worker ile düzeltip denetler":"Fixes the bug with a worker and reviews it","Sonucu bağımsız ajanla doğrular":"Verifies the result with an independent agent","Fikri ve kodu araştırır, uygulamaz":"Researches the idea and code, no changes","İnceleyip uygulanabilir plan hazırlar":"Inspects and prepares an actionable plan","Alt Ajanlar":"Subagents","Ana ajan çalışır, alt ajanlarla paylaşır":"Main agent works and shares with subagents","Yerleşik ajanlarla uygular ve denetler":"Builds with native agents and reviews","Paralel dalgalar, bağımsız doğrulama":"Parallel waves, independent checks","Orkestratör":"Orchestrator","Orkestratör modu":"Orchestrator mode","Orkestratör ve alt ajan modeli":"Orchestrator and subagent model","Bu sohbette henüz ölçülmüş model yanıtı yok":"No measured model response in this chat yet"};
function codexOrchL(tr) { try { if (/^tr/i.test(navigator.language)) return tr; } catch (e) {} return Object.prototype.hasOwnProperty.call(CODEX_ORCH_EN, tr) ? CODEX_ORCH_EN[tr] : tr; }
var codexOrchestratorModels = null, codexOrchestratorModelSectionLive = null;
var CODEX_ORCH_EFFORT_LABELS = { none: codexOrchL("Yok"), minimal: "Minimal", low: codexOrchL("Düşük"), medium: codexOrchL("Orta"), high: codexOrchL("Yüksek"), xhigh: codexOrchL("Çok yüksek"), max: "Max", ultra: "Ultra" };
function codexOrchestratorSubmodelGet() {
  try {
    var v = JSON.parse(localStorage.getItem(CODEX_ORCH_SUBMODEL_KEY) || "null");
    if (v && ((typeof v.model === "string" && v.model) || v.fast === true)) return { model: typeof v.model === "string" && v.model ? v.model : null, effort: typeof v.effort === "string" && v.effort ? v.effort : null, fast: v.fast === true };
  } catch (e) {}
  return null;
}
function codexOrchestratorSubmodelSet(v) {
  try {
    if (!v || !v.model) localStorage.removeItem(CODEX_ORCH_SUBMODEL_KEY);
    else localStorage.setItem(CODEX_ORCH_SUBMODEL_KEY, JSON.stringify({ model: v.model, effort: v.effort || null }));
  } catch (e) {}
  try { window.dispatchEvent(new Event("codex-orchestrator-change")); } catch (e) {}
}
function codexOrchestratorModelList() {
  var l = codexOrchestratorModels;
  if (!Array.isArray(l)) return [];
  return l.filter(function (m) { return m && typeof m.model === "string" && m.model && m.hidden !== true; });
}
function codexOrchestratorEfforts(m) {
  var out = [];
  if (!m || !Array.isArray(m.supportedReasoningEfforts)) return out;
  m.supportedReasoningEfforts.forEach(function (x) {
    var e = x && x.reasoningEffort;
    if (e && e !== "persistent" && out.indexOf(e) < 0) out.push(e);
  });
  return out;
}
function codexOrchestratorModelLabel(m) { return (m && m.displayName) || (m && m.model) || ""; }
function codexOrchestratorModelNote(scope) {
  var prevScope = window.__codexSubScopeOverride;
  if (scope) window.__codexSubScopeOverride = scope;
  try { return codexOrchestratorModelNoteRaw(); } finally { window.__codexSubScopeOverride = prevScope; }
}
function codexOrchestratorModelNoteRaw() {
  var s = codexOrchestratorSubmodelGet();
  if (!s) return "";
  var m = s.model ? codexOrchestratorModelList().find(function (x) { return x.model === s.model; }) : null;
  var fast = s.fast && (!m || (Array.isArray(m.serviceTiers) && m.serviceTiers.some(function (t) { return t && (t.id === "priority" || /fast/i.test(t.name || "")); })));
  var fastNote = fast ? "\n\n[ALT AJAN FAST — KULLANICI SEÇİMİ]\nThe user enabled Fast for native subagents in the composer orchestrator menu. spawn_agent has no service-tier field, so use the Fast role variants, which only add service_tier=\"priority\": pass agent_type=\"worker-fast\" where you would use \"worker\", \"explorer-fast\" where you would use \"explorer\", and \"default-fast\" for the default or unspecified role. Keep every other spawn argument as you would otherwise choose it. If a Fast role is unavailable or rejected, report the concrete error and continue with the ordinary role." : "";
  if (!s.model) return fastNote;
  var effort = s.effort && (!m || codexOrchestratorEfforts(m).indexOf(s.effort) >= 0) ? s.effort : null;
  return "\n\n[ALT AJAN MODELİ — KULLANICI SEÇİMİ]\n" +
    "The user selected the subagent model \"" + s.model + "\"" +
    (effort ? " with reasoning effort \"" + effort + "\"" : " with that model's default reasoning effort") +
    " in the composer orchestrator menu. This is the user's explicit model request for native subagents in this chat and replaces the configured subagent default. " +
    "For every spawn_agent call in this turn pass model=\"" + s.model + "\"" +
    (effort ? " and reasoning_effort=\"" + effort + "\"" : " and omit reasoning_effort") +
    ", and set fork_turns=\"none\" because explicit model overrides require it; give each child the task context it needs in its message. " +
    "If the user's current message names a different subagent model or effort, follow the message. Do not change the parent model or effort. " +
    "If the spawn tool does not offer these fields or rejects the model, report the concrete error." + fastNote;
}
function codexOrchestratorCls(name) {
  var c = window.__codexOrchCls || (window.__codexOrchCls = { css: null, map: {} });
  if (c.map[name] !== undefined) return c.map[name];
  if (c.css === null) {
    var parts = [];
    var walk = function (rules) { for (var i = 0; i < rules.length; i++) { var r = rules[i]; if (r.selectorText) { if (r.selectorText.indexOf("._") >= 0) parts.push(r.selectorText); } else if (r.cssRules) walk(r.cssRules); } };
    for (var s = 0; s < document.styleSheets.length; s++) { try { walk(document.styleSheets[s].cssRules); } catch (e) {} }
    c.css = parts.join("\n");
  }
  var anchors = { tovi5: "ViewToggleEffortLabel", xwb5v: "ThumbSpring", item: "itemInteractive" };
  var group = { ViewControls: "tovi5", ViewToggle: "tovi5", ViewToggleContent: "tovi5", ViewToggleModelLabel: "tovi5", ViewToggleEffortLabel: "tovi5", ViewToggleIcon: "tovi5", ViewPanel: "tovi5", SimpleView: "tovi5", SliderKeyboardControl: "tovi5", Container: "xwb5v", Root: "xwb5v", Track: "xwb5v", Range: "xwb5v", TickRail: "xwb5v", Tick: "xwb5v", VisualThumbRail: "xwb5v", ThumbScale: "xwb5v", ThumbSpring: "xwb5v", Thumb: "xwb5v", sectionLabel: "item", itemBase: "item", itemInteractive: "item" }[name];
  var out = "";
  if (group) {
    var am = c.css.match(new RegExp("\\._" + anchors[group] + "_([A-Za-z0-9-]+)_\\d+"));
    if (am) { var m = c.css.match(new RegExp("\\.(_" + name + "_" + am[1] + "_\\d+)(?![A-Za-z0-9_-])")); if (m) out = m[1]; }
  }
  if (c.css) c.map[name] = out;
  return out;
}
function codexOrchestratorPrettyLabel(m) { return codexOrchestratorModelLabel(m).replace(/^Gpt(?=\s)/, "GPT"); }
var CODEX_ORCH_CHEVRON = '<svg aria-hidden="true" focusable="false" height="12" viewBox="0 0 12 12" width="12" xmlns="http://www.w3.org/2000/svg" class="__ICON__"><path d="M4.21677 8.71677C4.06056 8.87298 4.06056 9.12696 4.21677 9.28317C4.37298 9.43938 4.62696 9.43938 4.78317 9.28317L7.60642 6.45993C7.86023 6.20609 7.86023 5.79384 7.60642 5.54001L4.78317 2.71677C4.62696 2.56056 4.37298 2.56056 4.21677 2.71677C4.06056 2.87298 4.06056 3.12696 4.21677 3.28317L6.93356 5.99997L4.21677 8.71677Z" fill="currentColor"></path></svg>';
var CODEX_ORCH_CHECK = '<svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-xs shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100"><path d="M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z" fill="currentColor"></path></svg>';
function codexOrchestratorModelSection(el) {
  var C = codexOrchestratorCls;
  var wrap = el("div", "box-sizing:border-box");
  wrap.setAttribute("data-codex-orchestrator-models", "");
  var view = "slider";
  function mk(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function siblings(show) {
    var p = wrap.parentElement; if (!p) return;
    for (var i = 0; i < p.children.length; i++) { var ch = p.children[i]; if (ch !== wrap) ch.style.display = show ? "" : "none"; }
  }
  function pickModel(value, models) {
    if (!value) codexOrchestratorSubmodelSet(null);
    else {
      var prev = codexOrchestratorSubmodelGet(), m = models.find(function (x) { return x.model === value; });
      var effs = codexOrchestratorEfforts(m), ef = prev && prev.model === value ? prev.effort : null;
      if (!ef || effs.indexOf(ef) < 0) ef = m && effs.indexOf(m.defaultReasoningEffort) >= 0 ? m.defaultReasoningEffort : null;
      codexOrchestratorSubmodelSet({ model: value, effort: ef });
    }
    view = "slider"; render();
  }
  function renderList(models, sel) {
    siblings(false);
    var panel = mk("div", C("ViewPanel"));
    var list = mk("div", "flex flex-col");
    list.style.cssText = "max-height:320px;overflow-y:auto";
    list.setAttribute("role", "group");
    var lab = mk("div", C("sectionLabel")); lab.setAttribute("data-menu-section-label", "true"); lab.textContent = "Alt ajan modeli";
    list.appendChild(lab);
    function row(label, value, active, hint) {
      var b = mk("div", "no-drag " + C("itemBase") + " rounded-xl text-default group " + C("itemInteractive") + " flex flex-col");
      b.setAttribute("role", "menuitemradio"); b.setAttribute("aria-checked", active ? "true" : "false"); b.tabIndex = -1;
      b.setAttribute("data-codex-subagent-model", value || "");
      if (hint) b.title = hint;
      var rc = mk("div", "flex w-full min-w-0 items-center gap-[var(--spacing-menu-item-content,calc(var(--spacing)*1.5))]"); rc.setAttribute("data-menu-row-content", "true");
      var t = mk("span", "flex-1 min-w-0 truncate"), t2 = mk("span", "flex min-w-0 items-center gap-1 tabular-nums"), t3 = mk("span", "truncate whitespace-nowrap");
      t3.textContent = label; t2.appendChild(t3); t.appendChild(t2); rc.appendChild(t);
      if (active) rc.insertAdjacentHTML("beforeend", CODEX_ORCH_CHECK);
      b.appendChild(rc);
      b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); pickModel(value, models); });
      b.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickModel(value, models); } });
      return b;
    }
    list.appendChild(row(codexOrchL("Varsayılan (ayar dosyası)"), null, !sel, codexOrchL("config.toml [agents] varsayılanı")));
    if (!models.length) { var w = mk("div", C("sectionLabel")); w.textContent = codexOrchL("Modeller yükleniyor\u2026"); list.appendChild(w); }
    models.forEach(function (m) { list.appendChild(row(codexOrchestratorPrettyLabel(m), m.model, !!sel && sel.model === m.model, m.model)); });
    if (sel && models.length && !models.some(function (m) { return m.model === sel.model; })) list.appendChild(row(sel.model, sel.model, true, sel.model));
    panel.appendChild(list); wrap.appendChild(panel);
    var cur = list.querySelector('[aria-checked="true"]'); if (cur) setTimeout(function () { try { cur.scrollIntoView({ block: "nearest" }); } catch (e) {} }, 0);
  }
  function renderSlider(models, sel) {
    siblings(true);
    var sep = el("div", "height:0.5px;margin:2px 8px 0;background:color-mix(in srgb, currentColor 12%, transparent)");
    wrap.appendChild(sep);
    var cur = sel ? models.find(function (m) { return m.model === sel.model; }) : null;
    var effs = sel ? codexOrchestratorEfforts(cur) : [];
    var idx = sel && sel.effort ? effs.indexOf(sel.effort) : -1;
    var panel = mk("div", C("ViewPanel"));
    var ctl = mk("div", C("ViewControls")); ctl.setAttribute("data-explicit-model", "true"); ctl.setAttribute("data-ultra-warning-visible", "false");
    var tog = mk("div", "no-drag group cursor-interaction " + C("ViewToggle"));
    tog.setAttribute("role", "menuitem"); tog.setAttribute("aria-label", codexOrchL("Alt ajan modeli seç")); tog.setAttribute("data-interactive", "true"); tog.tabIndex = 0;
    tog.setAttribute("data-codex-subagent-toggle", "");
    var rc = mk("div", "flex w-full min-w-0 items-center gap-[var(--spacing-menu-item-content,calc(var(--spacing)*1.5))]"); rc.setAttribute("data-menu-row-content", "true");
    var o = mk("span", "flex-1 min-w-0 truncate"), content = mk("span", C("ViewToggleContent"));
    var ml = mk("span", C("ViewToggleModelLabel")), mi = mk("span", "flex min-w-0 items-center gap-1 tabular-nums"), mt = mk("span", "truncate whitespace-nowrap");
    mt.textContent = "Alt ajan \u00b7 " + (sel ? (cur ? codexOrchestratorPrettyLabel(cur) : sel.model) : codexOrchL("Varsayılan"));
    mi.appendChild(mt); ml.appendChild(mi); content.appendChild(ml);
    var ef = mk("span", C("ViewToggleEffortLabel"));
    ef.setAttribute("data-accent", idx >= 0 ? "true" : "false");
    ef.setAttribute("data-effort-only", idx >= 0 ? "false" : "true");
    ef.setAttribute("data-maximum", idx >= 0 && idx === effs.length - 1 ? "true" : "false");
    ef.textContent = idx >= 0 ? (CODEX_ORCH_EFFORT_LABELS[effs[idx]] || effs[idx]) : (sel ? codexOrchL("Model varsayılanı") : codexOrchL("Ayar dosyası"));
    content.appendChild(ef);
    content.insertAdjacentHTML("beforeend", CODEX_ORCH_CHEVRON.replace("__ICON__", C("ViewToggleIcon")));
    o.appendChild(content); rc.appendChild(o); tog.appendChild(rc);
    var openList = function (e) { e.preventDefault(); e.stopPropagation(); view = "list"; render(); };
    tog.addEventListener("click", openList);
    tog.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") openList(e); });
    ctl.appendChild(tog); panel.appendChild(ctl);
    if (sel && effs.length) {
      var n = effs.length, pos = Math.max(0, idx);
      var simple = mk("div", C("SimpleView")), cont = mk("div", C("Container"));
      cont.setAttribute("data-model-picker-power-slider", "");
      var root = mk("span", C("Root"));
      root.setAttribute("role", "slider"); root.tabIndex = 0;
      root.setAttribute("aria-label", codexOrchL("Alt ajan düşünme seviyesi")); root.setAttribute("aria-valuemin", "0"); root.setAttribute("aria-valuemax", String(n - 1)); root.setAttribute("aria-valuenow", String(pos));
      root.setAttribute("aria-valuetext", CODEX_ORCH_EFFORT_LABELS[effs[pos]] || effs[pos]);
      root.setAttribute("data-orientation", "horizontal"); root.setAttribute("data-dragging", "false"); root.setAttribute("data-fast-mode", "false"); root.setAttribute("data-highlighted", "false"); root.setAttribute("data-reduced-motion", "false");
      root.style.outline = "none";
      var frac = function (i) { return n > 1 ? i / (n - 1) : 0; };
      var at = function (i) { var p = frac(i), off = 13 - 26 * p; return "calc(" + (p * 100) + "% " + (off < 0 ? "- " : "+ ") + Math.abs(off) + "px)"; };
      var rangeAt = function (i) { var p = frac(i), off = 13 - 26 * p; return "translateX(calc(-" + ((1 - p) * 100) + "% " + (off < 0 ? "- " : "+ ") + Math.abs(off) + "px))"; };
      var track = mk("span", C("Track")); track.setAttribute("data-orientation", "horizontal");
      var range = mk("span", C("Range")); range.setAttribute("aria-hidden", "true");
      range.style.transition = "transform var(--model-picker-power-slider-motion-duration, .3s) var(--model-picker-power-slider-motion-easing, cubic-bezier(.23,1,.32,1))";
      track.appendChild(range);
      var rail = mk("div", C("TickRail")), ticks = [];
      for (var i = 0; i < n; i++) (function (i) {
        var t = mk("span", C("Tick")); t.setAttribute("data-locked", "false"); t.style.left = at(i);
        t.setAttribute("data-codex-subagent-effort", effs[i]); t.title = CODEX_ORCH_EFFORT_LABELS[effs[i]] || effs[i];
        ticks.push(t); rail.appendChild(t);
      })(i);
      track.appendChild(rail); root.appendChild(track);
      var vr = mk("div", C("VisualThumbRail")); vr.setAttribute("aria-hidden", "true");
      var ts = mk("span", C("ThumbScale")), sp = mk("span", C("ThumbSpring")), th = mk("span", C("Thumb"));
      ts.style.transition = "left var(--model-picker-power-slider-motion-duration, .3s) var(--model-picker-power-slider-motion-easing, cubic-bezier(.23,1,.32,1))";
      sp.appendChild(th); ts.appendChild(sp); vr.appendChild(ts); root.appendChild(vr);
      var show = function (i) {
        range.style.transform = rangeAt(i); ts.style.left = at(i);
        ticks.forEach(function (t, k) { t.setAttribute("data-selected", k <= i ? "true" : "false"); });
        root.setAttribute("aria-valuenow", String(i)); root.setAttribute("aria-valuetext", CODEX_ORCH_EFFORT_LABELS[effs[i]] || effs[i]);
        ef.textContent = CODEX_ORCH_EFFORT_LABELS[effs[i]] || effs[i];
        ef.setAttribute("data-accent", "true"); ef.setAttribute("data-effort-only", "false"); ef.setAttribute("data-maximum", i === n - 1 ? "true" : "false");
      };
      if (idx >= 0) show(pos); else { range.style.transform = rangeAt(0); ts.style.left = at(0); ticks.forEach(function (t) { t.setAttribute("data-selected", "false"); }); ts.style.opacity = "0.55"; }
      var commit = function (i) { pos = i; ts.style.opacity = ""; show(i); codexOrchestratorSubmodelSet({ model: sel.model, effort: effs[i] }); };
      var nearest = function (x) {
        var r = track.getBoundingClientRect(), best = 0, bd = 1e9;
        for (var k = 0; k < n; k++) { var p = frac(k), cx = r.left + p * r.width + (13 - 26 * p); var dd = Math.abs(x - cx); if (dd < bd) { bd = dd; best = k; } }
        return best;
      };
      var dragging = false, last = pos;
      root.addEventListener("pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); dragging = true; root.setAttribute("data-dragging", "true"); try { root.setPointerCapture(e.pointerId); } catch (x) {} last = nearest(e.clientX); ts.style.opacity = ""; show(last); });
      root.addEventListener("pointermove", function (e) { if (!dragging) return; var k = nearest(e.clientX); if (k !== last) { last = k; show(k); } });
      var end = function (e) { if (!dragging) return; dragging = false; root.setAttribute("data-dragging", "false"); commit(last); };
      root.addEventListener("pointerup", end); root.addEventListener("pointercancel", end);
      root.addEventListener("click", function (e) { e.stopPropagation(); });
      root.addEventListener("keydown", function (e) {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); commit(Math.max(0, pos - 1)); }
        else if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); commit(Math.min(n - 1, pos + 1)); }
      });
      cont.appendChild(root); simple.appendChild(cont); panel.appendChild(simple);
    }
    wrap.appendChild(panel);
  }
  function render() {
    wrap.textContent = "";
    var sel = codexOrchestratorSubmodelGet(), models = codexOrchestratorModelList();
    if (view === "list") renderList(models, sel); else renderSlider(models, sel);
  }
  render();
  wrap.codexRender = render;
  wrap.codexShowSlider = function () { if (view !== "slider") { view = "slider"; render(); } };
  return wrap;
}

var CODEX_ORCH_KEY="codex-orchestrator-mode";
var CODEX_ORCH_ALL_MODES=[["off",codexOrchL("Kapalı"),codexOrchL("Mesajlar normal gider"),"rgb(120, 120, 116)"],["fix",codexOrchL("Fix"),codexOrchL("Hatayı worker ile düzeltip denetler"),"rgb(225, 70, 90)"],["verify",codexOrchL("Verify"),codexOrchL("Sonucu bağımsız ajanla doğrular"),"rgb(22, 163, 74)"],["explore",codexOrchL("Explore"),codexOrchL("Fikri ve kodu araştırır, uygulamaz"),"rgb(8, 145, 178)"],["plan",codexOrchL("Plan"),codexOrchL("İnceleyip uygulanabilir plan hazırlar"),"#22C55E"],["subagents",codexOrchL("Alt Ajanlar"),codexOrchL("Ana ajan çalışır, alt ajanlarla paylaşır"),"#EAB308"],["lead",codexOrchL("Lead"),codexOrchL("Yerleşik ajanlarla uygular ve denetler"),"#EF4444"],["swarm",codexOrchL("Swarm"),codexOrchL("Paralel dalgalar, bağımsız doğrulama"),"#A855F7"]];
// Modes switched off in the Damndots dashboard are hidden from the picker and treated as Off. Fix, Verify and Explore start switched off.
var CODEX_ORCH_DEFAULT_DISABLED=["fix","verify","explore"];
var CODEX_ORCH_MODES=CODEX_ORCH_ALL_MODES.slice();
function codexOrchestratorDisabledList(){var d=window.__damndotsOrchestratorDefaults;var l=d&&Array.isArray(d.disabledModes)?d.disabledModes:CODEX_ORCH_DEFAULT_DISABLED;return l.filter(function(m){return m!=="off"})}
function codexOrchestratorAllowed(m){return codexOrchestratorDisabledList().indexOf(m)<0}
// Optional dashboard setting: while the orchestrator is Off the picker reads "Off <model> <thinking>" instead of "Orchestrator".
function codexOrchOffDetails(){var d=window.__damndotsOrchestratorDefaults;return !!(d&&d.showOffDetails===true)}
function codexOrchestratorOrdered(){var d=window.__damndotsOrchestratorDefaults,o=d&&Array.isArray(d.modeOrder)?d.modeOrder:null;if(!o)return CODEX_ORCH_ALL_MODES;var rows=[CODEX_ORCH_ALL_MODES[0]];o.forEach(function(k){var r=CODEX_ORCH_ALL_MODES.find(function(x){return x[0]===k});if(r&&rows.indexOf(r)<0)rows.push(r)});CODEX_ORCH_ALL_MODES.forEach(function(r){if(rows.indexOf(r)<0)rows.push(r)});return rows}
// Colours chosen in the Damndots dashboard replace the built-in colour of a mode; the row objects are cached so the picker keeps stable identities.
var codexOrchestratorColorCache={};
function codexOrchestratorColored(rows){var d=window.__damndotsOrchestratorDefaults,c=d&&d.modeColors&&typeof d.modeColors==="object"?d.modeColors:{};return rows.map(function(r){var v=c[r[0]];if(typeof v!=="string"||!/^#[0-9a-fA-F]{6}$/.test(v))return r;var k=r[0]+v,hit=codexOrchestratorColorCache[k];if(!hit)hit=codexOrchestratorColorCache[k]=[r[0],r[1],r[2],v];return hit})}
function codexOrchestratorRefreshModes(){var next=codexOrchestratorColored(codexOrchestratorOrdered()).filter(function(r){return codexOrchestratorAllowed(r[0])});if(next.length!==CODEX_ORCH_MODES.length||next.some(function(r,i){return CODEX_ORCH_MODES[i]!==r})){CODEX_ORCH_MODES.length=0;Array.prototype.push.apply(CODEX_ORCH_MODES,next)}}
codexOrchestratorRefreshModes();try{window.addEventListener("codex-orchestrator-change",codexOrchestratorRefreshModes)}catch(e){}
var CODEX_ORCH_ACCENT="rgb(76, 126, 240)";
var CODEX_ORCH_BTN="no-drag cursor-interaction items-center select-none disabled:cursor-default aria-disabled:cursor-default focus:outline-hidden disabled:opacity-40 aria-disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 whitespace-nowrap flex border gap-1 rounded-full text-tertiary not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover border-transparent h-token-button-composer px-2 py-0 text-sm leading-[18px] min-w-0";
var CODEX_ORCH_POP="no-drag m-px flex select-none flex-col overflow-hidden bg-surface-elevated-secondary/90 text-default ring-(--color-border-overlay) ring-(length:--dropdown-overlay-ring-width) shadow-(--shadow-dropdown-overlay) backdrop-blur-sm rounded-2xl p-[var(--app-menu-gutter,var(--spacing))]";
var codexOrchestratorPopup=null,codexOrchestratorComponent,codexOrchestratorTpsComponent;
var CODEX_ORCH_THREAD_MODES = 'codex-orchestrator-thread-modes-v2';
var CODEX_ORCH_PENDING_MODE = 'codex-orchestrator-pending-mode-v1';
var codexOrchestratorScopeAtom;
function codexOrchestratorReadModes() {
  try {
    var data = JSON.parse(localStorage.getItem(CODEX_ORCH_THREAD_MODES) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) { return {}; }
}
function codexOrchestratorMode(scopeId) { var picked = codexOrchestratorModeRaw(scopeId); return picked && codexOrchestratorAllowed(picked) ? picked : null; }
function codexOrchestratorModeRaw(scopeId) {
  var modes = codexOrchestratorReadModes();
  if (scopeId && Object.prototype.hasOwnProperty.call(modes, String(scopeId))) {
    var explicit = modes[String(scopeId)];
    return explicit && Object.prototype.hasOwnProperty.call(CODEX_ORCH_TEXT, explicit) ? explicit : null;
  }
  // A just-created chat has no saved mode for a moment (the draft is bound to its thread id after the turn starts); the selection made in the new-chat composer is still pending then.
  if (scopeId && String(scopeId).indexOf('draft:') !== 0 && codexOrchestratorIsNewThread(scopeId)) { var young = codexOrchestratorReadPending(); if (young && young.mode && Date.now() - young.at < 120000 && Object.prototype.hasOwnProperty.call(CODEX_ORCH_TEXT, young.mode)) return young.mode; }
  if (scopeId && String(scopeId).indexOf('draft:') === 0) { var pend = codexOrchestratorReadPending(); if (pend && pend.mode && Object.prototype.hasOwnProperty.call(CODEX_ORCH_TEXT, pend.mode)) return pend.mode; }
  var defaults = window.__damndotsOrchestratorDefaults;
  return defaults && Object.prototype.hasOwnProperty.call(CODEX_ORCH_TEXT, defaults.mode) ? defaults.mode : null;
}
// A chat created in this session from the new-chat composer (its first turn has started).
function codexOrchestratorIsNewThread(id) { try { var m = window.__dotsThreadMap || {}; for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k) && String(m[k]) === String(id)) return true; } catch (e) {} return false; }
function codexOrchestratorReadPending() {
  try {
    var pending = JSON.parse(localStorage.getItem(CODEX_ORCH_PENDING_MODE) || 'null');
    if (!pending || typeof pending !== 'object' || !Number.isFinite(pending.at) || Date.now() - pending.at > 3600000) return null;
    if (!Object.prototype.hasOwnProperty.call(CODEX_ORCH_TEXT, pending.mode) && pending.mode !== 'off') return null;
    return pending;
  } catch (error) { return null; }
}
function codexOrchestratorWritePending(mode, scopeId) {
  try { localStorage.setItem(CODEX_ORCH_PENDING_MODE, JSON.stringify({ mode: mode, scopeId: scopeId || null, at: Date.now() })); } catch (error) {}
}
function codexOrchestratorClearPending() {
  try { localStorage.removeItem(CODEX_ORCH_PENDING_MODE); } catch (error) {}
}
function codexOrchestratorClaimPending(scopeId) {
  var pending = codexOrchestratorReadPending();
  if (!pending || !scopeId) return null;
  var pendingScope = pending.scopeId == null ? null : String(pending.scopeId);
  if (pendingScope && pendingScope !== String(scopeId) && pendingScope.indexOf('draft:') !== 0) return null;
  // Only a just-made selection may move to a chat that has no saved mode; an old draft choice must not switch an existing chat on.
  if (String(scopeId).indexOf('draft:') !== 0 && Date.now() - pending.at > 120000) return null;
  var modes = codexOrchestratorReadModes();
  if (!Object.prototype.hasOwnProperty.call(modes, String(scopeId))) {
    modes[String(scopeId)] = pending.mode;
    try { localStorage.setItem(CODEX_ORCH_THREAD_MODES, JSON.stringify(modes)); } catch (error) {}
  }
  codexOrchestratorClearPending();
  window.dispatchEvent(new Event('codex-orchestrator-change'));
  return codexOrchestratorMode(scopeId);
}
function codexOrchestratorGet(scopeId) {
  codexOrchestratorRefreshModes();
  var mode = codexOrchestratorMode(scopeId);
  var index = CODEX_ORCH_MODES.findIndex(function (row) { return row[0] === mode; });
  return index < 0 ? 0 : index;
}
function codexOrchestratorSet(index, scopeId) {
  index = Math.max(0, Math.min(CODEX_ORCH_MODES.length - 1, index));
  var mode = CODEX_ORCH_MODES[index][0];
  if (!scopeId) {
    codexOrchestratorWritePending(mode, null);
    window.dispatchEvent(new Event('codex-orchestrator-change'));
    return;
  }
  var modes = codexOrchestratorReadModes();
  modes[String(scopeId)] = mode;
  localStorage.setItem(CODEX_ORCH_THREAD_MODES, JSON.stringify(modes));
  if (String(scopeId).indexOf('draft:') === 0) codexOrchestratorWritePending(mode, String(scopeId));
  else codexOrchestratorClearPending();
  window.dispatchEvent(new Event('codex-orchestrator-change'));
}
function codexOrchestratorSubCopyDraft(threadId) {
  try {
    if (!threadId) return;
    var base = "codex-orchestrator-subagent-model-v2:", draft = localStorage.getItem(base + "draft:new");
    if (draft && localStorage.getItem(base + String(threadId)) == null) localStorage.setItem(base + String(threadId), draft);
  } catch (e) {}
}
function codexOrchestratorBind(clientThreadId, threadId) {
  try {
  if (!clientThreadId || !threadId) return;
  var modes = codexOrchestratorReadModes();
  var draftKey = 'draft:' + String(clientThreadId);
  var threadKey = String(threadId);
  if (!Object.prototype.hasOwnProperty.call(modes, draftKey)) {
    var pending = codexOrchestratorReadPending();
    var defaults = window.__damndotsOrchestratorDefaults;
    var draftNew = Object.prototype.hasOwnProperty.call(modes, 'draft:new') ? modes['draft:new'] : null;
    modes[draftKey] = pending && (pending.scopeId == null || String(pending.scopeId).indexOf('draft:') === 0) ? pending.mode : draftNew ? draftNew : defaults && defaults.mode ? defaults.mode : 'off';
  }
  if (!Object.prototype.hasOwnProperty.call(modes, threadKey)) modes[threadKey] = modes[draftKey];
  try { codexOrchestratorSubCopyDraft(threadKey); } catch (e) {}
  delete modes[draftKey];
  localStorage.setItem(CODEX_ORCH_THREAD_MODES, JSON.stringify(modes));
  codexOrchestratorClearPending();
  window.dispatchEvent(new Event('codex-orchestrator-change'));
  } catch (error) {
    // Preference persistence must never block Codex's own thread creation.
    return;
  }
}
// Codex 26.1029+ builds turns in the main process: mirror the selection there and pick up chat claims made by it.
function codexOrchestratorSync() {
  try {
    var bridge = window.electronBridge;
    if (!bridge || typeof bridge.syncOrchestrator !== 'function') return;
    var defaults = window.__damndotsOrchestratorDefaults;
    bridge.syncOrchestrator({ disabled: codexOrchestratorDisabledList(), modes: codexOrchestratorReadModes(), pending: codexOrchestratorReadPending(), notes: (function () { var out = {}; try { var ks = Object.keys(codexOrchestratorReadModes()); if (ks.indexOf('draft:new') < 0) ks.push('draft:new'); ks.forEach(function (k) { try { var n = codexOrchestratorModelNote(k); if (n) out[k] = n; else out[k] = ''; } catch (e) {} }); } catch (e) {} return out; })(), note: codexOrchestratorModelNote(), defaultMode: defaults && typeof defaults.mode === 'string' ? defaults.mode : null, scope: (function () { try { return codexOrchestratorComposerScope(); } catch (e) { return null; } })(), scopeMode: (function () { try { return codexOrchestratorMode(codexOrchestratorComposerScope()) || 'off'; } catch (e) { return null; } })() }).then(function (r) {
      if (!r || typeof r !== 'object') return;
      var changed = false, modes = codexOrchestratorReadModes();
      if (r.claims) Object.keys(r.claims).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(modes, k)) { modes[k] = r.claims[k]; changed = true; } });
      if (changed) { try { localStorage.setItem(CODEX_ORCH_THREAD_MODES, JSON.stringify(modes)); } catch (e) {} }
      var pending = codexOrchestratorReadPending();
      if (pending && r.pendingConsumed >= pending.at) { codexOrchestratorClearPending(); changed = true; }
      if (changed) window.dispatchEvent(new Event('codex-orchestrator-change'));
    }).catch(function () {});
  } catch (error) {}
}
function codexOrchestratorComposerScope(){throw new Error("Native composer bindings must be resolved during installation");}

var CODEX_ORCH_TEXT={"subagents":"[ORKESTRATÖR MODU: ALT AJANLAR — NATIVE CODEX]\nDELEGATION REQUIRED: In this mode you must call spawn_agent at least once before your final answer, even when the task looks small. Spawn at least one bounded subagent (an explorer for an investigation or a worker for a disjoint edit). A turn that ends without any spawned agent does not follow the selection the user made. Only a pure greeting, status question or stop request needs no agent.\nThe user selected Alt Ajanlar and requests useful native subagent assistance for this task. The parent remains an active contributor. For substantive work with a meaningful independent split, delegate at least one bounded part early and continue your own independent part. Run independent investigations or disjoint edits concurrently when that saves time or improves coverage; keep tightly dependent work together. No fixed planning, implementation or review pipeline is required. Integrate results and verify at a level proportionate to the actual task. For a trivial task with no useful split, work directly and do not invent a second task.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","lead":"[ORKESTRATÖR MODU: LEAD — NATIVE CODEX]\nDELEGATION REQUIRED: In this mode you must call spawn_agent at least once before your final answer, even when the task looks small. Spawn worker agents for the implementation units and an independent default agent to review the integrated result. Do not do the substantive implementation yourself. A turn that ends without any spawned agent does not follow the selection the user made. Only a pure greeting, status question or stop request needs no agent.\nThe user selected Lead and requests native delegation and coordination. Establish the target and acceptance criteria, inspect enough context, then make a short dependency-aware work plan. Choose the number and roles of agents from the actual work and available concurrency; there is no fixed team size. For substantive implementation delegate a meaningful implementation unit to worker agents. Do not funnel every project into one worker or wait for one worker before assigning unrelated work. Parallelize independent, disjoint modules or investigations; serialize dependent tasks and shared mutable resources. A single-file task may correctly use one writer and a later reviewer; do not add agents merely to fill slots. The parent owns task boundaries, interfaces, coordination, integration and final evidence and may do bounded integration work while workers run. Review the stable integrated result with an independent default agent; larger changes may justify distinct scoped reviews, not duplicate seats reviewing the same thing. Address substantive findings through the owning worker when useful. If a worker is blocked or unsuitable, use the common takeover protocol and transparently explain the fallback instead of silently discarding its work. Completion requires the requested result, reconciled child results and adequate verification, not just a completed task list.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","plan":"[ORKESTRATÖR MODU: PLAN — NATIVE CODEX]\nDELEGATION REQUIRED: In this mode you must call spawn_agent at least once before your final answer, even when the task looks small. Spawn at least one explorer for repository discovery before writing the plan. A turn that ends without any spawned agent does not follow the selection the user made. Only a pure greeting, status question or stop request needs no agent.\nThe user selected Plan and requests planning, not application implementation. For a substantive repository task, delegate bounded discovery to explorer agents; use parallel explorers only for independent questions. Inspect repository facts before asking the user to supply facts available in the workspace. Ask only for material preferences, constraints or tradeoffs that evidence cannot resolve. Produce a right-sized plan mapping each requirement to the affected files/resources, concrete tasks, dependencies/interfaces and observable acceptance checks. Include relevant risks, verification commands or runtime checks, unresolved assumptions and completion/stop criteria. Explain what can run concurrently and what must be sequential. Check that referenced files and interfaces exist and that no requirement is silently dropped. For complex or high-impact plans, delegate a separate plan critique to a default agent and reconcile blockers; a small plan needs only proportionate self-review. Do not write application code, install dependencies, run mutating application experiments or publish. Save a plan artifact only when requested or already authorized by the task; otherwise return the plan in chat. Do not impose a new roadmap, commit policy or document hierarchy. Stop at the completed plan; implementation needs the user's subsequent direction.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","explore":"[ORKESTRATÖR MODU: EXPLORE — NATIVE CODEX]\nDELEGATION REQUIRED: In this mode you must call spawn_agent at least once before your final answer, even when the task looks small. Spawn at least one explorer for the investigation. A turn that ends without any spawned agent does not follow the selection the user made. Only a pure greeting, status question or stop request needs no agent.\nThe user selected Explore and requests native delegated investigation without implementation. Identify the actual questions and use explorer agents for specific repository-local questions, in parallel when independent. Keep external documentation research distinct from repository facts and use appropriate read-only tools. Start with targeted file/text/symbol searches; inspect relevant relationships and data/control flow rather than dumping whole files. Reuse prior explorer findings and existing children for related follow-up instead of independently repeating the same investigation. Return the direct answer, relevant absolute paths/symbols, how components connect, evidence for findings, feasible alternatives where requested and material unknowns. Separate observed facts from inferences. Do not modify application files, install dependencies or publish. Stop when the requested question is answered with actionable evidence or identify the precise evidence that is unavailable; do not drift into implementation or unrequested architecture decisions.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","verify":"[ORKESTRATÖR MODU: VERIFY — NATIVE CODEX]\nDELEGATION REQUIRED: In this mode you must call spawn_agent at least once before your final answer, even when the task looks small. Spawn a default agent for the independent verification. A turn that ends without any spawned agent does not follow the selection the user made. Only a pure greeting, status question or stop request needs no agent.\nThe user selected Verify and requests independent native verification. Resolve the actual target, revision/environment and acceptance criteria from the request, not only from an implementer's summary. Delegate a bounded independent verification to a default agent for a substantive review, with explicit inspect-and-report instructions and no application edits. Split independent verification surfaces only when useful; avoid duplicate reviews of the same evidence. Map every material claim to source/diff, test, artifact or runtime evidence that actually proves it. Check existence, substance and wiring: a file or stub existing does not prove behavior. Use fresh targeted checks where needed and preserve valid existing evidence when unchanged; do not rerun expensive suites without reason. Distinguish code correctness, rendered behavior, installed version and deployment. Do not hide an observable failure as uncertainty; mark unavailable proof as inconclusive or not run. Reconcile discrepancies and issue PASS only when material acceptance criteria are proven, otherwise FAIL or PARTIAL with concrete findings, evidence gaps and next checks. Do not repair application code, install dependencies or publish. Verification tools must stay within the user's authorized environment and avoid unrelated state changes.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","fix":"[ORKESTRATÖR MODU: FIX — NATIVE CODEX]\nDELEGATION REQUIRED: In this mode you must call spawn_agent at least once before your final answer, even when the task looks small. Spawn an explorer for the diagnosis and/or a worker with explicit file ownership for the repair, then an independent default agent to review the fix. Do not make the substantive edit yourself. A turn that ends without any spawned agent does not follow the selection the user made. Only a pure greeting, status question or stop request needs no agent.\nThe user selected Fix and requests native delegated repair within the authorized scope. Establish the observed failure, expected behavior and reproduction conditions. Reproduce it or collect the missing logs/state before guessing at a fix. Read complete errors, inspect recent changes and trace the failing data/configuration across component boundaries. Use explorers for independent diagnosis questions and a worker with explicit ownership for a substantive repair. State a testable root-cause hypothesis, test it with a minimal change and keep unrelated fixes/refactors out. Capture a failing reproduction or another concrete before/after observation; add a regression test when meaningful and appropriate. Re-run the original failure and nearby affected checks after the fix. Several independent failures may be split across agents; do not split manifestations of the same shared cause blindly. After three unsuccessful hypotheses or repeated new symptoms, reopen the diagnosis and examine design/assumption errors instead of stacking another speculative patch; continue useful investigation within scope and surface a genuine blocker when one remains. Reuse the responsible worker for corrections and independently review substantive fixes with a default agent. Apply the common takeover rules if delegation fails. Report the cause, exact repair, validation and remaining limits; do not claim fixed because code changed or tests unrelated to the original symptom pass.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","swarm":"[ORKESTRATÖR MODU: SWARM — NATIVE CODEX, METASWARM]\nDELEGATION REQUIRED: In this mode you must call spawn_agent at least once before your final answer, even when the task looks small. A small task still uses at least one worker and one fresh reviewer. Do not do the substantive implementation yourself. A turn that ends without any spawned agent does not follow the selection the user made. Only a pure greeting, status question or stop request needs no agent.\nThe user selected Swarm: a metaswarm-style, quality-gated parallel swarm. The installed metaswarm plugin (skills orchestrated-execution, plan-review-gate and design-review-gate) is the reference for this workflow; read those skills when the task is substantial. Run everything with native Codex subagents. Do not require BEADS, GitHub issues, pull requests, commits or new project files unless the user asked for them or the repository already uses them. Core principle: trust nothing, verify everything, review adversarially.\n1. MAP. Establish the target, constraints and a Definition of Done: concrete items that can each be verified independently. Send explorer agents in parallel for independent discovery questions instead of reading everything yourself.\n2. DECOMPOSE. Split the work into work units, each with an ID, a short spec, its DoD items, an explicit file scope (about five files at most) and its dependencies. The units form a dependency graph. Mark every unit that can run in parallel as parallel, never give two parallel units overlapping files, and add integration units that wire separately built parts together.\n3. PLAN REVIEW GATE. For substantive or risky plans, spawn three fresh reviewers in parallel (feasibility, completeness, scope and alignment). Fix the plan and re-review with new reviewers until all pass, at most three rounds, before implementation starts. Skip this gate only for a small, clearly scoped task and say so.\n4. SCALE. Choose the number of agents from the width of the dependency graph and the available concurrency, never a fixed count: one worker for a single unit, three to five parallel workers for typical work, more only for wide independent work. Never spawn agents for busywork.\n5. WAVES. Execute the graph level by level as parallel waves and start a unit as soon as its dependencies pass, so the critical path stays short. Every unit runs the four-phase loop. IMPLEMENT: a worker with the spec, DoD, file scope and project context; tests first where the project has tests; only files in its scope; it must not certify its own result. VALIDATE: you run the tests, type check, lint and build yourself and compare the changed files with the unit scope; never accept a worker saying it passes; after three failed attempts stop and escalate with the evidence. ADVERSARIAL REVIEW: a fresh default agent receives only the spec, the DoD and the diff, never the worker report or earlier findings, and returns PASS or FAIL for each DoD item with file:line evidence; only critical or major findings tied to a real requirement block. On FAIL the owning worker fixes, you validate again and a new reviewer reviews, at most ten rounds. ACCEPT: the unit is done only after VALIDATE and REVIEW both pass; record minor findings as follow-ups.\n6. STEER. Track every unit with its owner, phase, attempts and last concrete progress. Redirect a stuck agent, and reassign only through the takeover protocol below.\n7. FINAL REVIEW. After all units, run the full checks on the integrated result and spawn one fresh reviewer for cross-unit integration: conflicting changes, duplicated code, broken contracts between units and files changed outside any scope.\n8. CHECKPOINTS AND REPORT. Pause for the user only at planned checkpoints: destructive or irreversible steps, security-sensitive changes, schema migrations and missing external credentials. Finish with a table per unit (owner, validate, review), the checks you ran with their results, follow-ups and remaining risks.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly."};
var CODEX_ORCH_SENT="codex-orchestrator-sent",CODEX_ORCH_OFF="[ORCHESTRATOR OFF — THIS CHAT, CURRENT TURN]\nThe user selected Off. All previous Alt Ajanlar, Lead, Plan, Explore, Verify and Fix role instructions and their delegation workflow are inactive for this turn. Handle the current request yourself in the primary agent. Do not start subagents or assign new work to existing subagents unless the user explicitly asks for delegation in the current request. Do not infer permission from earlier turns, project/skill suggestions, task complexity or proactive/Ultra preferences. Do not use another chat, external agent process or background job to bypass this setting. This is normal working mode: implementation is permitted when the user's actual request authorizes it; previous Plan or Verify limitations do not remain active. Preserve ordinary scope, permissions and project instructions. Already running children are not automatically cancelled by changing the selector; if relevant, report their actual status without giving them new work. A later active composer mode can enable its own workflow again. An explicit delegation request authorizes only that request and does not change the saved Off selection.",codexOrchestratorFirst=null;
function codexOrchestratorSent(){try{return JSON.parse(localStorage.getItem(CODEX_ORCH_SENT)||"{}")}catch(e){return{}}}
function codexOrchestratorSave(o){try{var k=Object.keys(o);for(var i=0;i<k.length-200;i++)delete o[k[i]];localStorage.setItem(CODEX_ORCH_SENT,JSON.stringify(o))}catch(e){}}
// Native per-turn application context. This is evaluated in the composer's scope.
function codexOrchestratorCollab(cm, options) { return cm; }
var CODEX_ORCH_OFF_ULTRA="[ORCHESTRATOR OFF + ULTRA — THIS CHAT, CURRENT TURN]\nThe user selected Off in the orchestrator menu and Ultra reasoning for this turn. No orchestrator role workflow (Alt Ajanlar, Lead, Plan, Explore, Verify, Fix) is active and none of their phase or review requirements apply. Original Codex Ultra behaviour applies: you may proactively delegate bounded, independent subtasks to native subagents when that materially improves speed or quality of the current task; the Ultra selection is the user's authorization for this. Delegation is optional: handle greetings, status questions, small edits and tightly coupled work yourself, and do not invent busywork. Use only the native collaboration tools; do not create user-owned chats, external agent processes or background jobs. Keep the user's scope, permissions, project instructions and model choices.";
function codexOrchestratorTrace(reason,p,aeon){try{var k='codex-orchestrator-trace',l=JSON.parse(localStorage.getItem(k)||'[]');l.push({at:Date.now(),reason:reason,trigger:p&&p.turnTrigger,hasInput:!!(p&&p.input&&p.input.length),aeon:aeon==null?null:String(aeon),thread:p&&(p.threadId||p.clientThreadId)||null});localStorage.setItem(k,JSON.stringify(l.slice(-25)))}catch(e){}}
function codexOrchestratorTurn(p, aeon, fallbackEffort) {
  codexOrchestratorTrace('enter', p, aeon);
  if (!p || aeon != null || p.toolOutput != null || !p.input || !p.input.length) { codexOrchestratorTrace('skip-basic', p, aeon); return p; }
  if (p.turnTrigger != null && p.turnTrigger !== 'composer' && p.turnTrigger !== 'goal') { codexOrchestratorTrace('skip-trigger', p, aeon); return p; }
  var scopeId = p.threadId != null ? String(p.threadId) : p.clientThreadId != null ? 'draft:' + String(p.clientThreadId) : null;
  if (!scopeId) return p;
  var mode = codexOrchestratorMode(scopeId);
  if (!Object.prototype.hasOwnProperty.call(codexOrchestratorReadModes(), scopeId)) { codexOrchestratorClaimPending(scopeId); mode = codexOrchestratorMode(scopeId); }
  var sent = codexOrchestratorSent();
  var context = Object.assign({}, p.additionalContext);
  var cmEffort = p.collaborationMode && p.collaborationMode.settings ? p.collaborationMode.settings.reasoning_effort : null;
  var effort = cmEffort != null ? cmEffort : p.effort != null ? p.effort : fallbackEffort;
  context.codex_orchestrator = { kind: 'application', value: mode ? CODEX_ORCH_TEXT[mode] + codexOrchestratorModelNote() : effort === 'ultra' ? CODEX_ORCH_OFF_ULTRA + codexOrchestratorModelNote() : CODEX_ORCH_OFF };
  sent[scopeId] = mode || 'off';
  var result = Object.assign({}, p, { additionalContext: context });
  var cm = p.collaborationMode;
  if (cm && cm.settings && /^\[ORKESTRATÖR MODU:/.test(cm.settings.developer_instructions || '')) {
    result.collaborationMode = Object.assign({}, cm, { settings: Object.assign({}, cm.settings, { developer_instructions: null }) });
  }
  codexOrchestratorSave(sent);
  codexOrchestratorTrace('injected:' + (mode || 'off'), p, aeon);
  return result;
}

function codexOrchestratorClose(){codexOrchestratorModelSectionLive=null;var p=codexOrchestratorPopup;if(!p)return;codexOrchestratorPopup=null;try{p.cleanup()}catch(e){}try{window.dispatchEvent(new Event("codex-orchestrator-closed"))}catch(e){}}
function codexOrchestratorOpen(anchor,scopeId){
 codexOrchestratorClose();
 var M=CODEX_ORCH_MODES,LAST=M.length-1,d=document;
 function el(tag,css,cls){var e=d.createElement(tag);if(css)e.style.cssText=css;if(cls)e.className=cls;return e}
 var pop=el("div","position:fixed;z-index:60;width:254px;box-sizing:border-box;opacity:0;transform:translateY(4px) scale(0.98);transform-origin:bottom right;transition:opacity 0.12s ease,transform 0.12s ease;",CODEX_ORCH_POP);
 pop.setAttribute("data-codex-orchestrator-popup","");pop.setAttribute("role","dialog");pop.setAttribute("aria-label",codexOrchL("Orkestratör"));
 var head=el("div","display:flex;flex-direction:column;align-items:center;justify-content:center;height:48px;padding:4px;box-sizing:border-box;text-align:center");
 var title=el("div","font-size:14px;line-height:20px;font-weight:500"),sub=el("div","font-size:12px;line-height:16px;opacity:0.5;white-space:nowrap");
 head.appendChild(title);head.appendChild(sub);
 var pad=el("div","margin:0 2px 6px;padding:2px 6px;height:32px;box-sizing:border-box");
 var root=el("div","position:relative;height:28px;width:100%;cursor:var(--cursor-interaction, pointer);touch-action:none;outline:none");
 root.setAttribute("role","slider");root.tabIndex=0;root.setAttribute("aria-label",codexOrchL("Orkestratör modu"));root.setAttribute("aria-valuemin","0");root.setAttribute("aria-valuemax",String(LAST));
 var track=el("div","position:absolute;left:0;right:0;top:2px;height:24px;border-radius:12px;overflow:hidden;background:color-mix(in srgb, currentColor 10%, transparent);box-shadow:inset 0 0 0 0.5px color-mix(in srgb, currentColor 8%, transparent)");
 var fill=el("div","position:absolute;left:0;top:0;height:100%;border-radius:12px 0 0 12px;background:"+CODEX_ORCH_ACCENT+";transition:width 0.3s cubic-bezier(0.23, 1, 0.32, 1),background-color 0.3s ease");
 track.appendChild(fill);
 var ticks=[];for(var k=0;k<=LAST;k++){var w=el("span","position:absolute;top:0;width:16px;height:24px;display:flex;align-items:center;justify-content:center;cursor:var(--cursor-interaction, pointer);left:calc(13px + (100% - 26px) * "+(k/LAST)+" - 8px)");var t=el("span","display:block;width:4px;height:4px;border-radius:50%;pointer-events:none;transition:background-color 0.3s cubic-bezier(0.23, 1, 0.32, 1),transform 0.12s ease,filter 0.12s ease");(function(t){w.addEventListener("pointerenter",function(){t.style.transform="scale(2)";t.style.filter="brightness(0.85)"});w.addEventListener("pointerleave",function(){t.style.transform="";t.style.filter=""})})(t);w.appendChild(t);ticks.push(t);track.appendChild(w)}
 var thumb=el("div","position:absolute;top:0;width:28px;height:28px;box-sizing:border-box;border-radius:50%;background:#fff;border:0.5px solid var(--color-border-strong, rgba(45, 45, 43, 0.2));box-shadow:0 0 2px rgba(0, 0, 0, 0.1);transition:left 0.3s cubic-bezier(0.23, 1, 0.32, 1),transform 0.28s cubic-bezier(0.34, 1.5, 0.64, 1);will-change:left,transform");
 root.appendChild(track);root.appendChild(thumb);pad.appendChild(root);pop.appendChild(head);pop.appendChild(pad);
 function paint(){var i=codexOrchestratorGet(scopeId),x="calc(13px + (100% - 26px) * "+(i/LAST)+")";fill.style.width=i===0?"0":x;fill.style.background=M[i][3];thumb.style.left="calc(13px + (100% - 26px) * "+(i/LAST)+" - 14px)";for(var k=0;k<ticks.length;k++)ticks[k].style.background=(i>0&&k<=i)?"rgba(255, 255, 255, 0.45)":"color-mix(in srgb, currentColor 40%, transparent)";title.textContent=M[i][1];title.style.color=i===0?"color-mix(in srgb, currentColor 65%, transparent)":M[i][3];sub.textContent=M[i][2];root.setAttribute("aria-valuenow",String(i));root.setAttribute("aria-valuetext",M[i][1])}
 function fromX(cx){var r=track.getBoundingClientRect(),w=r.width-26;return w>0?Math.round((cx-r.left-13)/w*LAST):0}
 function pick(n){codexOrchestratorSet(n,scopeId);paint()}
 var drag=false,hov=false;thumb.addEventListener("pointerenter",function(){hov=true;thumb.style.transform="scale(1.1429)"});thumb.addEventListener("pointerleave",function(){hov=false;if(!drag)thumb.style.transform=""});
 root.addEventListener("pointerdown",function(e){e.preventDefault();drag=true;root.style.cursor="grabbing";thumb.style.transition="left 0.15s cubic-bezier(0.23, 1, 0.32, 1),transform 0.28s cubic-bezier(0.34, 1.5, 0.64, 1)";fill.style.transition="width 0.15s cubic-bezier(0.23, 1, 0.32, 1),background-color 0.3s ease";thumb.style.transform="scale(1.1429)";try{root.setPointerCapture(e.pointerId)}catch(x){}root.focus();pick(fromX(e.clientX))});
 root.addEventListener("pointermove",function(e){if(drag)pick(fromX(e.clientX))});
 function up(){if(!drag)return;drag=false;root.style.cursor="";thumb.style.transition="";fill.style.transition="";if(!hov)thumb.style.transform=""}
 root.addEventListener("wheel",function(e){e.preventDefault();var d=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:-e.deltaY;if(!d)return;pick(codexOrchestratorGet(scopeId)+(d>0?1:-1))},{passive:false});root.addEventListener("pointerup",up);root.addEventListener("pointercancel",up);
 root.addEventListener("keydown",function(e){var i=codexOrchestratorGet(scopeId),n=e.key==="ArrowRight"?i+1:e.key==="ArrowLeft"?i-1:e.key==="Home"?0:e.key==="End"?LAST:(e.key==="Enter"||e.key===" ")?-1:null;if(n===null)return;e.preventDefault();e.stopPropagation();if(n<0){codexOrchestratorClose();return}pick(n)});
 var r=anchor.getBoundingClientRect();pop.style.right=Math.max(8,window.innerWidth-r.right)+"px";pop.style.bottom=(window.innerHeight-r.top+8)+"px";
 paint();d.body.appendChild(pop);
 requestAnimationFrame(function(){pop.style.opacity="1";pop.style.transform="none"});
 function away(e){var t=e.target;if(pop.contains(t)||anchor.contains(t))return;codexOrchestratorClose()}
 function esc(e){if(e.key==="Escape"){e.stopPropagation();var ms=codexOrchestratorModelSectionLive;if(ms&&ms.querySelector("[data-codex-subagent-model]")&&ms.codexShowSlider){ms.codexShowSlider();return}codexOrchestratorClose();try{anchor.focus()}catch(x){}}}
 function bye(){codexOrchestratorClose()}
 d.addEventListener("pointerdown",away,true);d.addEventListener("keydown",esc,true);window.addEventListener("resize",bye);window.addEventListener("blur",bye);
 try{root.focus({preventScroll:true})}catch(x){}
 codexOrchestratorPopup={cleanup:function(){d.removeEventListener("pointerdown",away,true);d.removeEventListener("keydown",esc,true);window.removeEventListener("resize",bye);window.removeEventListener("blur",bye);if(pop.parentNode)pop.parentNode.removeChild(pop)}};
}
function codexOrchestratorSliderDom(scopeId){
 var M=CODEX_ORCH_MODES,LAST=M.length-1,d=document;
 function el(tag,css){var e=d.createElement(tag);if(css)e.style.cssText=css;return e}
 var box=el("div","display:flex;flex-direction:column;padding:4px 4px 2px");
 var head=el("div","display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:40px;padding:2px 4px;box-sizing:border-box;text-align:center");
 var title=el("div","font-size:14px;line-height:20px;font-weight:500"),sub=el("div","font-size:12px;line-height:16px;opacity:0.5;white-space:nowrap");
 head.appendChild(title);head.appendChild(sub);
 var pad=el("div","margin:0 2px;padding:2px 6px;height:32px;box-sizing:border-box");
 var root=el("div","position:relative;height:28px;width:100%;cursor:var(--cursor-interaction, pointer);touch-action:none;outline:none");
 root.setAttribute("role","slider");root.tabIndex=0;root.setAttribute("aria-label",codexOrchL("Orkestratör modu"));root.setAttribute("aria-valuemin","0");root.setAttribute("aria-valuemax",String(LAST));root.setAttribute("data-codex-orchestrator-slider","");
 var track=el("div","position:absolute;left:0;right:0;top:2px;height:24px;border-radius:12px;overflow:hidden;background:color-mix(in srgb, currentColor 10%, transparent);box-shadow:inset 0 0 0 0.5px color-mix(in srgb, currentColor 8%, transparent)");
 var fill=el("div","position:absolute;left:0;top:0;height:100%;border-radius:12px 0 0 12px;transition:width 0.3s cubic-bezier(0.23, 1, 0.32, 1),background-color 0.3s ease");
 track.appendChild(fill);
 var ticks=[];for(var k=0;k<=LAST;k++){var w=el("span","position:absolute;top:0;width:16px;height:24px;display:flex;align-items:center;justify-content:center;cursor:var(--cursor-interaction, pointer);left:calc(13px + (100% - 26px) * "+(k/LAST)+" - 8px)");w.setAttribute("data-codex-orchestrator-mode",M[k][0]);var t=el("span","display:block;width:4px;height:4px;border-radius:50%;pointer-events:none;transition:background-color 0.3s cubic-bezier(0.23, 1, 0.32, 1),transform 0.12s ease,filter 0.12s ease");(function(t){w.addEventListener("pointerenter",function(){t.style.transform="scale(2)";t.style.filter="brightness(0.85)"});w.addEventListener("pointerleave",function(){t.style.transform="";t.style.filter=""})})(t);w.appendChild(t);ticks.push(t);track.appendChild(w)}
 var thumb=el("div","position:absolute;top:0;width:28px;height:28px;box-sizing:border-box;border-radius:50%;background:#fff;border:0.5px solid var(--color-border-strong, rgba(45, 45, 43, 0.2));box-shadow:0 0 2px rgba(0, 0, 0, 0.1);transition:left 0.3s cubic-bezier(0.23, 1, 0.32, 1),transform 0.28s cubic-bezier(0.34, 1.5, 0.64, 1);will-change:left,transform");
 root.appendChild(track);root.appendChild(thumb);pad.appendChild(root);box.appendChild(head);box.appendChild(pad);
 var line=el("div","height:0.5px;margin:6px 8px 0;background:color-mix(in srgb, currentColor 12%, transparent)");box.appendChild(line);
 function paint(){var i=codexOrchestratorGet(scopeId),x="calc(13px + (100% - 26px) * "+(i/LAST)+")";fill.style.width=i===0?"0":x;fill.style.background=M[i][3];thumb.style.left="calc(13px + (100% - 26px) * "+(i/LAST)+" - 14px)";for(var k=0;k<ticks.length;k++)ticks[k].style.background=(i>0&&k<=i)?"rgba(255, 255, 255, 0.45)":"color-mix(in srgb, currentColor 40%, transparent)";title.textContent=M[i][1];title.style.color=i===0?"color-mix(in srgb, currentColor 65%, transparent)":M[i][3];sub.textContent=M[i][2];root.setAttribute("aria-valuenow",String(i));root.setAttribute("aria-valuetext",M[i][1])}
 function fromX(cx){var r=track.getBoundingClientRect(),w=r.width-26;return w>0?Math.round((cx-r.left-13)/w*LAST):0}
 function pick(n){codexOrchestratorSet(n,scopeId);paint()}
 var drag=false,hov=false;thumb.addEventListener("pointerenter",function(){hov=true;thumb.style.transform="scale(1.1429)"});thumb.addEventListener("pointerleave",function(){hov=false;if(!drag)thumb.style.transform=""});
 root.addEventListener("pointerdown",function(e){e.preventDefault();e.stopPropagation();drag=true;root.style.cursor="grabbing";thumb.style.transition="left 0.15s cubic-bezier(0.23, 1, 0.32, 1),transform 0.28s cubic-bezier(0.34, 1.5, 0.64, 1)";fill.style.transition="width 0.15s cubic-bezier(0.23, 1, 0.32, 1),background-color 0.3s ease";thumb.style.transform="scale(1.1429)";try{root.setPointerCapture(e.pointerId)}catch(x){}try{root.focus({preventScroll:true})}catch(x){}pick(fromX(e.clientX))});
 root.addEventListener("pointermove",function(e){if(drag){e.stopPropagation();pick(fromX(e.clientX))}});
 function up(){if(!drag)return;drag=false;root.style.cursor="";thumb.style.transition="";fill.style.transition="";if(!hov)thumb.style.transform=""}
 root.addEventListener("wheel",function(e){e.preventDefault();var dd=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:-e.deltaY;if(!dd)return;pick(codexOrchestratorGet(scopeId)+(dd>0?1:-1))},{passive:false});root.addEventListener("pointerup",up);root.addEventListener("pointercancel",up);
 root.addEventListener("keydown",function(e){var i=codexOrchestratorGet(scopeId),n=e.key==="ArrowRight"?i+1:e.key==="ArrowLeft"?i-1:e.key==="Home"?0:e.key==="End"?LAST:null;if(n===null)return;e.preventDefault();e.stopPropagation();pick(n)});
 paint();
 return {node:box,paint:paint};
}
function codexOrchestratorEnsureNative(R){
 if(window.__codexOrchMenuHeader&&window.__codexOrchTriggerLabel)return;
 var h=R.createElement;
 function useOrchTick(){var s=R.useState(0),set=s[1];R.useEffect(function(){function f(){set(function(x){return x+1})}window.addEventListener('codex-orchestrator-change',f);window.addEventListener('storage',f);return function(){window.removeEventListener('codex-orchestrator-change',f);window.removeEventListener('storage',f)}},[]);}
 window.__codexOrchMenuHeader=function(){
  var scopeId=codexOrchestratorComposerScope(),ref=R.useRef(null);
  useOrchTick();
  /* Same as the native menu: transitions are off for the first frame so the max-effort particles are visible immediately. */
  var trs=R.useState(false),transitionsReady=trs[0],setTransitionsReady=trs[1];
  R.useLayoutEffect(function(){var f=window.requestAnimationFrame(function(){setTransitionsReady(true)});return function(){window.cancelAnimationFrame(f)}},[]);
  var rm=R.useState(function(){return window.matchMedia("(prefers-reduced-motion: reduce)").matches}),reduced=rm[0],setReduced=rm[1];
  R.useEffect(function(){var q=window.matchMedia("(prefers-reduced-motion: reduce)");function sync(){setReduced(q.matches)}q.addEventListener("change",sync);sync();return function(){q.removeEventListener("change",sync)}},[]);
  // Like Ultra in the reasoning slider, the base range keeps the previous level colour on the last (max) mode; the native MaxFill reveal animates the max colour over it.
  var i=codexOrchestratorGet(scopeId),M=CODEX_ORCH_MODES,m=M[i],Slider=window.__codexNativeOrchPowerSlider;
  // The last mode in the picker gets the native Ultra (max) effect, like Ultra in the reasoning slider. The list can change through the Damndots order and toggles.
  var optKey=M.map(function(r){return r[0]}).join(",");
  var options=R.useMemo(function(){var last=M.length-1;return M.map(function(row,k){return {id:row[0],isLocked:false,isMax:k>0&&k===last,label:row[1],requiresExplicitSelection:false}})},[optKey]);
  R.useLayoutEffect(function(){var host=ref.current;if(!host)return;
   for(var n=host.parentElement;n;n=n.parentElement){if(typeof n.className==='string'&&/(^|\s)_?ModelList[-_]/.test(n.className)){host.style.display='none';return}}
  },[]);
  function pick(o){var k=M.findIndex(function(x){return x[0]===o.id});if(k>=0)codexOrchestratorSet(k,scopeId)}
  function keyboard(e){var idx=codexOrchestratorGet(scopeId),to=e.key==="ArrowRight"?idx+1:e.key==="ArrowLeft"?idx-1:e.key==="Home"?0:e.key==="End"?M.length-1:null;if(to===null)return;e.preventDefault();e.stopPropagation();var k=Math.max(0,Math.min(M.length-1,to));if(ref.current){var nativeRoot=ref.current.querySelector('[data-model-picker-power-slider]');if(nativeRoot)nativeRoot.dispatchEvent(new WheelEvent("wheel",{deltaY:k>idx?-120:120,bubbles:true,cancelable:true}));} }
  return h('div',{ref:ref,'data-codex-orchestrator-header':'','data-codex-native-orch-slider':'',style:{'--color-chart-blue':m[3],'--color-chart-purple':m[3],'--color-accent':(i>1&&i===M.length-1?M[i-1][3]:m[3])},onKeyDown:keyboard},
   h('div',{style:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:40,padding:'2px 4px',textAlign:'center'}},
    h('div',{style:{fontSize:14,lineHeight:'20px',fontWeight:500,color:codexOrchLight(m[3])}},m[1]),
    h('div',{style:{fontSize:12,lineHeight:'16px',opacity:.5,whiteSpace:'nowrap'}},m[2])),
   Slider?h('div',{'data-codex-orchestrator-slider':'',tabIndex:0,role:'group','aria-label':codexOrchL('Orkestratör modu'),'aria-valuenow':i,'aria-valuetext':m[1]},h(Slider,{active:true,disabled:!scopeId,fastModeEnabled:false,initialOptionId:m[0],keyboardControlFocused:false,onSelectOption:pick,onCommitOption:pick,onCancelOption:function(){},onConfirmCurrentOption:function(){},onDragToMax:function(){},options:options,selectedOptionId:m[0],shouldReduceMotion:reduced,transitionsReady:transitionsReady})):null,
   h('div',{style:{height:.5,margin:'6px 8px 0',background:'color-mix(in srgb, currentColor 12%, transparent)'}}));
 };

 /* Mode text with the same blur / width animation as the native reasoning-effort label (same DOM structure, classes, timing). */
 window.__codexOrchModeText=function(props){
  var idx=props.index,root=R.useRef(null),layersRef=R.useRef(null),st=R.useRef({key:null,anims:[]});
  function nat(part){var m=window.__codexNativeEffortClasses;if(m&&m[part])return m[part];var e=document.querySelector('[class*="ModelPickerTriggerEffort'+part+'"]');return e&&typeof e.className==='string'?e.className.split(/\s+/).filter(function(c){return c.indexOf('ModelPickerTriggerEffort'+part)===0}).join(' '):''}
  function fin(a){try{a.onfinish=null;var t=a.effect&&a.effect.target;if(a.playState!=='idle'&&t&&t.isConnected&&t.getClientRects().length>0)a.commitStyles();a.cancel()}catch(e){}}
  R.useLayoutEffect(function(){
   var el=root.current,box=layersRef.current;if(!el||!box)return;
   var layers=Array.prototype.slice.call(box.querySelectorAll('[data-orch-layer]')),sel=layers.filter(function(x){return x.getAttribute('data-orch-layer')===String(idx)})[0];if(!sel)return;
   var w=parseFloat(getComputedStyle(sel).width),reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches,key=idx+':'+w;
   if(st.current.key===key)return;
   var animate=st.current.key!=null&&!reduced;st.current.key=key;
   st.current.anims.forEach(fin);
   var blur=getComputedStyle(box).getPropertyValue('--blur-xs')||'4px';
   var targets=[[el,{width:w+'px'}]].concat(layers.map(function(x){return [x,{opacity:x===sel?'1':'0',filter:x===sel?'blur(0px)':'blur('+blur+')'}]}));
   var opts=window.__codexNativeEffortAnim||{duration:300,easing:'ease-out',fill:'both'};
   st.current.anims=targets.map(function(p){var t=p[0],to=p[1];if(!animate){Object.assign(t.style,to);return null}
    var cs=getComputedStyle(t),from={};Object.keys(to).forEach(function(k){from[k]=cs.getPropertyValue(k)});var a=t.animate([from,to],opts);a.onfinish=function(){fin(a)};return a}).filter(Boolean);
  });
  R.useLayoutEffect(function(){return function(){st.current.anims.forEach(fin);st.current.key=null}},[]);
  var M=CODEX_ORCH_MODES,layerEls=M.map(function(row,k){
   var base={opacity:0,width:'max-content',filter:'blur(var(--blur-xs, 4px))',willChange:'opacity, filter',gridArea:'1 / 1',justifySelf:'center'};
   if(k>0)base.color=codexOrchLight(row[3]);
   return h('span',{key:row[0],'data-orch-layer':String(k),'aria-hidden':true,className:(k>0?(window.__codexModelTextClass||''):'')+' '+nat('Text'),style:base},k===0?codexOrchL(codexOrchOffDetails()?'Kapalı':'Orkestratör'):row[1]);
  });
  return h('span',{ref:root,className:nat('Label'),style:{display:'inline-flex',boxSizing:'content-box',whiteSpace:'nowrap',flexShrink:0}},
   h('span',{className:'sr-only'},M[idx][1]),
   h('span',{className:nat('Viewport'),style:{display:'flex',justifyContent:'center'}},h('span',{ref:layersRef,className:nat('Layers'),style:{display:'grid',gridTemplateColumns:'max-content',width:'max-content',flexShrink:0}},layerEls)));
 };
 window.__codexOrchTriggerLabel=function(props){
  var scopeId=codexOrchestratorComposerScope();useOrchTick();
  var i=codexOrchestratorGet(scopeId),m=CODEX_ORCH_MODES[i];
  var ref=R.useRef(null);
  R.useLayoutEffect(function(){
   var el=ref.current,btn=el&&el.closest('button');if(!btn)return;
   btn.removeAttribute('data-composer-navigation-target');btn.setAttribute('data-codex-subagent-trigger','');
  });
  var modeText=h(window.__codexOrchModeText,{index:i});
  if(i===0){if(codexOrchOffDetails()&&props.model!=null)return h('span',{ref:ref,className:'flex min-w-0 items-center gap-1.5','data-codex-orchestrator-label':'off'},modeText,props.model);return h('span',{ref:ref,className:'truncate whitespace-nowrap','data-codex-orchestrator-label':'off'},modeText)}
  if(props.model==null)return h('span',{ref:ref,className:'shrink-0 whitespace-nowrap','data-codex-orchestrator-label':m[0]},modeText);
  return h('span',{ref:ref,className:'flex min-w-0 items-center gap-1.5','data-codex-orchestrator-label':m[0]},modeText,props.model);
 };
}
var CODEX_ORCH_TPS_KEY = "codex-thread-tps-v3";
var codexTpsActive = {};
function codexTpsRead() {
  try { var all=JSON.parse(localStorage.getItem(CODEX_ORCH_TPS_KEY)||"{}"); return all&&typeof all==="object"?all:{}; } catch(e) { return {}; }
}
function codexTpsWrite(all) { try { localStorage.setItem(CODEX_ORCH_TPS_KEY,JSON.stringify(all)); } catch(e) {} try { window.dispatchEvent(new Event("codex-tps-change")); } catch(e) {} }
function codexTpsInt(v) { var n=Number(v); return Number.isFinite(n)&&n>0?n:0; }
function codexTpsTokens(info) {
  if(!info||typeof info!=="object") return 0;
  var last=info.last_token_usage||info.lastTokenUsage||info.last_usage||info.lastUsage||info.last;
  if(last&&typeof last==="object") return codexTpsInt(last.output_tokens??last.outputTokens);
  if(info.usage&&typeof info.usage==="object") return codexTpsInt(info.usage.output_tokens??info.usage.outputTokens);
  return 0;
}
function codexTpsActiveFor(params) {
  if(!params||params.threadId==null) return null;
  var id=String(params.threadId), now=performance.now(), turnId=params.turnId!=null?String(params.turnId):null, a=codexTpsActive[id];
  if(!a||now-a.touched>600000||(turnId&&a.turnId&&turnId!==a.turnId)) a=codexTpsActive[id]={turnId:turnId,touched:now,first:now,tokens:0,tokenCounts:[],model:null,lastUsageTokens:0,lastUsageAt:0,durationMs:0};
  if(turnId&&!a.turnId)a.turnId=turnId;
  a.touched=now;
  return {id:id,a:a};
}
function codexTpsCommit(id,tokens,ms,source) {
  tokens=codexTpsInt(tokens);ms=codexTpsInt(ms);
  if(tokens<=0||ms<16)return;
  var all=codexTpsRead(),list=Array.isArray(all[id])?all[id]:[];
  list.push({tokens:tokens,ms:Math.round(ms),source:source||"native",at:Date.now()});if(list.length>50)list=list.slice(-50);all[id]=list;
  codexTpsWrite(all);
}
function codexTpsOnTurnStarted(params) { var p=params&&Object.assign({},params,{turnId:params.turnId??params.turn?.id}),ref=codexTpsActiveFor(p);if(ref&&(params.model||params.turn&&params.turn.model))ref.a.model=String(params.model||params.turn.model); }
function codexTpsOnDelta(params) { codexTpsActiveFor(params); }
function codexTpsOnItemStart(params) {
  if(!params||!params.item)return;
  var kind=String(params.item.type||params.item.itemType||"").toLowerCase();
  if(kind!=="reasoning"&&kind!=="agentmessage"&&kind!=="plan")return;
  codexTpsActiveFor(params);
}
function codexTpsOnUsage(params) {
  var ref=codexTpsActiveFor(params);if(!ref)return;
  var tokens=codexTpsTokens(params.tokenUsage||params.info||params);if(tokens<=0)return;
  var a=ref.a,now=performance.now();
  if(a.lastUsageTokens===tokens&&now-a.lastUsageAt<250)return;
  a.tokens+=tokens;a.tokenCounts.push(tokens);a.lastUsageTokens=tokens;a.lastUsageAt=now;
}
function codexTpsOnTurnCompleted(params) {
  if(!params||params.threadId==null)return;
  var turn=params.turn||{},
      turnId=turn.id!=null?turn.id:params.turnId,
      ref=codexTpsActiveFor({threadId:params.threadId,turnId:turnId});
  if(!ref)return;
  if(turn.status&&turn.status!=="completed"){delete codexTpsActive[ref.id];return;}
  var ms=codexTpsInt(turn.durationMs??turn.duration_ms);
  if(!ms&&turn.startedAt!=null&&turn.completedAt!=null){var start=typeof turn.startedAt==="number"?turn.startedAt:Date.parse(turn.startedAt),end=typeof turn.completedAt==="number"?turn.completedAt:Date.parse(turn.completedAt);if(Number.isFinite(start)&&Number.isFinite(end))ms=Math.max(0,end-start)*(typeof turn.startedAt==="number"&&Math.abs(start)<1e11?1000:1);}
  if(!ms)ms=Math.round(performance.now()-ref.a.first);
  var finished=ref.a;finished.durationMs=ms;delete codexTpsActive[ref.id];
  if(finished.tokens<=0||ms<16)return;
  var nativeResult=function(){codexTpsCommit(ref.id,finished.tokens,ms,"native")};
  var bridge=window.electronBridge&&window.electronBridge.getOpenCodexTps;
  if(typeof bridge!=="function"){nativeResult();return;}
  var until=Date.now(),since=until-ms-15000;
  Promise.resolve(bridge({sinceMs:since,untilMs:until,model:finished.model,tokenCounts:finished.tokenCounts.slice()})).then(function(result){
    if(result&&result.tokens>0&&result.durationMs>=16&&result.matchedTokenEvents===finished.tokenCounts.length)codexTpsCommit(ref.id,result.tokens,result.durationMs,"opencodex");
    else nativeResult();
  }).catch(nativeResult);
}
function codexTpsMetric(scopeId) {
  var all=codexTpsRead(),list=scopeId&&Array.isArray(all[String(scopeId)])?all[String(scopeId)]:[];
  var tokens=0,ms=0,count=0;
  for(var i=0;i<list.length;i++){var s=list[i],t=codexTpsInt(s&&s.tokens),m=codexTpsInt(s&&s.ms);if(t>0&&m>0){tokens+=t;ms+=m;count++;}}
  if(!count||ms<=0)return {text:"— tok/s",title:codexOrchL("Bu sohbette henüz ölçülmüş model yanıtı yok"),count:0,tps:0};
  var tps=tokens/(ms/1000),text=(tps>=100?Math.round(tps):tps>=10?tps.toFixed(0):tps.toFixed(1))+" tok/s",openCount=0;
  for(var j=0;j<list.length;j++)if(list[j]&&list[j].source==="opencodex")openCount++;
  var tr=(function(){try{return /^tr/i.test(navigator.language)}catch(e){return true}})(),sourceLabel=openCount===count?(tr?"OpenCodex upstream verisinden":"OpenCodex upstream data"):(tr?"model yanıtlarından":"model responses");
  return {text:text,title:tr?"Bu sohbette "+sourceLabel+" ölçülen "+count+" yanıtın ortalaması: "+text+".":"Average of "+count+" responses in this chat, measured from "+sourceLabel+": "+text+".",count:count,tps:tps};
}
try { window.__codexTpsOnTurnStarted=codexTpsOnTurnStarted;window.__codexTpsOnTurnCompleted=codexTpsOnTurnCompleted;window.__codexTpsOnDelta=codexTpsOnDelta;window.__codexTpsOnItemStart=codexTpsOnItemStart;window.__codexTpsOnUsage=codexTpsOnUsage; } catch(e) {}
function codexThreadTpsBadge(scopeId,R) {
  var m=codexTpsMetric(scopeId),s=R.useState(0),bump=s[1],shownState=R.useState(m.tps||0),shown=shownState[0],setShown=shownState[1];
  var badgeRef=R.useRef(null),scopeRef=R.useRef(scopeId);
  var hovState=R.useState(false),hovered=hovState[0],setHovered=hovState[1];
  R.useEffect(function(){function update(){bump(function(x){return x+1})}window.addEventListener("codex-tps-change",update);window.addEventListener("storage",update);return function(){window.removeEventListener("codex-tps-change",update);window.removeEventListener("storage",update)}},[scopeId]);
  R.useEffect(function(){
    if(scopeRef.current!==scopeId){scopeRef.current=scopeId;setShown(m.tps||0);return;}
    if(!m.count){setShown(0);return;}
    var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(reduce){setShown(m.tps);return;}
    var from=codexTpsInt(shown),to=codexTpsInt(m.tps),started=performance.now(),frame=0;
    if(from===to){setShown(to);return;}
    try{if(badgeRef.current&&badgeRef.current.animate)badgeRef.current.animate([{opacity:.55,transform:"translateY(1px)"},{opacity:1,transform:"translateY(0)"}],{duration:420,easing:"cubic-bezier(.22,1,.36,1)"});}catch(e){}
    function step(now){var p=Math.min(1,(now-started)/520),e=1-Math.pow(1-p,3);setShown(from+(to-from)*e);if(p<1)frame=requestAnimationFrame(step);else setShown(to);}
    frame=requestAnimationFrame(step);
    return function(){cancelAnimationFrame(frame)};
  },[m.tps,m.count,scopeId]);
  if(!m.count)return null;
  var visible=shown,number=visible>=100?Math.round(visible):visible>=10?visible.toFixed(0):visible.toFixed(1);
  var tipText=m.title;
  var tipStyle={position:"absolute",bottom:"calc(100% + 8px)",left:"50%",transform:"translateX(-50%)",padding:"var(--tooltip-padding-block,5px) var(--tooltip-padding-inline,12px)",borderRadius:"var(--tooltip-border-radius,20px)",background:"var(--tooltip-background-color,#2d2d2b)",color:"var(--tooltip-text-color,#fbfaf6)",fontSize:"var(--tooltip-font-size,13px)",lineHeight:"var(--tooltip-line-height,18px)",fontWeight:"var(--tooltip-font-weight,430)",letterSpacing:"var(--tooltip-letter-spacing,-0.15px)",textAlign:"center",whiteSpace:"nowrap",boxShadow:"var(--tooltip-box-shadow,0 8px 18px #0f172a33)",border:"1px solid var(--tooltip-border-color,rgba(251,250,246,.05))",pointerEvents:"none",zIndex:60,opacity:hovered?1:0,transition:"opacity 120ms ease",visibility:hovered?"visible":"hidden"};
  return R.createElement("span",{ref:badgeRef,className:"no-drag select-none whitespace-nowrap tabular-nums text-text",style:{position:"relative",display:"inline-flex",alignItems:"center",fontSize:"12px",lineHeight:"18px",marginInlineEnd:"9px",fontWeight:400},onMouseEnter:function(){setHovered(true)},onMouseLeave:function(){setHovered(false)},onFocus:function(){setHovered(true)},onBlur:function(){setHovered(false)},"aria-label":tipText,"data-codex-tps":"","data-codex-tps-scope":scopeId||""},number+" tok/s",R.createElement("div",{role:"tooltip",style:tipStyle,"data-codex-tps-tip":""},tipText));
}

function codexOrchestratorDropdown(R, children) {
  if (!codexOrchestratorTpsComponent) codexOrchestratorTpsComponent=function(){var scopeId=codexOrchestratorComposerScope();return codexThreadTpsBadge(scopeId,R);};
  codexOrchestratorEnsureNative(R);
  if (!codexOrchestratorComponent) {
    codexOrchestratorComponent = function (props) {
      var scopeId = codexOrchestratorComposerScope();
      var codexModelsQuery = eco({ hostId: 'local' });
      var codexModelsData = codexModelsQuery && codexModelsQuery.data && codexModelsQuery.data.models;
      if (Array.isArray(codexModelsData)) codexOrchestratorModels = codexModelsData;
      R.useEffect(function () { var live = codexOrchestratorModelSectionLive; if (live && live.codexRender) live.codexRender(); }, [codexModelsData]);
      var h = R.createElement, ref = R.useRef(null);
      var a = R.useState(function () { return codexOrchestratorGet(scopeId); });
      var i = a[0], setI = a[1], b = R.useState(false), open = b[0], setO = b[1];
      R.useEffect(function () {
        function changed() { setI(codexOrchestratorGet(scopeId)); }
        function closed() { setO(false); }
        changed(); codexOrchestratorClose(); setO(false);
        window.addEventListener('codex-orchestrator-change', changed);
        window.addEventListener('codex-orchestrator-closed', closed);
        window.addEventListener('storage', changed);
        return function () {
          window.removeEventListener('codex-orchestrator-change', changed);
          window.removeEventListener('codex-orchestrator-closed', closed);
          window.removeEventListener('storage', changed);
        };
      }, [scopeId]);
      function click(event) {
        event.preventDefault();
        if (codexOrchestratorPopup) { codexOrchestratorClose(); return; }
        codexOrchestratorOpen(ref.current, scopeId); setO(true);
      }
      // Read the current chat synchronously; no previous chat label during effect handoff.
      i = codexOrchestratorGet(scopeId);
      var m = CODEX_ORCH_MODES[i];
      var Picker = window.__codexComposerModelPicker, native = props && props.nativePicker;
      var np = native && native.type === Picker && native.props ? native.props : {};
      if (typeof Picker === 'function') return h('span', { className: 'flex min-w-0 items-center', 'data-codex-orchestrator-trigger': m[0], 'data-codex-orchestrator-scope': scopeId || '', 'data-codex-subagent-picker': '', title: codexOrchL('Orkestratör ve alt ajan modeli') },
        h(Picker, { codexSubagent: true, codexConversationId: np.conversationId, hideLabel: np.hideLabel, serviceTierDefaults: np.serviceTierDefaults, permissionsCwdOverride: np.permissionsCwdOverride, permissionsHostId: np.permissionsHostId }));
      return h(R.Fragment, null, h('button', { key: 'codex-orchestrator-button', ref: ref, type: 'button', disabled: !scopeId, className: CODEX_ORCH_BTN,
        title: codexOrchL('Orkestratör') + ': ' + m[1], 'aria-label': codexOrchL('Orkestratör') + ': ' + m[1], 'aria-haspopup': 'dialog',
        'aria-expanded': open, 'data-state': open ? 'open' : 'closed', 'data-codex-orchestrator-trigger': m[0],
        'data-codex-orchestrator-scope': scopeId || '', onClick: click },
        h('span', { className: 'truncate whitespace-nowrap', style: i > 0 ? { color: codexOrchLight(m[3]), fontWeight: 500 } : undefined }, i > 0 ? m[1] : codexOrchL('Orkestratör')),
        h('svg', { width: 12, height: 12, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true', style: { flexShrink: 0, opacity: 0.7 } },
          h('path', { d: 'M5.5 7.5 10 12l4.5-4.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))));
    };
  }
  return R.createElement(R.Fragment, null, R.createElement(codexOrchestratorTpsComponent), children, R.createElement(codexOrchestratorComponent, { nativePicker: children }));
}



function codexOrchLight(c){return 'color-mix(in srgb, '+c+' 55%, white)'}

/* damndots wheel control: scrolling over a picker changes thinking level, model, orchestrator mode or Fast. Each action has its own modifier key and the part of the picker (model name, thinking level, mode) it reacts to; see scripts/scroll-controls-settings.cjs */
(function(){
 if(window.__codexWheelInstalled)return;window.__codexWheelInstalled=1;
 window.__codexScrollControls={enabled:true,thinking:{on:true,key:'none',zone:'any'},model:{on:true,key:'shift',zone:'any'},mode:{on:true,key:'ctrl',zone:'any'},fast:{on:true,key:'alt',zone:'any'}};
 function loadControls(){try{var b=window.electronBridge&&window.electronBridge.getScrollControls;if(typeof b!=='function')return;Promise.resolve(b()).then(function(v){if(v&&typeof v==='object'){window.__codexScrollControls=v;window.dispatchEvent(new Event('codex-orchestrator-change'))}}).catch(function(){})}catch(e){}}
 loadControls();setInterval(function(){if(document.visibilityState!=='hidden')loadControls()},3000);
 function pickInst(btn,which){
  if(btn&&btn.__codexInst)return btn.__codexInst;
  try{var set=window.__codexInstList;if(set){var found=null;set.forEach(function(it){if(it&&it.tk&&it.tk.current===btn)found=it});if(found){btn.__codexInst=found;return found}}}catch(e){}
  return {sel:window.__codexPickerSel&&window.__codexPickerSel[which],models:window.__codexPickerModels&&window.__codexPickerModels[which],handlers:window.__codexPickerHandlers&&window.__codexPickerHandlers[which]};
 }
 function cycleModel(which,dir,btn){
  var inst=pickInst(btn,which),S=inst&&inst.sel||(window.__codexPickerSel&&window.__codexPickerSel[which]),M=inst&&inst.models||(window.__codexPickerModels&&window.__codexPickerModels[which]);
  if(!S||!M||!Array.isArray(M.models)||!S.selectComposerModelAndReasoningEffort)return false;
  var list=M.models.filter(function(m){return m&&m.model&&!m.hidden});if(!list.length)return false;
  var cur=(S.modelSettings&&S.modelSettings.model)||M.modelId,i=list.findIndex(function(m){return m.model===cur});
  var j=Math.max(0,Math.min(list.length-1,(i<0?(dir>0?-1:list.length):i)+dir));if(j===i)return true;
  var nm=list[j],eff=S.modelSettings&&S.modelSettings.reasoningEffort,sup=(nm.supportedReasoningEfforts||[]).map(function(x){return x&&x.reasoningEffort||x});
  if(sup.length&&sup.indexOf(eff)<0)eff=nm.defaultReasoningEffort||sup[0]||eff;
  try{Promise.resolve(S.selectComposerModelAndReasoningEffort(nm.model,eff,function(){})).catch(function(){})}catch(e){return false}return true;
 }
 function stepEffort(which,dir,btn){
  var inst=pickInst(btn,which),S=inst&&inst.sel||(window.__codexPickerSel&&window.__codexPickerSel[which]),M=inst&&inst.models||(window.__codexPickerModels&&window.__codexPickerModels[which]);
  if(!S||!S.modelSettings||!M||!Array.isArray(M.models))return false;
  var cur=S.modelSettings.model||M.modelId,m=M.models.filter(function(x){return x&&x.model===cur})[0];if(!m)return false;
  var list=(m.supportedReasoningEfforts||[]).map(function(x){return x&&x.reasoningEffort||x}).filter(function(x){return x&&x!=='persistent'});if(list.length<2)return false;
  var i=list.indexOf(S.modelSettings.reasoningEffort),j=Math.max(0,Math.min(list.length-1,(i<0?list.indexOf(m.defaultReasoningEffort):i)+dir));if(j===i)return true;
  try{Promise.resolve(S.setModelAndReasoningEffort(cur,list[j])).catch(function(){})}catch(x){return false}return true;
 }
 function triggerAt(e){
  var t=e.target&&e.target.closest?e.target.closest('button'):null;
  if(t&&(t.hasAttribute('data-codex-subagent-trigger')||t.getAttribute('data-composer-navigation-target')==='reasoning'))return t;
  var bs=document.querySelectorAll('button[data-codex-subagent-trigger],button[data-composer-navigation-target="reasoning"]');
  for(var q=0;q<bs.length;q++){if(bs[q].checkVisibility&&!bs[q].checkVisibility())continue;var rc=bs[q].getBoundingClientRect();if(rc.width&&e.clientX>=rc.left&&e.clientX<=rc.right&&e.clientY>=rc.top&&e.clientY<=rc.bottom)return bs[q]}
  return null;
 }
 var KEYS=['none','shift','ctrl','alt','ctrl+shift'],ZONES=['any','model','thinking','mode','fast'],ACTIONS=['thinking','model','mode','fast'];
 var DEFAULT_BINDINGS={thinking:{on:true,key:'none',zone:'any'},model:{on:true,key:'shift',zone:'any'},mode:{on:true,key:'ctrl',zone:'any'},fast:{on:true,key:'alt',zone:'any'}};
 // Older settings stored a boolean per action; a missing action keeps its default key and zone.
 function bindingOf(c,name){var v=c&&c[name],d=DEFAULT_BINDINGS[name];if(typeof v==='boolean')return {on:v,key:d.key,zone:d.zone};if(v&&typeof v==='object'&&typeof v.on==='boolean'&&KEYS.indexOf(v.key)>=0&&ZONES.indexOf(v.zone)>=0)return v;return d}
 function keyOf(e){var ctrl=e.ctrlKey||e.metaKey,sh=e.shiftKey,al=e.altKey;if(al&&(ctrl||sh))return 'other';if(al)return 'alt';if(ctrl&&sh)return 'ctrl+shift';if(ctrl)return 'ctrl';if(sh)return 'shift';return 'none'}
 // The picker button shows the orchestrator mode, the model name and the thinking level as separate labels; the pointer belongs to the nearest one.
 function zoneOf(t,x){
  var regs=[],mode=t.querySelector('[data-codex-orchestrator-label] > [class*="ModelPickerTriggerEffortLabel"]'),model=t.querySelector('[data-codex-model-blur-label]');
  if(mode)regs.push(['mode',mode]);if(model)regs.push(['model',model]);
  var labels=t.querySelectorAll('[class*="ModelPickerTriggerEffortLabel"]');
  for(var i=0;i<labels.length;i++){var l=labels[i];if(l.hasAttribute('data-codex-model-blur-label')||l.parentElement&&l.parentElement.hasAttribute('data-codex-orchestrator-label'))continue;regs.push(['thinking',l]);break}
  // The Fast icon sits left of the model name and is only drawn while Fast is on; the strip at the left edge of the model name counts as Fast either way. On the orchestrator picker the icon sits between the mode label and the model name (moved there with CSS), so only the strip around it counts.
  if(model){var mb=model.getBoundingClientRect(),ic=t.querySelector('[class*="ModelPickerTriggerInlineModeIcon"]'),ib=ic&&ic.getBoundingClientRect();var hasIcon=!!(ib&&ib.width),lo=mode?(hasIcon?ib.left-3:mb.left-3):-1e9,hi=hasIcon?ib.right+3:mb.left+6;if(mb.width&&x>=lo&&x<=hi)return 'fast'}
  var best=null,bd=1e9;
  regs.forEach(function(r){var b=r[1].getBoundingClientRect();if(!b.width)return;var d=x<b.left?b.left-x:x>b.right?x-b.right:0;if(d<bd){bd=d;best=r[0]}});
  return best;
 }
 function pickAction(c,key,zone,sub){
  var best=null,score=-1;
  ACTIONS.forEach(function(n){var b=bindingOf(c,n);if(!b.on||b.key!==key)return;if(n==='mode'&&!sub)return;if(b.zone!=='any'&&b.zone!==zone)return;var s=b.zone==='any'?0:1;if(s>score){best=n;score=s}});
  return best;
 }
 // Fast (and any further service tier the model offers) steps through the picker's own service tier options.
 function cycleFast(which,dir,btn){
  var inst=pickInst(btn,which),T=inst&&inst.tier,st=T&&T.serviceTierSettings;
  if(!st||!Array.isArray(st.availableOptions)||typeof T.setServiceTier!=='function')return false;
  var opts=st.availableOptions;if(opts.length<2)return false;
  var cur=st.selectedServiceTier==null?null:st.selectedServiceTier,i=opts.findIndex(function(o){return (o.value==null?null:o.value)===cur});if(i<0)i=0;
  var j=Math.max(0,Math.min(opts.length-1,i+dir));if(j===i)return true;
  try{Promise.resolve(T.setServiceTier(opts[j].value==null?null:opts[j].value)).catch(function(){})}catch(x){return false}return true;
 }
 var last=0;
 window.addEventListener('wheel',function(e){
  var c=window.__codexScrollControls;if(!c||c.enabled===false)return;
  var t=triggerAt(e);if(!t)return;
  var sub=t.hasAttribute('data-codex-subagent-trigger'),main=!sub&&t.getAttribute('data-composer-navigation-target')==='reasoning';
  if(!sub&&!main)return;
  if(t.getAttribute('aria-expanded')==='true')return;
  var d=e.deltaY||e.deltaX,dir=d<0?1:d>0?-1:0;if(!dir)return;
  var which=sub?'sub':'main',action=pickAction(c,keyOf(e),zoneOf(t,e.clientX),sub);
  if(!action)return;
  var inst=pickInst(t,which),H=inst&&inst.handlers||(window.__codexPickerHandlers&&window.__codexPickerHandlers[which]),fn=H&&H[dir>0?'composer.increaseReasoningEffort':'composer.decreaseReasoningEffort'];
  if(action==='thinking'&&typeof fn!=='function'&&!(inst&&inst.sel)&&!(window.__codexPickerSel&&window.__codexPickerSel[which]))return;
  e.preventDefault();e.stopPropagation();
  var now=Date.now();if(now-last<45)return;last=now;
  if(action==='mode'){var scope=codexOrchestratorComposerScope(),idx=codexOrchestratorGet(scope),to=Math.max(0,Math.min(CODEX_ORCH_MODES.length-1,idx+dir));if(to!==idx)codexOrchestratorSet(to,scope);return}
  if(action==='model'){var okc=false;try{okc=cycleModel(which,-dir,t)}catch(x){window.__codexWheelErr=String(x&&x.message||x)}window.__codexWheelDbg={which:which,dir:dir,ok:okc};return}
  if(action==='fast'){try{cycleFast(which,dir,t)}catch(x){window.__codexWheelErr=String(x&&x.message||x)}return}
  var done=false;try{done=stepEffort(which,dir,t)}catch(x){}
  if(!done&&typeof fn==='function')try{fn()}catch(x){}
 },{capture:true,passive:false});
})();

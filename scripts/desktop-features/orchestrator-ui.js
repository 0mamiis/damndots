// Subagent model/effort selection for the composer orchestrator popup.
var CODEX_ORCH_SUBMODEL_KEY = "codex-orchestrator-subagent-model-v1";
var codexOrchestratorModels = null, codexOrchestratorModelSectionLive = null;
var CODEX_ORCH_EFFORT_LABELS = { none: "Yok", minimal: "Minimal", low: "Düşük", medium: "Orta", high: "Yüksek", xhigh: "Çok yüksek", max: "Max", ultra: "Ultra" };
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
function codexOrchestratorModelNote() {
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
    list.appendChild(row("Varsayılan (ayar dosyası)", null, !sel, "config.toml [agents] varsayılanı"));
    if (!models.length) { var w = mk("div", C("sectionLabel")); w.textContent = "Modeller yükleniyor\u2026"; list.appendChild(w); }
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
    tog.setAttribute("role", "menuitem"); tog.setAttribute("aria-label", "Alt ajan modeli seç"); tog.setAttribute("data-interactive", "true"); tog.tabIndex = 0;
    tog.setAttribute("data-codex-subagent-toggle", "");
    var rc = mk("div", "flex w-full min-w-0 items-center gap-[var(--spacing-menu-item-content,calc(var(--spacing)*1.5))]"); rc.setAttribute("data-menu-row-content", "true");
    var o = mk("span", "flex-1 min-w-0 truncate"), content = mk("span", C("ViewToggleContent"));
    var ml = mk("span", C("ViewToggleModelLabel")), mi = mk("span", "flex min-w-0 items-center gap-1 tabular-nums"), mt = mk("span", "truncate whitespace-nowrap");
    mt.textContent = "Alt ajan \u00b7 " + (sel ? (cur ? codexOrchestratorPrettyLabel(cur) : sel.model) : "Varsayılan");
    mi.appendChild(mt); ml.appendChild(mi); content.appendChild(ml);
    var ef = mk("span", C("ViewToggleEffortLabel"));
    ef.setAttribute("data-accent", idx >= 0 ? "true" : "false");
    ef.setAttribute("data-effort-only", idx >= 0 ? "false" : "true");
    ef.setAttribute("data-maximum", idx >= 0 && idx === effs.length - 1 ? "true" : "false");
    ef.textContent = idx >= 0 ? (CODEX_ORCH_EFFORT_LABELS[effs[idx]] || effs[idx]) : (sel ? "Model varsayılanı" : "Ayar dosyası");
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
      root.setAttribute("aria-label", "Alt ajan düşünme seviyesi"); root.setAttribute("aria-valuemin", "0"); root.setAttribute("aria-valuemax", String(n - 1)); root.setAttribute("aria-valuenow", String(pos));
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
var CODEX_ORCH_MODES=[["off","Kapalı","Mesajlar normal gider","rgb(120, 120, 116)"],["fix","Fix","Hatayı worker ile düzeltip denetler","rgb(225, 70, 90)"],["verify","Verify","Sonucu bağımsız ajanla doğrular","rgb(22, 163, 74)"],["explore","Explore","Fikri ve kodu araştırır, uygulamaz","rgb(8, 145, 178)"],["plan","Plan","İnceleyip uygulanabilir plan hazırlar","rgb(139, 92, 246)"],["subagents","Alt Ajanlar","Ana ajan çalışır, alt ajanlarla paylaşır","rgb(14, 139, 154)"],["lead","Lead","Yerleşik ajanlarla uygular ve denetler","rgb(76, 126, 240)"]];
var CODEX_ORCH_ACCENT="rgb(76, 126, 240)";
var CODEX_ORCH_BTN="no-drag cursor-interaction items-center select-none disabled:cursor-default aria-disabled:cursor-default focus:outline-hidden disabled:opacity-40 aria-disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 whitespace-nowrap flex border gap-1 rounded-full text-tertiary not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover border-transparent h-token-button-composer px-2 py-0 text-sm leading-[18px] min-w-0";
var CODEX_ORCH_POP="no-drag m-px flex select-none flex-col overflow-hidden bg-surface-elevated-secondary/90 text-default ring-(--color-border-overlay) ring-(length:--dropdown-overlay-ring-width) shadow-(--shadow-dropdown-overlay) backdrop-blur-sm rounded-2xl p-[var(--app-menu-gutter,var(--spacing))]";
var codexOrchestratorPopup=null,codexOrchestratorComponent,codexOrchestratorTpsComponent;
var CODEX_ORCH_THREAD_MODES = 'codex-orchestrator-thread-modes-v2';
var codexOrchestratorScopeAtom;
function codexOrchestratorReadModes() {
  try {
    var data = JSON.parse(localStorage.getItem(CODEX_ORCH_THREAD_MODES) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) { return {}; }
}
function codexOrchestratorMode(scopeId) {
  if (!scopeId) return null;
  var modes = codexOrchestratorReadModes();
  var mode = Object.prototype.hasOwnProperty.call(modes, String(scopeId)) ? modes[String(scopeId)] : null;
  return mode && Object.prototype.hasOwnProperty.call(CODEX_ORCH_TEXT, mode) ? mode : null;
}
function codexOrchestratorGet(scopeId) {
  var mode = codexOrchestratorMode(scopeId);
  var index = CODEX_ORCH_MODES.findIndex(function (row) { return row[0] === mode; });
  return index < 0 ? 0 : index;
}
function codexOrchestratorSet(index, scopeId) {
  if (!scopeId) return;
  index = Math.max(0, Math.min(CODEX_ORCH_MODES.length - 1, index));
  var modes = codexOrchestratorReadModes();
  modes[String(scopeId)] = CODEX_ORCH_MODES[index][0];
  localStorage.setItem(CODEX_ORCH_THREAD_MODES, JSON.stringify(modes));
  window.dispatchEvent(new Event('codex-orchestrator-change'));
}
function codexOrchestratorBind(clientThreadId, threadId) {
  try {
  if (!clientThreadId || !threadId) return;
  var modes = codexOrchestratorReadModes();
  var draftKey = 'draft:' + String(clientThreadId);
  var threadKey = String(threadId);
  if (!Object.prototype.hasOwnProperty.call(modes, draftKey)) return;
  if (!Object.prototype.hasOwnProperty.call(modes, threadKey)) modes[threadKey] = modes[draftKey];
  delete modes[draftKey];
  localStorage.setItem(CODEX_ORCH_THREAD_MODES, JSON.stringify(modes));
  window.dispatchEvent(new Event('codex-orchestrator-change'));
  } catch (error) {
    // Preference persistence must never block Codex's own thread creation.
    return;
  }
}
function codexOrchestratorComposerScope(){var source=bs(pS),id=DGt(source);return id!=null?String(id):source.value.clientThreadId!=null?"draft:"+String(source.value.clientThreadId):null;}

var CODEX_ORCH_TEXT={"subagents":"[ORKESTRATÖR MODU: ALT AJANLAR — NATIVE CODEX]\nThe user selected Alt Ajanlar and requests useful native subagent assistance for this task. The parent remains an active contributor. For substantive work with a meaningful independent split, delegate at least one bounded part early and continue your own independent part. Run independent investigations or disjoint edits concurrently when that saves time or improves coverage; keep tightly dependent work together. No fixed planning, implementation or review pipeline is required. Integrate results and verify at a level proportionate to the actual task. For a trivial task with no useful split, work directly and do not invent a second task.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","lead":"[ORKESTRATÖR MODU: LEAD — NATIVE CODEX]\nThe user selected Lead and requests native delegation and coordination. Establish the target and acceptance criteria, inspect enough context, then make a short dependency-aware work plan. Choose the number and roles of agents from the actual work and available concurrency; there is no fixed team size. For substantive implementation delegate a meaningful implementation unit to worker agents. Do not funnel every project into one worker or wait for one worker before assigning unrelated work. Parallelize independent, disjoint modules or investigations; serialize dependent tasks and shared mutable resources. A single-file task may correctly use one writer and a later reviewer; do not add agents merely to fill slots. The parent owns task boundaries, interfaces, coordination, integration and final evidence and may do bounded integration work while workers run. Review the stable integrated result with an independent default agent; larger changes may justify distinct scoped reviews, not duplicate seats reviewing the same thing. Address substantive findings through the owning worker when useful. If a worker is blocked or unsuitable, use the common takeover protocol and transparently explain the fallback instead of silently discarding its work. Completion requires the requested result, reconciled child results and adequate verification, not just a completed task list.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","plan":"[ORKESTRATÖR MODU: PLAN — NATIVE CODEX]\nThe user selected Plan and requests planning, not application implementation. For a substantive repository task, delegate bounded discovery to explorer agents; use parallel explorers only for independent questions. Inspect repository facts before asking the user to supply facts available in the workspace. Ask only for material preferences, constraints or tradeoffs that evidence cannot resolve. Produce a right-sized plan mapping each requirement to the affected files/resources, concrete tasks, dependencies/interfaces and observable acceptance checks. Include relevant risks, verification commands or runtime checks, unresolved assumptions and completion/stop criteria. Explain what can run concurrently and what must be sequential. Check that referenced files and interfaces exist and that no requirement is silently dropped. For complex or high-impact plans, delegate a separate plan critique to a default agent and reconcile blockers; a small plan needs only proportionate self-review. Do not write application code, install dependencies, run mutating application experiments or publish. Save a plan artifact only when requested or already authorized by the task; otherwise return the plan in chat. Do not impose a new roadmap, commit policy or document hierarchy. Stop at the completed plan; implementation needs the user's subsequent direction.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","explore":"[ORKESTRATÖR MODU: EXPLORE — NATIVE CODEX]\nThe user selected Explore and requests native delegated investigation without implementation. Identify the actual questions and use explorer agents for specific repository-local questions, in parallel when independent. Keep external documentation research distinct from repository facts and use appropriate read-only tools. Start with targeted file/text/symbol searches; inspect relevant relationships and data/control flow rather than dumping whole files. Reuse prior explorer findings and existing children for related follow-up instead of independently repeating the same investigation. Return the direct answer, relevant absolute paths/symbols, how components connect, evidence for findings, feasible alternatives where requested and material unknowns. Separate observed facts from inferences. Do not modify application files, install dependencies or publish. Stop when the requested question is answered with actionable evidence or identify the precise evidence that is unavailable; do not drift into implementation or unrequested architecture decisions.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","verify":"[ORKESTRATÖR MODU: VERIFY — NATIVE CODEX]\nThe user selected Verify and requests independent native verification. Resolve the actual target, revision/environment and acceptance criteria from the request, not only from an implementer's summary. Delegate a bounded independent verification to a default agent for a substantive review, with explicit inspect-and-report instructions and no application edits. Split independent verification surfaces only when useful; avoid duplicate reviews of the same evidence. Map every material claim to source/diff, test, artifact or runtime evidence that actually proves it. Check existence, substance and wiring: a file or stub existing does not prove behavior. Use fresh targeted checks where needed and preserve valid existing evidence when unchanged; do not rerun expensive suites without reason. Distinguish code correctness, rendered behavior, installed version and deployment. Do not hide an observable failure as uncertainty; mark unavailable proof as inconclusive or not run. Reconcile discrepancies and issue PASS only when material acceptance criteria are proven, otherwise FAIL or PARTIAL with concrete findings, evidence gaps and next checks. Do not repair application code, install dependencies or publish. Verification tools must stay within the user's authorized environment and avoid unrelated state changes.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly.","fix":"[ORKESTRATÖR MODU: FIX — NATIVE CODEX]\nThe user selected Fix and requests native delegated repair within the authorized scope. Establish the observed failure, expected behavior and reproduction conditions. Reproduce it or collect the missing logs/state before guessing at a fix. Read complete errors, inspect recent changes and trace the failing data/configuration across component boundaries. Use explorers for independent diagnosis questions and a worker with explicit ownership for a substantive repair. State a testable root-cause hypothesis, test it with a minimal change and keep unrelated fixes/refactors out. Capture a failing reproduction or another concrete before/after observation; add a regression test when meaningful and appropriate. Re-run the original failure and nearby affected checks after the fix. Several independent failures may be split across agents; do not split manifestations of the same shared cause blindly. After three unsuccessful hypotheses or repeated new symptoms, reopen the diagnosis and examine design/assumption errors instead of stacking another speculative patch; continue useful investigation within scope and surface a genuine blocker when one remains. Reuse the responsible worker for corrections and independently review substantive fixes with a default agent. Apply the common takeover rules if delegation fails. Report the cause, exact repair, validation and remaining limits; do not claim fixed because code changed or tests unrelated to the original symptom pass.\n\n[NATIVE WORKFLOW CONTRACT v2]\nThe current turn's selected mode defines delegation and work boundaries. Preserve the user's task, existing work, repository rules, authorization and explicit model/effort/Fast choices. A mode does not grant publication, destructive operations, external messaging or new user-owned chats. Use the actual native collaboration schema; never emulate missing tools with external agent processes. Greetings, status and stop requests need no new agents. Do not create busywork or aim for a fixed agent count.\n\nDispatch: give each child a bounded objective, necessary context, dependencies, file/module or investigation ownership, acceptance checks and an expected deliverable. Tell writers they share the codebase: preserve others' edits. Never assign overlapping writers to the same resource, including a shared browser/editor session. Give isolated children the decisions and constraints they need; do not assume they see the chat history. Unless assigned a coordination role, children should complete their own task and return evidence instead of spawning another team.\n\nTrack and collect: keep a lightweight task list with child identity, ownership, dependencies, last concrete progress and result. Use durable notes only when useful for long work; do not force new project files for small tasks. Require a final deliverable, not a promise to report later. A useful result states DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED, changed files or findings, checks and remaining gaps. Resolve conflicting reports against actual files and outputs.\n\nWhile children work, continue independent work allowed by this mode. Use native notifications and bounded waits; avoid repeated status polling and silent waits longer than 60 seconds. A running status or slow model response alone is not proof of a stall. If repeated checks show no concrete progress, ask the child for the latest artifact or blocker and adjust the task, context or division of work. Do not restart unchanged attempts repeatedly or silently change the user's chosen model.\n\nBefore takeover or reassignment: inspect the child's latest messages, current files/diff and running tools. Stop the prior writer and confirm it cannot continue writing before transferring ownership. Preserve and reuse useful partial work. Never claim that no file was written without checking again immediately before that claim. Use followup_task to resume an idle child; send_message alone does not restart it. Explicitly cancel obsolete children; collect every child still in scope before completion.\n\nVerification and reporting: assess each child's claims against the relevant artifact and task-proportionate evidence. Distinguish source inspection, tests, rendered/runtime behavior and installed/deployed behavior. Report passed, failed, inconclusive and not-run checks accurately. Do not claim success from an exit code, a running process or an agent summary alone. Stop repeating checks once adequate evidence exists unless changes, failures or unresolved risks justify another pass. State missing evidence plainly."};
var CODEX_ORCH_SENT="codex-orchestrator-sent",CODEX_ORCH_OFF="[ORCHESTRATOR OFF — THIS CHAT, CURRENT TURN]\nThe user selected Off. All previous Alt Ajanlar, Lead, Plan, Explore, Verify and Fix role instructions and their delegation workflow are inactive for this turn. Handle the current request yourself in the primary agent. Do not start subagents or assign new work to existing subagents unless the user explicitly asks for delegation in the current request. Do not infer permission from earlier turns, project/skill suggestions, task complexity or proactive/Ultra preferences. Do not use another chat, external agent process or background job to bypass this setting. This is normal working mode: implementation is permitted when the user's actual request authorizes it; previous Plan or Verify limitations do not remain active. Preserve ordinary scope, permissions and project instructions. Already running children are not automatically cancelled by changing the selector; if relevant, report their actual status without giving them new work. A later active composer mode can enable its own workflow again. An explicit delegation request authorizes only that request and does not change the saved Off selection.",codexOrchestratorFirst=null;
function codexOrchestratorSent(){try{return JSON.parse(localStorage.getItem(CODEX_ORCH_SENT)||"{}")}catch(e){return{}}}
function codexOrchestratorSave(o){try{var k=Object.keys(o);for(var i=0;i<k.length-200;i++)delete o[k[i]];localStorage.setItem(CODEX_ORCH_SENT,JSON.stringify(o))}catch(e){}}
// Native per-turn application context. This is evaluated in the composer's scope.
function codexOrchestratorCollab(cm, options) { return cm; }
var CODEX_ORCH_OFF_ULTRA="[ORCHESTRATOR OFF + ULTRA — THIS CHAT, CURRENT TURN]\nThe user selected Off in the orchestrator menu and Ultra reasoning for this turn. No orchestrator role workflow (Alt Ajanlar, Lead, Plan, Explore, Verify, Fix) is active and none of their phase or review requirements apply. Original Codex Ultra behaviour applies: you may proactively delegate bounded, independent subtasks to native subagents when that materially improves speed or quality of the current task; the Ultra selection is the user's authorization for this. Delegation is optional: handle greetings, status questions, small edits and tightly coupled work yourself, and do not invent busywork. Use only the native collaboration tools; do not create user-owned chats, external agent processes or background jobs. Keep the user's scope, permissions, project instructions and model choices.";
function codexOrchestratorTurn(p, aeon, fallbackEffort) {
  if (!p || aeon != null || !p.threadId || p.toolOutput != null || !p.input || !p.input.length) return p;
  if (p.turnTrigger != null && p.turnTrigger !== 'composer') return p;
  var mode = codexOrchestratorMode(p.threadId);
  var sent = codexOrchestratorSent();
  var context = Object.assign({}, p.additionalContext);
  var cmEffort = p.collaborationMode && p.collaborationMode.settings ? p.collaborationMode.settings.reasoning_effort : null;
  var effort = cmEffort != null ? cmEffort : p.effort != null ? p.effort : fallbackEffort;
  context.codex_orchestrator = { kind: 'application', value: mode ? CODEX_ORCH_TEXT[mode] + codexOrchestratorModelNote() : effort === 'ultra' ? CODEX_ORCH_OFF_ULTRA + codexOrchestratorModelNote() : CODEX_ORCH_OFF };
  sent[p.threadId] = mode || 'off';
  var result = Object.assign({}, p, { additionalContext: context });
  var cm = p.collaborationMode;
  if (cm && cm.settings && /^\[ORKESTRATÖR MODU:/.test(cm.settings.developer_instructions || '')) {
    result.collaborationMode = Object.assign({}, cm, { settings: Object.assign({}, cm.settings, { developer_instructions: null }) });
  }
  codexOrchestratorSave(sent);
  return result;
}

function codexOrchestratorClose(){codexOrchestratorModelSectionLive=null;var p=codexOrchestratorPopup;if(!p)return;codexOrchestratorPopup=null;try{p.cleanup()}catch(e){}try{window.dispatchEvent(new Event("codex-orchestrator-closed"))}catch(e){}}
function codexOrchestratorOpen(anchor,scopeId){
 codexOrchestratorClose();
 var M=CODEX_ORCH_MODES,LAST=M.length-1,d=document;
 function el(tag,css,cls){var e=d.createElement(tag);if(css)e.style.cssText=css;if(cls)e.className=cls;return e}
 var pop=el("div","position:fixed;z-index:60;width:254px;box-sizing:border-box;opacity:0;transform:translateY(4px) scale(0.98);transform-origin:bottom right;transition:opacity 0.12s ease,transform 0.12s ease;",CODEX_ORCH_POP);
 pop.setAttribute("data-codex-orchestrator-popup","");pop.setAttribute("role","dialog");pop.setAttribute("aria-label","Orkestratör");
 var head=el("div","display:flex;flex-direction:column;align-items:center;justify-content:center;height:48px;padding:4px;box-sizing:border-box;text-align:center");
 var title=el("div","font-size:14px;line-height:20px;font-weight:500"),sub=el("div","font-size:12px;line-height:16px;opacity:0.5;white-space:nowrap");
 head.appendChild(title);head.appendChild(sub);
 var pad=el("div","margin:0 2px 6px;padding:2px 6px;height:32px;box-sizing:border-box");
 var root=el("div","position:relative;height:28px;width:100%;cursor:var(--cursor-interaction, pointer);touch-action:none;outline:none");
 root.setAttribute("role","slider");root.tabIndex=0;root.setAttribute("aria-label","Orkestratör modu");root.setAttribute("aria-valuemin","0");root.setAttribute("aria-valuemax",String(LAST));
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
 root.setAttribute("role","slider");root.tabIndex=0;root.setAttribute("aria-label","Orkestratör modu");root.setAttribute("aria-valuemin","0");root.setAttribute("aria-valuemax",String(LAST));root.setAttribute("data-codex-orchestrator-slider","");
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
  var rm=R.useState(function(){return window.matchMedia("(prefers-reduced-motion: reduce)").matches}),reduced=rm[0],setReduced=rm[1];
  R.useEffect(function(){var q=window.matchMedia("(prefers-reduced-motion: reduce)");function sync(){setReduced(q.matches)}q.addEventListener("change",sync);sync();return function(){q.removeEventListener("change",sync)}},[]);
  var i=codexOrchestratorGet(scopeId),M=CODEX_ORCH_MODES,m=M[i],Slider=window.__codexNativeOrchPowerSlider;
  var options=R.useMemo(function(){return M.map(function(row){return {id:row[0],isLocked:false,isMax:row[0]==="lead",label:row[1],requiresExplicitSelection:false}})},[]);
  R.useLayoutEffect(function(){var host=ref.current;if(!host)return;
   for(var n=host.parentElement;n;n=n.parentElement){if(typeof n.className==='string'&&/(^|\s)_ModelList_/.test(n.className)){host.style.display='none';return}}
  },[]);
  function pick(o){var k=M.findIndex(function(x){return x[0]===o.id});if(k>=0)codexOrchestratorSet(k,scopeId)}
  function keyboard(e){var idx=codexOrchestratorGet(scopeId),to=e.key==="ArrowRight"?idx+1:e.key==="ArrowLeft"?idx-1:e.key==="Home"?0:e.key==="End"?M.length-1:null;if(to===null)return;e.preventDefault();e.stopPropagation();var k=Math.max(0,Math.min(M.length-1,to));if(ref.current){var nativeRoot=ref.current.querySelector('[data-model-picker-power-slider]');if(nativeRoot)nativeRoot.dispatchEvent(new WheelEvent("wheel",{deltaY:k>idx?-120:120,bubbles:true,cancelable:true}));} }
  return h('div',{ref:ref,'data-codex-orchestrator-header':'','data-codex-native-orch-slider':'',style:{'--color-chart-blue':m[3],'--color-chart-purple':m[3]},onKeyDown:keyboard},
   h('div',{style:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:40,padding:'2px 4px',textAlign:'center'}},
    h('div',{style:{fontSize:14,lineHeight:'20px',fontWeight:500,color:m[3]}},m[1]),
    h('div',{style:{fontSize:12,lineHeight:'16px',opacity:.5,whiteSpace:'nowrap'}},m[2])),
   Slider?h('div',{'data-codex-orchestrator-slider':'',tabIndex:0,role:'group','aria-label':'Orkestratör modu','aria-valuenow':i,'aria-valuetext':m[1]},h(Slider,{active:true,disabled:!scopeId,fastModeEnabled:false,initialOptionId:m[0],keyboardControlFocused:false,onSelectOption:pick,onCommitOption:pick,onCancelOption:function(){},onConfirmCurrentOption:function(){},onDragToMax:function(){},options:options,selectedOptionId:m[0],shouldReduceMotion:reduced,transitionsReady:true})):null,
   h('div',{style:{height:.5,margin:'6px 8px 0',background:'color-mix(in srgb, currentColor 12%, transparent)'}}));
 };
 window.__codexOrchTriggerLabel=function(props){
  var scopeId=codexOrchestratorComposerScope();useOrchTick();
  var i=codexOrchestratorGet(scopeId),m=CODEX_ORCH_MODES[i];
  var ref=R.useRef(null);
  R.useLayoutEffect(function(){
   if(!document.getElementById('codex-orch-trigger-style')){var st=document.createElement('style');st.id='codex-orch-trigger-style';st.textContent='[data-codex-orch-off] [class*="_ModelPickerTriggerModelLabel_"],[data-codex-orch-off] [class*="_ModelPickerTriggerEffort"]{display:none!important}';document.head.appendChild(st)}
   var el=ref.current,btn=el&&el.closest('button');if(!btn)return;
   if(i===0)btn.setAttribute('data-codex-orch-off','');else btn.removeAttribute('data-codex-orch-off');
  });
  if(props.model==null)return i===0?h('span',{ref:ref,className:'truncate whitespace-nowrap','data-codex-orchestrator-label':'off'},'Orkestratör'):h('span',{ref:ref,className:'shrink-0 whitespace-nowrap','data-codex-orchestrator-label':m[0],style:{color:m[3]}},m[1]);
  if(i===0)return h('span',{className:'flex min-w-0 items-center gap-1 text-tertiary','data-codex-orchestrator-label':'off'},h('span',{className:'truncate whitespace-nowrap'},'Orkestratör'),
   h('svg',{width:12,height:12,viewBox:'0 0 20 20',fill:'none','aria-hidden':'true',style:{flexShrink:0,opacity:0.7}},h('path',{d:'M5.5 7.5 10 12l4.5-4.5',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round'})));
  return h('span',{className:'flex min-w-0 items-center gap-1.5','data-codex-orchestrator-label':m[0]},h('span',{className:'shrink-0 whitespace-nowrap',style:{color:m[3],fontWeight:500}},m[1]),props.model);
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
function codexTpsOnTurnStarted(params) { var ref=codexTpsActiveFor(params);if(ref&&(params.model||params.turn&&params.turn.model))ref.a.model=String(params.model||params.turn.model); }
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
  if(!ms&&turn.startedAt!=null&&turn.completedAt!=null){var start=typeof turn.startedAt==="number"?turn.startedAt:Date.parse(turn.startedAt),end=typeof turn.completedAt==="number"?turn.completedAt:Date.parse(turn.completedAt);if(Number.isFinite(start)&&Number.isFinite(end))ms=Math.max(0,end-start);}
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
  if(!count||ms<=0)return {text:"— tok/s",title:"Bu sohbette henüz ölçülmüş model yanıtı yok",count:0,tps:0};
  var tps=tokens/(ms/1000),text=(tps>=100?Math.round(tps):tps>=10?tps.toFixed(0):tps.toFixed(1))+" tok/s",openCount=0;
  for(var j=0;j<list.length;j++)if(list[j]&&list[j].source==="opencodex")openCount++;
  var sourceLabel=openCount===count?"OpenCodex upstream verisinden":"model yanıtlarından";
  return {text:text,title:"Bu sohbette "+sourceLabel+" ölçülen "+count+" yanıtın ortalaması: "+text+".",count:count,tps:tps};
}
try { window.__codexTpsOnTurnStarted=codexTpsOnTurnStarted;window.__codexTpsOnTurnCompleted=codexTpsOnTurnCompleted;window.__codexTpsOnDelta=codexTpsOnDelta;window.__codexTpsOnItemStart=codexTpsOnItemStart;window.__codexTpsOnUsage=codexTpsOnUsage; } catch(e) {}
function codexThreadTpsBadge(scopeId,R) {
  var m=codexTpsMetric(scopeId),s=R.useState(0),bump=s[1],shownState=R.useState(m.tps||0),shown=shownState[0],setShown=shownState[1];
  var badgeRef=R.useRef(null),scopeRef=R.useRef(scopeId);
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
  return R.createElement("span",{ref:badgeRef,className:"no-drag select-none whitespace-nowrap tabular-nums text-text",style:{fontSize:"12px",lineHeight:"18px",marginInlineEnd:"12px",fontWeight:400},title:m.title,"aria-label":m.title,"data-codex-tps":"","data-codex-tps-scope":scopeId||""},number+" tok/s");
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
      if (typeof Picker === 'function') return h('span', { className: 'flex min-w-0 items-center', 'data-codex-orchestrator-trigger': m[0], 'data-codex-orchestrator-scope': scopeId || '', 'data-codex-subagent-picker': '', title: 'Orkestratör ve alt ajan modeli' },
        h(Picker, { codexSubagent: true, codexConversationId: np.conversationId, hideLabel: np.hideLabel, serviceTierDefaults: np.serviceTierDefaults, permissionsCwdOverride: np.permissionsCwdOverride, permissionsHostId: np.permissionsHostId }));
      return h(R.Fragment, null, h('button', { key: 'codex-orchestrator-button', ref: ref, type: 'button', disabled: !scopeId, className: CODEX_ORCH_BTN,
        title: 'Orkestratör: ' + m[1], 'aria-label': 'Orkestratör: ' + m[1], 'aria-haspopup': 'dialog',
        'aria-expanded': open, 'data-state': open ? 'open' : 'closed', 'data-codex-orchestrator-trigger': m[0],
        'data-codex-orchestrator-scope': scopeId || '', onClick: click },
        h('span', { className: 'truncate whitespace-nowrap', style: i > 0 ? { color: m[3], fontWeight: 500 } : undefined }, i > 0 ? m[1] : 'Orkestratör'),
        h('svg', { width: 12, height: 12, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true', style: { flexShrink: 0, opacity: 0.7 } },
          h('path', { d: 'M5.5 7.5 10 12l4.5-4.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))));
    };
  }
  return R.createElement(R.Fragment, null, R.createElement(codexOrchestratorTpsComponent), children, R.createElement(codexOrchestratorComponent, { nativePicker: children }));
}



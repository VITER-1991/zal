// VEETER · офлайн-журнал тренувань
(function () {
  "use strict";

  const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const UNIT_LABEL = { reps: "повт.", sec: "сек", m: "м", done: "" };

  let P = null;
  let profile = localStorage.getItem("wa2_profile");
  let selectedDay = null;
  let currentTab = "today";
  let rest = { running: false, remaining: 0, total: 0, intervalId: null };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const todayISO = () => iso(new Date());
  const nowDayId = () => DAY_IDS[new Date().getDay()];
  const fmtDate = (s) => { const [, m, d] = s.split("-"); return `${d}.${m}`; };
  const round5 = (v) => Math.round(v / 5) * 5;

  // ---------- storage ----------
  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  const logKey = (p) => "wa2_log_" + p;
  const bodyKey = (p) => "wa2_body_" + p;
  const metaKey = (p) => "wa2_meta_" + p;
  const getLog = () => lsGet(logKey(profile), {});
  const saveLog = (log) => lsSet(logKey(profile), log);
  const getBody = () => lsGet(bodyKey(profile), []);
  const saveBody = (arr) => lsSet(bodyKey(profile), arr);
  const getMeta = () => lsGet(metaKey(profile), { startDate: mondayOf(new Date()) });
  const saveMeta = (m) => lsSet(metaKey(profile), m);

  function mondayOf(d) {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return iso(x);
  }

  function getEntry(exId, date) {
    return (getLog()[exId] || []).find((e) => e.date === date) || null;
  }
  function history(exId) {
    return (getLog()[exId] || []).filter((e) => e.reps.some((r) => r != null) || e.weight != null)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function lastBefore(exId, date, skipDeload) {
    const h = history(exId).filter((e) => e.date < date && (!skipDeload || !e.deload));
    return h.length ? h[h.length - 1] : null;
  }
  function upsert(exId, date, patch) {
    const log = getLog();
    if (!log[exId]) log[exId] = [];
    let e = log[exId].find((x) => x.date === date);
    if (!e) { e = { date, weight: null, reps: [], deload: isDeload() }; log[exId].push(e); }
    Object.assign(e, patch);
    saveLog(log);
    return e;
  }

  // ---------- week / cycle ----------
  function weekNumber() {
    const start = new Date(getMeta().startDate + "T00:00:00");
    const now = new Date(todayISO() + "T00:00:00");
    return Math.max(1, Math.floor((now - start) / 86400000 / 7) + 1);
  }
  const isDeload = () => weekNumber() % 6 === 0;
  const cycleNo = () => Math.ceil(weekNumber() / 6);

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2000);
  }

  // ---------- init ----------
  function init() {
    fetch("data/programs.json")
      .then((r) => r.json())
      .then((data) => { P = data; boot(); })
      .catch(() => {
        document.body.innerHTML = '<div class="empty-state"><span class="emoji">⚠️</span>Не вдалось завантажити програму.</div>';
      });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  function boot() {
    bindGlobalEvents();
    if (!profile || !P[profile]) showOnboard();
    else showMain();
  }

  function showOnboard() {
    $all(".screen").forEach((s) => s.classList.add("hidden"));
    $("#onboard").classList.remove("hidden");
  }

  function selectProfile(p) {
    profile = p;
    localStorage.setItem("wa2_profile", p);
    if (!lsGet(metaKey(p), null)) saveMeta({ startDate: mondayOf(new Date()) });
    showMain();
  }

  const prog = () => P[profile];

  function showMain() {
    $all(".screen").forEach((s) => s.classList.add("hidden"));
    $("#main").classList.remove("hidden");
    currentTab = "today";
    setActiveTabBtn();
    renderProfileChip();
    const today = nowDayId();
    const days = prog().days;
    if (days.find((d) => d.id === today)) selectedDay = today;
    else {
      const idx = DAY_IDS.indexOf(today);
      const next = days.find((d) => DAY_IDS.indexOf(d.id) > idx) || days[0];
      selectedDay = next.id;
    }
    renderBanner();
    renderDayTabs();
    renderDay();
  }

  function renderProfileChip() {
    const avatar = profile === "vitalii" ? "💪" : "🍑";
    $("#profileBtn").innerHTML = `<span>${avatar}</span><span>${prog().name}</span>`;
  }

  function renderBanner() {
    const wk = weekNumber();
    const banner = $("#weekBanner");
    let cls = "banner";
    let text = `Тиждень ${wk} · цикл ${cycleNo()}`;
    if (isDeload()) {
      cls += " warn";
      text += " — <b>deload</b>: ваги мінус 40%, по 2 підходи. Застосунок уже перерахував.";
    } else if (wk <= 2) {
      text += " — <b>вхід</b>: вага, з якою 2–3 повтори в запасі. Без відмови. Запиши стартові ваги.";
    } else if (wk % 6 === 5) {
      text += " — наступного тижня deload.";
    }
    if (!prog().days.find((d) => d.id === nowDayId())) text += " Сьогодні відновлення.";
    banner.className = cls;
    banner.innerHTML = text;
  }

  function renderDayTabs() {
    const today = nowDayId();
    const wrap = $("#dayTabs");
    wrap.innerHTML = "";
    prog().days.forEach((d) => {
      const btn = document.createElement("button");
      btn.className = "day-tab" + (d.id === selectedDay ? " active" : "");
      btn.innerHTML = d.label + (d.id === today ? '<span class="dot"></span>' : "");
      btn.onclick = () => { selectedDay = d.id; renderDayTabs(); renderDay(); };
      wrap.appendChild(btn);
    });
  }

  // ---------- exercise logic ----------
  const planSets = (ex) => (ex.unit === "done" ? 1 : isDeload() ? Math.min(2, ex.n) : ex.n);

  function allTop(entry, ex) {
    if (ex.hi == null || !entry) return false;
    const r = entry.reps.slice(0, ex.n);
    return r.length >= ex.n && r.every((v) => v != null && v >= ex.hi);
  }

  function suggestion(ex) {
    const date = todayISO();
    if (ex.load === "none") return { value: "", hint: "" };
    const unit = ex.load === "assist" ? "lb допомоги" : "lb";
    if (isDeload()) {
      const base = lastBefore(ex.id, date, true);
      if (!base || base.weight == null) return { value: "", hint: "deload: легка вага, по 2 підходи" };
      const v = ex.load === "assist" ? round5(base.weight * 1.4) : round5(base.weight * 0.6);
      return { value: v, hint: `deload: ${ex.load === "assist" ? "+40% допомоги" : "−40%"} від ${base.weight} ${unit}` };
    }
    const last = lastBefore(ex.id, date, true);
    if (!last || last.weight == null) return { value: "", hint: "", first: true };
    const repsTxt = last.reps.filter((r) => r != null).join("/");
    const lastTxt = `минулого разу ${last.weight} ${unit}${repsTxt ? " × " + repsTxt : ""}`;
    if (allTop(last, ex) && weekNumber() >= 3) {
      const v = ex.load === "assist" ? Math.max(0, last.weight - ex.step) : last.weight + ex.step;
      const d = ex.load === "assist" ? `−${ex.step} lb допомоги` : `+${ex.step} lb`;
      return { value: v, hint: `${lastTxt} — усі на верхній межі, ${d}`, up: true };
    }
    if (allTop(last, ex)) return { value: last.weight, hint: `${lastTxt} — верхня межа, можна додати`, up: true };
    return { value: last.weight, hint: lastTxt };
  }

  function defaultValue(ex, i) {
    if (ex.unit === "m") return ex.hi;
    const last = lastBefore(ex.id, todayISO(), true);
    if (last && last.reps[i] != null && ex.hi != null && last.reps[i] < ex.hi) return last.reps[i];
    if (ex.hi != null) return ex.hi;
    return last && last.reps[i] != null ? last.reps[i] : null;
  }

  function targetTxt(ex) {
    if (ex.unit === "done") return "";
    if (ex.lo == null) return "до відмови";
    return ex.lo === ex.hi ? `${ex.hi}` : `${ex.lo}–${ex.hi}`;
  }

  // ---------- day render ----------
  function dayExercises(day) {
    const out = [];
    day.blocks.forEach((b) => b.exercises.forEach((ex) => out.push(ex)));
    return out;
  }

  function isExDone(ex, entry) {
    if (!entry) return false;
    return entry.reps.slice(0, planSets(ex)).filter((r) => r != null).length >= planSets(ex);
  }

  function renderDay() {
    const day = prog().days.find((d) => d.id === selectedDay);
    const content = $("#dayContent");
    content.innerHTML = "";
    if (!day) return;
    const date = todayISO();
    const exs = dayExercises(day);
    const doneCount = exs.filter((ex) => isExDone(ex, getEntry(ex.id, date))).length;

    const head = document.createElement("div");
    head.className = "day-head";
    const mode = day.together
      ? `<span class="chip together">разом з ${prog().partner} · 6:00–7:00</span>`
      : `<span class="chip">сам${day.superset ? " · суперсети" : ""}</span>`;
    head.innerHTML = `
      <div class="day-title">${day.title}</div>
      <div class="day-focus">${day.focus}</div>
      <div class="day-meta">${mode}<span class="chip" id="dayProgress">${doneCount}/${exs.length} вправ</span></div>
      ${selectedDay !== nowDayId() ? `<div class="day-hint">Записи підуть на сьогоднішню дату (${fmtDate(date)}).</div>` : ""}
    `;
    content.appendChild(head);

    if (day.together) {
      const w = document.createElement("div");
      w.className = "block-head";
      w.innerHTML = `<span>Кардіо-розминка</span><span class="time">6:00–6:10</span>`;
      content.appendChild(w);
    }
    day.notes.forEach((n) => {
      const c = document.createElement("div");
      c.className = "note-card";
      c.innerHTML = n;
      content.appendChild(c);
    });

    day.blocks.forEach((b) => {
      const bh = document.createElement("div");
      bh.className = "block-head";
      bh.innerHTML = `<span>${b.title}</span>${b.time ? `<span class="time">${b.time}</span>` : ""}`;
      content.appendChild(bh);
      const group = document.createElement("div");
      group.className = "block-group" + (day.superset ? " superset" : "");
      b.exercises.forEach((ex, j) => {
        const next = day.superset ? (j === 0 ? b.exercises[1] : b.exercises[0]) : null;
        group.appendChild(renderExerciseCard(ex, date, day, next));
      });
      content.appendChild(group);
    });

    if (day.together) {
      const w = document.createElement("div");
      w.className = "block-head";
      w.innerHTML = `<span>Розтяжка на килимках</span><span class="time">6:50–7:00</span>`;
      content.appendChild(w);
    }
  }

  function updateDayProgress() {
    const day = prog().days.find((d) => d.id === selectedDay);
    const exs = dayExercises(day);
    const n = exs.filter((ex) => isExDone(ex, getEntry(ex.id, todayISO()))).length;
    const el = $("#dayProgress");
    if (el) el.textContent = `${n}/${exs.length} вправ`;
    if (n === exs.length) toast("Тренування завершено! Шейк і сніданок 🥤");
  }

  function renderExerciseCard(ex, date, day, next) {
    const card = document.createElement("div");
    card.className = "ex-card";
    const entry = getEntry(ex.id, date);
    if (isExDone(ex, entry)) card.classList.add("done");
    const sug = suggestion(ex);
    const n = planSets(ex);
    const setsLabel = isDeload() && ex.unit !== "done" ? `${n}×${targetTxt(ex)} · deload` : ex.sets;

    const head = document.createElement("div");
    head.className = "ex-head";
    head.innerHTML = `
      <img class="ex-thumb" src="${ex.img}" alt="" loading="lazy">
      <div class="ex-meta">
        <div class="ex-name"><span class="ex-code">${ex.code}</span>${ex.name}</div>
        <div class="ex-sets">${setsLabel}${ex.note ? ` <span class="ex-note">· ${ex.note}</span>` : ""}</div>
        ${ex.prio && !isDeload() ? `<div class="ex-tag">останній підхід — до відмови</div>` : ""}
      </div>
      <span class="ex-more">›</span>
    `;
    head.onclick = () => openExerciseSheet(ex);
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "ex-body";

    if (ex.load !== "none") {
      const wRow = document.createElement("div");
      wRow.className = "ex-row";
      const weightVal = entry && entry.weight != null ? entry.weight : sug.value;
      wRow.innerHTML = `
        <div class="weight-box">
          <button class="w-dec" aria-label="менше">−</button>
          <input class="w-input" type="number" inputmode="decimal" value="${weightVal}" placeholder="—">
          <button class="w-inc" aria-label="більше">+</button>
        </div>
        <span class="weight-unit">${ex.load === "assist" ? "lb допомоги" : "lb"}</span>
      `;
      body.appendChild(wRow);
      const input = $(".w-input", wRow);
      const commit = () => {
        const v = parseFloat(input.value);
        upsert(ex.id, date, { weight: isNaN(v) ? null : v });
      };
      input.addEventListener("change", commit);
      $(".w-dec", wRow).onclick = () => { input.value = Math.max(0, (parseFloat(input.value) || 0) - ex.step); commit(); };
      $(".w-inc", wRow).onclick = () => { input.value = (parseFloat(input.value) || 0) + ex.step; commit(); };
      card._weightInput = input;
      const hint = document.createElement("div");
      hint.className = "last-weight" + (sug.up ? " up" : "");
      hint.textContent = sug.hint || (sug.first ? "перше тренування — підбери й запиши стартову вагу" : "");
      body.appendChild(hint);
    }

    const track = document.createElement("div");
    track.className = "sets-track";
    renderSetChips(track, ex, date, card, next);
    body.appendChild(track);

    card.appendChild(body);
    return card;
  }

  function renderSetChips(track, ex, date, card, next) {
    const entry = getEntry(ex.id, date);
    const n = planSets(ex);
    track.innerHTML = "";
    if (ex.unit === "done") {
      const done = entry && entry.reps[0] != null;
      const b = document.createElement("button");
      b.className = "set-chip wide" + (done ? " done" : "");
      b.textContent = done ? "✓ Виконано" : "Позначити виконаним";
      b.onclick = () => {
        upsert(ex.id, date, { reps: done ? [] : [1] });
        renderSetChips(track, ex, date, card, next);
        card.classList.toggle("done", !done);
        updateDayProgress();
      };
      track.appendChild(b);
      return;
    }
    for (let i = 0; i < n; i++) {
      const v = entry ? entry.reps[i] : null;
      const b = document.createElement("button");
      b.className = "set-chip" + (v != null ? " done" : "");
      b.innerHTML = v != null
        ? `<b>${v}</b><small>${UNIT_LABEL[ex.unit]}</small>`
        : `<span class="n">${i + 1}</span><small>${targetTxt(ex)}</small>`;
      b.onclick = () => {
        if (v != null) { openPicker(ex, i, v, (val) => setRep(ex, date, i, val, track, card, next, false)); return; }
        const dv = defaultValue(ex, i);
        if (dv == null) { openPicker(ex, i, null, (val) => setRep(ex, date, i, val, track, card, next, true)); return; }
        setRep(ex, date, i, dv, track, card, next, true);
      };
      track.appendChild(b);
    }
  }

  function setRep(ex, date, i, val, track, card, next, isNew) {
    const entry = getEntry(ex.id, date) || { reps: [] };
    const reps = entry.reps.slice();
    while (reps.length < i) reps.push(null);
    reps[i] = val;
    while (reps.length && reps[reps.length - 1] == null) reps.pop();
    const patch = { reps };
    if (card._weightInput) {
      const w = parseFloat(card._weightInput.value);
      if (!isNaN(w)) patch.weight = w;
    }
    upsert(ex.id, date, patch);
    renderSetChips(track, ex, date, card, next);
    const done = isExDone(ex, getEntry(ex.id, date));
    card.classList.toggle("done", done);
    if (isNew && val != null) {
      if (navigator.vibrate) navigator.vibrate(20);
      const lastSet = i === planSets(ex) - 1;
      if (next) startRest(ex.restSec, `Далі ${next.code} · ${next.name}`);
      else if (ex.restSec && !lastSet) startRest(ex.restSec, `Відпочинок · ${ex.name}`);
      if (ex.unit === "reps" && ex.hi != null && val < ex.lo) toast("Менше за нижню межу — наступного разу зменш вагу");
    }
    updateDayProgress();
  }

  // ---------- reps picker ----------
  function openPicker(ex, i, current, onPick) {
    const overlay = $("#pickerOverlay");
    let values = [];
    if (ex.unit === "sec") for (let s = 10; s <= 90; s += 5) values.push(s);
    else if (ex.unit === "m") values = [10, 20, 30, 40, 50, 60];
    else {
      const lo = ex.lo != null ? Math.max(1, ex.lo - 5) : 1;
      const hi = ex.hi != null ? ex.hi + 4 : 20;
      for (let r = lo; r <= hi; r++) values.push(r);
    }
    const unitWord = { reps: "повтори", sec: "секунди", m: "метри" }[ex.unit];
    $("#pickerContent").innerHTML = `
      <div class="picker-title">Підхід ${i + 1} · ${unitWord}</div>
      <div class="picker-sub">${ex.name} · ціль ${targetTxt(ex)}</div>
      <div class="picker-grid">${values.map((v) => {
        const inRange = ex.lo != null && v >= ex.lo && v <= ex.hi;
        return `<button data-v="${v}" class="${v === current ? "cur" : ""}${inRange ? " ok" : ""}">${v}</button>`;
      }).join("")}</div>
      ${current != null ? `<button class="picker-clear">Скасувати підхід</button>` : ""}
    `;
    overlay.classList.remove("hidden");
    $all(".picker-grid button", overlay).forEach((b) => {
      b.onclick = () => { overlay.classList.add("hidden"); onPick(parseInt(b.dataset.v, 10)); };
    });
    const clr = $(".picker-clear", overlay);
    if (clr) clr.onclick = () => { overlay.classList.add("hidden"); onPick(null); };
  }

  // ---------- rest timer ----------
  function startRest(sec, label) {
    clearInterval(rest.intervalId);
    rest.running = true;
    rest.total = sec;
    rest.remaining = sec;
    $("#restBar").classList.remove("hidden");
    $("#restLabel").textContent = label;
    renderRest();
    rest.intervalId = setInterval(() => {
      rest.remaining--;
      renderRest();
      if (rest.remaining <= 0) finishRest(true);
    }, 1000);
  }
  function renderRest() {
    $("#restTime").textContent = Math.max(0, rest.remaining);
    $("#restProgress").style.width = Math.max(0, (rest.remaining / rest.total) * 100) + "%";
  }
  function finishRest(natural) {
    clearInterval(rest.intervalId);
    rest.running = false;
    $("#restBar").classList.add("hidden");
    if (natural && navigator.vibrate) navigator.vibrate([80, 60, 80]);
  }
  function adjustRest(delta) {
    if (!rest.running) return;
    rest.remaining = Math.max(0, rest.remaining + delta);
    rest.total = Math.max(rest.total, rest.remaining);
    renderRest();
  }

  // ---------- exercise sheet ----------
  function openExerciseSheet(ex) {
    const h = history(ex.id).slice(-8).reverse();
    const unit = ex.load === "assist" ? "lb доп." : "lb";
    const hist = h.length
      ? `<div class="section-title">Журнал</div><div class="hist-table">${h.map((e) => `
          <div class="hrow"><span>${fmtDate(e.date)}${e.deload ? " <i>deload</i>" : ""}</span>
          <span>${e.weight != null ? e.weight + " " + unit : ""}</span>
          <span class="reps">${ex.unit === "done" ? "✓" : e.reps.map((r) => (r == null ? "–" : r)).join(" / ")}</span></div>`).join("")}</div>`
      : "";
    $("#sheetContent").innerHTML = `
      <img src="${ex.img}" alt="">
      <h2><span class="ex-code">${ex.code}</span>${ex.name}</h2>
      <div class="sheet-sets">${ex.sets}${ex.note ? ` · <span>${ex.note}</span>` : ""}</div>
      <ul class="cues">${ex.cues.map((c) => `<li>${c}</li>`).join("")}</ul>
      ${ex.prio ? `<div class="note-card">Останній підхід — до відмови або за 1 повтор до неї.</div>` : ""}
      ${ex.base ? `<div class="note-card">Базова вправа — ніколи до відмови. Крок прогресії +${ex.step} lb.</div>` : ""}
      ${hist}
      <button class="close-sheet" id="closeSheetBtn">Закрити</button>
    `;
    $("#sheetOverlay").classList.remove("hidden");
    $("#sheet").scrollTop = 0;
    $("#closeSheetBtn").onclick = () => $("#sheetOverlay").classList.add("hidden");
  }

  // ---------- settings ----------
  function openSettings() {
    const overlay = $("#settingsOverlay");
    const meta = getMeta();
    $("#settingsContent").innerHTML = `
      <div class="section-title">Профіль</div>
      <div class="settings-row"><span>${prog().name}</span><button id="switchProfileBtn">Змінити</button></div>
      <div class="settings-row"><span>Старт програми (понеділок)</span><input id="startDateInput" type="date" value="${meta.startDate}"></div>
      <div class="settings-row"><span>Тиждень · цикл</span><span>${weekNumber()} · ${cycleNo()}</span></div>
      <div class="section-title">Резервна копія</div>
      <div class="settings-row"><span>Зберегти журнал у файл</span><button id="exportBtn">Експорт</button></div>
      <div class="settings-row"><span>Відновити з файлу</span><button id="importBtn">Імпорт</button></div>
      <input type="file" id="importFile" accept="application/json,.json" class="hidden">
      <div class="settings-row"><span>Очистити журнал профілю</span><button class="danger" id="clearBtn">Очистити</button></div>
      <button class="close-sheet" id="closeSettingsBtn">Закрити</button>
    `;
    overlay.classList.remove("hidden");
    $("#switchProfileBtn").onclick = () => {
      overlay.classList.add("hidden");
      localStorage.removeItem("wa2_profile");
      profile = null;
      showOnboard();
    };
    $("#startDateInput").onchange = (e) => {
      if (!e.target.value) return;
      saveMeta({ startDate: e.target.value });
      renderBanner();
      renderDay();
    };
    $("#exportBtn").onclick = () => {
      const payload = { app: "veeter", profile, meta: getMeta(), log: getLog(), body: getBody() };
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `veeter-${profile}-${todayISO()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    $("#importBtn").onclick = () => $("#importFile").click();
    $("#importFile").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((t) => {
        let d;
        try { d = JSON.parse(t); } catch (err) { toast("Файл не схожий на копію журналу"); return; }
        if (d.app !== "veeter" || !d.log) { toast("Файл не схожий на копію журналу"); return; }
        if (d.profile !== profile && !confirm(`Це копія профілю «${(P[d.profile] || {}).name || d.profile}». Завантажити в «${prog().name}»?`)) return;
        if (!confirm("Замінити поточний журнал даними з файлу?")) return;
        saveLog(d.log);
        saveBody(d.body || []);
        if (d.meta) saveMeta(d.meta);
        overlay.classList.add("hidden");
        showMain();
        toast("Журнал відновлено");
      });
    };
    $("#clearBtn").onclick = () => {
      if (confirm("Видалити весь журнал і заміри цього профілю? Спершу зроби експорт, якщо потрібна копія.")) {
        localStorage.removeItem(logKey(profile));
        localStorage.removeItem(bodyKey(profile));
        overlay.classList.add("hidden");
        renderDay();
        toast("Журнал очищено");
      }
    };
    $("#closeSettingsBtn").onclick = () => overlay.classList.add("hidden");
  }

  // ---------- progress ----------
  function renderProgress() {
    const content = $("#progressContent");
    const log = getLog();
    const dates = new Set();
    Object.values(log).forEach((arr) => arr.forEach((e) => { if (e.reps.some((r) => r != null)) dates.add(e.date); }));
    const weekStart = mondayOf(new Date());
    const thisWeek = [...dates].filter((d) => d >= weekStart).length;

    content.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="v">${dates.size}</div><div class="l">тренувань</div></div>
        <div class="stat-card"><div class="v">${thisWeek}/${prog().days.length}</div><div class="l">цього тижня</div></div>
        <div class="stat-card"><div class="v">${weekNumber()}</div><div class="l">тиждень · цикл ${cycleNo()}</div></div>
      </div>
    `;
    let any = false;
    prog().days.forEach((day) => {
      const exs = dayExercises(day).filter((ex) => ex.unit !== "done" && history(ex.id).length);
      if (!exs.length) return;
      any = true;
      const t = document.createElement("div");
      t.className = "section-title";
      t.textContent = `${day.title} · ${day.focus}`;
      content.appendChild(t);
      exs.forEach((ex) => content.appendChild(progressCard(ex)));
    });
    if (!any) {
      content.innerHTML += '<div class="empty-state"><span class="emoji">📈</span>Відміть перші підходи на вкладці «Сьогодні» — графіки з\'являться тут.</div>';
    }
  }

  function progressCard(ex) {
    const h = history(ex.id);
    const useWeight = ex.load !== "none" && h.some((e) => e.weight != null);
    const pts = useWeight
      ? h.filter((e) => e.weight != null).map((e) => e.weight)
      : h.map((e) => Math.max(0, ...e.reps.filter((r) => r != null)));
    const unit = useWeight ? (ex.load === "assist" ? "lb доп." : "lb") : UNIT_LABEL[ex.unit];
    const first = pts[0], last = pts[pts.length - 1];
    const delta = last - first;
    const better = ex.load === "assist" ? delta < 0 : delta > 0;
    const lastE = h[h.length - 1];
    const card = document.createElement("div");
    card.className = "hist-card";
    card.innerHTML = `
      <div class="hname"><span class="ex-code">${ex.code}</span>${ex.name}</div>
      <canvas></canvas>
      <div class="hist-meta">
        <span>${fmtDate(h[0].date)} → ${fmtDate(lastE.date)} · ${lastE.reps.filter((r) => r != null).join("/")}</span>
        <span class="${delta ? (better ? "good" : "bad") : ""}">${last} ${unit}${delta ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}</span>
      </div>
    `;
    card.onclick = () => openExerciseSheet(ex);
    requestAnimationFrame(() => drawSparkline($("canvas", card), pts));
    return card;
  }

  function drawSparkline(canvas, values) {
    if (!canvas || !values.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = (canvas.getBoundingClientRect().width || 300) * dpr;
    const h = 64 * dpr;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const min = Math.min(...values), max = Math.max(...values);
    const pad = 8 * dpr, range = max - min || 1;
    const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
    const xy = (v, i) => [values.length > 1 ? pad + stepX * i : w / 2, h - pad - ((v - min) / range) * (h - pad * 2)];
    ctx.beginPath();
    ctx.strokeStyle = "#4fd1a5";
    ctx.lineWidth = 2.5 * dpr;
    ctx.lineJoin = "round";
    values.forEach((v, i) => { const [x, y] = xy(v, i); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = "#ff6b35";
    values.forEach((v, i) => { const [x, y] = xy(v, i); ctx.beginPath(); ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2); ctx.fill(); });
  }

  // ---------- body ----------
  function renderBody() {
    const pr = prog();
    const content = $("#bodyContent");
    const arr = getBody().slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = arr.length ? arr[arr.length - 1] : null;
    const isFri = nowDayId() === "fri";
    const field = (id, ph, label) => `<label class="body-field"><span>${label}</span><input id="${id}" type="number" inputmode="decimal" placeholder="${ph}"></label>`;

    content.innerHTML = `
      <div class="section-title">Заміри · ${isFri ? "сьогодні п'ятниця — зважся до залу" : "раз на тиждень, у п'ятницю до залу"}</div>
      <div class="body-card">
        <div class="body-fields">
          ${field("bwInput", last && last.weight != null ? last.weight : "lb", "Вага, lb")}
          ${pr.measurements ? field("waistInput", last && last.waist != null ? last.waist : "см", "Талія, см") + field("hipsInput", last && last.hips != null ? last.hips : "см", "Стегна, см") : ""}
        </div>
        ${pr.measurements ? `<div class="muted small" style="margin-top:8px">Талію й стегна — раз на 2 тижні (парні тижні).</div>` : ""}
        <button id="bodySaveBtn" class="primary-btn">Записати</button>
      </div>
      <div class="hist-card" id="bodyChart"></div>
      <div id="bodyList"></div>
      <div class="section-title">Білок і відновлення</div>
      <div class="note-card">${pr.nutrition.intro}</div>
      <div class="hist-card">${pr.nutrition.rows.map((r) => `<div class="nutri-row"><span>${r[0]}</span><span class="p">${r[1]}</span></div>`).join("")}</div>
      <ul class="guide-list">${pr.nutrition.notes.map((n) => `<li>${n}</li>`).join("")}</ul>
      <div class="disclaimer">${pr.nutrition.disclaimer}</div>
    `;

    const chart = $("#bodyChart");
    const ws = arr.filter((e) => e.weight != null);
    if (ws.length > 1) {
      const d = ws[ws.length - 1].weight - ws[0].weight;
      chart.innerHTML = `<div class="hname">Вага тіла</div><canvas></canvas><div class="hist-meta"><span>${fmtDate(ws[0].date)} → ${fmtDate(ws[ws.length - 1].date)}</span><span>${ws[ws.length - 1].weight} lb (${d > 0 ? "+" : ""}${Math.round(d * 10) / 10})</span></div>`;
      requestAnimationFrame(() => drawSparkline($("canvas", chart), ws.map((e) => e.weight)));
    } else {
      chart.innerHTML = `<div class="muted small">Після двох зважувань тут з'явиться графік.</div>`;
    }
    if (arr.length) {
      $("#bodyList").innerHTML = `<div class="hist-table">${arr.slice(-12).reverse().map((e) => `
        <div class="hrow"><span>${fmtDate(e.date)}</span><span>${e.weight != null ? e.weight + " lb" : ""}</span>
        <span class="reps">${pr.measurements && (e.waist != null || e.hips != null) ? `${e.waist ?? "–"} / ${e.hips ?? "–"} см` : ""}</span></div>`).join("")}</div>`;
    }

    $("#bodySaveBtn").onclick = () => {
      const num = (id) => { const el = $("#" + id); if (!el) return null; const v = parseFloat(el.value); return isNaN(v) ? null : v; };
      const patch = { weight: num("bwInput"), waist: num("waistInput"), hips: num("hipsInput") };
      if (patch.weight == null && patch.waist == null && patch.hips == null) return;
      const list = getBody();
      const date = todayISO();
      let e = list.find((x) => x.date === date);
      if (!e) { e = { date }; list.push(e); }
      Object.keys(patch).forEach((k) => { if (patch[k] != null) e[k] = patch[k]; });
      saveBody(list);
      toast("Записано");
      renderBody();
    };
  }

  // ---------- guide ----------
  function renderGuide() {
    const pr = prog();
    const j = P.joint;
    const me = profile === "vitalii" ? 1 : 2;
    content(`#guideContent`, `
      <div class="section-title">Тиждень</div>
      <div class="hist-card table">
        <div class="trow th"><span>День</span><span>Віталій</span><span>Тетяна</span></div>
        ${j.week.map((r) => `<div class="trow"><span>${r[0]}</span><span class="${me === 1 ? "me" : ""}">${r[1]}</span><span class="${me === 2 ? "me" : ""}">${r[2]}</span></div>`).join("")}
      </div>
      <div class="section-title">Спільне тренування · пн, ср, пт</div>
      <div class="hist-card sched">${j.schedule.map((r) => `<div class="nutri-row"><span class="p left">${r[0]}</span><span>${r[1]}</span></div>`).join("")}</div>
      <ul class="guide-list">${j.rules.map((b) => `<li>${b}</li>`).join("")}</ul>
      <div class="section-title">Як прогресувати</div>
      <ul class="guide-list">${pr.progression.map((b) => `<li>${b}</li>`).join("")}</ul>
      <div class="section-title">Як працює журнал</div>
      <ul class="guide-list">
        <li>Тисни на квадратик підходу — запишеться ціль або твій минулий результат і стартує таймер.</li>
        <li>Тисни на заповнений квадратик — виправ кількість повторів або скасуй підхід.</li>
        <li>Коли всі підходи на верхній межі, з тижня 3 застосунок сам підставить нову вагу за правилом вище (у гравітроні — менше допомоги).</li>
        <li>Кожен 6-й тиждень — deload: 2 підходи і вага −40% підставляються автоматично.</li>
        <li>Дані зберігаються на телефоні. Раз на місяць роби експорт у ⚙️.</li>
      </ul>
    `);
  }
  function content(sel, html) { $(sel).innerHTML = html; }

  // ---------- tabs ----------
  function setActiveTabBtn() {
    $all(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === currentTab));
  }
  function showTab(tab) {
    currentTab = tab;
    $all(".screen").forEach((s) => s.classList.add("hidden"));
    const map = { today: "main", progress: "progressScreen", body: "bodyScreen", guide: "guideScreen" };
    $("#" + map[tab]).classList.remove("hidden");
    setActiveTabBtn();
    if (tab === "today") { renderBanner(); renderDayTabs(); renderDay(); }
    if (tab === "progress") renderProgress();
    if (tab === "body") renderBody();
    if (tab === "guide") renderGuide();
  }

  function bindGlobalEvents() {
    $all(".profile-pick").forEach((btn) => { btn.onclick = () => selectProfile(btn.dataset.profile); });
    document.addEventListener("click", (e) => {
      const tabBtn = e.target.closest(".tab-btn");
      if (tabBtn) showTab(tabBtn.dataset.tab);
    });
    $("#profileBtn").onclick = openSettings;
    $("#settingsBtn").onclick = openSettings;
    ["sheetOverlay", "settingsOverlay", "pickerOverlay"].forEach((id) => {
      $("#" + id).addEventListener("click", (e) => { if (e.target.id === id) e.target.classList.add("hidden"); });
    });
    $("#restSkip").onclick = () => finishRest(false);
    $("#restPlus").onclick = () => adjustRest(15);
    $("#restMinus").onclick = () => adjustRest(-15);
  }

  init();
})();

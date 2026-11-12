// VEETER · офлайн-журнал тренувань
(function () {
  "use strict";

  // Старий index.html (без core.js) із новим app.js — перший запуск після оновлення на слабкому інтернеті.
  // Один раз за сесію вкладки просимо service worker оновитись і перезавантажуємось; вдруге — лише повідомлення.
  if (typeof ZalCore === "undefined" || !document.getElementById("workStop")) {
    const FLAG = "zal_mixed_reload";
    let tried = false;
    try { tried = sessionStorage.getItem(FLAG) === "1"; } catch (e) {}
    if (!tried) {
      try { sessionStorage.setItem(FLAG, "1"); } catch (e) {}
      const go = () => location.reload();
      const upd = "serviceWorker" in navigator && navigator.serviceWorker.getRegistration
        ? navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {})
        : Promise.resolve();
      Promise.race([upd, new Promise((r) => setTimeout(r, 3000))]).then(go, go);
    } else {
      document.body.innerHTML = '<div class="empty-state"><span class="emoji">⚠️</span>Оновлення не завершилось. Закрий застосунок і відкрий ще раз при доброму інтернеті.</div>';
    }
    return;
  }
  // файли узгоджені — наступне змішане завантаження в цій вкладці знову має одну спробу
  try { sessionStorage.removeItem("zal_mixed_reload"); } catch (e) {}

  const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const UNIT_LABEL = { reps: "повт.", sec: "сек", m: "м", done: "" };

  let P = null;
  let profile = localStorage.getItem("wa2_profile");
  let selectedDay = null;
  let currentTab = "today";
  // секундомір підходу, відпочинок і час зупиненого, ще не записаного підходу (епоха, мс)
  let timers = { work: null, rest: null, pending: null };
  let tickId = null;         // один інтервал на обидва таймери; живе, лише поки щось іде
  let renderedDate = null;   // дата, з якою намальовано екран «Сьогодні»
  let dayDoneCount = 0;      // скільки вправ було виконано, щоб тост «завершено» не повторювався
  let pendingReload = false; // нова версія застосунку чекає, поки застосунок сховають
  let touched = false;       // користувач уже щось натискав після запуску
  let audioCtx = null;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const todayISO = () => iso(new Date());
  const nowDayId = () => DAY_IDS[new Date().getDay()];
  const fmtDate = (s) => { const [, m, d] = s.split("-"); return `${d}.${m}`; };
  const fmtW = (v) => (v == null || v === "" ? "" : String(Math.round(Number(v) * 10) / 10));
  const parseNum = (s) => { const v = parseFloat(String(s == null ? "" : s).replace(",", ".")); return isNaN(v) ? null : v; };
  const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00"));
  const isNumOrNull = (v) => v == null || (typeof v === "number" && isFinite(v));
  // номер дня без годинника — щоб перехід на літній/зимовий час не з'їдав годину
  const dayNum = (s) => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
  const Z = ZalCore;

  // ---------- storage ----------
  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast("Не вдалось зберегти — пам'ять заповнена. Зроби експорт у ⚙️"); return false; }
  }
  const logKey = (p) => "wa3_log_" + p;
  const sessKey = (p) => "wa3_sessions_" + p;
  const planKey = (p) => "wa3_plan_" + p;
  const timerKey = (p) => "wa3_timer_" + p;
  const bodyKey = (p) => "wa2_body_" + p;
  const metaKey = (p) => "wa2_meta_" + p;
  const getLog = () => lsGet(logKey(profile), {});
  const saveLog = (log) => lsSet(logKey(profile), log);
  const getPlan = () => Z.cleanPlan(lsGet(planKey(profile), {})) || {};
  const savePlan = (p) => lsSet(planKey(profile), p);
  const getSessions = () => lsGet(sessKey(profile), {});
  const saveSessions = (s) => lsSet(sessKey(profile), s);
  // Журнал v3 береться зі старого wa2 лише раз; wa2_log_* тільки читаємо й ніколи не пишемо.
  function ensureMigrated(p) {
    if (localStorage.getItem(logKey(p)) !== null) return;
    lsSet(logKey(p), Z.migrateLogV2(lsGet("wa2_log_" + p, {})));
  }
  const getBody = () => lsGet(bodyKey(profile), []);
  const saveBody = (arr) => lsSet(bodyKey(profile), arr);
  function getMeta() {
    const m = lsGet(metaKey(profile), null);
    if (m && isISO(m.startDate)) return m;
    const fixed = { startDate: defaultStart() };
    saveMeta(fixed);
    return fixed;
  }
  const saveMeta = (m) => lsSet(metaKey(profile), m);

  function mondayOf(d) {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return iso(x);
  }
  // старт програми: понеділок цього тижня, а у суботу й неділю — наступний понеділок
  function defaultStart() {
    const d = new Date();
    if (d.getDay() === 6 || d.getDay() === 0) d.setDate(d.getDate() + (d.getDay() === 6 ? 2 : 1));
    return mondayOf(d);
  }

  function getEntry(exId, date) {
    return (getLog()[exId] || []).find((e) => e.date === date) || null;
  }
  function history(exId) {
    return (getLog()[exId] || []).filter((e) => Z.doneSets(e).length > 0)
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
    if (!e) { e = { date, deload: isDeload(), sets: [] }; log[exId].push(e); }
    Object.assign(e, patch);
    saveLog(log);
    return e;
  }
  function setSet(exId, date, i, set) {
    const log = getLog();
    if (!log[exId]) log[exId] = [];
    let e = log[exId].find((x) => x.date === date);
    if (!e) { e = { date, deload: isDeload(), sets: [] }; log[exId].push(e); }
    while (e.sets.length < i) e.sets.push(null);
    e.sets[i] = set;
    while (e.sets.length && e.sets[e.sets.length - 1] == null) e.sets.pop();
    saveLog(log);
    return e;
  }
  const ctx = () => ({ week: weekNumber(), deload: isDeload() });

  // ---------- week / cycle ----------
  function weekNumber() {
    return Math.max(1, Math.floor((dayNum(todayISO()) - dayNum(getMeta().startDate)) / 7) + 1);
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
    if ("serviceWorker" in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register("sw.js").catch(() => {});
      // нова версія активувалась — перезавантажуємось лише тоді, коли це нікому не заважає
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController) return;
        pendingReload = true;
        maybeReload();
      });
    }
  }

  function boot() {
    bindGlobalEvents();
    if (!profile || !P[profile]) showOnboard();
    else showMain();
  }

  function showOnboard() {
    $all(".screen").forEach((s) => s.classList.add("hidden"));
    $("#onboard").classList.remove("hidden");
    renderTimers();
  }

  function selectProfile(p) {
    profile = p;
    localStorage.setItem("wa2_profile", p);
    if (!lsGet(metaKey(p), null)) saveMeta({ startDate: defaultStart() });
    invalidateProg();
    ensureMigrated(p);
    showMain();
  }

  // програма профілю з накладеною ціллю (кількість підходів / межі повторів)
  let progCache = null;
  function invalidateProg() { progCache = null; }
  function prog() {
    if (progCache && progCache.p === profile) return progCache.v;
    const base = P[profile];
    const plan = getPlan();
    const v = Object.assign({}, base, {
      days: base.days.map((d) => Object.assign({}, d, {
        blocks: d.blocks.map((b) => Object.assign({}, b, { exercises: b.exercises.map((ex) => Z.applyPlan(ex, plan[ex.id])) }))
      }))
    });
    progCache = { p: profile, v };
    return v;
  }

  // вправа з програми профілю без накладеної цілі (P не змінюємо)
  function rawEx(exId) {
    const base = P[profile];
    for (const d of base.days) for (const b of d.blocks) {
      const ex = b.exercises.find((x) => x.id === exId);
      if (ex) return ex;
    }
    return null;
  }

  function showMain() {
    ensureMigrated(profile);
    $all(".screen").forEach((s) => s.classList.add("hidden"));
    $("#main").classList.remove("hidden");
    currentTab = "today";
    renderedDate = todayISO();
    setActiveTabBtn();
    renderProfileChip();
    const today = nowDayId();
    const days = prog().days;
    // тренування вже йде (напр. програма п'ятниці в суботу) — повертаємось на його день
    const open = todaySession();
    if (open && open.end == null && days.find((d) => d.id === open.day)) selectedDay = open.day;
    else if (days.find((d) => d.id === today)) selectedDay = today;
    else {
      const idx = DAY_IDS.indexOf(today);
      const next = days.find((d) => DAY_IDS.indexOf(d.id) > idx) || days[0];
      selectedDay = next.id;
    }
    restoreTimers();
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

  // скільки квадратиків малювати: ціль + додані, але зроблені підходи не ховаємо, навіть якщо ціль зменшили
  function chipCount(ex, entry) {
    let lastDone = -1;
    if (entry) entry.sets.forEach((x, i) => { if (x) lastDone = i; });
    return Math.max(planSets(ex) + ((entry && entry.extra) || 0), lastDone + 1);
  }

  // перший незроблений підхід серед квадратиків; -1, якщо всі зроблено
  function nextIdx(ex, entry) {
    const n = chipCount(ex, entry);
    for (let i = 0; i < n; i++) if (!(entry && entry.sets[i])) return i;
    return -1;
  }

  function weightHint(ex, i) {
    const date = todayISO();
    if (ex.load === "none") return { value: null, up: false, text: "" };
    const last = lastBefore(ex.id, date, true);
    const r = Z.nextWeight(ex, i, getEntry(ex.id, date), last, ctx());
    const unit = ex.load === "assist" ? "lb допомоги" : "lb";
    const base = Z.prevSet(last, i);
    const tw = last ? Z.topWeight(last, ex.load) : null;
    const repsTxt = last ? Z.doneSets(last).map((s) => s.r).join("/") : "";
    const lastTxt = tw != null ? `минулого разу ${fmtW(tw)} ${unit}${repsTxt ? " × " + repsTxt : ""}` : "";
    // «до відмови» не має верхньої межі — кажемо, який поріг узяли
    const fail = ex.hi == null ? `усі підходи по ${Z.FAILURE_ASSIST_TOP}+` : "";
    let text = "";
    if (r.why === "up") text = `${lastTxt} — ${fail || "усі на верхній межі"}, ${ex.load === "assist" ? `−${ex.step} lb допомоги` : `+${ex.step} lb`}`;
    else if (r.why === "top") text = `${lastTxt} — ${fail || "верхня межа"}, ${ex.load === "assist" ? "можна зменшити допомогу" : "можна додати"}`;
    else if (r.why === "deload") {
      // легка вага не зменшується (округлення дало б 0 або ту саму вагу) — «−40%» було б неправдою
      text = ex.load !== "assist" && r.value === base.w ? "deload: легка вага, по 2 підходи"
        : `deload: ${ex.load === "assist" ? "+40% допомоги" : "−40%"} від ${fmtW(base.w)} ${unit}`;
    }
    else if (r.why === "assist0") text = `${lastTxt} — ${fail ? fail + ", " : ""}допомога вже 0, переходь на вправу без гравітрона`;
    else if (r.why === "first") text = "перше тренування — підбери й запиши стартову вагу";
    else if (r.why === "same") text = lastTxt;
    return { value: r.value, up: r.up, text };
  }

  function defaultValue(ex, i) {
    return Z.defaultReps(ex, i, lastBefore(ex.id, todayISO(), true));
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
    const n = planSets(ex);
    if (entry.sets.length < n) return false;
    for (let i = 0; i < n; i++) if (!entry.sets[i]) return false;
    return true;
  }

  function renderDay() {
    const day = prog().days.find((d) => d.id === selectedDay);
    const content = $("#dayContent");
    blurInside(content);
    content.innerHTML = "";
    if (!day) return;
    const date = todayISO();
    const exs = dayExercises(day);
    const doneCount = exs.filter((ex) => isExDone(ex, getEntry(ex.id, date))).length;
    dayDoneCount = doneCount;

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
        group.appendChild(renderExerciseCard(ex, date, day, partnerOf(day, b, j)));
      });
      content.appendChild(group);
    });

    if (day.together) {
      const w = document.createElement("div");
      w.className = "block-head";
      w.innerHTML = `<span>Розтяжка на килимках</span><span class="time">6:50–7:00</span>`;
      content.appendChild(w);
    }
    refreshSessionUI();
  }

  function updateDayProgress() {
    const day = prog().days.find((d) => d.id === selectedDay);
    const exs = dayExercises(day);
    const n = exs.filter((ex) => isExDone(ex, getEntry(ex.id, todayISO()))).length;
    const el = $("#dayProgress");
    if (el) el.textContent = `${n}/${exs.length} вправ`;
    if (n === exs.length && dayDoneCount < exs.length) finishSession(true);
    dayDoneCount = n;
  }

  // у суперсеті напарник — сусідня вправа блоку
  function partnerOf(day, b, j) {
    return day.superset ? (j === 0 ? b.exercises[1] : b.exercises[0]) : null;
  }

  // де вправа в програмі: спершу показаний день (картки є лише для нього), потім решта — таймер глобальний
  function locate(exId) {
    const days = prog().days;
    const order = days.filter((d) => d.id === selectedDay).concat(days.filter((d) => d.id !== selectedDay));
    for (const day of order) {
      for (const b of day.blocks) {
        const j = b.exercises.findIndex((x) => x.id === exId);
        if (j >= 0) return { day, ex: b.exercises[j], partner: partnerOf(day, b, j) };
      }
    }
    return null;
  }

  // перемалювати одну картку на місці (разом із зв'язком із напарником по суперсету)
  function rerenderCard(exId) {
    const old = $(`.ex-card[data-ex="${exId}"]`);
    const loc = locate(exId);
    if (!old || !loc) return;
    blurInside(old);
    old.replaceWith(renderExerciseCard(loc.ex, todayISO(), loc.day, loc.partner));
  }

  // поле у фокусі, яке зараз зникне: зберегти вже вписану вагу й зняти фокус (iOS не знімає фокус при дотику до кнопки,
  // а прибраний з екрана елемент не отримує ні blur, ні change)
  // Не повторно: збереження може перемалювати день (staleDay → showMain → renderDay → blurInside).
  let flushing = false;
  function blurInside(el) {
    const a = document.activeElement;
    if (flushing || !a || a === document.body || !el.contains(a)) return;
    flushing = true;
    try {
      if (a.blur) a.blur(); // спершу знімаємо фокус: вкладений виклик уже не знайде це поле
      a.dispatchEvent(new Event("zal-flush"));
    } finally { flushing = false; }
  }

  // зупинений «Стоп», ще не записаний підхід — лише сьогоднішній; вчорашній викидаємо
  const isTodayAt = (at) => typeof at === "number" && isFinite(at) && iso(new Date(at)) === todayISO();
  function currentPending() {
    if (timers.pending && !isTodayAt(timers.pending.at)) { timers.pending = null; saveTimers(); }
    return timers.pending;
  }
  // час під навантаженням підходу, зупиненого «Стоп», але ще не записаного
  function pendingTimeFor(exId, i) {
    const p = currentPending();
    return p && p.exId === exId && p.i === i ? p.t : null;
  }

  const WEIGHT_ERR = "Вага: число від 0 до 2000";
  // iOS ігнорує select() у обробнику focus — виділяємо вже після нього
  function selectAllSoon(input) {
    setTimeout(() => { try { input.setSelectionRange(0, input.value.length); } catch (e) {} }, 0);
  }

  function renderExerciseCard(ex, date, day, next) {
    const card = document.createElement("div");
    card.className = "ex-card";
    card.dataset.ex = ex.id;
    const entry = getEntry(ex.id, date);
    if (isExDone(ex, entry)) card.classList.add("done");
    const n = planSets(ex);
    const ni = nextIdx(ex, entry);
    const ci = ni >= 0 ? ni : chipCount(ex, entry) - 1;
    const last = lastBefore(ex.id, date, true);
    const setsLabel = isDeload() && ex.unit !== "done" ? `${n}×${targetTxt(ex)} · deload` : ex.sets;
    const lastDone = last ? Z.doneSets(last) : [];
    const noLoadLast = ex.load === "none" && ex.unit !== "done" && lastDone.length
      ? `<div class="ex-last">минулого разу ${lastDone.map((s) => s.r).join(" / ")}</div>` : "";

    const head = document.createElement("div");
    head.className = "ex-head";
    head.innerHTML = `
      <img class="ex-thumb" src="${ex.img}" alt="" loading="lazy">
      <div class="ex-meta">
        <div class="ex-name"><span class="ex-code">${ex.code}</span>${ex.name}</div>
        <div class="ex-sets">${setsLabel}${ex.note ? ` <span class="ex-note">· ${ex.note}</span>` : ""}</div>
        ${noLoadLast}
        ${ex.prio && !isDeload() ? `<div class="ex-tag">останній підхід — до відмови</div>` : ""}
      </div>
      <span class="ex-more">›</span>
    `;
    head.onclick = () => openExerciseSheet(ex);
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "ex-body";

    if (ex.load !== "none") {
      const sug = weightHint(ex, ci);
      const unitShort = ex.load === "assist" ? "lb доп." : "lb";
      const p = Z.prevSet(last, ci);
      const prevTxt = p ? (p.w != null ? `${fmtW(p.w)} ${unitShort} × ${p.r}` : `× ${p.r}`) : "—";
      const wRow = document.createElement("div");
      wRow.className = "w-row";
      wRow.innerHTML = `
        <div class="w-prev"><small>минулого разу</small><b>${prevTxt}</b></div>
        <label class="w-now"><small>зараз</small>
          <span><input class="w-input" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="—" value="${fmtW(sug.value)}"><i>${unitShort}</i></span>
        </label>
      `;
      body.appendChild(wRow);
      const input = $(".w-input", wRow);
      let shown = input.value;
      input.addEventListener("focus", () => selectAllSoon(input));
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
      // Вагу записуємо як чернетку. Запис без підходів не заважає прогресії: history() бере лише дні з підходами.
      const commit = () => {
        if (staleDay(date)) return;
        const raw = input.value.trim();
        const v = raw === "" ? null : parseNum(raw);
        if (raw !== "" && (v == null || v < 0 || v > 2000)) {
          input.value = shown;
          toast(WEIGHT_ERR);
          return;
        }
        upsert(ex.id, date, { draft: v });
        input.value = shown = fmtW(v);
      };
      input.addEventListener("change", commit);
      // запасний шлях: значення змінилось, а change не прийшов (поле прибирають з екрана у фокусі)
      // лише для картки сьогоднішньої дати: вчорашня картка нічого не зберігає й не перемальовує екран
      const flush = () => { if (date === todayISO() && input.value !== shown) commit(); };
      input.addEventListener("blur", flush);
      input.addEventListener("zal-flush", flush);
      const hint = document.createElement("div");
      hint.className = "last-weight" + (sug.up ? " up" : "");
      hint.textContent = sug.text;
      if (sug.text) body.appendChild(hint);
    }

    const track = document.createElement("div");
    track.className = "sets-track";
    renderSetChips(track, ex, date);
    body.appendChild(track);

    // «Старт» необов'язковий: без нього квадратик записує підхід без часу
    if (ex.unit !== "done") {
      const running = timers.work && timers.work.exId === ex.id;
      if (running || ni >= 0) {
        const sb = document.createElement("button");
        sb.className = "start-set" + (running ? " stop" : "");
        sb.textContent = running ? workStopText() : `▶ Старт підходу ${ni + 1}`;
        sb.onclick = () => (running ? stopWork() : startWork(ex, ni, date));
        body.appendChild(sb);
      }
    }

    card.appendChild(body);
    return card;
  }

  function renderSetChips(track, ex, date) {
    const entry = getEntry(ex.id, date);
    track.innerHTML = "";
    if (ex.unit === "done") {
      const done = !!(entry && entry.sets[0]);
      const b = document.createElement("button");
      b.className = "set-chip wide" + (done ? " done" : "");
      b.textContent = done ? "✓ Виконано" : "Позначити виконаним";
      b.onclick = () => {
        if (staleDay(date)) return;
        setSet(ex.id, date, 0, done ? null : { w: null, r: 1, t: null });
        if (!done) { const l = locate(ex.id); ensureSession(); touchSession(l ? l.day.id : selectedDay); }
        rerenderCard(ex.id);
        updateDayProgress();
      };
      track.appendChild(b);
      return;
    }
    const n = chipCount(ex, entry);
    for (let i = 0; i < n; i++) {
      const s = entry && entry.sets[i] ? entry.sets[i] : null;
      const b = document.createElement("button");
      b.className = "set-chip" + (s ? " done" : "");
      b.innerHTML = s
        ? `<b>${s.r}</b><small>${s.w != null ? fmtW(s.w) + " lb" : UNIT_LABEL[ex.unit]}</small>`
        : `<span class="n">${i + 1}</span><small>${targetTxt(ex)}</small>`;
      // Підхід записуємо, коли його вже зроблено: питаємо, скільки вийшло (ціль підсвічена — один дотик).
      b.onclick = () => {
        if (s) {
          openPicker(ex, i, s.r, null, (val, w) => recordSet(ex, date, i, val, null, { isNew: false, restStarted: false, w }), s);
          return;
        }
        openPicker(ex, i, null, suggestedValue(ex, i), (val) => recordSet(ex, date, i, val, pendingTimeFor(ex.id, i), { isNew: true, restStarted: false }));
      };
      track.appendChild(b);
    }
    if (((entry && entry.extra) || 0) < 10) {
      const add = document.createElement("button");
      add.className = "set-chip add";
      add.setAttribute("aria-label", "Додати підхід");
      add.textContent = "＋";
      add.onclick = () => {
        if (staleDay(date)) return;
        const e = getEntry(ex.id, date);
        const extra = (e && e.extra) || 0;
        if (extra >= 10) return;
        upsert(ex.id, date, { extra: extra + 1 });
        rerenderCard(ex.id);
      };
      track.appendChild(add);
    }
  }

  // екран намальовано вчора (iOS відновив застосунок з пам'яті) — не пишемо на стару дату
  function staleDay(date) {
    if (date === todayISO()) return false;
    resetTimers();
    showMain();
    toast("Новий день — оновив екран, тисни ще раз");
    return true;
  }

  // Єдине місце, де підхід потрапляє в журнал. r === null — скасувати підхід.
  // Новий підхід бере вагу з поля «зараз»; правка зробленого — з opts.w (поле в picker) і зберігає старий t.
  function recordSet(ex, date, i, r, t, opts) {
    if (staleDay(date)) return;
    const loc = locate(ex.id);
    const next = loc ? loc.partner : null;
    // підхід, зупинений «Стоп»: відпочинок уже запустив stopWork, навіть якщо вікно закрили й записали з квадратика
    const fromPending = opts.isNew && r != null && pendingTimeFor(ex.id, i) != null;
    if (r == null) setSet(ex.id, date, i, null);
    else if (opts.isNew) {
      // вага з поля «зараз»; картки на екрані немає (інший день, перезапуск) — та сама підказка: чернетка → перенос → пропозиція
      const inp = ex.load !== "none" ? $(`.ex-card[data-ex="${ex.id}"] .w-input`) : null;
      const raw = inp ? parseNum(inp.value) : ex.load !== "none" ? weightHint(ex, i).value : null;
      const w = raw != null && raw >= 0 && raw <= 2000 ? raw : null;
      setSet(ex.id, date, i, { w, r, t });
      upsert(ex.id, date, { draft: undefined });
    } else {
      const old = getEntry(ex.id, date);
      const prev = old ? old.sets[i] : null;
      setSet(ex.id, date, i, { w: opts.w !== undefined ? opts.w : (prev ? prev.w : null), r, t: prev ? prev.t : null });
    }
    if (opts.isNew && r != null) {
      if (pendingTimeFor(ex.id, i) != null) timers.pending = null;
      // підхід записано, поки на ньому йде секундомір — секундомір уже нічого не міряє
      if (timers.work && timers.work.exId === ex.id && timers.work.i === i) timers.work = null;
      saveTimers();
      ensureSession();
      touchSession(loc ? loc.day.id : selectedDay);
    }
    rerenderCard(ex.id);
    if (opts.isNew && r != null) {
      if (navigator.vibrate) navigator.vibrate(20);
      // відпочинок звідси — лише для підходу без «Старт» і не посеред іншого підходу
      if (!opts.restStarted && !fromPending && !timers.work) {
        const plan = restPlan(ex, i, next, date);
        if (plan) startRest(plan.sec, plan.label);
      }
      renderTimers();
      if (ex.unit === "reps" && ex.hi != null && r < ex.lo) {
        toast(ex.load === "assist" ? "Менше за нижню межу — наступного разу додай допомоги"
          : ex.load === "none" ? "Менше за нижню межу цілі"
          : "Менше за нижню межу — наступного разу зменш вагу");
      }
    }
    updateDayProgress();
  }

  // відпочинок після підходу i, рахуючи, ніби його вже записано; null — відпочинку немає
  function restPlan(ex, i, next, date) {
    const lastSet = i === chipCount(ex, getEntry(ex.id, date)) - 1;
    const nextDone = next && isExDone(next, getEntry(next.id, date));
    if (next && !(lastSet && nextDone)) return { sec: ex.restSec, label: `Далі ${next.code} · ${next.name}` };
    if (!lastSet) return ex.restSec ? { sec: ex.restSec, label: `Відпочинок · ${ex.name}` } : null;
    // останній підхід вправи — відпочинок перед наступною невиконаною вправою дня
    const up = nextUndone(ex, next, date);
    return up ? { sec: ex.restSec || 90, label: `Далі ${up.code} · ${up.name}` } : null;
  }

  function nextUndone(ex, partner, date) {
    const loc = locate(ex.id);
    if (!loc) return null;
    const list = dayExercises(loc.day);
    const from = list.findIndex((x) => x.id === ex.id);
    const order = list.slice(from + 1).concat(list.slice(0, from));
    return order.find((x) => x.id !== ex.id && (!partner || x.id !== partner.id) && !isExDone(x, getEntry(x.id, date))) || null;
  }

  // ---------- reps picker ----------
  // для вправ на час підказуємо виміряний секундоміром час (до 5 с), інакше — ціль / минулий раз
  function suggestedValue(ex, i) {
    const t = ex.unit === "sec" ? pendingTimeFor(ex.id, i) : null;
    return t != null ? Math.max(5, Z.round5(t)) : defaultValue(ex, i);
  }

  // другий дотик подвійного тапу не має влучити в щойно відкрите вікно
  let pickerOpenedAt = 0;
  const pickerFresh = () => Date.now() - pickerOpenedAt < 400;

  // editSet — зроблений підхід, який правимо: зверху поле «Вага», onPick(r, w) отримує нову вагу
  function openPicker(ex, i, current, suggested, onPick, editSet) {
    const overlay = $("#pickerOverlay");
    pickerOpenedAt = Date.now();
    const fromTime = ex.unit === "sec" && current == null && pendingTimeFor(ex.id, i) != null;
    let values = [];
    if (ex.unit === "sec") for (let s = 10; s <= 90; s += 5) values.push(s);
    else if (ex.unit === "m") values = [10, 20, 30, 40, 50, 60];
    else {
      const lo = ex.lo != null ? Math.max(1, ex.lo - 5) : 1;
      const hi = ex.hi != null ? ex.hi + 4 : 20;
      for (let r = lo; r <= hi; r++) values.push(r);
    }
    if (suggested != null && !values.includes(suggested)) values.push(suggested);
    if (current != null && !values.includes(current)) values.push(current);
    values.sort((a, b) => a - b);
    const unitWord = { reps: "повторів", sec: "секунд", m: "метрів" }[ex.unit];
    const quick = current == null && suggested != null
      ? `<button class="picker-quick" data-v="${suggested}">✓ ${suggested} ${UNIT_LABEL[ex.unit]}${ex.lo != null && !fromTime ? " — як у цілі" : ""}</button>`
      : "";
    $("#pickerContent").innerHTML = `
      <div class="picker-title">Підхід ${i + 1} · скільки ${unitWord} зробив?</div>
      <div class="picker-rest hidden" id="pickerRest"></div>
      <div class="picker-sub">${ex.name} · ціль ${targetTxt(ex)}</div>
      ${editSet && ex.load !== "none" ? `<label class="picker-w"><small>Вага, ${ex.load === "assist" ? "lb допомоги" : "lb"}</small><input id="pickW" class="w-input" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="—" value="${fmtW(editSet.w)}"></label>` : ""}
      ${quick}
      <div class="picker-grid">${values.map((v) => {
        const inRange = ex.lo != null && v >= ex.lo && v <= ex.hi;
        return `<button data-v="${v}" class="${v === current ? "cur" : ""}${v === suggested && current == null ? " sug" : ""}${inRange ? " ok" : ""}">${v}</button>`;
      }).join("")}</div>
      ${current != null ? `<button class="picker-clear">Скасувати підхід</button>` : ""}
    `;
    overlay.classList.remove("hidden");
    renderTimers();
    $all(".picker-grid button, .picker-quick", overlay).forEach((b) => {
      b.onclick = () => {
        if (pickerFresh()) return;
        let w;
        const wi = $("#pickW", overlay);
        if (editSet) {
          w = editSet.w;
          if (wi) {
            const raw = wi.value.trim();
            const v = raw === "" ? null : parseNum(raw);
            if (raw === "" || (v != null && v >= 0 && v <= 2000)) w = v;
            else toast(WEIGHT_ERR);
          }
        }
        closeOverlay("pickerOverlay");
        onPick(parseInt(b.dataset.v, 10), w);
      };
    });
    const pw = $("#pickW", overlay);
    if (pw) pw.addEventListener("focus", () => selectAllSoon(pw));
    const clr = $(".picker-clear", overlay);
    if (clr) clr.onclick = () => { if (pickerFresh()) return; closeOverlay("pickerOverlay"); onPick(null); };
  }

  // ---------- timers: work stopwatch + rest ----------
  // Час рахуємо від годинника, а не тиками: після блокування екрана таймери показують правду.
  const timerBusy = () => !!(timers.work || timers.rest);
  // секундомір сесії на екрані «Сьогодні» теж потребує тика, навіть коли таймерів підходу немає
  const clockWanted = () => !!(profile && $("#sessClock") && !$("#main").classList.contains("hidden"));
  function saveTimers() { if (profile) lsSet(timerKey(profile), timers); }
  function resetTimers() {
    timers = { work: null, rest: null, pending: null };
    saveTimers();
    renderTimers();
  }
  // Перезавантаження лише непомітно: застосунок сховано, або ще при запуску — без таймерів, вікон і поля у фокусі.
  const overlayOpen = () => $all(".sheet-overlay").some((o) => !o.classList.contains("hidden"));
  const inputFocused = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
  function maybeReload() {
    if (!pendingReload) return;
    if (document.hidden) {
      blurInside(document.body); // вписана вага зберігається як чернетка
      location.reload();
      return;
    }
    if (!touched && !timerBusy() && !overlayOpen() && !inputFocused()) location.reload();
  }

  // після перезапуску: підхід — лише сьогоднішній і молодший за 20 хв, відпочинок — лише незакінчений
  function restoreTimers() {
    const s = lsGet(timerKey(profile), null) || {};
    const now = Date.now();
    const num = (v) => typeof v === "number" && isFinite(v);
    const w = s.work, r = s.rest, p = s.pending;
    timers = {
      work: w && num(w.startAt) && num(w.i) && locate(w.exId) && iso(new Date(w.startAt)) === todayISO()
        && now - w.startAt < 20 * 60000 ? { exId: w.exId, i: w.i, startAt: w.startAt } : null,
      rest: r && num(r.endAt) && num(r.total) && r.endAt > now ? { endAt: r.endAt, total: r.total, label: String(r.label || "") } : null,
      pending: p && num(p.i) && num(p.t) && isTodayAt(p.at) && locate(p.exId) && !((getEntry(p.exId, todayISO()) || { sets: [] }).sets[p.i])
        ? { exId: p.exId, i: p.i, t: p.t, at: p.at } : null
    };
    saveTimers();
    renderTimers();
  }

  const workElapsed = () => Math.floor((Date.now() - timers.work.startAt) / 1000);
  const workStopText = () => `■ Стоп · ${Z.fmtClock(workElapsed())}`;
  const restRemaining = () => Math.max(0, Math.ceil((timers.rest.endAt - Date.now()) / 1000));

  function startWork(ex, i, date) {
    if (staleDay(date || todayISO())) return;
    const prev = timers.work;
    ensureSession();
    // інший секундомір замінюємо без запису
    timers.work = { exId: ex.id, i, startAt: Date.now() };
    timers.pending = null;
    if (timers.rest) finishRest(false);
    saveTimers();
    if (prev && prev.exId !== ex.id) rerenderCard(prev.exId);
    rerenderCard(ex.id);
    renderTimers();
  }

  function stopWork() {
    const w = timers.work;
    if (!w) return;
    // другий дотик подвійного тапу «Старт» влучає в «Стоп» на тому самому місці — ігноруємо
    if (Date.now() - w.startAt < 700) return;
    const loc = locate(w.exId);
    const date = iso(new Date(w.startAt));
    const t = Math.max(1, Math.round((Date.now() - w.startAt) / 1000));
    timers.work = null;
    if (!loc || staleDay(date)) { saveTimers(); renderTimers(); return; }
    const ex = loc.ex, i = w.i;
    timers.pending = { exId: ex.id, i, t, at: Date.now() };
    const plan = restPlan(ex, i, loc.partner, date);
    if (plan) startRest(plan.sec, plan.label);
    saveTimers();
    renderTimers();
    rerenderCard(ex.id);
    openPicker(ex, i, null, suggestedValue(ex, i), (r) => recordSet(ex, date, i, r, t, { isNew: true, restStarted: true }));
  }

  function startRest(sec, label) {
    timers.rest = { endAt: Date.now() + sec * 1000, total: sec, label };
    saveTimers();
    renderTimers();
  }
  function tickTimers() {
    if (timers.rest && restRemaining() <= 0) finishRest(true);
    else renderTimers();
  }
  // смуга внизу (секундомір має пріоритет), кнопка «Стоп» на картці, рядок у вікні повторів; один інтервал на все
  function renderTimers() {
    const w = timers.work, r = timers.rest;
    const bar = $("#restBar");
    bar.classList.toggle("hidden", !w && !r);
    bar.classList.toggle("work", !!w);
    document.body.classList.toggle("resting", !!(w || r));
    $("#workActions").classList.toggle("hidden", !w);
    $("#restActions").classList.toggle("hidden", !!w);
    $("#restProgress").classList.toggle("hidden", !!w);
    const left = r ? restRemaining() : 0;
    if (w) {
      const loc = locate(w.exId);
      $("#restLabel").textContent = `Підхід ${w.i + 1} · ${loc ? loc.ex.name : ""}`;
      $("#restTime").textContent = Z.fmtClock(workElapsed());
      $all(".start-set.stop").forEach((b) => { b.textContent = workStopText(); });
    } else if (r) {
      $("#restLabel").textContent = r.label;
      $("#restTime").textContent = Z.fmtClock(left);
      $("#restProgress").style.width = Math.max(0, r.total ? (left / r.total) * 100 : 0) + "%";
    }
    const pr = $("#pickerRest");
    if (pr) {
      pr.classList.toggle("hidden", !r);
      pr.textContent = r ? `Відпочинок · ${Z.fmtClock(left)}` : "";
    }
    updateSessClock();
    const wantTick = timerBusy() || clockWanted();
    if (wantTick && !tickId) tickId = setInterval(tickTimers, 250);
    if (!wantTick && tickId) { clearInterval(tickId); tickId = null; }
  }
  function finishRest(natural) {
    if (!timers.rest) return;
    // відпочинок скінчився давно (екран був заблокований) — запізнілий сигнал лише плутає
    const late = Date.now() - timers.rest.endAt > 5000;
    timers.rest = null;
    saveTimers();
    renderTimers();
    if (natural && !late) {
      beep();
      if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
    }
  }
  function adjustRest(delta) {
    if (!timers.rest) return;
    timers.rest.endAt = Math.max(Date.now(), timers.rest.endAt + delta * 1000);
    timers.rest.total = Math.max(timers.rest.total, restRemaining());
    saveTimers();
    tickTimers();
  }

  // iPhone не вібрує з браузера, тож кінець відпочинку — коротким сигналом.
  // Звук дозволяється лише після дотику, тому «будимо» його на кожному натисканні.
  function unlockAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      // "suspended" або "interrupted" (після блокування екрана)
      if (audioCtx.state !== "running") { const p = audioCtx.resume(); if (p && p.catch) p.catch(() => {}); }
    } catch (e) {}
  }
  function beep() {
    if (!audioCtx || document.hidden) return;
    try {
      const t = audioCtx.currentTime;
      [0, 0.28].forEach((off) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t + off);
        g.gain.exponentialRampToValueAtTime(0.5, t + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.2);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(t + off);
        o.stop(t + off + 0.22);
      });
    } catch (e) {}
  }

  // ---------- session: час усього тренування ----------
  // Сесія дня — лише запис із ключем сьогоднішньої дати; вчорашня незавершена сьогоднішній годинник не заводить.
  const todaySession = () => { const s = getSessions()[todayISO()]; return s && typeof s.start === "number" ? s : null; };
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtHM = (ms) => { const d = new Date(ms); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
  const fmtMin = (ms) => Math.round(ms / 60000) + " хв";

  function ensureSession() {
    const all = getSessions();
    const date = todayISO();
    const s = all[date];
    if (!s || typeof s.start !== "number") all[date] = { start: Date.now(), end: null, last: null, day: selectedDay };
    else if (s.end != null) s.end = null; // тренування продовжено
    else return;
    saveSessions(all);
    refreshSessionUI();
  }

  // dayId — день програми, на якому записано підхід: за ним showMain відкриває вкладку після перезапуску
  function touchSession(dayId) {
    const all = getSessions();
    const s = all[todayISO()];
    if (!s) return;
    s.last = Date.now();
    if (dayId) s.day = dayId;
    saveSessions(all);
  }

  // auto — тренування закрилось само (всі вправи зроблено)
  function finishSession(auto) {
    const all = getSessions();
    const s = all[todayISO()];
    if (!s || s.end != null) {
      if (auto) toast("Тренування завершено! Шейк і сніданок 🥤");
      return;
    }
    // секундомір підходу зупиняємо без запису, відпочинок — без сигналу
    const w = timers.work;
    timers.work = null;
    timers.pending = null;
    saveTimers();
    if (w) rerenderCard(w.exId);
    finishRest(false);
    // жодного записаного підходу — тренування не було, рядок «0 хв» в історії не потрібен
    if (s.last == null) {
      delete all[todayISO()];
      saveSessions(all);
      refreshSessionUI();
      renderTimers();
      toast("Тренування скасовано");
      return;
    }
    s.end = Date.now();
    saveSessions(all);
    refreshSessionUI();
    renderTimers();
    const dur = fmtMin(Z.sessionMs(s));
    toast(auto ? `Тренування завершено: ${dur}. Шейк і сніданок 🥤` : `Тренування: ${dur}`);
  }

  // чип з годинником, картка завершеного тренування й кнопка «Завершити» — залежно від сесії за сьогодні
  function refreshSessionUI() {
    ["sessClock", "sessCard", "sessFinish"].forEach((id) => { const e = $("#" + id); if (e) e.remove(); });
    const content = $("#dayContent");
    const meta = $(".day-meta", content);
    if (!meta) return;
    const s = todaySession();
    if (s && s.end == null) {
      const chip = document.createElement("span");
      chip.className = "chip clock";
      chip.id = "sessClock";
      chip.dataset.start = String(s.start);
      meta.appendChild(chip);
      const btn = document.createElement("button");
      btn.className = "primary-btn";
      btn.id = "sessFinish";
      btn.textContent = "Завершити тренування";
      btn.onclick = () => finishSession(false);
      content.appendChild(btn);
    } else if (s) {
      const card = document.createElement("div");
      card.className = "note-card sess-card";
      card.id = "sessCard";
      card.textContent = `Тренування: ${fmtHM(s.start)}–${fmtHM(s.end)} · ${fmtMin(Z.sessionMs(s))}`;
      meta.parentNode.after(card);
    }
    updateSessClock();
    renderTimers();
  }

  function updateSessClock() {
    const el = $("#sessClock");
    if (!el) return;
    el.textContent = "⏱ " + Z.fmtClock((Date.now() - Number(el.dataset.start)) / 1000);
  }

  // Повернулись у застосунок: оновити таймер, а якщо настав новий день — перемалювати.
  function onResume() {
    if (document.hidden) return;
    if (timerBusy()) tickTimers();
    if (P && profile && P[profile] && renderedDate && renderedDate !== todayISO()) {
      resetTimers();
      if (currentTab === "today") showMain();
      else { renderedDate = todayISO(); showTab(currentTab); }
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
    }
  }

  // ---------- exercise sheet ----------
  // «50 lb × 10 / 9 / 8» або, коли вага різна, «50×10 · 55×9 · 60×8»
  function histSets(e, unit) {
    const d = Z.doneSets(e);
    const ws = d.map((s) => s.w);
    if (ws.every((w) => w == null)) return d.map((s) => s.r).join(" / ");
    if (ws.every((w) => w === ws[0])) return `${fmtW(ws[0])} ${unit} × ${d.map((s) => s.r).join(" / ")}`;
    return d.map((s) => (s.w != null ? fmtW(s.w) + "×" : "") + s.r).join(" · ");
  }
  function openExerciseSheet(ex) {
    const goalUnit = ex.unit === "sec" ? "секунд" : ex.unit === "m" ? "метрів" : "повторів";
    const goalHtml = ex.unit === "done" ? "" : `
      <div class="section-title">Ціль</div>
      <div class="goal-row">
        <label>Підходи<input id="goalN" type="text" inputmode="numeric" enterkeyhint="done"></label>
        ${ex.lo == null ? "" : `<label>від (${goalUnit})<input id="goalLo" type="text" inputmode="numeric" enterkeyhint="done"></label>
        <label>до (${goalUnit})<input id="goalHi" type="text" inputmode="numeric" enterkeyhint="done"></label>`}
      </div>
      <button id="goalReset" class="link-btn hidden"></button>`;
    const h = history(ex.id).slice(-8).reverse();
    const unit = ex.load === "assist" ? "lb доп." : "lb";
    const hist = h.length
      ? `<div class="section-title">Журнал</div><div class="hist-table">${h.map((e) => `
          <div class="hrow"><span>${fmtDate(e.date)}${e.deload ? " <i>deload</i>" : ""}</span>
          <span class="reps">${ex.unit === "done" ? "✓" : histSets(e, unit)}</span></div>`).join("")}</div>`
      : "";
    $("#sheetContent").innerHTML = `
      <img src="${ex.img}" alt="">
      <h2><span class="ex-code">${ex.code}</span>${ex.name}</h2>
      <div class="sheet-sets">${ex.sets}${ex.note ? ` · <span>${ex.note}</span>` : ""}</div>
      ${goalHtml}
      <ul class="cues">${ex.cues.map((c) => `<li>${c}</li>`).join("")}</ul>
      ${ex.prio ? `<div class="note-card">Останній підхід — до відмови або за 1 повтор до неї.</div>` : ""}
      ${ex.base ? `<div class="note-card">Базова вправа — ніколи до відмови. Крок прогресії +${ex.step} lb.</div>` : ""}
      ${hist}
      <button class="close-sheet" id="closeSheetBtn">Закрити</button>
    `;
    $("#sheetOverlay").classList.remove("hidden");
    $("#sheet").scrollTop = 0;
    $("#closeSheetBtn").onclick = () => closeOverlay("sheetOverlay");
    if (ex.unit !== "done") wireGoal(ex);
  }

  // редагування цілі: поля, збереження в плані, оновлення листа й карток
  function wireGoal(ex0) {
    const id = ex0.id;
    const fN = $("#goalN"), fLo = $("#goalLo"), fHi = $("#goalHi"), reset = $("#goalReset");
    const cur = () => { const l = locate(id); return l ? l.ex : ex0; };
    function fill() {
      const ex = cur();
      fN.value = ex.n;
      if (fLo) { fLo.value = ex.lo; fHi.value = ex.hi; }
      const sets = $("#sheetContent .sheet-sets");
      if (sets) sets.innerHTML = `${ex.sets}${ex.note ? ` · <span>${ex.note}</span>` : ""}`;
      const has = !!getPlan()[id];
      reset.classList.toggle("hidden", !has);
      const raw = rawEx(id);
      reset.textContent = `Як у програмі (${Z.setsLabel(raw)})`;
    }
    function refresh() { fill(); renderDay(); }
    function commit() {
      const ex = cur(), raw = rawEx(id);
      const num = (f, d) => { const v = parseInt(f.value, 10); return isFinite(v) ? v : d; };
      const eff = Z.applyPlan(raw, { n: num(fN, ex.n), lo: fLo ? num(fLo, ex.lo) : undefined, hi: fHi ? num(fHi, ex.hi) : undefined });
      const ov = {};
      if (eff.n !== raw.n) ov.n = eff.n;
      if (raw.lo != null) {
        if (eff.lo !== raw.lo) ov.lo = eff.lo;
        if (eff.hi !== raw.hi) ov.hi = eff.hi;
      }
      const plan = getPlan();
      if (Object.keys(ov).length) plan[id] = ov; else delete plan[id];
      if (!savePlan(plan)) { fill(); return; }
      invalidateProg();
      refresh();
    }
    [fN, fLo, fHi].forEach((f) => {
      if (!f) return;
      f.onfocus = () => selectAllSoon(f);
      f.onkeydown = (e) => { if (e.key === "Enter") f.blur(); };
      f.onchange = commit;
    });
    reset.onclick = () => {
      const plan = getPlan();
      delete plan[id];
      if (!savePlan(plan)) return;
      invalidateProg();
      refresh();
    };
    fill();
  }

  // ---------- settings ----------
  function openSettings() {
    const overlay = $("#settingsOverlay");
    const meta = getMeta();
    $("#settingsContent").innerHTML = `
      <div class="section-title">Профіль</div>
      <div class="settings-row"><span>${prog().name}</span><button id="switchProfileBtn">Змінити</button></div>
      <div class="settings-row"><span>Старт програми (понеділок)</span><input id="startDateInput" type="date" value="${esc(meta.startDate)}"></div>
      <div class="settings-row"><span>Тиждень · цикл</span><span id="weekCycle">${weekNumber()} · ${cycleNo()}</span></div>
      <div class="section-title">Резервна копія</div>
      <div class="settings-row"><span>Зберегти журнал у файл</span><button id="exportBtn">Експорт</button></div>
      <div class="settings-row"><span>Відновити з файлу</span><button id="importBtn">Імпорт</button></div>
      <input type="file" id="importFile" accept="application/json,.json" class="hidden">
      <div class="settings-row"><span>Очистити журнал профілю</span><button class="danger" id="clearBtn">Очистити</button></div>
      <button class="close-sheet" id="closeSettingsBtn">Закрити</button>
    `;
    overlay.classList.remove("hidden");
    $("#switchProfileBtn").onclick = () => {
      closeOverlay("settingsOverlay");
      resetTimers();
      localStorage.removeItem("wa2_profile");
      profile = null;
      showOnboard();
    };
    $("#startDateInput").onchange = (e) => {
      if (!isISO(e.target.value)) return;
      const mon = mondayOf(new Date(e.target.value + "T00:00:00"));
      saveMeta({ startDate: mon });
      if (mon !== e.target.value) { e.target.value = mon; toast(`Старт — завжди понеділок: ${fmtDate(mon)}`); }
      $("#weekCycle").textContent = `${weekNumber()} · ${cycleNo()}`;
      renderBanner();
      renderDay();
    };
    $("#exportBtn").onclick = () => {
      const payload = { app: "veeter", v: 3, profile, meta: getMeta(), log: getLog(), body: getBody(), sessions: getSessions(), plan: getPlan() };
      const name = `veeter-${profile}-${todayISO()}.json`;
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      // на iPhone надійніше через «Поділитися» → «Зберегти у Файли»
      try {
        const file = new File([blob], name, { type: "application/json" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: name }).catch(() => {});
          return;
        }
      } catch (err) {}
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    $("#importBtn").onclick = () => $("#importFile").click();
    $("#importFile").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((t) => {
        let d;
        try { d = JSON.parse(t); } catch (err) { toast("Файл не схожий на копію журналу"); return; }
        const ok = d && d.app === "veeter";
        let log = null, sessions = null, plan = null;
        if (ok && d.v === 3) {
          log = Z.cleanLogV3(d.log);
          sessions = Z.cleanSessions(d.sessions);
          plan = Z.cleanPlan(d.plan);
        } else if (ok && d.v === undefined) {
          const old = cleanLogV2(d.log);
          log = old ? Z.migrateLogV2(old) : null;
          sessions = {};
          plan = {};
        }
        const body = log && sessions && plan ? cleanBody(d.body) : null;
        if (!log || !sessions || !plan || !body) { toast("Файл не схожий на копію журналу"); return; }
        if (d.profile !== profile && !confirm(`Це копія профілю «${(P[d.profile] || {}).name || d.profile}». Завантажити в «${prog().name}»?`)) return;
        if (!confirm("Замінити поточний журнал даними з файлу?")) return;
        saveLog(log);
        saveBody(body);
        if (d.v === 3) {
          saveSessions(sessions);
          lsSet(planKey(profile), plan);
          invalidateProg();
        }
        if (d.meta && isISO(d.meta.startDate)) saveMeta({ startDate: mondayOf(new Date(d.meta.startDate + "T00:00:00")) });
        closeOverlay("settingsOverlay");
        showMain();
        toast("Журнал відновлено");
      });
    };
    $("#clearBtn").onclick = () => {
      if (confirm("Видалити весь журнал і заміри цього профілю? Спершу зроби експорт, якщо потрібна копія.")) {
        // wa3_plan_ (ціль) і wa2_log_ (стара копія) не чіпаємо
        // порожній v3-журнал (не видалений ключ), інакше ensureMigrated підтягне стару копію wa2 назад
        lsSet(logKey(profile), {});
        localStorage.removeItem(sessKey(profile));
        resetTimers();
        localStorage.removeItem(bodyKey(profile));
        closeOverlay("settingsOverlay");
        renderDay();
        toast("Журнал очищено");
      }
    };
    $("#closeSettingsBtn").onclick = () => closeOverlay("settingsOverlay");
  }

  // Пропускаємо в журнал лише числа й дати потрібного формату — зламаний файл нічого не зламає.
  function cleanLogV2(log) {
    if (!log || typeof log !== "object" || Array.isArray(log)) return null;
    const out = {};
    for (const [id, arr] of Object.entries(log)) {
      if (!Array.isArray(arr)) return null;
      out[id] = arr
        .filter((e) => e && isISO(e.date) && isNumOrNull(e.weight) && Array.isArray(e.reps) && e.reps.every(isNumOrNull))
        .map((e) => ({ date: e.date, weight: e.weight == null ? null : e.weight, reps: e.reps.map((r) => (r == null ? null : r)), deload: !!e.deload }));
    }
    return out;
  }
  function cleanBody(body) {
    if (body == null) return [];
    if (!Array.isArray(body)) return null;
    return body
      .filter((e) => e && isISO(e.date) && isNumOrNull(e.weight) && isNumOrNull(e.waist) && isNumOrNull(e.hips))
      .map((e) => {
        const o = { date: e.date };
        ["weight", "waist", "hips"].forEach((k) => { if (e[k] != null) o[k] = e[k]; });
        return o;
      });
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- progress ----------
  function renderProgress() {
    const content = $("#progressContent");
    const log = getLog();
    const dates = new Set();
    Object.values(log).forEach((arr) => Array.isArray(arr) && arr.forEach((e) => { if (e && Z.doneSets(e).length) dates.add(e.date); }));
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
    renderSessionHistory(content);
  }

  // останні 10 тренувань: дата, години, тривалість; без тривалості й сьогоднішнє незавершене — пропускаємо
  function renderSessionHistory(content) {
    const all = getSessions();
    const today = todayISO();
    const rows = Object.keys(all).sort().reverse()
      .filter((d) => isISO(d) && all[d] && typeof all[d].start === "number" && Z.sessionMs(all[d]) != null && !(d === today && all[d].end == null))
      .slice(0, 10);
    if (!rows.length) return;
    const t = document.createElement("div");
    t.className = "section-title";
    t.textContent = "Історія тренувань";
    content.appendChild(t);
    const table = document.createElement("div");
    table.className = "hist-table";
    table.innerHTML = rows.map((d) => {
      const s = all[d];
      return `<div class="hrow"><span>${fmtDate(d)}</span><span>${fmtHM(s.start)}–${fmtHM(s.end != null ? s.end : s.last)}</span><span class="reps">${fmtMin(Z.sessionMs(s))}</span></div>`;
    }).join("");
    content.appendChild(table);
  }

  function progressCard(ex) {
    const all = history(ex.id);
    const work = all.filter((e) => !e.deload);
    const h = work.length ? work : all;
    const tw = (e) => Z.topWeight(e, ex.load);
    const useWeight = ex.load !== "none" && h.some((e) => tw(e) != null);
    const pts = useWeight
      ? h.filter((e) => tw(e) != null).map(tw)
      : h.map((e) => Math.max(0, ...Z.doneSets(e).map((s) => s.r)));
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
        <span>${fmtDate(h[0].date)} → ${fmtDate(lastE.date)} · ${Z.doneSets(lastE).map((s) => s.r).join("/")}</span>
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
    const field = (id, ph, label) => `<label class="body-field"><span>${label}</span><input id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="${esc(ph)}"></label>`;

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
      const num = (id) => { const el = $("#" + id); return el ? parseNum(el.value) : null; };
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
        <li>Впиши вагу у віконце “зараз”, тисни “Старт” і роби підхід. Закінчив — “Стоп”, вибери, скільки повторів вийшло. Відпочинок стартує сам.</li>
        <li>“Старт” можна пропустити: тисни на квадратик підходу й запиши повтори.</li>
        <li>“Минулого разу” показує той самий підхід минулого тренування.</li>
        <li>Ціль (підходи й повтори) міняється в картці вправи — тисни на назву.</li>
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
    renderTimers();
  }

  // Єдиний спосіб закрити вікно (кнопка, фон, свайп, дії всередині)
  function closeOverlay(id) {
    const ov = $("#" + id);
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
    ov.classList.add("hidden");
    const sh = $(".sheet", ov);
    if (sh) { sh.classList.remove("dragging"); sh.style.transform = ""; }
  }

  // Закриття вікна свайпом униз (лише touch)
  function enableSheetSwipe(id) {
    const ov = $("#" + id);
    const sh = $(".sheet", ov);
    let tid = null, startY = 0, startX = 0, dy = 0, state = "idle"; // idle | pending | drag | off
    const find = (list) => { for (const t of list) if (t.identifier === tid) return t; return null; };
    const reset = () => {
      tid = null; dy = 0; state = "idle";
      sh.classList.remove("dragging");
      sh.style.transform = "";
    };
    sh.addEventListener("touchstart", (e) => {
      if (tid !== null) return; // додаткові пальці ігноруємо
      const t = e.changedTouches[0];
      const onHandle = !!e.target.closest(".sheet-handle");
      if (!onHandle) {
        if (e.target.closest("input, textarea, select, button, canvas, a")) return;
        if (sh.scrollTop > 0) return;
      }
      tid = t.identifier; startY = t.clientY; startX = t.clientX; dy = 0; state = "pending";
    }, { passive: true });
    sh.addEventListener("touchmove", (e) => {
      if (state === "idle" || state === "off") return;
      const t = find(e.changedTouches);
      if (!t) return;
      const mx = t.clientX - startX;
      dy = t.clientY - startY;
      if (state === "pending") {
        if (Math.abs(dy) < 8 && Math.abs(mx) < 8) return;
        if (dy <= 0 || Math.abs(mx) > Math.abs(dy)) { state = "off"; return; }
        state = "drag";
        sh.classList.add("dragging");
      }
      if (dy < 0) dy = 0;
      sh.style.transform = "translateY(" + dy + "px)";
      e.preventDefault();
    }, { passive: false });
    const end = (e, allowClose) => {
      if (tid === null || !find(e.changedTouches)) return;
      const close = allowClose && state === "drag" && dy > 90;
      reset();
      if (close) closeOverlay(id);
    };
    sh.addEventListener("touchend", (e) => end(e, true));
    sh.addEventListener("touchcancel", (e) => end(e, false));
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
      $("#" + id).addEventListener("click", (e) => {
        if (e.target.id !== id) return;
        if (id === "pickerOverlay" && pickerFresh()) return;
        closeOverlay(id);
      });
      enableSheetSwipe(id);
    });
    // WebKit дозволяє звук лише з touchend / click, pointerdown — на інших пристроях
    ["pointerdown", "touchend", "click"].forEach((t) => document.addEventListener(t, unlockAudio, { passive: true }));
    ["pointerdown", "keydown"].forEach((t) => document.addEventListener(t, () => { touched = true; }, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", () => { if (document.hidden) maybeReload(); });
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("focus", onResume);
    $("#restSkip").onclick = () => finishRest(false);
    $("#workStop").onclick = stopWork;
    $("#restPlus").onclick = () => adjustRest(15);
    $("#restMinus").onclick = () => adjustRest(-15);
  }

  init();
})();

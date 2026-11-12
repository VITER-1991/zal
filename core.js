(function (root) {
  "use strict";

  function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function numOrNull(x) { return isNum(x) ? x : null; }
  function validDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00").getTime());
  }

  function cleanSet(s) {
    if (!isObj(s) || !isNum(s.r)) return null;
    return { w: numOrNull(s.w), r: s.r, t: numOrNull(s.t) };
  }

  function cleanEntry(e) {
    if (!isObj(e) || !validDate(e.date) || !Array.isArray(e.sets)) return null;
    var sets = e.sets.map(cleanSet);
    while (sets.length && sets[sets.length - 1] === null) sets.pop();
    var hasDraft = isNum(e.draft);
    if (!sets.length && !hasDraft) return null;
    var out = { date: e.date, deload: !!e.deload, sets: sets };
    if (hasDraft) out.draft = e.draft;
    if (isNum(e.extra)) {
      var x = Math.min(10, Math.max(0, Math.floor(e.extra)));
      if (x > 0) out.extra = x;
    }
    return out;
  }

  function migrateLogV2(log2) {
    var out = {};
    if (!isObj(log2)) return out;
    Object.keys(log2).forEach(function (id) {
      if (!Array.isArray(log2[id])) return;
      out[id] = log2[id].map(function (e) {
        if (!isObj(e) || !Array.isArray(e.reps)) return null;
        var w = numOrNull(e.weight);
        return cleanEntry({
          date: e.date,
          deload: e.deload,
          sets: e.reps.map(function (r) { return isNum(r) ? { w: w, r: r, t: null } : null; })
        });
      }).filter(Boolean);
    });
    return out;
  }

  function cleanLogV3(log) {
    if (!isObj(log)) return null;
    var out = {};
    var ids = Object.keys(log);
    for (var i = 0; i < ids.length; i++) {
      if (!Array.isArray(log[ids[i]])) return null;
      out[ids[i]] = log[ids[i]].map(cleanEntry).filter(Boolean);
    }
    return out;
  }

  function cleanSessions(x) {
    if (x === undefined || x === null) return {};
    if (!isObj(x)) return null;
    var out = {};
    Object.keys(x).forEach(function (date) {
      var s = x[date];
      if (!validDate(date) || !isObj(s) || !isNum(s.start)) return;
      out[date] = { start: s.start, end: numOrNull(s.end), last: numOrNull(s.last), day: typeof s.day === "string" ? s.day : "" };
    });
    return out;
  }

  function cleanPlan(x) {
    if (x === undefined || x === null) return {};
    if (!isObj(x)) return null;
    var out = {};
    Object.keys(x).forEach(function (id) {
      if (!isObj(x[id])) return;
      var p = {};
      ["n", "lo", "hi"].forEach(function (k) { if (isNum(x[id][k])) p[k] = x[id][k]; });
      if (Object.keys(p).length) out[id] = p;
    });
    return out;
  }

  function doneSets(entry) {
    if (!entry || !Array.isArray(entry.sets)) return [];
    return entry.sets.filter(Boolean);
  }

  var FAILURE_ASSIST_TOP = 12;

  function round5(v) { return Math.round(v / 5) * 5; }

  function allTop(entry, ex) {
    if (!entry || !Array.isArray(entry.sets)) return false;
    var thr = ex.hi != null ? ex.hi : (ex.load === "assist" ? FAILURE_ASSIST_TOP : null);
    if (thr == null) return false;
    var first = entry.sets.slice(0, ex.n);
    if (first.length < ex.n) return false;
    for (var i = 0; i < first.length; i++) {
      if (!first[i] || first[i].r < thr) return false;
    }
    return true;
  }

  function topWeight(entry, load) {
    var ws = doneSets(entry).map(function (s) { return s.w; }).filter(isNum);
    if (!ws.length) return null;
    return load === "assist" ? Math.min.apply(null, ws) : Math.max.apply(null, ws);
  }

  function prevSet(last, i) {
    if (!last || !Array.isArray(last.sets)) return null;
    if (last.sets[i]) return last.sets[i];
    var d = doneSets(last);
    return d.length ? d[d.length - 1] : null;
  }

  function nextWeight(ex, i, today, last, ctx) {
    // draft: число — вписана вага; null — поле свідомо очистили; відсутня/undefined — чернетки немає
    if (today && (isNum(today.draft) || today.draft === null)) return { value: today.draft, up: false, why: "draft" };
    var done = doneSets(today);
    if (done.length) return { value: numOrNull(done[done.length - 1].w), up: false, why: "carry" };
    var base = prevSet(last, i);
    if (base == null || base.w == null) return { value: null, up: false, why: "first" };
    var assist = ex.load === "assist";
    if (ctx.deload) {
      var dl = assist ? Math.max(ex.step, round5(base.w * 1.4)) : round5(base.w * 0.6);
      if (!assist && dl === 0 && base.w > 0) dl = base.w; // легка вага: не пропонуємо 0
      return { value: dl, up: false, why: "deload" };
    }
    if (allTop(last, ex)) {
      if (assist && base.w <= 0) return { value: 0, up: true, why: "assist0" };
      if (ctx.week >= 3) {
        return { value: assist ? Math.max(0, base.w - ex.step) : base.w + ex.step, up: true, why: "up" };
      }
      return { value: base.w, up: true, why: "top" };
    }
    return { value: base.w, up: false, why: "same" };
  }

  function defaultReps(ex, i, last) {
    if (ex.unit === "m") return ex.hi;
    var s = last && Array.isArray(last.sets) ? last.sets[i] : null;
    if (s && ex.hi != null && s.r < ex.hi) return s.r;
    if (ex.hi != null) return ex.hi;
    return s ? s.r : null;
  }

  function setsLabel(ex) {
    if (ex.unit === "done") return "\u2014";
    if (ex.lo == null) return ex.n + "\u00d7 \u0434\u043e \u0432\u0456\u0434\u043c\u043e\u0432\u0438";
    var s = ex.n + "\u00d7" + (ex.lo === ex.hi ? ex.hi : ex.lo + "\u2013" + ex.hi);
    if (ex.unit === "sec") s += " \u0441";
    else if (ex.unit === "m") s += " \u043c";
    if (ex.per) s += " " + ex.per;
    return s;
  }

  function clampInt(v, lo, hi) { return Math.min(hi, Math.max(lo, Math.round(v))); }

  function applyPlan(ex, ov) {
    var out = {};
    Object.keys(ex).forEach(function (k) { out[k] = ex[k]; });
    if (ov) {
      if (isNum(ov.n)) out.n = clampInt(ov.n, 1, 10);
      if (ex.lo != null && ex.unit !== "done") {
        if (isNum(ov.lo)) out.lo = clampInt(ov.lo, 1, 999);
        if (isNum(ov.hi)) out.hi = clampInt(ov.hi, 1, 999);
        out.hi = Math.max(out.lo, out.hi);
      }
    }
    out.sets = setsLabel(out);
    return out;
  }

  function fmtClock(sec) {
    var t = Math.max(0, Math.floor(sec));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var ss = (s < 10 ? "0" : "") + s;
    if (h) return h + ":" + (m < 10 ? "0" : "") + m + ":" + ss;
    return m + ":" + ss;
  }

  function sessionMs(s) {
    if (!s) return null;
    var e = s.end != null ? s.end : s.last;
    return e == null ? null : e - s.start;
  }

  root.ZalCore = {
    migrateLogV2: migrateLogV2,
    cleanLogV3: cleanLogV3,
    cleanSessions: cleanSessions,
    cleanPlan: cleanPlan,
    doneSets: doneSets,
    FAILURE_ASSIST_TOP: FAILURE_ASSIST_TOP,
    round5: round5,
    allTop: allTop,
    topWeight: topWeight,
    prevSet: prevSet,
    nextWeight: nextWeight,
    defaultReps: defaultReps,
    applyPlan: applyPlan,
    setsLabel: setsLabel,
    fmtClock: fmtClock,
    sessionMs: sessionMs
  };
})(globalThis);

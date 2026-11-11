import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, updateDoc, deleteDoc, addDoc, collection, collectionGroup, query, where, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ownerEmail } from "./firebase-config.js";

/* ================= 共通の小道具 ================= */
const $ = (s) => document.getElementById(s);
const pad = (n) => String(n).padStart(2, "0");
const WD = "日月火水木金土";
const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const mkey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1);
const hhmm = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes());
const toMin = (t) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => { m = Math.max(0, Math.round(m)); return Math.floor(m / 60) + ":" + pad(m % 60); };
const days = (n) => (Math.round(n * 10) / 10) + "日";
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const firstOfMonth = (d) => { const x = new Date(d || Date.now()); x.setDate(1); x.setHours(0, 0, 0, 0); return x; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayLabel = (key) => { const [y, m, d] = key.split("-").map(Number); return m + "/" + pad(d) + "（" + WD[new Date(y, m - 1, d).getDay()] + "）"; };
const DASH = '<span class="dash">—</span>';

/* paid=有給日数, pay=給与対象として所定労働時間を加える日数, special=特別休暇日数, off=休暇・半休日数, full=終日休み（打刻不可） */
const TYPES = {
  "": { label: "", cls: "" },
  paid: { label: "有給", cls: "paid", paid: 1, pay: 1, full: true },
  paidHalf: { label: "有給（半日）", cls: "paid", paid: 0.5, pay: 0.5 },
  special: { label: "特別休暇", cls: "special", special: 1, pay: 1, full: true },
  off: { label: "休暇", cls: "off", off: 1, full: true },
  half: { label: "半休", cls: "off", off: 0.5 },
  comp: { label: "代休", cls: "comp", full: true },
  hw: { label: "休日出勤", cls: "hw" }
};
const T = (d) => TYPES[(d && d.type) || ""] || TYPES[""];

let toastTimer;
function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}
function show(view) {
  for (const id of ["bootView", "loginView", "pendingView", "appView"]) $(id).hidden = id !== view;
}

/* ================= 状態 ================= */
const S = {
  user: null, member: null, isAdmin: false,
  settings: { std: 480, otLimit: 2700 },
  my: {}, myGrant: null, myReq: [],
  members: {}, emps: {}, grants: {}, reqs: [],
  sView: firstOfMonth(), aView: firstOfMonth(),
  selected: null, route: "staff",
  unsubs: [], dataStartedFor: null
};

/* ================= 計算 ================= */
function breakMin(day, span) {
  if (typeof day.breakMin === "number") return day.breakMin;
  if (span == null) return 0;
  return span > 480 ? 60 : span > 360 ? 45 : 0; // 労基法34条の最低基準
}
function calc(day, isLive) {
  if (!day || !day.in) return null;
  const s = toMin(day.in);
  let e = day.out ? toMin(day.out) : (isLive ? nowMin() : null);
  if (e == null) return { work: null, br: 0, ot: null };
  if (e < s) e += 1440;
  const span = e - s, br = breakMin(day, span), work = Math.max(0, span - br);
  return { work, br, ot: Math.max(0, work - S.settings.std) };
}
const dayOf = (months, key) => ((months || {})[key.slice(0, 7)] || {})[key];
/* 今日の勤務：今日の記録。今日が未出勤で昨日が勤務中なら昨日（日またぎ勤務） */
function activeDay(months) {
  const t = new Date(), tk = ymd(t);
  const today = dayOf(months, tk);
  if (today && today.in) return { key: tk, day: today };
  const y = new Date(t); y.setDate(y.getDate() - 1);
  const yd = dayOf(months, ymd(y));
  if (yd && yd.in && !yd.out) return { key: ymd(y), day: yd };
  return { key: tk, day: today || null };
}
function statusOf(day) {
  const ty = day && day.type;
  if (day && day.in && !day.out) return { cls: "working", label: "勤務中", k: "work" };
  if (day && day.in && day.out) return { cls: "done", label: "退勤済", k: "done" };
  if (ty && ty !== "hw" && TYPES[ty]) return { cls: TYPES[ty].cls, label: TYPES[ty].label, k: "leave" };
  return { cls: "", label: "未出勤", k: "none" };
}
const leaveDays = (day) => T(day).paid || 0;
function monthTotals(months, view) {
  const data = (months || {})[mkey(view)] || {}, act = activeDay(months);
  const r = { days: 0, work: 0, ot: 0, paid: 0, comp: 0, hw: 0, special: 0, off: 0, pay: 0 };
  for (const key of Object.keys(data)) {
    const d = data[key], t = T(d), c = calc(d, key === act.key && !d.out);
    if (c && c.work != null) { r.days++; r.work += c.work; r.ot += c.ot; }
    r.paid += t.paid || 0; r.special += t.special || 0; r.off += t.off || 0; r.pay += t.pay || 0;
    if (d.type === "comp") r.comp++;
    if (d.type === "hw") r.hw++;
  }
  r.payable = r.work + r.pay * S.settings.std;
  return r;
}
function longTotals(months, year) {
  let paidYear = 0, hw = 0, comp = 0;
  for (const mk of Object.keys(months || {})) for (const key of Object.keys(months[mk] || {})) {
    const d = months[mk][key];
    if (key.slice(0, 4) === String(year)) paidYear += leaveDays(d);
    if (d.type === "hw") hw++;
    if (d.type === "comp") comp++;
  }
  return { paidYear, compLeft: hw - comp };
}
/* 有給残 = 付与日数 + 繰越日数 − 付与日以降に取った有給（半日は0.5） */
function paidRemain(months, g) {
  if (!g || !g.date) return null;
  let used = 0;
  for (const mk of Object.keys(months || {})) for (const key of Object.keys(months[mk] || {})) if (key >= g.date) used += leaveDays(months[mk][key]);
  const total = (Number(g.days) || 0) + (Number(g.carry) || 0);
  return { total, used, remain: total - used };
}
function describe(w) {
  if (!w) return "";
  const parts = [T(w).label || "通常勤務"];
  if (w.in || w.out) parts.push((w.in || "--:--") + "〜" + (w.out || "--:--"));
  if (typeof w.breakMin === "number") parts.push("休憩" + w.breakMin + "分");
  if (w.note) parts.push("メモ：" + w.note);
  return parts.join("　");
}

/* ================= Firebase ================= */
const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("YOUR_");
let app, auth, db;
if (!configured) {
  $("bootMsg").textContent = "Firebase の設定がまだです。public/firebase-config.js に Firebase プロジェクトの値を入れてから、もう一度開いてください。";
} else {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  getRedirectResult(auth).catch((e) => showLoginError(e));
  onAuthStateChanged(auth, onUser);
}

const isOwnerUser = (u) => !!u && !!u.email && u.email.toLowerCase() === String(ownerEmail).toLowerCase() && u.emailVerified;
const cutoff = () => (new Date().getFullYear() - 2) + "-01-01";

function stopAll() { S.unsubs.forEach((u) => { try { u(); } catch (e) {} }); S.unsubs = []; S.dataStartedFor = null; }
function watch(ref, next, label) {
  const u = onSnapshot(ref, next, (err) => {
    console.error(label, err);
    toast(label + "を読み込めませんでした（" + (err.code || "error") + "）");
  });
  S.unsubs.push(u);
}

let memberUnsub = null;
function onUser(user) {
  stopAll();
  if (memberUnsub) { memberUnsub(); memberUnsub = null; }
  S.user = user; S.member = null; S.isAdmin = false;
  if (!user) { show("loginView"); return; }
  show("bootView"); $("bootMsg").textContent = "アカウントを確認しています…";
  const ref = doc(db, "members", user.uid);
  let creating = false;
  memberUnsub = onSnapshot(ref, async (snap) => {
    if (!snap.exists()) {
      if (creating || snap.metadata.fromCache) return;
      creating = true;
      const owner = isOwnerUser(user);
      try {
        await setDoc(ref, {
          name: user.displayName || (user.email || "").split("@")[0] || "名前未設定",
          email: user.email || "",
          role: owner ? "admin" : "staff",
          status: owner ? "active" : "pending",
          createdAt: serverTimestamp()
        });
      } catch (e) { $("bootMsg").textContent = "アカウントを登録できませんでした（" + (e.code || e.message) + "）"; }
      return;
    }
    S.member = snap.data();
    S.isAdmin = isOwnerUser(user) || (S.member.role === "admin" && S.member.status === "active");
    if (S.member.status !== "active" && !S.isAdmin) { stopAll(); showPending(); return; }
    startData();
  }, (err) => { $("bootMsg").textContent = "アカウントを確認できませんでした（" + err.code + "）"; show("bootView"); });
}

function showPending() {
  show("pendingView");
  const m = S.member || {};
  $("pendingMsg").textContent = m.status === "disabled"
    ? "このアカウントは利用停止になっています。管理者に確認してください。"
    : "管理者の承認待ちです。承認されると、この画面が自動で切り替わります。";
  if (document.activeElement !== $("myName")) $("myName").value = m.name || "";
  $("pendingWho").textContent = "ログイン中：" + (S.user.email || "");
}

function startData() {
  const key = S.user.uid + (S.isAdmin ? ":a" : ":s");
  show("appView");
  $("whoName").textContent = (S.member && S.member.name) || S.user.email || "";
  $("tabs").hidden = !S.isAdmin;
  if (S.dataStartedFor === key) { route(); return; }
  stopAll(); S.dataStartedFor = key;
  const uid = S.user.uid;

  watch(doc(db, "settings", "main"), (snap) => {
    const v = snap.exists() ? snap.data() : null;
    if (v) { S.settings.std = Number(v.std) || 480; S.settings.otLimit = Number(v.otLimit) || 2700; }
    render();
  }, "設定");
  watch(query(collection(db, "attendance", uid, "days"), where("date", ">=", cutoff())), (snap) => {
    const months = {};
    snap.forEach((d) => { const v = d.data(); (months[v.date.slice(0, 7)] = months[v.date.slice(0, 7)] || {})[v.date] = v; });
    S.my = months; render();
  }, "自分の記録");
  watch(doc(db, "grants", uid), (snap) => { S.myGrant = snap.exists() ? snap.data() : null; render(); }, "有給の付与");
  watch(query(collection(db, "requests"), where("uid", "==", uid)), (snap) => {
    S.myReq = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render();
  }, "修正依頼");

  if (S.isAdmin) {
    watch(collection(db, "members"), (snap) => {
      const next = {}; snap.forEach((d) => { next[d.id] = d.data(); }); S.members = next; renderAdmin();
    }, "従業員の一覧");
    watch(query(collectionGroup(db, "days"), where("date", ">=", cutoff())), (snap) => {
      const next = {};
      snap.forEach((d) => {
        const v = d.data(); if (!v.uid) return;
        const mm = next[v.uid] = next[v.uid] || {};
        (mm[v.date.slice(0, 7)] = mm[v.date.slice(0, 7)] || {})[v.date] = v;
      });
      S.emps = next; renderAdmin();
    }, "全員の記録");
    watch(collection(db, "grants"), (snap) => {
      const next = {}; snap.forEach((d) => { next[d.id] = d.data(); }); S.grants = next; renderAdmin();
    }, "有給の付与");
    watch(collection(db, "requests"), (snap) => {
      S.reqs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderAdmin();
    }, "修正依頼");
  }
  route();
}

/* ================= 書き込み ================= */
const DAY_FIELDS = ["type", "in", "out", "breakMin", "note", "direct", "straight", "inAt", "outAt"];
async function saveDay(uid, date, d, extra) {
  const ref = doc(db, "attendance", uid, "days", date);
  try {
    if (!d) { await deleteDoc(ref); return true; }
    const body = { uid, date, ym: date.slice(0, 7), updatedAt: serverTimestamp() };
    for (const f of DAY_FIELDS) if (d[f] !== undefined && d[f] !== null && d[f] !== "") body[f] = d[f];
    if (body.breakMin !== undefined && typeof body.breakMin !== "number") delete body.breakMin;
    Object.assign(body, extra || {});
    await setDoc(ref, body);
    return true;
  } catch (e) {
    toast(e.code === "permission-denied"
      ? "この記録は変更できません（退勤済みの日は修正依頼を送ってください）"
      : "保存に失敗しました（" + (e.code || e.message) + "）");
    return false;
  }
}
const isLockedForMe = (d) => !S.isAdmin && !!(d && d.out);

/* ================= 月のタイムカード表 ================= */
function renderMonthTable(tbody, months, view, editable, pending) {
  const data = (months || {})[mkey(view)] || {};
  const y = view.getFullYear(), m = view.getMonth(), last = new Date(y, m + 1, 0).getDate();
  const todayKey = ymd(new Date()), act = activeDay(months);
  let html = "", any = false;
  for (let i = 1; i <= last; i++) {
    const dt = new Date(y, m, i), key = ymd(dt), d = data[key];
    const live = !!(d && d.in && !d.out && key === act.key), c = calc(d, live), ty = T(d);
    if (d && (d.in || d.note || d.type)) any = true;
    const cls = [dt.getDay() === 6 ? "sat" : "", dt.getDay() === 0 ? "sun" : "", key === todayKey ? "today" : "", editable ? "click" : ""].join(" ");
    html += '<tr class="' + cls + '" data-key="' + key + '"' + (editable ? ' tabindex="0"' : "") + ">" +
      '<td class="day mono">' + (m + 1) + "/" + pad(i) + "（" + WD[dt.getDay()] + "）</td>" +
      "<td>" + (ty.label ? '<span class="pill sm ' + ty.cls + '">' + ty.label + "</span>" : "") +
        (pending && pending.has(key) ? ' <span class="pill sm req">修正依頼中</span>' : "") + "</td>" +
      '<td class="mono t-in">' + (d && d.in ? esc(d.in) + (d.direct ? '<span class="mark">直行</span>' : "") : DASH) + "</td>" +
      '<td class="mono t-out">' + (d && d.out ? esc(d.out) + (d.straight ? '<span class="mark">直帰</span>' : "") : (live ? "勤務中" : DASH)) + "</td>" +
      '<td class="mono num">' + (c && c.work != null ? fmt(c.br) : DASH) + "</td>" +
      '<td class="mono num">' + (c && c.work != null ? fmt(c.work) : DASH) + "</td>" +
      '<td class="mono num' + (c && c.ot > 0 ? " ot" : "") + '">' + (c && c.ot > 0 ? fmt(c.ot) : DASH) + "</td>" +
      '<td class="memo">' + esc(d && d.note) + "</td></tr>";
  }
  tbody.innerHTML = html;
  return any;
}

/* ================= 従業員画面 ================= */
function renderStaff() {
  const a = activeDay(S.my), d = a.day, st = statusOf(d);
  $("statusPill").className = "pill " + st.cls;
  $("statusPill").textContent = st.label;
  const c = calc(d, true);
  $("todayStats").textContent = c && c.work != null ? "実働 " + fmt(c.work) + "（休憩 " + fmt(c.br) + " 差引）" : "";
  const fullLeave = !!T(d).full;
  $("pIn").disabled = !!(d && d.in) || fullLeave;
  $("pOut").disabled = st.k !== "work";
  $("pDg").disabled = $("pIn").disabled;
  $("pDk").disabled = $("pOut").disabled;
  $("pInT").textContent = fullLeave && !(d && d.in) ? "休暇の日" : d && d.in ? d.in : "--:--";
  $("pOutT").textContent = d && d.out ? d.out : "--:--";

  $("sMonth").textContent = S.sView.getFullYear() + "年" + (S.sView.getMonth() + 1) + "月";
  $("sStd").textContent = "所定労働 " + fmt(S.settings.std) + "（超過分を残業として集計）";
  const pending = new Set(S.myReq.filter((r) => r.status === "pending").map((r) => r.date));
  const any = renderMonthTable($("sRows"), S.my, S.sView, true, pending);
  const t = monthTotals(S.my, S.sView), lt = longTotals(S.my, S.sView.getFullYear());
  $("sDays").textContent = t.days + "日";
  $("sWork").textContent = fmt(t.work);
  $("sOt").textContent = fmt(t.ot);
  $("sPayable").textContent = fmt(t.payable);
  const pr = paidRemain(S.my, S.myGrant);
  $("sPaid").className = pr && pr.remain < 0 ? "red" : "grn";
  $("sPaid").innerHTML = (pr ? days(pr.remain) : "未設定") + "<small>今月 " + days(t.paid) + "・今年 " + days(lt.paidYear) + "</small>";
  $("sPaid").title = pr ? "付与 " + days(pr.total) + "（" + S.myGrant.date + " から）／取得 " + days(pr.used) : "管理者がまだ有給の付与日数を登録していません";
  $("sSpecial").textContent = days(t.special);
  $("sOff").textContent = days(t.off);
  $("sComp").innerHTML = days(t.comp) + "<small>／残 " + days(lt.compLeft) + "</small>";
  $("sEmpty").hidden = any;

  const items = S.myReq.slice().sort((x, y2) => tsOf(y2.createdAt) - tsOf(x.createdAt)).slice(0, 20);
  $("myReqBox").hidden = !items.length;
  const RS = { pending: ["承認待ち", "req"], approved: ["承認済み", "ok"], rejected: ["却下", "ng"] };
  $("myReqRows").innerHTML = items.map((r) => {
    const s2 = RS[r.status] || RS.pending;
    return '<tr><td class="mono">' + dayLabel(r.date) + '</td><td class="wrap">' + esc(describe(r.want)) + '</td><td class="wrap">' + esc(r.reason) +
      '</td><td><span class="pill sm ' + s2[1] + '">' + s2[0] + '</span></td><td class="wrap">' + esc(r.adminNote) + "</td></tr>";
  }).join("");
}
const tsOf = (t) => (t && typeof t.toMillis === "function") ? t.toMillis() : (t ? Date.parse(t) || 0 : Date.now());

async function mutateMine(date, fn, extra) {
  const cur = Object.assign({}, dayOf(S.my, date) || {});
  fn(cur);
  return saveDay(S.user.uid, date, cur, extra);
}
$("pIn").addEventListener("click", async () => {
  const t = new Date();
  if (await mutateMine(ymd(t), (d) => { d.in = hhmm(t); d.out = ""; delete d.breakMin; delete d.direct; delete d.straight; }, { inAt: serverTimestamp() }))
    toast(hhmm(t) + " に出勤しました");
});
$("pOut").addEventListener("click", async () => {
  const a = activeDay(S.my); if (!a.day) return;
  const now = hhmm(new Date());
  if (await mutateMine(a.key, (d) => { d.out = now; }, { outAt: serverTimestamp() }))
    toast(now + " に退勤しました。お疲れさまでした" + (S.isAdmin ? "" : "（この日の修正は管理者への依頼になります）"));
});
$("pDg").addEventListener("click", async () => {
  const t = new Date();
  if (await mutateMine(ymd(t), (d) => { d.in = "09:00"; d.out = ""; d.direct = true; delete d.breakMin; }, { inAt: serverTimestamp() }))
    toast("直行として 09:00 で出勤を記録しました");
});
$("pDk").addEventListener("click", async () => {
  const a = activeDay(S.my); if (!a.day) return;
  if (await mutateMine(a.key, (d) => { d.out = "18:00"; d.straight = true; }, { outAt: serverTimestamp() }))
    toast("直帰として 18:00 で退勤を記録しました。お疲れさまでした");
});
$("lvDate").value = ymd(new Date());
$("leaveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("lvDate").value, ty = $("lvType").value;
  if (!v) { toast("日付を選んでください"); return; }
  const cur = dayOf(S.my, v);
  if (isLockedForMe(cur)) { toast("この日は退勤済みのため直接変更できません。表の行をタップして修正依頼を送ってください"); return; }
  if (cur && cur.in && TYPES[ty].full) { toast("この日はすでに打刻があります。半日の休みにするか、表の行から修正してください"); return; }
  if (!(await mutateMine(v, (d) => { d.type = ty; }))) return;
  const [, m, dd] = v.split("-").map(Number);
  const pr = paidRemain(S.my, S.myGrant);
  const after = pr && TYPES[ty].paid ? pr.remain - TYPES[ty].paid + (cur && T(cur).paid || 0) : null;
  if (after != null && after < 0) toast(m + "月" + dd + "日に登録しましたが、有給残が足りません（残 " + days(after) + "）。管理者に確認してください");
  else toast(m + "月" + dd + "日に" + TYPES[ty].label + "を登録しました" + (after != null ? "（有給残 " + days(after) + "）" : ""));
});
$("sPrev").addEventListener("click", () => { S.sView.setMonth(S.sView.getMonth() - 1); render(); });
$("sNext").addEventListener("click", () => { S.sView.setMonth(S.sView.getMonth() + 1); render(); });
$("sThis").addEventListener("click", () => { S.sView = firstOfMonth(); render(); });
bindRowEdit($("sRows"), () => ({ uid: S.user.uid, months: S.my, staff: true }));

/* ================= 管理者画面 ================= */
const memberName = (uid) => (S.members[uid] && S.members[uid].name) || "（名前未設定）";
function activeIds() {
  return Object.keys(S.members)
    .filter((id) => S.members[id].status === "active")
    .sort((a, b) => memberName(a).localeCompare(memberName(b), "ja"));
}
function renderAdmin() {
  if (!S.isAdmin || S.route !== "admin") return;
  const now = new Date();
  $("aToday").textContent = (now.getMonth() + 1) + "月" + now.getDate() + "日（" + WD[now.getDay()] + "） " + hhmm(now) + " 時点";
  renderRequestsAdmin();
  const ids = activeIds();

  // 今日の状況
  const cnt = { work: 0, done: 0, leave: 0, none: 0 };
  $("todayRows").innerHTML = ids.length ? ids.map((id) => {
    const a = activeDay(S.emps[id]), day = a.day, st = statusOf(day), ht = T(day);
    cnt[st.k]++;
    const c = calc(day, st.k === "work");
    const half = day && day.in && ht.label && !ht.full && day.type !== "hw" ? ' <span class="pill sm ' + ht.cls + '">' + ht.label + "</span>" : "";
    return '<tr class="click" tabindex="0" data-emp="' + id + '"><td>' + esc(memberName(id)) + "</td>" +
      '<td><span class="pill ' + st.cls + '">' + st.label + "</span>" + half + "</td>" +
      '<td class="mono t-in">' + (day && day.in ? esc(day.in) + (day.direct ? '<span class="mark">直行</span>' : "") : DASH) + "</td>" +
      '<td class="mono t-out">' + (day && day.out ? esc(day.out) + (day.straight ? '<span class="mark">直帰</span>' : "") : DASH) + "</td>" +
      '<td class="mono num">' + (c && c.work != null ? fmt(c.br) : DASH) + "</td>" +
      '<td class="mono num">' + (c && c.work != null ? fmt(c.work) : DASH) + "</td>" +
      '<td class="memo">' + esc(day && day.note) + "</td></tr>";
  }).join("") : '<tr><td colspan="7" class="empty-note" style="white-space:normal;padding:20px">利用中の従業員はまだいません。従業員にアプリのURLを送り、ログインしてもらったら、下の「従業員の管理」で承認してください。</td></tr>';
  $("cAll").textContent = ids.length;
  $("cWork").textContent = cnt.work; $("cDone").textContent = cnt.done;
  $("cLeave").textContent = cnt.leave; $("cNone").textContent = cnt.none;

  // 月次集計
  $("aMonth").textContent = S.aView.getFullYear() + "年" + (S.aView.getMonth() + 1) + "月";
  $("setStd").value = String(S.settings.std);
  $("setLimit").value = String(S.settings.otLimit);
  $("monthRows").innerHTML = ids.length ? ids.map((id) => {
    const t = monthTotals(S.emps[id], S.aView), lt = longTotals(S.emps[id], S.aView.getFullYear());
    const pr = paidRemain(S.emps[id], S.grants[id]);
    const ratio = S.settings.otLimit ? t.ot / S.settings.otLimit : 0;
    return '<tr class="click' + (S.selected === id ? " sel" : "") + '" tabindex="0" data-emp="' + id + '"><td>' + esc(memberName(id)) + "</td>" +
      '<td class="mono num">' + t.days + "日</td>" +
      '<td class="mono num">' + fmt(t.work) + "</td>" +
      '<td class="mono num' + (t.ot > 0 ? " ot" : "") + '">' + fmt(t.ot) + "</td>" +
      '<td><div class="limit' + (ratio >= 1 ? " over" : ratio >= 0.8 ? " warn" : "") + '"><div class="track"><i style="width:' + Math.min(100, ratio * 100).toFixed(1) + '%"></i></div><span>' + Math.round(ratio * 100) + "%</span></div></td>" +
      '<td class="mono num">' + days(t.paid) + "</td>" +
      '<td class="mono num' + (pr && pr.remain < 0 ? " ot" : "") + '">' + (pr ? days(pr.remain) : '<span class="dash">未設定</span>') + "</td>" +
      '<td class="mono num">' + days(t.special) + "</td>" +
      '<td class="mono num">' + days(t.off) + "</td>" +
      '<td class="mono num">' + days(t.comp) + "</td>" +
      '<td class="mono num' + (lt.compLeft < 0 ? " ot" : "") + '">' + days(lt.compLeft) + "</td>" +
      '<td class="mono num' + (lt.paidYear < 5 ? " warnc" : "") + '">' + days(lt.paidYear) + "</td></tr>";
  }).join("") : '<tr><td colspan="12" class="empty-note" style="padding:20px">集計できる従業員がまだいません。</td></tr>';

  // 個人明細
  if (S.selected && S.members[S.selected]) {
    $("detail").hidden = false;
    $("dName").textContent = memberName(S.selected) + " さんの明細（" + (S.aView.getMonth() + 1) + "月）";
    renderMonthTable($("dRows"), S.emps[S.selected], S.aView, true);
    const g = S.grants[S.selected];
    if (S.grantFormFor !== S.selected) {
      S.grantFormFor = S.selected;
      $("gDate").value = g && g.date || "";
      $("gDays").value = g && g.days != null ? g.days : "";
      $("gCarry").value = g && g.carry != null ? g.carry : 0;
    }
    const pr = paidRemain(S.emps[S.selected], g);
    $("gInfo").textContent = pr
      ? "現在の有給残 " + days(pr.remain) + "（付与 " + days(pr.total) + " − 取得 " + days(pr.used) + "）。次の付与日が来たら、付与日・日数・繰越を更新してください。"
      : "まだ付与日数が登録されていません。付与日と日数を入れて保存すると、有給残が計算されます。";
  } else { $("detail").hidden = true; S.grantFormFor = null; }

  renderMembers();
}

function renderRequestsAdmin() {
  const list = S.reqs.filter((r) => r.status === "pending").sort((a, b) => tsOf(a.createdAt) - tsOf(b.createdAt));
  $("reqBadge").hidden = !list.length; $("reqBadge").textContent = list.length;
  $("reqRows").innerHTML = list.length ? list.map((r) => {
    const cur = dayOf(S.emps[r.uid], r.date);
    return '<tr data-req="' + r.id + '"><td>' + esc(memberName(r.uid)) + '</td><td class="mono">' + dayLabel(r.date) + "</td>" +
      '<td class="wrap">' + esc(cur ? describe(cur) : "記録なし") + '</td><td class="wrap">' + esc(describe(r.want)) + '</td><td class="wrap">' + esc(r.reason) + "</td>" +
      '<td><div class="req-actions"><button class="btn small primary" type="button" data-act="ok">承認</button><button class="btn small danger" type="button" data-act="ng">却下</button></div></td></tr>';
  }).join("") : '<tr><td colspan="6" class="empty-note" style="padding:16px">承認待ちの修正依頼はありません。</td></tr>';
}
$("reqRows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]"); if (!btn) return;
  const tr = btn.closest("tr"), r = S.reqs.find((x) => x.id === tr.dataset.req);
  if (!r || r.status !== "pending") return;
  tr.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  const ok = btn.dataset.act === "ok";
  if (ok) {
    const w = r.want || {};
    const d = { type: w.type || "", in: w.in || "", out: w.out || "", note: w.note || "" };
    if (typeof w.breakMin === "number") d.breakMin = w.breakMin;
    const empty = !d.in && !d.out && !d.type && !d.note;
    if (!(await saveDay(r.uid, r.date, empty ? null : d))) { tr.querySelectorAll("button").forEach((b) => { b.disabled = false; }); return; }
  }
  try {
    await updateDoc(doc(db, "requests", r.id), { status: ok ? "approved" : "rejected", resolvedAt: serverTimestamp(), resolvedBy: S.user.uid });
    toast(ok ? "修正依頼を承認し、記録を書き換えました" : "修正依頼を却下しました");
  } catch (err) { toast("依頼の状態を保存できませんでした（" + err.code + "）"); }
});

function renderMembers() {
  const ids = Object.keys(S.members).sort((a, b) => {
    const order = { pending: 0, active: 1, disabled: 2 };
    return (order[S.members[a].status] ?? 3) - (order[S.members[b].status] ?? 3) || memberName(a).localeCompare(memberName(b), "ja");
  });
  const pendingN = ids.filter((id) => S.members[id].status === "pending").length;
  $("memBadge").hidden = !pendingN; $("memBadge").textContent = pendingN;
  const ST = { pending: ["承認待ち", "req"], active: ["利用中", "ok"], disabled: ["利用停止", "ng"] };
  $("memRows").innerHTML = ids.map((id) => {
    const m = S.members[id], st = ST[m.status] || ST.pending;
    const owner = String(m.email || "").toLowerCase() === String(ownerEmail).toLowerCase();
    const me = id === S.user.uid;
    let actions = "";
    if (!owner && !me) {
      if (m.status !== "active") actions += '<button class="btn small primary" type="button" data-mact="activate">承認</button>';
      if (m.status === "active") actions += '<button class="btn small danger" type="button" data-mact="disable">利用停止</button>';
      if (m.status === "active" && m.role !== "admin") actions += '<button class="btn small" type="button" data-mact="admin">管理者にする</button>';
      if (m.role === "admin") actions += '<button class="btn small" type="button" data-mact="staff">従業員に戻す</button>';
    }
    return '<tr data-mid="' + id + '"><td>' + esc(m.name) + (me ? "（あなた）" : "") + '</td><td class="wrap">' + esc(m.email) + "</td>" +
      "<td>" + (m.role === "admin" ? "管理者" : "従業員") + (owner ? "（オーナー）" : "") + '</td><td><span class="pill sm ' + st[1] + '">' + st[0] + "</span></td>" +
      '<td><div class="req-actions">' + actions + "</div></td></tr>";
  }).join("");
}
$("memRows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-mact]"); if (!btn) return;
  const id = btn.closest("tr").dataset.mid, act = btn.dataset.mact;
  const patch = act === "activate" ? { status: "active" } : act === "disable" ? { status: "disabled" } : act === "admin" ? { role: "admin" } : { role: "staff" };
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "members", id), patch);
    toast({ activate: "承認しました。この人は打刻できるようになりました", disable: "利用を停止しました", admin: "管理者にしました", staff: "従業員に戻しました" }[act]);
  } catch (err) { toast("変更できませんでした（" + err.code + "）"); btn.disabled = false; }
});

function openDetail(id) {
  S.selected = id; renderAdmin();
  $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
}
for (const tbId of ["todayRows", "monthRows"]) {
  $(tbId).addEventListener("click", (e) => { const tr = e.target.closest("tr[data-emp]"); if (tr) openDetail(tr.dataset.emp); });
  $(tbId).addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tr = e.target.closest("tr[data-emp]"); if (tr) { e.preventDefault(); openDetail(tr.dataset.emp); }
  });
}
$("dClose").addEventListener("click", () => { S.selected = null; renderAdmin(); });
$("aPrev").addEventListener("click", () => { S.aView.setMonth(S.aView.getMonth() - 1); renderAdmin(); });
$("aNext").addEventListener("click", () => { S.aView.setMonth(S.aView.getMonth() + 1); renderAdmin(); });
$("aThis").addEventListener("click", () => { S.aView = firstOfMonth(); renderAdmin(); });
async function saveSettings() {
  const v = { std: Number($("setStd").value) || 480, otLimit: Number($("setLimit").value) || 2700 };
  try { await setDoc(doc(db, "settings", "main"), v); toast("設定を保存しました"); }
  catch (e) { toast("設定を保存できませんでした（" + e.code + "）"); }
}
$("setStd").addEventListener("change", saveSettings);
$("setLimit").addEventListener("change", saveSettings);
$("grantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = S.selected; if (!id) return;
  const data = { date: $("gDate").value, days: Number($("gDays").value) || 0, carry: Number($("gCarry").value) || 0, updatedAt: serverTimestamp() };
  if (!data.date) { toast("付与日を入れてください"); return; }
  try { await setDoc(doc(db, "grants", id), data); toast("有給の付与を保存しました"); }
  catch (err) { toast("有給の付与を保存できませんでした（" + err.code + "）"); }
});
bindRowEdit($("dRows"), () => ({ uid: S.selected, months: S.emps[S.selected] || {}, staff: false }));

/* ================= 編集ダイアログ ================= */
let editing = null;
function bindRowEdit(tbody, getTarget) {
  const open = (tr) => { if (tr && tr.dataset.key) openEdit(getTarget(), tr.dataset.key); };
  tbody.addEventListener("click", (e) => open(e.target.closest("tr")));
  tbody.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tr = e.target.closest("tr"); if (tr) { e.preventDefault(); open(tr); }
  });
}
function openEdit(target, key) {
  if (!target || !target.uid) return;
  const d = dayOf(target.months, key) || {};
  const request = target.staff && isLockedForMe(d);
  editing = { target, key, request };
  $("dlgTitle").textContent = dayLabel(key) + " の" + (request ? "修正依頼" : "記録");
  $("lockNote").hidden = !request;
  $("reasonRow").hidden = !request;
  $("fReason").value = "";
  $("dlgSubmit").textContent = request ? "修正依頼を送る" : "保存";
  $("fType").value = d.type || "";
  $("fIn").value = d.in || "";
  $("fOut").value = d.out || "";
  $("fBreak").value = typeof d.breakMin === "number" ? d.breakMin : "";
  $("fNote").value = d.note || "";
  $("dlgDelete").hidden = request || !(d.in || d.note || d.type);
  $("dlg").showModal();
}
$("dlgCancel").addEventListener("click", () => $("dlg").close());
$("dlgForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editing) return;
  const ty = $("fType").value;
  let vin = $("fIn").value, vout = $("fOut").value;
  const brRaw = $("fBreak").value.trim(), note = $("fNote").value.trim();
  if (TYPES[ty] && TYPES[ty].full) { vin = ""; vout = ""; }
  if (vout && !vin) { toast("退勤だけでは保存できません。出勤時刻も入力してください"); return; }
  const want = { type: ty, in: vin, out: vout, note };
  if (vin && brRaw !== "") want.breakMin = Math.max(0, Number(brRaw) || 0);
  const { target, key } = editing;

  if (editing.request) {
    const reason = $("fReason").value.trim();
    if (!reason) { toast("修正の理由を入れてください"); $("fReason").focus(); return; }
    $("dlg").close();
    try {
      // 同じ日の承認待ちの依頼は、新しい依頼で置き換える
      for (const r of S.myReq.filter((x) => x.date === key && x.status === "pending")) await deleteDoc(doc(db, "requests", r.id));
      await addDoc(collection(db, "requests"), { uid: S.user.uid, date: key, want, reason, status: "pending", createdAt: serverTimestamp() });
      toast(dayLabel(key) + " の修正依頼を管理者に送りました");
    } catch (err) { toast("修正依頼を送れませんでした（" + err.code + "）"); }
    return;
  }
  $("dlg").close();
  const prev = dayOf(target.months, key) || {};
  const d = Object.assign({}, prev, want);
  if (want.breakMin === undefined) delete d.breakMin;
  if (prev.in !== vin) delete d.direct;
  if (prev.out !== vout) delete d.straight;
  if (await saveDay(target.uid, key, d)) toast("記録を保存しました");
});
$("dlgDelete").addEventListener("click", async () => {
  if (!editing) return;
  $("dlg").close();
  if (await saveDay(editing.target.uid, editing.key, null)) toast("記録を削除しました");
});

/* ================= CSV ================= */
const q = (s) => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
const HEAD = "日付,曜日,区分,出勤,退勤,直行,直帰,休憩(分),実働,残業,有給(日),特別休暇(日),休暇・半休(日),メモ";
function csvRows(months, view, prefix) {
  const data = (months || {})[mkey(view)] || {};
  const y = view.getFullYear(), m = view.getMonth(), last = new Date(y, m + 1, 0).getDate(), out = [];
  for (let i = 1; i <= last; i++) {
    const dt = new Date(y, m, i), key = ymd(dt), d = data[key], c = calc(d, false), ty = T(d);
    out.push(prefix.concat([key, WD[dt.getDay()], ty.label, d && d.in || "", d && d.out || "", d && d.direct ? "○" : "", d && d.straight ? "○" : "",
      c && c.work != null ? c.br : "", c && c.work != null ? fmt(c.work) : "", c && c.ot ? fmt(c.ot) : "",
      leaveDays(d) || "", ty.special || "", ty.off || "", q(d && d.note)]).join(","));
  }
  return out;
}
function download(filename, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("sCsv").addEventListener("click", () => download("勤怠_" + mkey(S.sView) + ".csv", [HEAD].concat(csvRows(S.my, S.sView, [])).join("\r\n")));
$("aCsv").addEventListener("click", () => {
  let lines = ["従業員," + HEAD];
  for (const id of activeIds()) lines = lines.concat(csvRows(S.emps[id], S.aView, [q(memberName(id))]));
  download("勤怠_全員_" + mkey(S.aView) + ".csv", lines.join("\r\n"));
});

/* ================= ログイン ================= */
const AUTH_MSG = {
  "auth/invalid-credential": "メールアドレスかパスワードが違います",
  "auth/wrong-password": "メールアドレスかパスワードが違います",
  "auth/user-not-found": "このメールアドレスは登録されていません。「新しく登録」を押してください",
  "auth/email-already-in-use": "このメールアドレスは登録済みです。「ログイン」を押してください",
  "auth/weak-password": "パスワードは6文字以上にしてください",
  "auth/invalid-email": "メールアドレスの形が正しくありません",
  "auth/popup-closed-by-user": "ログイン画面が閉じられました",
  "auth/too-many-requests": "試行回数が多すぎます。しばらく待ってからもう一度お試しください",
  "auth/network-request-failed": "通信できませんでした。電波の状態を確認してください",
  "auth/unauthorized-domain": "このURLはログインが許可されていません。Firebase の「承認済みドメイン」に追加してください",
  "auth/configuration-not-found": "ログイン機能がまだ準備されていません。管理者が Firebase の Authentication を「始める」で有効にし、ログイン方法を設定してください",
  "auth/operation-not-allowed": "このログイン方法は有効になっていません。管理者が Firebase の Authentication でログイン方法を有効にしてください"
};
function showLoginError(e) { if (e) $("loginErr").textContent = AUTH_MSG[e.code] || ("ログインできませんでした（" + (e.code || e.message) + "）"); }
$("googleBtn").addEventListener("click", async () => {
  $("loginErr").textContent = "";
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      try { await signInWithRedirect(auth, provider); } catch (e2) { showLoginError(e2); }
    } else showLoginError(e);
  }
});
$("emailForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("loginErr").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPass").value); }
  catch (err) { showLoginError(err); }
});
$("signupBtn").addEventListener("click", async () => {
  $("loginErr").textContent = "";
  const email = $("loginEmail").value.trim(), pass = $("loginPass").value;
  if (!email || pass.length < 6) { $("loginErr").textContent = "メールアドレスと6文字以上のパスワードを入れてから押してください"; return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    sendEmailVerification(cred.user).catch(() => {});
  } catch (err) { showLoginError(err); }
});
$("resetBtn").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim();
  if (!email) { $("loginErr").textContent = "メールアドレスを入れてから押してください"; return; }
  try { await sendPasswordResetEmail(auth, email); $("loginErr").textContent = "パスワード再設定のメールを送りました"; }
  catch (err) { showLoginError(err); }
});
$("nameForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("myName").value.trim(); if (!name) return;
  try { await updateDoc(doc(db, "members", S.user.uid), { name }); toast("名前を保存しました"); }
  catch (err) { toast("名前を保存できませんでした（" + err.code + "）"); }
});
const logout = () => signOut(auth);
$("logoutBtn").addEventListener("click", logout);
$("pendingLogout").addEventListener("click", logout);

/* ================= 画面切り替え・時計 ================= */
function route() {
  const want = location.hash === "#admin" && S.isAdmin ? "admin" : "staff";
  S.route = want;
  $("staffView").hidden = want !== "staff";
  $("adminView").hidden = want !== "admin";
  $("viewName").textContent = want === "admin" ? "管理者" : "従業員";
  $("tabStaff").setAttribute("aria-current", want === "staff" ? "page" : "false");
  $("tabAdmin").setAttribute("aria-current", want === "admin" ? "page" : "false");
  render();
}
window.addEventListener("hashchange", route);
function render() {
  if (!S.user || $("appView").hidden) return;
  if (S.route === "admin") renderAdmin(); else renderStaff();
}
function tick() {
  const d = new Date();
  $("clock").innerHTML = pad(d.getHours()) + ":" + pad(d.getMinutes()) + "<small>:" + pad(d.getSeconds()) + "</small>";
  $("date").textContent = d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日（" + WD[d.getDay()] + "）";
  if (d.getSeconds() === 0) render();
}
setInterval(tick, 1000); tick();
function netState() {
  const on = navigator.onLine;
  $("net").className = "net" + (on ? "" : " off");
  $("net").textContent = on ? "オンライン" : "オフライン（打刻は端末に保存し、つながったら送信します）";
}
window.addEventListener("online", netState); window.addEventListener("offline", netState); netState();

// ===============================
// ★ここを自分のSupabase値に置き換える
// ===============================
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "YOUR_PUBLISHABLE_KEY"; // Publishable key（旧 anon public key）
// ===============================

// SDKは window.supabase を使うので、クライアントは別名（衝突回避）
let sb = null;

const $ = (id) => document.getElementById(id);

function log(msg, obj) {
  const el = $("log");
  const line = obj ? `${msg}\n${JSON.stringify(obj, null, 2)}\n` : `${msg}\n`;
  el.textContent = line + el.textContent;
}

function setText(id, text) { $(id).textContent = text; }

function setBusy(b) {
  $("btnSignUp").disabled = b;
  $("btnSignIn").disabled = b;
  $("btnSignOut").disabled = b;
  $("btnSaveProfile").disabled = b;
  $("btnRandomName").disabled = b;
  $("btnSubmitScore").disabled = b;
  $("btnLoadRank").disabled = b;
  $("btnLoadRank2").disabled = b;
}

function show(id, on) {
  $(id).style.display = on ? "block" : "none";
}

function normalizeEmail(s) { return (s || "").trim(); }
function normalizeName(s) { return (s || "").trim().replace(/\s+/g, " "); }

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function suggestName() {
  const animals = ["mukki","yukki","bacto","micro","cocci","bacilli","phage","plasmid","agar","colony"];
  const a = animals[randInt(0, animals.length - 1)];
  return `${a}${randInt(10, 99)}`;
}

async function getUser() {
  const { data, error } = await sb.auth.getSession();
  if (error) {
    log("❌ getSession error", error);
    return null;
  }
  return data?.session?.user || null;
}

async function refreshAuthUI() {
  const user = await getUser();
  if (!user) {
    setText("authStatus", "未ログイン");
    show("profileCard", false);
    show("gameCard", false);
    return;
  }
  setText("authStatus", `ログイン中（メールは表示しません）：${user.email}`);
  await refreshProfileUI();
}

async function refreshProfileUI() {
  const user = await getUser();
  if (!user) return;

  const { data, error } = await sb
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    log("❌ profiles select error", error);
    setText("profileStatus", "プロフィール確認エラー");
    show("profileCard", true);
    show("gameCard", false);
    return;
  }

  if (!data) {
    setText("profileStatus", "未登録：表示名を入れて保存してください");
    show("profileCard", true);
    show("gameCard", false);
    return;
  }

  setText("profileStatus", `登録済み：${data.display_name}`);
  show("profileCard", false);
  show("gameCard", true);
}

async function signUp() {
  setBusy(true);
  log("⏳ signUp start");
  try {
    const email = normalizeEmail($("email").value);
    const password = $("password").value;

    if (!email || !password) return alert("EmailとPasswordを入れてください");

    const { data, error } = await sb.auth.signUp({ email, password });

    if (error) {
      log("❌ signUp error", error);
      alert(error.message);
      return;
    }
    log("✅ signUp OK（Confirm email がONならメール確認後にログイン）", data);
    await refreshAuthUI();
  } finally {
    setBusy(false);
  }
}

async function signIn() {
  setBusy(true);
  log("⏳ signIn start");
  try {
    const email = normalizeEmail($("email").value);
    const password = $("password").value;

    if (!email || !password) return alert("EmailとPasswordを入れてください");

    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      log("❌ signIn error", error);
      alert(error.message);
      return;
    }
    log("✅ signIn OK", { user: data.user?.email });
    await refreshAuthUI();
  } finally {
    setBusy(false);
  }
}

async function signOut() {
  setBusy(true);
  log("⏳ signOut start");
  try {
    const { error } = await sb.auth.signOut();
    if (error) {
      log("❌ signOut error", error);
      alert(error.message);
      return;
    }
    log("✅ signOut OK");
    await refreshAuthUI();
  } finally {
    setBusy(false);
  }
}

async function saveProfile() {
  const user = await getUser();
  if (!user) return alert("先にログインしてください");

  const name = normalizeName($("displayName").value);
  if (!name) return alert("表示名を入れてください（例：mukki77）");
  if (name.length < 3) return alert("表示名は3文字以上がおすすめです");

  setBusy(true);
  log("⏳ saveProfile start");
  try {
    // すでにある場合はupdate、なければinsert（upsert）
    const { error } = await sb
      .from("profiles")
      .upsert({ id: user.id, display_name: name }, { onConflict: "id" });

    if (error) {
      // display_name unique に引っかかるとここ
      log("❌ profile upsert error", error);
      alert("その表示名は既に使われています。別の名前にしてください。");
      return;
    }

    log("✅ profile saved", { display_name: name });
    await refreshProfileUI();
    await loadRanking();
  } finally {
    setBusy(false);
  }
}

async function submitScore() {
  const user = await getUser();
  if (!user) return alert("先にログインしてください");

  const score = parseInt($("scoreValue").value, 10);
  const mode = ($("modeValue").value || "default").trim() || "default";

  if (!Number.isFinite(score) || score < 0) return alert("スコアは0以上の整数にしてください");

  setBusy(true);
  log("⏳ submitScore start");
  try {
    const { error } = await sb
      .from("scores")
      .insert({ user_id: user.id, score, mode });

    if (error) {
      log("❌ scores insert error", error);
      alert(error.message);
      return;
    }
    setText("scoreStatus", `送信OK：score=${score} / mode=${mode}`);
    log("✅ score inserted", { score, mode });

    await loadRanking();
  } finally {
    setBusy(false);
  }
}

async function loadRanking() {
  // 最高スコア（best）で上位20を作る
  // 1) まず scores を user_id ごとに集約（JSでやる：簡単優先）
  // ※ データが増えたらSQL VIEW/関数に移すのが次の段階
  setBusy(true);
  log("⏳ loadRanking start");
  try {
    const { data: scores, error: err1 } = await sb
      .from("scores")
      .select("user_id, score, created_at")
      .order("created_at", { ascending: false })
      .limit(2000);

    if (err1) {
      log("❌ scores select error", err1);
      return;
    }

    // userごとのbest
    const bestMap = new Map();
    for (const s of scores || []) {
      const prev = bestMap.get(s.user_id);
      if (!prev || s.score > prev.score) {
        bestMap.set(s.user_id, { user_id: s.user_id, score: s.score, created_at: s.created_at });
      }
    }

    const bestArr = Array.from(bestMap.values())
      .sort((a, b) => (b.score - a.score) || (new Date(b.created_at) - new Date(a.created_at)))
      .slice(0, 20);

    // 2) profiles から表示名を取る
    const ids = bestArr.map(x => x.user_id);
    let nameMap = new Map();
    if (ids.length > 0) {
      const { data: profs, error: err2 } = await sb
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);

      if (err2) {
        log("❌ profiles select error", err2);
      } else {
        nameMap = new Map((profs || []).map(p => [p.id, p.display_name]));
      }
    }

    // 3) 表示
    const ol = $("rankList");
    ol.innerHTML = "";

    if (bestArr.length === 0) {
      const li = document.createElement("li");
      li.textContent = "まだスコアがありません";
      ol.appendChild(li);
      return;
    }

    bestArr.forEach((x, idx) => {
      const li = document.createElement("li");
      const name = nameMap.get(x.user_id) || "unknown";
      li.innerHTML = `
        <span class="name">${idx + 1}. ${escapeHtml(name)}</span>
        <span class="meta">best: ${x.score}</span>
      `;
      ol.appendChild(li);
    });
  } finally {
    setBusy(false);
  }
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function init() {
  setBusy(true);
  setText("authStatus", "起動中…");

  if (!window.supabase?.createClient) {
    setText("authStatus", "SDK読み込み失敗");
    log("❌ Supabase SDKが読み込めていません（CDN/ネットワーク）");
    setBusy(false);
    return;
  }

  if (!SUPABASE_URL.includes("supabase.co") || SUPABASE_PUBLISHABLE_KEY.length < 20) {
    setText("authStatus", "URL/Key未設定");
    log("⚠️ script.js の SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY を設定してください");
    setBusy(false);
    return;
  }

  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  log("🔌 Supabase client created");

  sb.auth.onAuthStateChange((event) => {
    log(`🔁 auth event: ${event}`);
    refreshAuthUI();
  });

  $("btnSignUp").addEventListener("click", signUp);
  $("btnSignIn").addEventListener("click", signIn);
  $("btnSignOut").addEventListener("click", signOut);

  $("btnRandomName").addEventListener("click", () => {
    $("displayName").value = suggestName();
  });
  $("btnSaveProfile").addEventListener("click", saveProfile);

  $("btnSubmitScore").addEventListener("click", submitScore);
  $("btnLoadRank").addEventListener("click", loadRanking);
  $("btnLoadRank2").addEventListener("click", loadRanking);

  // 初期表示
  setBusy(false);
  refreshAuthUI();
  loadRanking();
}

document.addEventListener("DOMContentLoaded", init);
// ===============================
// ★ここを自分のSupabase値に置き換える
// ===============================
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "YOUR_PUBLISHABLE_KEY"; // 旧 anon public key
// ===============================

// SDKは window.supabase を使う。自分のクライアントは別名にする（衝突回避）
let sb = null;

const $ = (id) => document.getElementById(id);

function log(msg, obj) {
  const logEl = $("log");
  const line = obj ? `${msg}\n${JSON.stringify(obj, null, 2)}\n` : `${msg}\n`;
  logEl.textContent = line + logEl.textContent;
}

function setStatus(text) {
  $("status").textContent = text;
}

function setBusy(isBusy) {
  $("btnSignUp").disabled = isBusy;
  $("btnSignIn").disabled = isBusy;
  $("btnSignOut").disabled = isBusy;
}

function normalizeEmail(s) {
  return (s || "").trim();
}

async function refreshUI() {
  if (!sb) return;
  const { data, error } = await sb.auth.getSession();
  if (error) {
    setStatus("セッション取得エラー");
    log("❌ getSession error", error);
    return;
  }
  const user = data?.session?.user;
  if (user) {
    setStatus(`ログイン中：${user.email}`);
  } else {
    setStatus("未ログイン");
  }
}

async function signUp() {
  if (!sb) return alert("Supabase未初期化です（URL/Keyを確認）");
  setBusy(true);
  log("⏳ signUp start");
  try {
    const email = normalizeEmail($("email").value);
    const password = $("password").value;

    if (!email || !password) {
      alert("EmailとPasswordを入れてください");
      return;
    }

    const { data, error } = await sb.auth.signUp({ email, password });

    if (error) {
      // 429 / rate limit もここに入ってきます
      log("❌ signUp error", error);
      alert(error.message);
      return;
    }

    log("✅ signUp OK", data);
    // Confirm email がONの場合は、ここで未ログインのままでも正常です
    await refreshUI();
  } finally {
    setBusy(false);
  }
}

async function signIn() {
  if (!sb) return alert("Supabase未初期化です（URL/Keyを確認）");
  setBusy(true);
  log("⏳ signIn start");
  try {
    const email = normalizeEmail($("email").value);
    const password = $("password").value;

    if (!email || !password) {
      alert("EmailとPasswordを入れてください");
      return;
    }

    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      log("❌ signIn error", error);
      alert(error.message); // 例: Email not confirmed / Invalid login credentials
      return;
    }

    log("✅ signIn OK", data);
    await refreshUI();
  } finally {
    setBusy(false);
  }
}

async function signOut() {
  if (!sb) return;
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
    await refreshUI();
  } finally {
    setBusy(false);
  }
}

function init() {
  setBusy(true);
  setStatus("起動中…");

  if (!window.supabase?.createClient) {
    setStatus("SDK読み込み失敗");
    log("❌ Supabase SDKが読み込めていません（CDN/ネットワーク）");
    setBusy(false);
    return;
  }

  if (!SUPABASE_URL.includes("supabase.co") || SUPABASE_PUBLISHABLE_KEY.length < 20) {
    setStatus("URL/Key未設定");
    log("⚠️ script.js の SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY を設定してください");
    setBusy(false);
    return;
  }

  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  log("🔌 Supabase client created");

  // 認証状態が変わるたびUI更新（遅延があっても追従）
  sb.auth.onAuthStateChange((event, session) => {
    log(`🔁 auth event: ${event}`, session ? { user: session.user?.email } : null);
    refreshUI();
  });

  $("btnSignUp").addEventListener("click", signUp);
  $("btnSignIn").addEventListener("click", signIn);
  $("btnSignOut").addEventListener("click", signOut);

  setBusy(false);
  refreshUI();
}

document.addEventListener("DOMContentLoaded", init);
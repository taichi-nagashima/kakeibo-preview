// ===== core.js — 設定・状態・ユーティリティ・起動フロー・家計簿ヘルパー（共通支出家計簿） =====
'use strict';
'use strict';
/* ============================================================
   共通支出家計簿 — Supabase連携アプリ
   テーブル: households / profiles / memberships / categories / transactions / recurring_expenses
   参加関係は memberships（user_id × household_id × display_name）、
   現在選択中の家計簿は profiles.active_household_id で表す。
   ============================================================ */
var DEFAULT_SUPABASE_URL = 'https://ilwspkhaystykdpwiijq.supabase.co';
var DEFAULT_SUPABASE_KEY = 'sb_publishable_3I2MqHL-VQkVgsNeltZ-WQ_AigHp1KV';
var CONFIG_KEY = 'kyotsu_kakeibo_sb_config_v1';

var sb = null;              // Supabase client
var state = {
  user: null,
  profile: null,            // 自分の profiles レコード（active_household_id を保持）
  household: null,          // 選択中の households レコード
  householdId: null,        // 選択中の家計簿ID
  myHouseholds: [],         // 自分が参加している家計簿一覧 [{household_id, name, display_name}]
  members: [],              // 選択中の家計簿の memberships（id = user_id に変換済み）
  categories: [],           // sort_order 順
  recurring: [],            // recurring_expenses
  monthTx: {},              // 'YYYY-MM' -> transactions[]
  viewMonth: null,          // 履歴タブの表示月 (Date, 1日)
  input: {
    entry: '',              // 入力中の金額文字列
    pending: null,          // '+' で保留中の合計
    payerId: null,
    categoryId: null,
    kind: 'expense',        // 種別トグル（使う=expense / 貯める=saving / 入る=income）
    advance: false          // 立て替えトグル（支出のときだけ有効）
  },
  autoPostDone: false,
  budgetDirty: false,       // 予算入力を編集中（未保存）かどうか
  savingsGoalDirty: false,  // 貯蓄目標入力を編集中（未保存）かどうか
  realtimeChannel: null
};

/* ---------- ユーティリティ ---------- */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtYen(n) { var num = Number(n); if (!isFinite(num) || num === 0) return '¥0'; var sign = num < 0 ? '-' : ''; return sign + '¥' + Math.abs(Math.trunc(num)).toLocaleString('ja-JP'); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function dateToStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function todayStr() { return dateToStr(new Date()); }
function monthKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
function monthRange(key) {
  var y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
  var start = y + '-' + pad2(m) + '-01';
  var last = new Date(y, m, 0).getDate();
  return { start: start, end: y + '-' + pad2(m) + '-' + pad2(last), lastDay: last };
}
var toastTimer = null;
function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
}
function showError(el, err) {
  if (!err) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = (err && err.message) ? err.message : String(err);
  el.classList.remove('hidden');
}
function memberName(id) {
  for (var i = 0; i < state.members.length; i++) {
    if (state.members[i].id === id) return state.members[i].display_name || 'メンバー';
  }
  return 'メンバー';
}
function categoryById(id) {
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].id === id) return state.categories[i];
  }
  return null;
}
// 種別（kind）: 'expense'（支出）/ 'saving'（貯蓄・投資）/ 'income'（収入）。
// 旧データで kind が無い場合は 'expense' として扱う。
function catKind(c) { return (c && c.kind) || 'expense'; }
function txKind(t) {
  if (t && t.kind) return t.kind;
  var c = t ? categoryById(t.category_id) : null;
  return c ? catKind(c) : 'expense';
}
function sumByKind(txs, kind) {
  return txs.reduce(function (a, t) {
    if (txKind(t) !== kind) return a;
    // 立て替え（is_advance）は支出の集計から除外する（収入・貯蓄には影響しない）
    if (kind === 'expense' && t.is_advance) return a;
    return a + (t.amount || 0);
  }, 0);
}
// 全体予算は「支出」カテゴリの予算合計で自動計算する（手入力はしない）。
// 貯蓄・投資の目標額は全体予算に含めない。
function categoryBudgetTotal() {
  return state.categories.reduce(function (a, c) {
    return catKind(c) === 'expense' ? a + (c.monthly_budget || 0) : a;
  }, 0);
}

/* ---------- 画面切り替え ---------- */
var SCREENS = ['screen-loading', 'screen-setup', 'screen-login', 'screen-join', 'screen-main'];
function showScreen(id) {
  SCREENS.forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
}

/* ---------- Supabase 接続設定 ---------- */
function loadConfig() {
  try {
    var raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      var c = JSON.parse(raw);
      if (c && c.url && c.key) return c;
    }
  } catch (e) {}
  // 保存済み設定がなければ、組み込みの接続情報を使う
  if (DEFAULT_SUPABASE_KEY) return { url: DEFAULT_SUPABASE_URL, key: DEFAULT_SUPABASE_KEY };
  return null;
}
function saveConfig(c) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch (e) {}
}
function clearConfig() {
  try { localStorage.removeItem(CONFIG_KEY); } catch (e) {}
}
function createClient(cfg) {
  return window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
}

/* ---------- テーマカラー ---------- */
var THEME_KEY = 'kyotsu_kakeibo_theme';
var THEME_BAR = { green: '#0B7A5C', coral: '#FF5A43', blue: '#2563EB', terracotta: '#D96B43', purple: '#7C5CFF', pink: '#EC4899' };
function applyTheme(name, save) {
  if (!name || !THEME_BAR[name]) name = 'coral';
  document.documentElement.setAttribute('data-theme', name);
  if (save) { try { localStorage.setItem(THEME_KEY, name); } catch (e) {} }
  var sw = document.querySelectorAll('.theme-swatch');
  for (var i = 0; i < sw.length; i++) sw[i].classList.toggle('on', sw[i].getAttribute('data-theme-choice') === name);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_BAR[name]);
}
function initTheme() {
  var t = 'coral';
  try { t = localStorage.getItem(THEME_KEY) || 'coral'; } catch (e) {}
  applyTheme(t, false);
}

/* ---------- 起動フロー ---------- */
function boot() {
  initTheme();
  showScreen('screen-loading');
  if (!window.supabase) {
    // ライブラリ読み込み失敗時（オフライン等）は設定画面で案内する
    var cfg0 = loadConfig();
    $('cfg-url').value = cfg0 ? cfg0.url : DEFAULT_SUPABASE_URL;
    $('cfg-key').value = cfg0 ? cfg0.key : DEFAULT_SUPABASE_KEY;
    showError($('setup-error'), '通信ライブラリを読み込めませんでした。ネットワーク接続を確認して、ページを再読み込みしてください。');
    showScreen('screen-setup');
    return;
  }
  var cfg = loadConfig();
  if (!cfg) {
    $('cfg-url').value = DEFAULT_SUPABASE_URL;
    $('cfg-key').value = DEFAULT_SUPABASE_KEY;
    showScreen('screen-setup');
    return;
  }
  sb = createClient(cfg);
  sb.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;
    if (!session) { showScreen('screen-login'); return; }
    state.user = session.user;
    afterLogin();
  }).catch(function () { showScreen('screen-login'); });
}

/* ---------- 複数家計簿：profiles / memberships ヘルパー ---------- */
// 自分の profiles 行を取得する（なければ作成する）。
// profiles では active_household_id だけを読み書きし、旧 household_id / display_name は触らない。
function ensureProfile() {
  return sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle()
    .then(function (res) {
      if (res.error) throw res.error;
      if (res.data) { state.profile = res.data; return state.profile; }
      return sb.from('profiles').insert({ id: state.user.id })
        .then(function (r2) {
          if (r2.error) throw r2.error;
          state.profile = { id: state.user.id, active_household_id: null };
          return state.profile;
        });
    });
}
// 選択中の家計簿を profiles.active_household_id に保存する
function saveActiveHouseholdId(householdId) {
  return sb.from('profiles').update({ active_household_id: householdId }).eq('id', state.user.id).select('id')
    .then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) {
        // profiles 行がまだ無い場合は作成して設定する
        return sb.from('profiles').insert({ id: state.user.id, active_household_id: householdId })
          .then(function (r2) { if (r2.error) throw r2.error; });
      }
    })
    .then(function () {
      if (state.profile) state.profile.active_household_id = householdId;
      else state.profile = { id: state.user.id, active_household_id: householdId };
    });
}
// memberships の行を、従来の members 形式（id = user_id）に変換する。
// transactions.payer_id は user_id なので、この形にすると既存の表示処理がそのまま使える。
function membershipToMember(ms) {
  return {
    id: ms.user_id,
    user_id: ms.user_id,
    membership_id: ms.id,
    household_id: ms.household_id,
    display_name: ms.display_name || 'メンバー',
    created_at: ms.created_at
  };
}
// 自分が参加している家計簿の一覧（memberships に households(name) を結合）
function loadMyHouseholds() {
  return sb.from('memberships').select('*, households(name)').eq('user_id', state.user.id).order('created_at')
    .then(function (res) {
      if (res.error) throw res.error;
      state.myHouseholds = (res.data || []).map(function (ms) {
        return {
          membership_id: ms.id,
          household_id: ms.household_id,
          display_name: ms.display_name || '',
          name: (ms.households && ms.households.name) || '家計簿'
        };
      });
      return state.myHouseholds;
    });
}
function myDisplayName() {
  for (var i = 0; i < state.members.length; i++) {
    if (state.members[i].id === state.user.id) return state.members[i].display_name || '';
  }
  return '';
}

function afterLogin() {
  showScreen('screen-loading');
  ensureProfile()
    .then(function () { return loadMyHouseholds(); })
    .then(function (list) {
      if (!list.length) {
        // 参加している家計簿が無い → セットアップ画面（作成／参加）
        showScreen('screen-join');
        return;
      }
      var active = state.profile && state.profile.active_household_id;
      var found = false;
      list.forEach(function (h) { if (h.household_id === active) found = true; });
      if (!found) {
        // 選択中が参加先に含まれない場合は先頭の家計簿を選択中として保存し直す
        active = list[0].household_id;
        return saveActiveHouseholdId(active).then(function () { enterHousehold(active); });
      }
      enterHousehold(active);
    })
    .catch(function (err) {
      showScreen('screen-login');
      showError($('login-error'), err);
    });
}

// 収入カテゴリの自動用意：kind='income' のカテゴリが1つも無い家計簿には
// 「給与」「ボーナス」「その他収入」を sort_order の末尾に追加する。
var INCOME_SEED = [
  { name: '給与', color: '#0ea5e9' },
  { name: 'ボーナス', color: '#f59e0b' },
  { name: 'その他収入', color: '#94a3b8' }
];
function ensureIncomeCategories() {
  var has = state.categories.some(function (c) { return catKind(c) === 'income'; });
  if (has) return Promise.resolve();
  var maxOrder = state.categories.reduce(function (a, c) { return Math.max(a, c.sort_order || 0); }, 0);
  var rows = INCOME_SEED.map(function (s, i) {
    return {
      household_id: state.household.id,
      name: s.name,
      color: s.color,
      monthly_budget: 0,
      sort_order: maxOrder + i + 1,
      kind: 'income'
    };
  });
  return sb.from('categories').insert(rows).then(function (res) {
    if (res.error) { console.error('収入カテゴリの自動作成に失敗:', res.error); return; }
    return sb.from('categories').select('*').eq('household_id', state.household.id).order('sort_order')
      .then(function (r2) { if (!r2.error && r2.data) state.categories = r2.data; });
  }).catch(function (e) { console.error(e); });
}

function enterHousehold(householdId) {
  state.householdId = householdId;
  // 切り替え時に前の家計簿のデータが混ざらないよう、月別キャッシュ等を初期化する
  state.monthTx = {};
  state.autoPostDone = false;
  state.budgetDirty = false;
  state.savingsGoalDirty = false;
  return Promise.all([
    sb.from('households').select('*').eq('id', householdId).single(),
    sb.from('memberships').select('*').eq('household_id', householdId).order('created_at'),
    sb.from('categories').select('*').eq('household_id', householdId).order('sort_order'),
    sb.from('recurring_expenses').select('*').eq('household_id', householdId).order('created_at'),
    loadMyHouseholds().catch(function () { return null; })
  ]).then(function (rs) {
    for (var i = 0; i < 4; i++) { if (rs[i].error) throw rs[i].error; }
    state.household = rs[0].data;
    state.householdId = state.household.id;
    state.members = (rs[1].data || []).map(membershipToMember);
    state.categories = rs[2].data || [];
    state.recurring = rs[3].data || [];
    state.viewMonth = new Date();
    state.viewMonth.setDate(1);
    return ensureIncomeCategories().then(function () {
      initInputTab();
      renderSettings();
      showScreen('screen-main');
      switchTab('input');
      subscribeRealtime();
      return ensureCurrentMonthLoaded();
    });
  }).then(function () {
    return runAutoPostFixed();
  }).then(function () {
    refreshInputSummary();
  }).catch(function (err) {
    showScreen('screen-login');
    showError($('login-error'), err);
  });
}

// 設定画面からの家計簿切り替え：選択中を保存 → 全データを読み直し → 購読を張り直し → 全タブ再描画
function switchToHousehold(householdId, knownName) {
  if (householdId === state.householdId && state.household) return Promise.resolve();
  showScreen('screen-loading');
  return saveActiveHouseholdId(householdId)
    .then(function () { return enterHousehold(householdId); })
    .then(function () {
      var label = knownName || (state.household && state.household.name) || '家計簿';
      toast('『' + label + '』に切り替えました');
    })
    .catch(function (err) {
      console.error(err);
      toast('切り替えに失敗: ' + (err.message || ''));
      if (state.household) showScreen('screen-main');
    });
}

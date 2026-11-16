// ===== app.js — タブ切り替え・認証・家計簿シート・イベント結線・起動（共通支出家計簿） =====
'use strict';
/* ============================================================
   タブ切り替え
   ============================================================ */
function switchTab(name) {
  ['input', 'history', 'settings'].forEach(function (n) {
    $('tab-' + n).classList.toggle('active', n === name);
    $('tabbtn-' + n).classList.toggle('active', n === name);
  });
  if (name === 'history') {
    runAutoPostFixed().then(function () { renderHistory(); });
  }
  if (name === 'input') refreshInputSummary();
}

/* ============================================================
   認証まわり
   ============================================================ */
function doLogin() {
  var email = $('login-email').value.trim();
  var pw = $('login-password').value;
  showError($('login-error'), null);
  if (!email || !pw) { showError($('login-error'), 'メールアドレスとパスワードを入力してください'); return; }
  $('btn-login').disabled = true;
  sb.auth.signInWithPassword({ email: email, password: pw }).then(function (res) {
    $('btn-login').disabled = false;
    if (res.error) { showError($('login-error'), res.error); return; }
    state.user = res.data.user;
    afterLogin();
  }).catch(function (err) {
    $('btn-login').disabled = false;
    showError($('login-error'), err);
  });
}
function doLogout() {
  if (state.realtimeChannel && sb) { sb.removeChannel(state.realtimeChannel); state.realtimeChannel = null; }
  var p = sb ? sb.auth.signOut() : Promise.resolve();
  p.then(function () { location.reload(); }).catch(function () { location.reload(); });
}
// memberships に自分の参加行を作成する
function createMembership(householdId, displayName) {
  return sb.from('memberships').insert({
    id: newUuid(),
    user_id: state.user.id,
    household_id: householdId,
    display_name: displayName
  }).then(function (res) { if (res.error) throw res.error; });
}
// 家計簿の新規作成：households 作成 → 標準カテゴリ作成 → memberships 作成 → 選択中に設定。
// IDはクライアント側で発行し、INSERT後の読み戻し（SELECT）はしない
// （作成直後はまだ選択中ではないため、RLSで読み戻しが弾かれるのを防ぐ）。
function createHouseholdAndJoin(hname, displayName) {
  var hid = newUuid();
  return sb.from('households').insert({ id: hid, name: hname, total_monthly_budget: 0 })
    .then(function (res) {
      if (res.error) throw res.error;
      return seedDefaultCategories(hid);
    })
    .then(function () { return createMembership(hid, displayName); })
    .then(function () { return saveActiveHouseholdId(hid); })
    .then(function () { return hid; });
}
// 既存の家計簿への参加：memberships 作成 → 選択中に設定。
// 家計簿の存在は memberships 作成時の外部キー制約（23503）で検証する。
function joinHouseholdAndActivate(householdId, displayName) {
  return createMembership(householdId, displayName)
    .then(function () { return saveActiveHouseholdId(householdId); })
    .then(function () { return householdId; });
}
function householdSheetError(err) {
  if (err && err.code === '23503') return '家計簿が見つかりませんでした。IDを確認してください。';
  if (err && err.code === '23505') return 'すでに参加しています。';
  return describeDbError(err);
}
function newUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function describeDbError(err) {
  var msg = (err && err.message) ? err.message : String(err || '不明なエラー');
  var code = err && err.code;
  if (code === '42501' || /row-level security/i.test(msg)) {
    return 'データベースの権限（RLSポリシー）で書き込みが拒否されました。Supabase側で households / memberships / profiles / categories テーブルに、ログイン中のユーザーの INSERT を許可するポリシーが必要です。（詳細: ' + msg + '）';
  }
  if (code === '23503') {
    return '参照先のデータが見つかりませんでした。家計簿IDが正しいか確認してください。（詳細: ' + msg + '）';
  }
  return msg;
}
// 新規家計簿には標準カテゴリを用意する（デフォルト選択の「特別費」を含む）
var DEFAULT_CATEGORIES = [
  { name: '食費', color: '#e07856', monthly_budget: 0, sort_order: 1, kind: 'expense' },
  { name: '日用品', color: '#5b8dd9', monthly_budget: 0, sort_order: 2, kind: 'expense' },
  { name: '住居費', color: '#7a7f87', monthly_budget: 0, sort_order: 3, kind: 'expense' },
  { name: '水道光熱費', color: '#e0a83c', monthly_budget: 0, sort_order: 4, kind: 'expense' },
  { name: '交通費', color: '#4aa3a2', monthly_budget: 0, sort_order: 5, kind: 'expense' },
  { name: '娯楽費', color: '#c95d8f', monthly_budget: 0, sort_order: 6, kind: 'expense' },
  { name: '特別費', color: '#b97e10', monthly_budget: 0, sort_order: 7, kind: 'expense' },
  { name: '給与', color: '#0ea5e9', monthly_budget: 0, sort_order: 8, kind: 'income' },
  { name: 'ボーナス', color: '#f59e0b', monthly_budget: 0, sort_order: 9, kind: 'income' },
  { name: 'その他収入', color: '#94a3b8', monthly_budget: 0, sort_order: 10, kind: 'income' }
];
function seedDefaultCategories(householdId) {
  var rows = DEFAULT_CATEGORIES.map(function (c) {
    return { id: newUuid(), household_id: householdId, name: c.name, color: c.color, monthly_budget: c.monthly_budget, sort_order: c.sort_order, kind: c.kind || 'expense' };
  });
  return sb.from('categories').insert(rows).then(function (res) {
    // カテゴリ作成に失敗しても家計簿自体の作成は成功扱いにする（設定タブから後で追加できる）
    if (res.error) console.error('デフォルトカテゴリの作成に失敗:', res.error);
  });
}
function doCreateHousehold() {
  var name = $('join-display-name').value.trim();
  var hname = $('new-household-name').value.trim() || 'ふたりの家計簿';
  showError($('join-error'), null);
  if (!name) { showError($('join-error'), '表示名を入力してください'); return; }
  var btn = $('btn-create-household');
  btn.disabled = true;
  btn.textContent = '作成中…';
  ensureProfile()
    .then(function () { return createHouseholdAndJoin(hname, name); })
    .then(function (hid) { toast('家計簿を作成しました'); return enterHousehold(hid); })
    .catch(function (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = '新しい家計簿を作成する';
      showError($('join-error'), describeDbError(err));
    });
}
function doJoinHousehold() {
  var name = $('join-display-name').value.trim();
  var hid = $('join-household-id').value.trim();
  showError($('join-error'), null);
  if (!name) { showError($('join-error'), '表示名を入力してください'); return; }
  if (!/^[0-9a-fA-F-]{36}$/.test(hid)) { showError($('join-error'), '家計簿IDの形式が正しくありません'); return; }
  var btn = $('btn-join-household');
  btn.disabled = true;
  btn.textContent = '参加処理中…';
  // 参加前の households 参照はRLSで見えないことがあるため、先に存在確認をせず、
  // memberships 作成時の外部キー制約で存在を検証する。
  ensureProfile()
    .then(function () { return joinHouseholdAndActivate(hid, name); })
    .then(function () { toast('家計簿に参加しました'); return enterHousehold(hid); })
    .catch(function (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = 'この家計簿に参加する';
      if (err && err.code === '23503') {
        showError($('join-error'), '家計簿が見つかりませんでした。IDを確認してください。');
      } else if (err && err.code === '23505') {
        showError($('join-error'), 'すでに参加しています。');
      } else {
        showError($('join-error'), describeDbError(err));
      }
    });
}

/* ---------- 設定タブ：家計簿名の変更シート（選択中の家計簿のみ） ---------- */
function openRenameHouseholdSheet() {
  var currentName = (state.household && state.household.name) || '';
  if (!currentName) {
    state.myHouseholds.forEach(function (h) { if (h.household_id === state.householdId) currentName = h.name; });
  }
  openSheet(
    '<h3>家計簿の名前を変更</h3>' +
    '<div class="field"><label for="hh-rename-name">家計簿の名前</label><input id="hh-rename-name" type="text" value="' + esc(currentName) + '" placeholder="例：ふたりの家計簿" /></div>' +
    '<div id="hh-rename-error" class="form-error hidden"></div>' +
    '<div class="stack" style="margin-top:16px;">' +
    '<button class="btn btn-primary btn-block" id="hh-rename-save">保存する</button>' +
    '<button class="btn btn-ghost btn-block" id="hh-rename-cancel">キャンセル</button></div>'
  );
  $('hh-rename-cancel').addEventListener('click', closeSheet);
  var renameInput = $('hh-rename-name');
  if (renameInput) {
    try { renameInput.focus(); renameInput.setSelectionRange(renameInput.value.length, renameInput.value.length); } catch (e) {}
  }
  $('hh-rename-save').addEventListener('click', function () {
    var newName = $('hh-rename-name').value.trim();
    var errEl = $('hh-rename-error');
    showError(errEl, null);
    if (!newName) { showError(errEl, '家計簿の名前を入力してください'); return; }
    if (newName === currentName) { closeSheet(); return; }
    var btn = $('hh-rename-save');
    btn.disabled = true;
    btn.textContent = '保存中…';
    // RLS の households_update は選択中の家計簿（current_household_id）に紐付くため、選択中のみ更新できる。
    // .select() で更新後の行を確認し、0件なら失敗として扱う（0行更新を成功とみなさない）。
    sb.from('households').update({ name: newName }).eq('id', state.householdId).select('id, name')
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) {
          throw new Error('家計簿名がデータベースに保存されませんでした（更新0件）。選択中の家計簿でない場合や、データベースの権限（RLSポリシー）で households の更新が拒否されている可能性があります。');
        }
        // 自分の変更は即時にローカル状態へ反映する
        if (state.household) state.household.name = newName;
        state.myHouseholds.forEach(function (h) { if (h.household_id === state.householdId) h.name = newName; });
        // 家計簿一覧（memberships × households）を読み直して表示を実データに合わせる
        return loadMyHouseholds().catch(function () { return null; })
          .then(function () { return reloadHousehold(); });
      })
      .then(function () {
        renderSettings();
        closeSheet();
        toast('家計簿名を変更しました');
      })
      .catch(function (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = '保存する';
        showError(errEl, describeDbError(err));
      });
  });
}

/* ---------- 設定タブ：家計簿の作成／参加シート ---------- */
function openCreateHouseholdSheet() {
  openSheet(
    '<h3>新しい家計簿を作成</h3>' +
    '<div class="field"><label for="hh-new-name">家計簿の名前</label><input id="hh-new-name" type="text" placeholder="例：自分の家計簿" /></div>' +
    '<div class="field"><label for="hh-new-display">この家計簿での表示名</label><input id="hh-new-display" type="text" value="' + esc(myDisplayName()) + '" placeholder="好きな名前を入力" /></div>' +
    '<div id="hh-sheet-error" class="form-error hidden"></div>' +
    '<div class="stack" style="margin-top:16px;">' +
    '<button class="btn btn-primary btn-block" id="hh-create-save">作成して切り替える</button>' +
    '<button class="btn btn-ghost btn-block" id="hh-create-cancel">キャンセル</button></div>'
  );
  $('hh-create-cancel').addEventListener('click', closeSheet);
  $('hh-create-save').addEventListener('click', function () {
    var hname = $('hh-new-name').value.trim();
    var dname = $('hh-new-display').value.trim();
    var errEl = $('hh-sheet-error');
    showError(errEl, null);
    if (!hname) { showError(errEl, '家計簿の名前を入力してください'); return; }
    if (!dname) { showError(errEl, '表示名を入力してください'); return; }
    var btn = $('hh-create-save');
    btn.disabled = true;
    btn.textContent = '作成中…';
    createHouseholdAndJoin(hname, dname)
      .then(function (hid) {
        closeSheet();
        return switchToHousehold(hid, hname);
      })
      .catch(function (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = '作成して切り替える';
        showError(errEl, householdSheetError(err));
      });
  });
}
function openJoinHouseholdSheet() {
  openSheet(
    '<h3>家計簿に参加</h3>' +
    '<div class="field"><label for="hh-join-id">参加する家計簿のID</label><input id="hh-join-id" type="text" autocomplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></div>' +
    '<div class="field"><label for="hh-join-display">この家計簿での表示名</label><input id="hh-join-display" type="text" value="' + esc(myDisplayName()) + '" placeholder="好きな名前を入力" /></div>' +
    '<div id="hh-sheet-error" class="form-error hidden"></div>' +
    '<div class="stack" style="margin-top:16px;">' +
    '<button class="btn btn-primary btn-block" id="hh-join-save">参加して切り替える</button>' +
    '<button class="btn btn-ghost btn-block" id="hh-join-cancel">キャンセル</button></div>'
  );
  $('hh-join-cancel').addEventListener('click', closeSheet);
  $('hh-join-save').addEventListener('click', function () {
    var hid = $('hh-join-id').value.trim();
    var dname = $('hh-join-display').value.trim();
    var errEl = $('hh-sheet-error');
    showError(errEl, null);
    if (!/^[0-9a-fA-F-]{36}$/.test(hid)) { showError(errEl, '家計簿IDの形式が正しくありません'); return; }
    if (!dname) { showError(errEl, '表示名を入力してください'); return; }
    if (hid === state.householdId) { showError(errEl, 'すでに参加しています（現在使用中の家計簿です）'); return; }
    var btn = $('hh-join-save');
    btn.disabled = true;
    btn.textContent = '参加処理中…';
    joinHouseholdAndActivate(hid, dname)
      .then(function () {
        closeSheet();
        return switchToHousehold(hid);
      })
      .catch(function (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = '参加して切り替える';
        showError(errEl, householdSheetError(err));
      });
  });
}

/* ============================================================
   イベント結線
   ============================================================ */
function bindEvents() {
  // テーマカラー選択
  document.querySelectorAll('.theme-swatch').forEach(function (b) {
    b.addEventListener('click', function () { applyTheme(b.getAttribute('data-theme-choice'), true); });
  });

  // 接続設定
  $('btn-save-config').addEventListener('click', function () {
    var url = $('cfg-url').value.trim().replace(/\/+$/, '');
    var key = $('cfg-key').value.trim();
    showError($('setup-error'), null);
    if (!url || !key) { showError($('setup-error'), 'URLとキーの両方を入力してください'); return; }
    var test = window.supabase.createClient(url, key);
    test.auth.getSession().then(function () {
      saveConfig({ url: url, key: key });
      location.reload();
    }).catch(function (err) { showError($('setup-error'), err); });
  });
  $('btn-to-setup').addEventListener('click', function () {
    var cfg = loadConfig();
    $('cfg-url').value = cfg ? cfg.url : DEFAULT_SUPABASE_URL;
    $('cfg-key').value = cfg ? cfg.key : DEFAULT_SUPABASE_KEY;
    showScreen('screen-setup');
  });
  $('btn-reset-config').addEventListener('click', function () {
    if (sb) sb.auth.signOut();
    clearConfig();
    location.reload();
  });
  // ログイン
  $('btn-login').addEventListener('click', doLogin);
  $('login-password').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  // 家計簿セットアップ
  $('btn-create-household').addEventListener('click', doCreateHousehold);
  $('btn-join-household').addEventListener('click', doJoinHousehold);
  $('btn-logout-join').addEventListener('click', doLogout);
  $('btn-logout').addEventListener('click', doLogout);
  // キーパッド
  Array.prototype.forEach.call(document.querySelectorAll('.key[data-key]'), function (b) {
    b.addEventListener('click', function () { pressKey(b.getAttribute('data-key')); });
  });
  $('key-submit').addEventListener('click', submitTransaction);
  // 種別トグル（使う／貯める／入る）
  Array.prototype.forEach.call(document.querySelectorAll('#kind-toggle button'), function (b) {
    b.addEventListener('click', function () { setInputKind(b.getAttribute('data-kind')); });
  });
  // タブ
  $('tabbtn-input').addEventListener('click', function () { switchTab('input'); });
  $('tabbtn-history').addEventListener('click', function () { switchTab('history'); });
  $('tabbtn-settings').addEventListener('click', function () { switchTab('settings'); });
  // 月切り替え
  $('month-prev').addEventListener('click', function () {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() - 1, 1);
    renderHistory();
  });
  $('month-next').addEventListener('click', function () {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + 1, 1);
    renderHistory();
  });
  // 設定
  $('btn-save-budgets').addEventListener('click', saveBudgets);
  // 貯蓄目標の保存と、編集中フラグ（再描画で入力値が消えないようにする）
  $('btn-save-savings-goal').addEventListener('click', saveSavingsGoal);
  ['set-savings-goal', 'set-savings-start'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('input', function () { state.savingsGoalDirty = true; });
  });
  // 入力タブ：立て替えトグル
  $('input-advance').addEventListener('change', function () { state.input.advance = this.checked; });
  // 設定：家計簿の作成／参加シート
  $('btn-open-create-household').addEventListener('click', openCreateHouseholdSheet);
  $('btn-open-join-household').addEventListener('click', openJoinHouseholdSheet);
  // 予算入力中は「編集中」として扱い、再描画で入力値が消えないようにする＋全体予算（自動計算）を随時更新
  $('set-cat-budgets').addEventListener('input', function () { state.budgetDirty = true; updateCatBudgetSum(); });
  $('btn-add-category').addEventListener('click', addCategory);
  // カテゴリ追加フォーム：種別に応じて金額ラベルを切り替え、収入では予算欄を隠す
  $('new-cat-kind').addEventListener('change', function () {
    var kind = $('new-cat-kind').value;
    $('new-cat-budget-field').classList.toggle('hidden', kind === 'income');
    $('new-cat-budget-label').textContent = kind === 'saving' ? '目標額（円）' : '月間予算（円）';
  });
  $('btn-add-recurring').addEventListener('click', function () { openRecurringSheet(null); });
  // シートを閉じる
  $('sheet-backdrop').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
}

bindEvents();
boot();

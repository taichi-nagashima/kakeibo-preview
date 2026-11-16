// ===== settings.js — タブ3：設定・固定費（共通支出家計簿） =====
'use strict';
/* ============================================================
   タブ3：設定
   ============================================================ */
function renderSettings() {
  if (!state.household) return;
  // 全体予算はカテゴリ予算の合計（自動計算）。編集中は入力欄の合計で表示を更新する
  if (!state.budgetDirty) {
    var td = $('set-total-display');
    if (td) td.textContent = fmtYen(categoryBudgetTotal());
  }
  // 貯蓄目標（編集中は入力途中の値を保持する）
  var goalInp = $('set-savings-goal'), startInp = $('set-savings-start');
  if (goalInp && startInp && !state.savingsGoalDirty) {
    var gv = state.household.savings_goal_amount;
    goalInp.value = (gv == null || gv === '') ? '' : gv;
    startInp.value = state.household.savings_start_amount || 0;
  }
  $('household-id-box').textContent = state.household.id;
  $('member-list').innerHTML = state.members.map(function (m) {
    return esc(m.display_name || 'メンバー') + (m.id === state.user.id ? '（あなた）' : '');
  }).join(' ・ ');
  renderMemberNames();
  renderHouseholdList();

  // カテゴリ別予算（編集中は入力途中の値を保持する）
  var bw = $('set-cat-budgets');
  var preservedBudgets = {};
  if (state.budgetDirty) {
    Array.prototype.forEach.call(bw.querySelectorAll('[data-catbudget]'), function (inp) {
      preservedBudgets[inp.getAttribute('data-catbudget')] = inp.value;
    });
  }
  bw.innerHTML = '';
  state.categories.forEach(function (c) {
    // 収入カテゴリには予算入力欄を出さない（保存時は0として扱う）
    if (catKind(c) === 'income') return;
    var row = document.createElement('div');
    row.className = 'set-row';
    var val = preservedBudgets[c.id] !== undefined ? preservedBudgets[c.id] : (c.monthly_budget || 0);
    var amountLabel = catKind(c) === 'saving' ? '目標額' : '月間予算';
    row.innerHTML = '<span class="dot" style="width:10px;height:10px;border-radius:50%;background:' + esc(c.color || '#999') + ';flex:none;"></span>' +
      '<div class="grow">' + esc(c.name) + '<div style="font-size:12px;color:var(--faint);margin-top:2px;">' + amountLabel + '</div></div>' +
      '<div class="yen-input"><span>¥</span><input type="number" min="0" inputmode="numeric" data-catbudget="' + esc(c.id) + '" data-kind="' + esc(catKind(c)) + '" value="' + esc(val) + '" /></div>';
    bw.appendChild(row);
  });
  updateCatBudgetSum();

  // カテゴリ管理
  var list = $('cat-manage-list');
  list.innerHTML = '';
  if (!state.categories.length) list.innerHTML = '<div class="empty-note">カテゴリがありません</div>';
  state.categories.forEach(function (c, idx) {
    var row = document.createElement('div');
    row.className = 'set-row cat-row';
    row.innerHTML =
      '<div class="set-row-top">' +
      '<input type="color" value="' + esc(safeColor(c.color)) + '" data-catcolor="' + esc(c.id) + '" aria-label="テーマカラー" />' +
      '<div class="grow"><input class="cat-name-input" type="text" value="' + esc(c.name) + '" data-catname="' + esc(c.id) + '" aria-label="カテゴリ名" /></div>' +
      '</div>' +
      '<div class="set-row-bottom">' +
      '<select class="cat-kind-select" data-catkind="' + esc(c.id) + '" aria-label="種別">' +
      '<option value="expense"' + (catKind(c) === 'expense' ? ' selected' : '') + '>支出</option>' +
      '<option value="saving"' + (catKind(c) === 'saving' ? ' selected' : '') + '>貯蓄・投資</option>' +
      '<option value="income"' + (catKind(c) === 'income' ? ' selected' : '') + '>収入</option>' +
      '</select>' +
      '<div class="set-actions">' +
      '<button class="icon-btn" data-move="-1" data-catid="' + esc(c.id) + '" aria-label="上へ" ' + (idx === 0 ? 'disabled style="opacity:.35"' : '') + '>↑</button>' +
      '<button class="icon-btn" data-move="1" data-catid="' + esc(c.id) + '" aria-label="下へ" ' + (idx === state.categories.length - 1 ? 'disabled style="opacity:.35"' : '') + '>↓</button>' +
      '<button class="mini-btn accent" data-catsave="' + esc(c.id) + '">保存</button>' +
      '<button class="mini-btn danger" data-catdel="' + esc(c.id) + '">削除</button>' +
      '</div></div>';
    list.appendChild(row);
  });
  Array.prototype.forEach.call(list.querySelectorAll('[data-catsave]'), function (b) {
    b.addEventListener('click', function () { saveCategory(b.getAttribute('data-catsave')); });
  });
  Array.prototype.forEach.call(list.querySelectorAll('[data-catdel]'), function (b) {
    b.addEventListener('click', function () { deleteCategory(b.getAttribute('data-catdel'), b); });
  });
  Array.prototype.forEach.call(list.querySelectorAll('[data-move]'), function (b) {
    b.addEventListener('click', function () { moveCategory(b.getAttribute('data-catid'), Number(b.getAttribute('data-move'))); });
  });

  renderRecurringList();
}
// 設定タブ「家計簿」セクション：参加中の家計簿一覧と切り替え
function renderHouseholdList() {
  var wrap = $('household-switch-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!state.myHouseholds.length) {
    wrap.innerHTML = '<div class="empty-note">参加中の家計簿がありません</div>';
    return;
  }
  state.myHouseholds.forEach(function (h) {
    var isActive = h.household_id === state.householdId;
    var row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML =
      '<div class="grow"><div style="font-weight:700;">' + esc(h.name) + '</div>' +
      '<div style="font-size:12px;color:var(--faint);margin-top:2px;">この家計簿での表示名：' + esc(h.display_name || 'メンバー') + '</div></div>' +
      (isActive
        ? '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none;"><span class="badge">使用中</span><button class="mini-btn" data-rename-household="' + esc(h.household_id) + '">名前を変更</button></div>'
        : '<button class="mini-btn accent" data-switch-household="' + esc(h.household_id) + '">切り替える</button>');
    wrap.appendChild(row);
  });
  Array.prototype.forEach.call(wrap.querySelectorAll('[data-switch-household]'), function (b) {
    b.addEventListener('click', function () { switchToHousehold(b.getAttribute('data-switch-household')); });
  });
  Array.prototype.forEach.call(wrap.querySelectorAll('[data-rename-household]'), function (b) {
    b.addEventListener('click', function () { openRenameHouseholdSheet(); });
  });
}
function renderMemberNames() {
  var wrap = $('member-name-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!state.members.length) {
    wrap.innerHTML = '<div class="empty-note">メンバーが見つかりません</div>';
    return;
  }
  state.members.forEach(function (m) {
    var isMe = m.id === state.user.id;
    var row = document.createElement('div');
    row.className = 'set-row';
    if (isMe) {
      row.innerHTML =
        '<div class="grow"><input class="cat-name-input" type="text" id="my-display-name" value="' + esc(m.display_name || '') + '" placeholder="好きな名前を入力" aria-label="自分の表示名" />' +
        '<div style="font-size:12px;color:var(--faint);margin-top:2px;">あなた（この端末でログイン中）</div></div>' +
        '<button class="mini-btn accent" id="btn-save-my-name">保存</button>';
      wrap.appendChild(row);
      row.querySelector('#btn-save-my-name').addEventListener('click', saveMyDisplayName);
    } else {
      row.innerHTML =
        '<div class="grow"><div style="font-weight:700;padding:6px 2px;">' + esc(m.display_name || 'メンバー') + '</div>' +
        '<div style="font-size:12px;color:var(--faint);">この名前は本人のアカウントで変更できます</div></div>';
      wrap.appendChild(row);
    }
  });
}
function saveMyDisplayName() {
  var inp = $('my-display-name');
  if (!inp) return;
  var name = inp.value.trim();
  if (!name) { toast('表示名を入力してください'); return; }
  if (name === myDisplayName()) { toast('表示名は変更ありません'); return; }
  var btn = $('btn-save-my-name');
  if (btn) btn.disabled = true;
  // 表示名は家計簿ごとに memberships へ保存する（選択中の家計簿での名前だけが変わる）
  sb.from('memberships').update({ display_name: name })
    .eq('user_id', state.user.id).eq('household_id', state.householdId).select('id')
    .then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('メンバー情報が見つかりませんでした');
      // ローカル状態を即時反映（支払者トグル・履歴・設定すべて）
      state.members.forEach(function (m) { if (m.id === state.user.id) m.display_name = name; });
      state.myHouseholds.forEach(function (h) { if (h.household_id === state.householdId) h.display_name = name; });
      renderPayerToggle();
      renderSettings();
      toast('表示名を「' + name + '」に変更しました');
    })
    .catch(function (err) {
      console.error(err);
      toast('名前の保存に失敗: ' + (err.message || ''));
      if (btn) btn.disabled = false;
    });
}
function safeColor(c) {
  return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#888888';
}
function updateCatBudgetSum() {
  // 入力中の「支出」カテゴリ予算だけをその場で合計し、全体予算（自動計算）の表示に反映する
  // （貯蓄・投資の目標額は全体予算に含めない）
  var sum = 0;
  Array.prototype.forEach.call(document.querySelectorAll('[data-catbudget]'), function (inp) {
    if (inp.getAttribute('data-kind') === 'saving') return;
    var v = parseInt(inp.value, 10);
    if (!isNaN(v) && v > 0) sum += v;
  });
  var disp = $('set-total-display');
  if (disp) disp.textContent = fmtYen(sum);
}
function reloadHousehold() {
  if (!state.household) return Promise.resolve();
  return sb.from('households').select('*').eq('id', state.household.id).single()
    .then(function (res) {
      if (!res.error && res.data) state.household = res.data;
    });
}
// households.total_monthly_budget をカテゴリ予算の合計に合わせて保存する
// （カテゴリの追加・削除など、予算設定画面以外でカテゴリ予算が変わったとき用）
function syncTotalBudget() {
  if (!state.household) return Promise.resolve();
  var total = categoryBudgetTotal();
  if ((state.household.total_monthly_budget || 0) === total) return Promise.resolve();
  return sb.from('households').update({ total_monthly_budget: total }).eq('id', state.household.id).select('id')
    .then(function (res) {
      if (res.error) { console.error(res.error); return; }
      if (res.data && res.data.length) state.household.total_monthly_budget = total;
    })
    .catch(function (e) { console.error(e); });
}
function saveBudgets() {
  // 保存ボタン押下時点のカテゴリ予算を控える（再描画で入力欄が作り直されても値を失わないため）
  var catValues = {};
  var total = 0;
  Array.prototype.forEach.call(document.querySelectorAll('[data-catbudget]'), function (inp) {
    var v = parseInt(inp.value, 10);
    if (isNaN(v) || v < 0) v = 0;
    catValues[inp.getAttribute('data-catbudget')] = v;
    // 全体予算は「支出」カテゴリの予算合計だけ（貯蓄・投資の目標額は含めない）
    if (inp.getAttribute('data-kind') !== 'saving') total += v;
  });
  // 収入カテゴリは予算入力欄が無いので、常に0で保存する
  state.categories.forEach(function (c) {
    if (catKind(c) === 'income' && catValues[c.id] === undefined) catValues[c.id] = 0;
  });
  var btn = $('btn-save-budgets');
  if (btn) btn.disabled = true;
  // .select() で更新後の行を返させ、実際に何件更新できたかを検証する。
  // RLSで弾かれた UPDATE はエラーにならず「0件更新」のまま成功扱いになるため、
  // 行が返ってこない場合は保存できていないものとして扱う。
  var jobs = [sb.from('households').update({ total_monthly_budget: total }).eq('id', state.household.id).select('id')];
  Object.keys(catValues).forEach(function (id) {
    jobs.push(sb.from('categories').update({ monthly_budget: catValues[id] }).eq('id', id).select('id'));
  });
  Promise.all(jobs).then(function (rs) {
    for (var i = 0; i < rs.length; i++) {
      if (rs[i].error) throw rs[i].error;
      if (!rs[i].data || !rs[i].data.length) {
        throw new Error(i === 0
          ? '全体予算がデータベースに保存されませんでした（更新0件）。データベースの権限（RLSポリシー）で households の更新が拒否されている可能性があります。'
          : '一部のカテゴリ予算がデータベースに保存されませんでした（更新0件）。データベースの権限（RLSポリシー）を確認してください。');
      }
    }
    // 保存できた値をサーバーから読み直し、ローカル状態と全画面の表示を実データに合わせる
    return Promise.all([reloadHousehold(), reloadCategories()]);
  }).then(function () {
    state.budgetDirty = false;
    renderSettings();
    refreshInputSummary();
    if ($('tab-history').classList.contains('active')) renderHistory();
    toast('予算を保存しました');
  }).catch(function (err) {
    console.error(err);
    toast('保存に失敗: ' + (err.message || ''));
  }).then(function () {
    if (btn) btn.disabled = false;
  });
}
// 貯蓄目標の保存：households の savings_goal_amount / savings_start_amount を更新する。
// 目標額が空欄なら null（未設定）として保存し、進捗カードは表示されなくなる。
function saveSavingsGoal() {
  var goalRaw = $('set-savings-goal').value.trim();
  var startRaw = $('set-savings-start').value.trim();
  var goal = goalRaw === '' ? null : parseInt(goalRaw, 10);
  if (goal !== null && (isNaN(goal) || goal < 0)) { toast('目標額を正しく入力してください'); return; }
  var start = startRaw === '' ? 0 : parseInt(startRaw, 10);
  if (isNaN(start) || start < 0) { toast('開始時の資産額を正しく入力してください'); return; }
  var btn = $('btn-save-savings-goal');
  if (btn) btn.disabled = true;
  sb.from('households').update({ savings_goal_amount: goal, savings_start_amount: start }).eq('id', state.household.id).select('id')
    .then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) {
        throw new Error('貯蓄目標がデータベースに保存されませんでした（更新0件）。データベースの権限（RLSポリシー）で households の更新が拒否されている可能性があります。');
      }
      state.household.savings_goal_amount = goal;
      state.household.savings_start_amount = start;
      state.savingsGoalDirty = false;
      toast('貯蓄目標を保存しました');
    })
    .catch(function (err) {
      console.error(err);
      toast('保存に失敗: ' + (err.message || ''));
    })
    .then(function () { if (btn) btn.disabled = false; });
}
function saveCategory(id) {
  var nameInp = document.querySelector('[data-catname="' + id + '"]');
  var colorInp = document.querySelector('[data-catcolor="' + id + '"]');
  var kindSel = document.querySelector('[data-catkind="' + id + '"]');
  var name = nameInp.value.trim();
  if (!name) { toast('カテゴリ名を入力してください'); return; }
  var kind = kindSel ? kindSel.value : 'expense';
  var patch = { name: name, color: colorInp.value, kind: kind };
  // 収入カテゴリに予算は無いので0にする
  if (kind === 'income') patch.monthly_budget = 0;
  sb.from('categories').update(patch).eq('id', id)
    .then(function (res) {
      if (res.error) throw res.error;
      return reloadCategories();
    })
    .then(function () { toast('カテゴリを保存しました'); })
    .catch(function (err) { toast('保存に失敗: ' + (err.message || '')); });
}
function deleteCategory(id, btn) {
  if (btn.getAttribute('data-confirm') !== '1') {
    btn.setAttribute('data-confirm', '1');
    btn.textContent = '本当に削除？';
    setTimeout(function () { btn.removeAttribute('data-confirm'); btn.textContent = '削除'; }, 3000);
    return;
  }
  sb.from('categories').delete().eq('id', id).then(function (res) {
    if (res.error) throw res.error;
    if (state.input.categoryId === id) state.input.categoryId = null;
    return reloadCategories().then(function () { return syncTotalBudget(); });
  }).then(function () { toast('カテゴリを削除しました'); })
    .catch(function (err) { toast('削除に失敗（使用中のカテゴリは削除できません）'); console.error(err); });
}
function moveCategory(id, dir) {
  var idx = -1;
  state.categories.forEach(function (c, i) { if (c.id === id) idx = i; });
  var j = idx + dir;
  if (idx < 0 || j < 0 || j >= state.categories.length) return;
  var a = state.categories[idx], b = state.categories[j];
  Promise.all([
    sb.from('categories').update({ sort_order: b.sort_order }).eq('id', a.id),
    sb.from('categories').update({ sort_order: a.sort_order }).eq('id', b.id)
  ]).then(function (rs) {
    for (var i = 0; i < rs.length; i++) { if (rs[i].error) throw rs[i].error; }
    return reloadCategories();
  }).catch(function (err) { toast('並び替えに失敗: ' + (err.message || '')); });
}
function addCategory() {
  var name = $('new-cat-name').value.trim();
  if (!name) { toast('カテゴリ名を入力してください'); return; }
  var kind = $('new-cat-kind').value || 'expense';
  var budget = parseInt($('new-cat-budget').value, 10);
  if (isNaN(budget) || budget < 0) budget = 0;
  // 収入カテゴリに予算は無いので0で保存する
  if (kind === 'income') budget = 0;
  var maxOrder = state.categories.reduce(function (a, c) { return Math.max(a, c.sort_order || 0); }, 0);
  sb.from('categories').insert({
    household_id: state.household.id,
    name: name,
    monthly_budget: budget,
    color: $('new-cat-color').value,
    sort_order: maxOrder + 1,
    kind: kind
  }).then(function (res) {
    if (res.error) throw res.error;
    $('new-cat-name').value = '';
    $('new-cat-budget').value = '';
    return reloadCategories().then(function () { return syncTotalBudget(); });
  }).then(function () { toast('カテゴリを追加しました'); })
    .catch(function (err) { toast('追加に失敗: ' + (err.message || '')); });
}

/* ---------- 固定費 ---------- */
function renderRecurringList() {
  var wrap = $('rec-list');
  wrap.innerHTML = '';
  if (!state.recurring.length) {
    wrap.innerHTML = '<div class="empty-note">固定費はまだ登録されていません</div>';
    return;
  }
  state.recurring.forEach(function (re) {
    var cat = categoryById(re.category_id);
    var row = document.createElement('div');
    row.className = 'set-row rec-row' + (re.is_active ? '' : ' off');
    row.innerHTML =
      '<div class="grow"><div class="t">' + esc(re.title) + '</div>' +
      '<div class="s tnum">毎月' + (re.billing_day >= 29 ? '末日' : re.billing_day + '日') + ' ・ ' + fmtYen(re.amount) + ' ・ ' +
      esc(cat ? cat.name : '') + ' ・ ' + esc(memberName(re.payer_id)) + '</div></div>' +
      '<label class="switch" aria-label="自動登録の有効・無効"><input type="checkbox" data-recactive="' + esc(re.id) + '"' + (re.is_active ? ' checked' : '') + ' /><span class="tr"></span></label>' +
      '<button class="mini-btn" data-recedit="' + esc(re.id) + '">編集</button>';
    wrap.appendChild(row);
  });
  Array.prototype.forEach.call(wrap.querySelectorAll('[data-recactive]'), function (inp) {
    inp.addEventListener('change', function () {
      var id = inp.getAttribute('data-recactive');
      sb.from('recurring_expenses').update({ is_active: inp.checked }).eq('id', id)
        .then(function (res) {
          if (res.error) throw res.error;
          state.recurring.forEach(function (r) { if (r.id === id) r.is_active = inp.checked; });
          renderRecurringList();
        })
        .catch(function (err) { toast('更新に失敗: ' + (err.message || '')); inp.checked = !inp.checked; });
    });
  });
  Array.prototype.forEach.call(wrap.querySelectorAll('[data-recedit]'), function (b) {
    b.addEventListener('click', function () { openRecurringSheet(b.getAttribute('data-recedit')); });
  });
}
function reloadRecurring() {
  return sb.from('recurring_expenses').select('*').eq('household_id', state.household.id).order('created_at')
    .then(function (res) {
      if (!res.error) { state.recurring = res.data || []; renderRecurringList(); }
    });
}

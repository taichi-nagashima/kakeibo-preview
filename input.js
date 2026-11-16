// ===== input.js — タブ1：入力（共通支出家計簿） =====
'use strict';
/* ============================================================
   タブ1：入力
   ============================================================ */
function initInputTab() {
  // 支払者デフォルト = ログインユーザー
  state.input.payerId = state.user.id;
  // 種別デフォルト = 使う（支出）
  state.input.kind = 'expense';
  // カテゴリデフォルト = 「特別費」があればそれ、なければ先頭の支出カテゴリ
  var def = null;
  state.categories.forEach(function (c) { if (c.name === '特別費') def = c; });
  if (!def) state.categories.forEach(function (c) { if (!def && catKind(c) === 'expense') def = c; });
  state.input.categoryId = def ? def.id : (state.categories[0] ? state.categories[0].id : null);
  state.input.entry = '';
  state.input.pending = null;
  state.input.advance = false;
  $('input-advance').checked = false;
  $('input-date').value = todayStr();
  $('input-memo').value = '';
  renderKindToggle();
  updateAdvanceRow();
  renderPayerToggle();
  renderCategoryChips();
  updateAmountDisplay();
}
function renderKindToggle() {
  Array.prototype.forEach.call(document.querySelectorAll('#kind-toggle button'), function (b) {
    b.classList.toggle('on', b.getAttribute('data-kind') === state.input.kind);
  });
}
function setInputKind(kind) {
  if (state.input.kind === kind) return;
  state.input.kind = kind;
  renderKindToggle();
  updateAdvanceRow();
  renderCategoryChips();
  refreshInputSummary();
}
// 立て替えトグルは「使う（支出）」のときだけ表示する
function updateAdvanceRow() {
  var isExpense = state.input.kind === 'expense';
  $('advance-row').classList.toggle('hidden', !isExpense);
  if (!isExpense && state.input.advance) {
    state.input.advance = false;
    $('input-advance').checked = false;
  }
}
function renderPayerToggle() {
  var wrap = $('payer-toggle');
  wrap.innerHTML = '';
  state.members.forEach(function (m) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.display_name || 'メンバー';
    if (m.id === state.input.payerId) b.classList.add('on');
    b.addEventListener('click', function () {
      state.input.payerId = m.id;
      renderPayerToggle();
    });
    wrap.appendChild(b);
  });
  if (!state.members.length) {
    wrap.innerHTML = '<span style="color:var(--faint);font-size:14px;">メンバーが見つかりません</span>';
  }
}
function renderCategoryChips() {
  var wrap = $('category-chips');
  wrap.innerHTML = '';
  // 選択中の種別のカテゴリだけを表示する
  var cats = state.categories.filter(function (c) { return catKind(c) === state.input.kind; });
  if (!cats.length) {
    wrap.innerHTML = '<span style="color:var(--faint);font-size:14px;">この種別のカテゴリがありません（設定タブから追加できます）</span>';
    state.input.categoryId = null;
    updateAmountDisplay();
    return;
  }
  var found = false;
  cats.forEach(function (c) { if (c.id === state.input.categoryId) found = true; });
  if (!found) state.input.categoryId = cats[0].id;
  cats.forEach(function (c) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (c.id === state.input.categoryId ? ' on' : '');
    b.innerHTML = '<span class="dot" style="background:' + esc(c.color || '#999') + '"></span>' + esc(c.name);
    b.addEventListener('click', function () {
      state.input.categoryId = c.id;
      renderCategoryChips();
      refreshInputSummary();
    });
    wrap.appendChild(b);
  });
}
function currentAmount() {
  var entry = state.input.entry === '' ? 0 : parseInt(state.input.entry, 10);
  if (isNaN(entry)) entry = 0;
  return (state.input.pending || 0) + entry;
}
function updateAmountDisplay() {
  var inp = state.input;
  var entryDisp = inp.entry === '' ? '0' : Number(inp.entry).toLocaleString('ja-JP');
  if (inp.pending !== null) {
    $('amount-expr').textContent = Number(inp.pending).toLocaleString('ja-JP') + ' + ' + entryDisp;
    $('amount-value').textContent = currentAmount().toLocaleString('ja-JP');
  } else {
    $('amount-expr').textContent = '';
    $('amount-value').textContent = entryDisp;
  }
  $('key-submit').disabled = currentAmount() <= 0 || !state.input.categoryId || !state.input.payerId;
}
function pressKey(k) {
  var inp = state.input;
  if (k === 'C') {
    if (inp.entry !== '') inp.entry = '';
    else inp.pending = null;
  } else if (k === '+') {
    var v = inp.entry === '' ? 0 : parseInt(inp.entry, 10);
    if (!isNaN(v) && v > 0) {
      inp.pending = (inp.pending || 0) + v;
      inp.entry = '';
    }
  } else {
    // 数字 / 00
    var next = (inp.entry === '0' ? '' : inp.entry) + k;
    next = next.replace(/^0+(?=\d)/, '');
    if (next.length <= 9) inp.entry = next;
  }
  updateAmountDisplay();
}
function refreshInputSummary() {
  if (!state.household) return;
  var key = monthKey(new Date());
  var txs = state.monthTx[key] || [];
  // 全体は「支出」だけを対象にする（貯蓄・投資と収入は予算の使用に数えない）
  var totalBudget = categoryBudgetTotal();
  var totalUsed = sumByKind(txs, 'expense');
  var totalRemain = totalBudget - totalUsed;
  var el = $('sum-total-remain');
  el.innerHTML = '<small>¥</small>' + totalRemain.toLocaleString('ja-JP');
  el.classList.toggle('neg', totalRemain < 0);
  $('sum-total-sub').textContent = '使用 ' + fmtYen(totalUsed) + ' / 予算 ' + fmtYen(totalBudget);

  var cat = categoryById(state.input.categoryId);
  if (cat) {
    var byCat = sumByCategory(txs);
    var used = byCat[cat.id] || 0;
    var kind = catKind(cat);
    var el2 = $('sum-cat-remain');
    if (kind === 'income') {
      $('sum-cat-cap').textContent = cat.name + '（今月の収入）';
      el2.innerHTML = '<small>¥</small>' + used.toLocaleString('ja-JP');
      el2.classList.remove('neg');
      $('sum-cat-sub').textContent = '今月入った金額の合計';
    } else if (kind === 'saving') {
      $('sum-cat-cap').textContent = cat.name + ' の目標残り';
      var sRemain = (cat.monthly_budget || 0) - used;
      el2.innerHTML = '<small>¥</small>' + sRemain.toLocaleString('ja-JP');
      el2.classList.toggle('neg', sRemain < 0);
      $('sum-cat-sub').textContent = '貯蓄・投資 ' + fmtYen(used) + ' / 目標 ' + fmtYen(cat.monthly_budget || 0);
    } else {
      $('sum-cat-cap').textContent = cat.name + ' の予算残り';
      var remain = (cat.monthly_budget || 0) - used;
      el2.innerHTML = '<small>¥</small>' + remain.toLocaleString('ja-JP');
      el2.classList.toggle('neg', remain < 0);
      $('sum-cat-sub').textContent = '使用 ' + fmtYen(used) + ' / 予算 ' + fmtYen(cat.monthly_budget || 0);
    }
  } else {
    $('sum-cat-cap').textContent = 'カテゴリ予算残り';
    $('sum-cat-remain').textContent = '—';
    $('sum-cat-sub').textContent = '';
  }
}
function submitTransaction() {
  var amount = currentAmount();
  if (amount <= 0) return;
  var date = $('input-date').value || todayStr();
  var memo = $('input-memo').value.trim();
  var btn = $('key-submit');
  btn.disabled = true;
  var selCat = categoryById(state.input.categoryId);
  sb.from('transactions').insert({
    household_id: state.household.id,
    category_id: state.input.categoryId,
    payer_id: state.input.payerId,
    amount: amount,
    spent_date: date,
    memo: memo || null,
    source: 'manual',
    external_id: null,
    kind: selCat ? catKind(selCat) : 'expense',
    is_advance: state.input.kind === 'expense' ? !!state.input.advance : false,
    advance_settled: false
  }).then(function (res) {
    if (res.error) throw res.error;
    // ローカルキャッシュへ即時反映（表示月・当月）
    var mk = date.slice(0, 7);
    delete state.monthTx[mk];
    return loadMonth(mk, true).then(function () {
      state.input.entry = '';
      state.input.pending = null;
      state.input.advance = false;
      $('input-advance').checked = false;
      $('input-memo').value = '';
      updateAmountDisplay();
      refreshInputSummary();
      var disp = $('amount-display');
      disp.classList.remove('pop');
      void disp.offsetWidth;
      disp.classList.add('pop');
      toast(fmtYen(amount) + ' を登録しました');
      btn.disabled = currentAmount() <= 0;
    });
  }).catch(function (err) {
    console.error(err);
    toast('登録に失敗: ' + (err.message || '通信に失敗しました'));
    btn.disabled = currentAmount() <= 0;
  });
}

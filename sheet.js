// ===== sheet.js — ボトムシート（明細編集／固定費編集）（共通支出家計簿） =====
'use strict';
/* ============================================================
   ボトムシート（明細編集 / 固定費編集）
   ============================================================ */
function openSheet(html) {
  $('sheet-content').innerHTML = html;
  $('sheet-backdrop').classList.add('open');
}
function closeSheet() { $('sheet-backdrop').classList.remove('open'); }
function optionsHTML(items, selectedId, labelFn) {
  return items.map(function (it) {
    return '<option value="' + esc(it.id) + '"' + (it.id === selectedId ? ' selected' : '') + '>' + esc(labelFn(it)) + '</option>';
  }).join('');
}
function findTx(id) {
  var found = null;
  Object.keys(state.monthTx).forEach(function (k) {
    state.monthTx[k].forEach(function (t) { if (t.id === id) found = t; });
  });
  return found;
}
function openTxSheet(id) {
  var t = findTx(id);
  if (!t) return;
  var badge = SOURCE_BADGES[t.source];
  openSheet(
    '<h3>支出を編集' + (badge ? ' <span class="badge ' + badge.cls + '">' + esc(badge.label) + '</span>' : '') + '</h3>' +
    '<div class="field"><label for="ed-amount">金額（円）</label><input id="ed-amount" type="number" inputmode="numeric" min="1" value="' + t.amount + '" /></div>' +
    '<div class="field"><label for="ed-date">日付</label><input id="ed-date" type="date" value="' + esc(t.spent_date) + '" /></div>' +
    '<div class="field"><label for="ed-category">カテゴリ</label><select id="ed-category">' + optionsHTML(state.categories, t.category_id, function (c) { return c.name; }) + '</select></div>' +
    '<div class="field"><label for="ed-payer">支払った人</label><select id="ed-payer">' + optionsHTML(state.members, t.payer_id, function (m) { return m.display_name || 'メンバー'; }) + '</select></div>' +
    '<div class="field"><label for="ed-memo">メモ</label><input id="ed-memo" type="text" value="' + esc(t.memo || '') + '" placeholder="店名・ひとことメモ" /></div>' +
    '<div class="sheet-toggle-row"><span class="sheet-toggle-label">立て替え</span><label class="switch" aria-label="立て替え"><input type="checkbox" id="ed-advance"' + (t.is_advance ? ' checked' : '') + ' /><span class="tr"></span></label></div>' +
    '<div class="sheet-toggle-row' + (t.is_advance ? '' : ' hidden') + '" id="ed-settled-row"><span class="sheet-toggle-label">精算済み</span><label class="switch" aria-label="精算済み"><input type="checkbox" id="ed-settled"' + (t.advance_settled ? ' checked' : '') + ' /><span class="tr"></span></label></div>' +
    '<div class="stack" style="margin-top:16px;">' +
    '<button class="btn btn-primary btn-block" id="ed-save">保存する</button>' +
    '<button class="btn btn-danger btn-block" id="ed-delete">この支出を削除</button>' +
    '<button class="btn btn-ghost btn-block" id="ed-cancel">キャンセル</button></div>'
  );
  $('ed-cancel').addEventListener('click', closeSheet);
  $('ed-advance').addEventListener('change', function () {
    $('ed-settled-row').classList.toggle('hidden', !this.checked);
  });
  $('ed-save').addEventListener('click', function () {
    var amount = parseInt($('ed-amount').value, 10);
    if (isNaN(amount) || amount <= 0) { toast('金額を正しく入力してください'); return; }
    var newCat = categoryById($('ed-category').value);
    var isAdv = $('ed-advance').checked;
    sb.from('transactions').update({
      amount: amount,
      spent_date: $('ed-date').value || t.spent_date,
      category_id: $('ed-category').value,
      payer_id: $('ed-payer').value,
      memo: $('ed-memo').value.trim() || null,
      // 取引の種別は、選んだカテゴリの種別に合わせる
      kind: newCat ? catKind(newCat) : (t.kind || 'expense'),
      is_advance: isAdv,
      advance_settled: isAdv ? $('ed-settled').checked : false
    }).eq('id', t.id).then(function (res) {
      if (res.error) throw res.error;
      Object.keys(state.monthTx).forEach(function (k) { delete state.monthTx[k]; });
      closeSheet();
      toast('保存しました');
      return Promise.all([ensureCurrentMonthLoaded(), loadMonth(monthKey(state.viewMonth), true)]);
    }).then(function () {
      refreshInputSummary();
      if ($('tab-history').classList.contains('active')) renderHistory();
    }).catch(function (err) { toast('保存に失敗: ' + (err.message || '')); });
  });
  $('ed-delete').addEventListener('click', function () {
    var b = $('ed-delete');
    if (b.getAttribute('data-confirm') !== '1') {
      b.setAttribute('data-confirm', '1');
      b.textContent = '本当に削除しますか？（もう一度タップ）';
      return;
    }
    sb.from('transactions').delete().eq('id', t.id).then(function (res) {
      if (res.error) throw res.error;
      Object.keys(state.monthTx).forEach(function (k) { delete state.monthTx[k]; });
      closeSheet();
      toast('削除しました');
      return Promise.all([ensureCurrentMonthLoaded(), loadMonth(monthKey(state.viewMonth), true)]);
    }).then(function () {
      refreshInputSummary();
      if ($('tab-history').classList.contains('active')) renderHistory();
    }).catch(function (err) { toast('削除に失敗: ' + (err.message || '')); });
  });
}
function billingDayOptions(selected) {
  var html = '';
  for (var d = 1; d <= 28; d++) {
    html += '<option value="' + d + '"' + (selected === d ? ' selected' : '') + '>' + d + '日</option>';
  }
  html += '<option value="31"' + (selected >= 29 ? ' selected' : '') + '>末日</option>';
  return html;
}
function openRecurringSheet(id) {
  var re = null;
  state.recurring.forEach(function (r) { if (r.id === id) re = r; });
  var isNew = !re;
  if (isNew) re = { title: '', amount: '', billing_day: 1, category_id: state.categories[0] ? state.categories[0].id : null, payer_id: state.user.id, is_active: true };
  openSheet(
    '<h3>' + (isNew ? '固定費を追加' : '固定費を編集') + '</h3>' +
    '<div class="field"><label for="re-title">名称</label><input id="re-title" type="text" value="' + esc(re.title) + '" placeholder="例：家賃" /></div>' +
    '<div class="field"><label for="re-amount">金額（円）</label><input id="re-amount" type="number" inputmode="numeric" min="1" value="' + esc(re.amount) + '" /></div>' +
    '<div class="field"><label for="re-day">毎月の計上日</label><select id="re-day">' + billingDayOptions(re.billing_day || 1) + '</select></div>' +
    '<div class="field"><label for="re-category">カテゴリ</label><select id="re-category">' + optionsHTML(state.categories, re.category_id, function (c) { return c.name; }) + '</select></div>' +
    '<div class="field"><label for="re-payer">支払った人</label><select id="re-payer">' + optionsHTML(state.members, re.payer_id, function (m) { return m.display_name || 'メンバー'; }) + '</select></div>' +
    '<div class="stack" style="margin-top:16px;">' +
    '<button class="btn btn-primary btn-block" id="re-save">保存する</button>' +
    (isNew ? '' : '<button class="btn btn-danger btn-block" id="re-delete">この固定費を削除</button>') +
    '<button class="btn btn-ghost btn-block" id="re-cancel">キャンセル</button></div>'
  );
  $('re-cancel').addEventListener('click', closeSheet);
  $('re-save').addEventListener('click', function () {
    var title = $('re-title').value.trim();
    var amount = parseInt($('re-amount').value, 10);
    if (!title) { toast('名称を入力してください'); return; }
    if (isNaN(amount) || amount <= 0) { toast('金額を正しく入力してください'); return; }
    var payload = {
      title: title,
      amount: amount,
      billing_day: parseInt($('re-day').value, 10),
      category_id: $('re-category').value,
      payer_id: $('re-payer').value
    };
    var q = isNew
      ? sb.from('recurring_expenses').insert(Object.assign({ household_id: state.household.id, is_active: true }, payload))
      : sb.from('recurring_expenses').update(payload).eq('id', re.id);
    q.then(function (res) {
      if (res.error) throw res.error;
      closeSheet();
      toast('固定費を保存しました');
      state.autoPostDone = false;
      return reloadRecurring().then(function () { return runAutoPostFixed(); });
    }).then(function () {
      refreshInputSummary();
      if ($('tab-history').classList.contains('active')) renderHistory();
    }).catch(function (err) { toast('保存に失敗: ' + (err.message || '')); });
  });
  if (!isNew) {
    $('re-delete').addEventListener('click', function () {
      var b = $('re-delete');
      if (b.getAttribute('data-confirm') !== '1') {
        b.setAttribute('data-confirm', '1');
        b.textContent = '本当に削除しますか？（もう一度タップ）';
        return;
      }
      sb.from('recurring_expenses').delete().eq('id', re.id).then(function (res) {
        if (res.error) throw res.error;
        closeSheet();
        toast('固定費を削除しました');
        return reloadRecurring();
      }).catch(function (err) { toast('削除に失敗: ' + (err.message || '')); });
    });
  }
}

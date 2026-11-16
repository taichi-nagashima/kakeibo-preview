// ===== data.js — データ取得・固定費の自動計上・リアルタイム購読（共通支出家計簿） =====
'use strict';
/* ---------- データ取得（月別 transactions） ---------- */
function loadMonth(key, force) {
  if (!force && state.monthTx[key]) return Promise.resolve(state.monthTx[key]);
  var r = monthRange(key);
  return sb.from('transactions').select('*')
    .eq('household_id', state.household.id)
    .gte('spent_date', r.start).lte('spent_date', r.end)
    .order('spent_date', { ascending: false })
    .order('created_at', { ascending: false })
    .then(function (res) {
      if (res.error) throw res.error;
      state.monthTx[key] = res.data || [];
      return state.monthTx[key];
    });
}
function ensureCurrentMonthLoaded() {
  return loadMonth(monthKey(new Date())).catch(function (e) { console.error(e); });
}
function sumByCategory(txs) {
  var map = {};
  txs.forEach(function (t) {
    // 立て替えはカテゴリ別バーの実績にも含めない
    if (t.is_advance) return;
    map[t.category_id] = (map[t.category_id] || 0) + (t.amount || 0);
  });
  return map;
}
function sumTotal(txs) {
  return txs.reduce(function (a, t) { return a + (t.amount || 0); }, 0);
}

/* ---------- 固定費の自動計上 ---------- */
function runAutoPostFixed() {
  if (state.autoPostDone) return Promise.resolve();
  state.autoPostDone = true;
  var now = new Date();
  var key = monthKey(now);
  var r = monthRange(key);
  var today = now.getDate();
  var targets = state.recurring.filter(function (re) {
    if (!re.is_active) return false;
    var day = Math.min(re.billing_day || 1, r.lastDay);
    return today >= day;
  });
  if (!targets.length) return Promise.resolve();
  return loadMonth(key).then(function (txs) {
    var existing = {};
    txs.forEach(function (t) { if (t.external_id) existing[t.external_id] = true; });
    var jobs = targets.filter(function (re) {
      return !existing['fixed_' + re.id + '_' + key];
    }).map(function (re) {
      var day = Math.min(re.billing_day || 1, r.lastDay);
      var reCat = categoryById(re.category_id);
      return sb.from('transactions').insert({
        household_id: state.household.id,
        category_id: re.category_id,
        payer_id: re.payer_id,
        amount: re.amount,
        spent_date: key + '-' + pad2(day),
        memo: re.title,
        source: 'fixed_auto',
        external_id: 'fixed_' + re.id + '_' + key,
        kind: reCat ? catKind(reCat) : 'expense'
      }).then(function (res) {
        // 23505 = unique violation（パートナー側で登録済み）→ 無視
        if (res.error && res.error.code !== '23505') console.error(res.error);
      });
    });
    return Promise.all(jobs);
  }).then(function () {
    delete state.monthTx[key];
    return loadMonth(key, true);
  }).catch(function (e) { console.error(e); });
}

/* ---------- リアルタイム購読 ---------- */
function subscribeRealtime() {
  if (state.realtimeChannel) { sb.removeChannel(state.realtimeChannel); state.realtimeChannel = null; }
  var hid = state.household.id;
  state.realtimeChannel = sb.channel('kakeibo-' + hid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: 'household_id=eq.' + hid }, function () {
      Object.keys(state.monthTx).forEach(function (k) { delete state.monthTx[k]; });
      ensureCurrentMonthLoaded().then(function () {
        refreshInputSummary();
        if ($('tab-history').classList.contains('active')) renderHistory();
      });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: 'household_id=eq.' + hid }, function () {
      reloadCategories();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'households', filter: 'id=eq.' + hid }, function () {
      sb.from('households').select('*').eq('id', hid).single().then(function (res) {
        if (!res.error && res.data) {
          state.household = res.data;
          loadMyHouseholds().catch(function () {}).then(function () { refreshInputSummary(); renderSettings(); });
        }
      });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'memberships', filter: 'household_id=eq.' + hid }, function () {
      reloadMembers();
    })
    .subscribe();
}
function reloadMembers() {
  if (!state.household) return Promise.resolve();
  return sb.from('memberships').select('*').eq('household_id', state.household.id).order('created_at')
    .then(function (res) {
      if (res.error) return;
      state.members = (res.data || []).map(membershipToMember);
      return loadMyHouseholds().catch(function () {});
    })
    .then(function () {
      renderPayerToggle();
      renderSettings();
      if ($('tab-history').classList.contains('active')) renderHistory();
    });
}
function reloadCategories() {
  return sb.from('categories').select('*').eq('household_id', state.household.id).order('sort_order')
    .then(function (res) {
      if (res.error) return;
      state.categories = res.data || [];
      renderCategoryChips();
      renderSettings();
      refreshInputSummary();
    });
}

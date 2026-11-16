// ===== history.js — タブ2：履歴・集計（共通支出家計簿） =====
'use strict';
'use strict';
/* ============================================================
   タブ2：履歴・集計
   ============================================================ */
// 支払者ごとの識別色（支払者別カードの色ドットと割合バーのセグメントで共通使用）
var PAYER_PALETTE = ['var(--accent)', '#e07856', '#5b8dd9', '#b97e10'];
function payerColor(i) { return PAYER_PALETTE[i % PAYER_PALETTE.length]; }
var SOURCE_BADGES = {
  fixed_auto: { label: '固定費', cls: '' },
  muse: { label: 'AI自動登録', cls: '' },
  card_sync: { label: 'カード連携', cls: 'card' }
};
function barHTML(name, color, used, budget, amountLabel) {
  var label = amountLabel || '予算';
  var pct = budget > 0 ? Math.min(100, Math.round(used / budget * 100)) : (used > 0 ? 100 : 0);
  var over = budget > 0 && used > budget;
  var remain = budget - used;
  return '<div class="bar-row">' +
    '<div class="bar-head"><span class="nm">' +
    (color ? '<span class="dot" style="background:' + esc(color) + '"></span>' : '') + '<span class="nm-text">' + esc(name) + '</span>' +
    '</span><span class="nums tnum"><b class="nums-main">' + fmtYen(used) + '</b>' +
    '<small class="nums-sub">' + label + ' ' + fmtYen(budget) +
    '（残り <b' + (remain < 0 ? ' style="color:var(--danger)"' : '') + '>' + fmtYen(remain) + '</b>）</small></span></div>' +
    '<div class="bar"><i class="' + (over ? 'over' : '') + '" style="width:' + pct + '%' + (color && !over ? ';background:' + esc(color) : '') + '"></i></div></div>';
}
// 貯蓄・投資の全期間データ（累計と月別合計）。進捗カード用。
function loadSavingsData() {
  if (!state.household) return Promise.resolve(null);
  return sb.from('transactions').select('amount, spent_date, kind, category_id')
    .eq('household_id', state.household.id)
    .then(function (res) {
      if (res.error) { console.error(res.error); return null; }
      var total = 0, byMonth = {};
      (res.data || []).forEach(function (t) {
        if (txKind(t) !== 'saving') return;
        total += t.amount || 0;
        var mk = (t.spent_date || '').slice(0, 7);
        if (mk) byMonth[mk] = (byMonth[mk] || 0) + (t.amount || 0);
      });
      return { total: total, byMonth: byMonth };
    }).catch(function (e) { console.error(e); return null; });
}
// 未精算の立て替え（月を問わず全件）
function loadUnsettledAdvances() {
  if (!state.household) return Promise.resolve([]);
  return sb.from('transactions').select('*')
    .eq('household_id', state.household.id)
    .eq('is_advance', true).eq('advance_settled', false)
    .order('spent_date', { ascending: false })
    .order('created_at', { ascending: false })
    .then(function (res) {
      if (res.error) { console.error(res.error); return []; }
      return res.data || [];
    }).catch(function (e) { console.error(e); return []; });
}
function settleAdvance(id, btn) {
  if (btn) btn.disabled = true;
  sb.from('transactions').update({ advance_settled: true }).eq('id', id).select('id')
    .then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('更新できませんでした（更新0件）');
      Object.keys(state.monthTx).forEach(function (k) { delete state.monthTx[k]; });
      toast('精算済みにしました');
      return ensureCurrentMonthLoaded();
    })
    .then(function () { renderHistory(); })
    .catch(function (err) {
      console.error(err);
      toast('更新に失敗: ' + (err.message || ''));
      if (btn) btn.disabled = false;
    });
}
// 今月の月末着地予測（当月表示時のみ使う）。
// 固定費は未計上の自動計上分（recurring）を加算し、それ以外の支出は
// 経過日数の日割り平均 × 残り日数で推計する。now はテスト用に差し替え可能。
function computeForecast(txs, now) {
  now = now || new Date();
  var key = monthKey(now);
  var range = monthRange(key);
  var elapsed = now.getDate();
  var remaining = range.lastDay - elapsed;
  var totalUsed = sumByKind(txs, 'expense');
  var fixedPosted = 0;
  var postedIds = {};
  txs.forEach(function (t) {
    if (t.external_id) postedIds[t.external_id] = true;
    if (t.source === 'fixed_auto' && txKind(t) === 'expense' && !t.is_advance) fixedPosted += t.amount || 0;
  });
  var upcomingFixed = 0, upcomingSaving = 0;
  state.recurring.forEach(function (re) {
    if (!re.is_active) return;
    if (postedIds['fixed_' + re.id + '_' + key]) return;
    var c = categoryById(re.category_id);
    var k = c ? catKind(c) : 'expense';
    if (k === 'expense') upcomingFixed += re.amount || 0;
    else if (k === 'saving') upcomingSaving += re.amount || 0;
  });
  var variableSpent = Math.max(0, totalUsed - fixedPosted);
  var projectedVariable = elapsed > 0 ? Math.round(variableSpent / elapsed * remaining) : 0;
  var savingTotal = sumByKind(txs, 'saving');
  var budget = categoryBudgetTotal();
  var allowance = budget - totalUsed - upcomingFixed;
  return {
    elapsed: elapsed, remaining: remaining, lastDay: range.lastDay,
    totalUsed: totalUsed, fixedPosted: fixedPosted,
    upcomingFixed: upcomingFixed, upcomingSaving: upcomingSaving,
    variableSpent: variableSpent, projectedVariable: projectedVariable,
    projectedTotal: totalUsed + upcomingFixed + projectedVariable,
    budget: budget, allowance: allowance,
    perDay: remaining > 0 ? Math.floor(allowance / remaining) : allowance,
    savingTotal: savingTotal, savingProjected: savingTotal + upcomingSaving
  };
}
// 履歴タブのセグメント（サマリー／内訳／明細）。選択は端末に記憶する。
function historySeg() {
  if (!state.historySeg) {
    var saved = null;
    try { saved = localStorage.getItem('kyotsu_kakeibo_hist_seg_v1'); } catch (e) {}
    state.historySeg = (saved === 'breakdown' || saved === 'detail') ? saved : 'summary';
  }
  return state.historySeg;
}
function switchHistorySeg(name) {
  state.historySeg = name;
  try { localStorage.setItem('kyotsu_kakeibo_hist_seg_v1', name); } catch (e) {}
  ['summary', 'breakdown', 'detail'].forEach(function (n) {
    var p = $('hpanel-' + n);
    if (p) p.classList.toggle('hidden', n !== name);
    var b = $('hseg-' + n);
    if (b) b.classList.toggle('on', n === name);
  });
}
function switchBreakdown(view) {
  state.breakdownView = view;
  ['category', 'payer'].forEach(function (n) {
    var p = $('brk-' + n);
    if (p) p.classList.toggle('hidden', n !== view);
    var b = $('brkbtn-' + n);
    if (b) b.classList.toggle('on', n === view);
  });
}
function renderHistory() {
  var key = monthKey(state.viewMonth);
  var y = state.viewMonth.getFullYear(), m = state.viewMonth.getMonth() + 1;
  $('month-label').textContent = y + '年' + m + '月';
  var body = $('history-body');
  body.innerHTML = '<div class="empty-note">読み込み中…</div>';
  Promise.all([loadMonth(key), loadSavingsData(), loadUnsettledAdvances()]).then(function (res2) {
    var txs = res2[0];
    var savingsData = res2[1];
    var unsettled = res2[2];
    var totalBudget = categoryBudgetTotal();
    var incomeTotal = sumByKind(txs, 'income');
    var savingTotal = sumByKind(txs, 'saving');
    var totalUsed = sumByKind(txs, 'expense');
    var totalPct = totalBudget > 0 ? Math.min(100, Math.round(totalUsed / totalBudget * 100)) : (totalUsed > 0 ? 100 : 0);
    var totalRemain = totalBudget - totalUsed;
    var byCat = sumByCategory(txs);
    var isCurrentMonth = key === monthKey(new Date());
    var fc = isCurrentMonth ? computeForecast(txs) : null;
    var seg = historySeg();
    if (!state.breakdownView) state.breakdownView = 'category';
    var bv = state.breakdownView;
    var sumHtml = '', brkCat = '', brkPayer = '', detHtml = '';

    // 月のフローサマリー（入る → 貯める → 使う → 残り）
    var flowRemain = incomeTotal - savingTotal - totalUsed;
    sumHtml += '<div class="card"><h3>今月の流れ</h3><div class="flow-grid">' +
      '<div class="flow-item"><div class="cap">収入</div><div class="val tnum income">+' + fmtYen(incomeTotal) + '</div></div>' +
      '<div class="flow-item"><div class="cap">貯蓄・投資</div><div class="val tnum">' + fmtYen(savingTotal) + '</div></div>' +
      '<div class="flow-item"><div class="cap">支出</div><div class="val tnum">' + fmtYen(totalUsed) + '</div></div>' +
      '<div class="flow-item"><div class="cap">残り</div><div class="val tnum' + (flowRemain < 0 ? ' neg' : '') + '">' + fmtYen(flowRemain) + '</div></div>' +
      '</div>' +
      (incomeTotal > 0
        ? '<div class="flow-rate tnum">貯蓄率 <b>' + Math.round(savingTotal / incomeTotal * 100) + '%</b>（貯蓄・投資 ÷ 収入）</div>'
        : '') +
      '</div>';

    // 貯蓄・投資の進捗（目標額が設定されている場合のみ）
    var goalAmt = state.household ? state.household.savings_goal_amount : null;
    if (goalAmt != null && Number(goalAmt) > 0 && savingsData) {
      var startAmt = Number(state.household.savings_start_amount) || 0;
      var projected = startAmt + savingsData.total;
      var goalRemain = Math.max(0, Number(goalAmt) - projected);
      var goalPct = Math.min(100, Math.round(projected / Number(goalAmt) * 100));
      sumHtml += '<div class="card"><h3>貯蓄・投資の進捗</h3>' +
        '<div class="big-total"><span class="used tnum">' + fmtYen(projected) + '</span><span class="of tnum">/ 目標 ' + fmtYen(goalAmt) + '</span></div>' +
        '<div class="bar"><i style="width:' + goalPct + '%"></i></div>' +
        '<div class="remain-line tnum">進捗 <b>' + goalPct + '%</b> ・ 目標まで残り <b>' + fmtYen(goalRemain) + '</b></div>' +
        '<div class="remain-line tnum">開始時 ' + fmtYen(startAmt) + ' ＋ これまでの貯蓄・投資 ' + fmtYen(savingsData.total) + '</div>';
      var nowD = new Date();
      var sum3 = 0;
      for (var pi = 0; pi < 3; pi++) {
        sum3 += savingsData.byMonth[monthKey(new Date(nowD.getFullYear(), nowD.getMonth() - pi, 1))] || 0;
      }
      var avg3 = sum3 / 3;
      if (goalRemain <= 0) {
        sumHtml += '<div class="remain-line">目標額に到達しています</div>';
      } else if (avg3 > 0) {
        var nMonths = Math.ceil(goalRemain / avg3);
        var targetD = new Date(nowD.getFullYear(), nowD.getMonth() + nMonths, 1);
        sumHtml += '<div class="remain-line tnum">直近3ヶ月の平均は月 ' + fmtYen(Math.round(avg3)) + '。このペースだとあと約' + nMonths + 'ヶ月（' + targetD.getFullYear() + '年' + (targetD.getMonth() + 1) + '月頃）で目標に届きます</div>';
      }
      // 月末時点の見込み（当月のみ・予測カードから移設）
      if (fc) {
        var meTotal = startAmt + savingsData.total + fc.upcomingSaving;
        var mePct = Math.min(100, Math.round(meTotal / Number(goalAmt) * 100));
        sumHtml += '<div class="remain-line tnum">月末時点の見込み <b>' + fmtYen(meTotal) + '</b>（目標の ' + mePct + '%' + (fc.upcomingSaving > 0 ? '・自動積立の未計上分を含む' : '') + '）</div>';
      }
      sumHtml += '<div class="goal-note">アプリの記録ベースの見込みです</div></div>';
    }

    // 全体予算（支出のみ）＋今月の予測（当月のみ・同じカードに統合）
    sumHtml += '<div class="card"><h3>' + (fc ? '全体予算・予測' : '全体予算') + '</h3>' +
      '<div class="big-total"><span class="used tnum">' + fmtYen(totalUsed) + '</span><span class="of tnum">/ 予算 ' + fmtYen(totalBudget) + '</span></div>' +
      '<div class="bar"><i class="' + (totalUsed > totalBudget && totalBudget > 0 ? 'over' : '') + '" style="width:' + totalPct + '%"></i></div>' +
      '<div class="remain-line tnum">残り <b class="' + (totalRemain < 0 ? 'neg' : '') + '">' + fmtYen(totalRemain) + '</b>（消化率 ' + (totalBudget > 0 ? Math.round(totalUsed / totalBudget * 100) : 0) + '%）</div>';
    if (fc) {
      var fcPct = fc.budget > 0 ? Math.min(100, Math.round(fc.projectedTotal / fc.budget * 100)) : (fc.projectedTotal > 0 ? 100 : 0);
      sumHtml += '<div class="fc-sep"></div><div class="fc-head">今月の予測（月末の着地）</div>' +
        '<div class="big-total"><span class="used tnum">' + fmtYen(fc.projectedTotal) + '</span>' +
        (fc.budget > 0 ? '<span class="of tnum">/ 予算 ' + fmtYen(fc.budget) + '</span>' : '') + '</div>' +
        '<div class="bar"><i class="' + (fc.budget > 0 && fc.projectedTotal > fc.budget ? 'over' : '') + '" style="width:' + fcPct + '%"></i></div>' +
        '<div class="remain-line tnum">内訳：ここまでの支出 ' + fmtYen(fc.totalUsed) + ' ＋ 固定費（未計上）' + fmtYen(fc.upcomingFixed) + ' ＋ 変動費のペース ' + fmtYen(fc.projectedVariable) + '</div>';
      if (fc.budget > 0) {
        if (fc.allowance >= 0) {
          sumHtml += '<div class="remain-line tnum">予算まであと <b>' + fmtYen(fc.allowance) + '</b>' +
            (fc.remaining > 0 ? '（残り' + fc.remaining + '日・1日あたり <b>' + fmtYen(fc.perDay) + '</b> まで）' : '（本日が月末です）') + '</div>';
        } else {
          sumHtml += '<div class="remain-line tnum">このペースだと予算を <b class="neg">' + fmtYen(Math.abs(fc.allowance)) + '</b> 超える見込みです</div>';
        }
      }
      if (fc.savingProjected > 0) {
        sumHtml += '<div class="remain-line tnum">貯蓄・投資の着地予測 <b>' + fmtYen(fc.savingProjected) + '</b>' +
          (fc.upcomingSaving > 0 ? '（自動積立の未計上分 ' + fmtYen(fc.upcomingSaving) + ' を含む）' : '') + '</div>';
      }
      sumHtml += '<div class="goal-note">固定費は未計上の自動計上分を加算し、それ以外の支出は経過' + fc.elapsed + '日の日割り平均で計算しています。月の前半は予測が大きく振れます。</div>';
    }
    sumHtml += '</div>';

    // 立て替え（未精算）：月を問わず全件。未精算が0件ならカード自体を出さない
    if (unsettled.length) {
      var advTotal = unsettled.reduce(function (a, t) { return a + (t.amount || 0); }, 0);
      sumHtml += '<div class="card"><h3>立て替え（未精算）</h3>' +
        '<div class="remain-line tnum" style="margin:0 0 4px;">合計 <b>' + fmtYen(advTotal) + '</b>（' + unsettled.length + '件）</div>';
      unsettled.forEach(function (t) {
        var acat = categoryById(t.category_id);
        var ad = new Date(t.spent_date + 'T00:00:00');
        sumHtml += '<div class="adv-row">' +
          '<div class="adv-main"><div class="adv-title">' + esc(t.memo ? t.memo : (acat ? acat.name : '立て替え')) + '</div>' +
          '<div class="adv-sub tnum">' + (ad.getMonth() + 1) + '月' + ad.getDate() + '日 ・ ' + esc(acat ? acat.name : '') + ' ・ ' + esc(memberName(t.payer_id)) + '</div></div>' +
          '<span class="amt3 tnum">' + fmtYen(t.amount) + '</span>' +
          '<button class="mini-btn accent" data-settle-advance="' + esc(t.id) + '">精算済みにする</button></div>';
      });
      sumHtml += '</div>';
    }

    // 内訳：カテゴリ別（種別ごとにグループ化）
    if (!state.categories.length) brkCat += '<div class="empty-note">カテゴリがありません</div>';
    var expCats = state.categories.filter(function (c) { return catKind(c) === 'expense'; });
    var savCats = state.categories.filter(function (c) { return catKind(c) === 'saving'; });
    var incCats = state.categories.filter(function (c) { return catKind(c) === 'income'; });
    if (expCats.length) {
      brkCat += '<div class="group-head">支出</div>';
      expCats.forEach(function (c) {
        brkCat += barHTML(c.name, c.color, byCat[c.id] || 0, c.monthly_budget || 0);
      });
    }
    if (savCats.length) {
      brkCat += '<div class="group-head">貯蓄・投資</div>';
      savCats.forEach(function (c) {
        brkCat += barHTML(c.name, c.color, byCat[c.id] || 0, c.monthly_budget || 0, '目標');
      });
    }
    if (incCats.length) {
      brkCat += '<div class="group-head">収入</div>';
      incCats.forEach(function (c) {
        brkCat += '<div class="bar-row"><div class="bar-head"><span class="nm">' +
          '<span class="dot" style="background:' + esc(c.color || '#999') + '"></span><span class="nm-text">' + esc(c.name) + '</span>' +
          '</span><span class="nums tnum"><b class="nums-main">+' + fmtYen(byCat[c.id] || 0) + '</b></span></div></div>';
      });
    }

    // 内訳：支払者別（支出のみ・立て替えを除いて計算）
    var byPayer = {};
    txs.forEach(function (t) {
      if (txKind(t) === 'expense' && !t.is_advance) byPayer[t.payer_id] = (byPayer[t.payer_id] || 0) + (t.amount || 0);
    });
    brkPayer += '<div class="payer-split">';
    var splitParts = '';
    state.members.forEach(function (mem, i) {
      var amt = byPayer[mem.id] || 0;
      var color = payerColor(i);
      var pct = totalUsed > 0 ? Math.round(amt / totalUsed * 100) : 0;
      brkPayer += '<div class="row"><span class="who"><span class="dot" style="background:' + color + '"></span>' + esc(mem.display_name || 'メンバー') + '</span><span class="amt2 tnum">' + fmtYen(amt) + '<span class="pct">（' + pct + '%）</span></span></div>';
      if (totalUsed > 0 && amt > 0) {
        splitParts += '<i style="width:' + (amt / totalUsed * 100) + '%;background:' + color + '"></i>';
      }
    });
    brkPayer += '</div><div class="split-caption">支出割合</div><div class="split-bar' + (splitParts ? '' : ' empty') + '" style="margin-top:6px;">' + splitParts + '</div>';

    var brkHtml = '<div class="card"><div class="brk-head"><h3>内訳</h3>' +
      '<div class="seg-control mini">' +
      '<button id="brkbtn-category" class="' + (bv === 'category' ? 'on' : '') + '">カテゴリ別</button>' +
      '<button id="brkbtn-payer" class="' + (bv === 'payer' ? 'on' : '') + '">支払者別</button></div></div>' +
      '<div id="brk-category"' + (bv === 'category' ? '' : ' class="hidden"') + '>' + brkCat + '</div>' +
      '<div id="brk-payer"' + (bv === 'payer' ? '' : ' class="hidden"') + '>' + brkPayer + '</div></div>';

    // 明細（日付グループ）
    if (!txs.length) {
      detHtml += '<div class="empty-note">この月の記録はまだありません</div>';
    } else {
      var groups = {}, order = [];
      txs.forEach(function (t) {
        if (!groups[t.spent_date]) { groups[t.spent_date] = []; order.push(t.spent_date); }
        groups[t.spent_date].push(t);
      });
      var week = ['日', '月', '火', '水', '木', '金', '土'];
      order.forEach(function (dstr) {
        var d = new Date(dstr + 'T00:00:00');
        // 日ごとの合計からも立て替えを除外する
        var daySum = groups[dstr].reduce(function (a, t) { return t.is_advance ? a : a + (t.amount || 0); }, 0);
        detHtml += '<div class="day-group"><div class="day-head"><span class="d">' +
          (d.getMonth() + 1) + '月' + d.getDate() + '日（' + week[d.getDay()] + '）</span>' +
          '<span class="dt tnum">' + fmtYen(daySum) + '</span></div><div class="tx-list">';
        groups[dstr].forEach(function (t) {
          var cat = categoryById(t.category_id);
          var badge = SOURCE_BADGES[t.source];
          var kind = txKind(t);
          detHtml += '<button class="tx" data-txid="' + esc(t.id) + '">' +
            '<span class="cdot" style="background:' + esc(cat ? (cat.color || '#999') : '#999') + '"></span>' +
            '<span class="mid"><span class="memo">' + esc(t.memo ? t.memo : (cat ? cat.name : '支出')) +
            (kind === 'saving' ? '<span class="badge saving">貯蓄・投資</span>' : '') +
            (t.is_advance ? '<span class="badge advance">立て替え</span>' : '') +
            (t.is_advance && t.advance_settled ? '<span class="badge settled">精算済</span>' : '') +
            (badge ? '<span class="badge ' + badge.cls + '">' + esc(badge.label) + '</span>' : '') +
            '</span><span class="meta">' + esc(cat ? cat.name : '') + ' ・ ' + esc(memberName(t.payer_id)) + '</span></span>' +
            (kind === 'income'
              ? '<span class="amt3 tnum income">+' + fmtYen(t.amount) + '</span>'
              : '<span class="amt3 tnum">' + fmtYen(t.amount) + '</span>') +
            '</button>';
        });
        detHtml += '</div></div>';
      });
    }

    var segHtml = '<div class="seg-control">' +
      '<button id="hseg-summary" class="' + (seg === 'summary' ? 'on' : '') + '">サマリー</button>' +
      '<button id="hseg-breakdown" class="' + (seg === 'breakdown' ? 'on' : '') + '">内訳</button>' +
      '<button id="hseg-detail" class="' + (seg === 'detail' ? 'on' : '') + '">明細</button></div>';
    body.innerHTML = segHtml +
      '<div id="hpanel-summary"' + (seg === 'summary' ? '' : ' class="hidden"') + '>' + sumHtml + '</div>' +
      '<div id="hpanel-breakdown"' + (seg === 'breakdown' ? '' : ' class="hidden"') + '>' + brkHtml + '</div>' +
      '<div id="hpanel-detail"' + (seg === 'detail' ? '' : ' class="hidden"') + '>' + detHtml + '</div>';
    Array.prototype.forEach.call(body.querySelectorAll('.tx'), function (btn) {
      btn.addEventListener('click', function () { openTxSheet(btn.getAttribute('data-txid')); });
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-settle-advance]'), function (b) {
      b.addEventListener('click', function () { settleAdvance(b.getAttribute('data-settle-advance'), b); });
    });
    ['summary', 'breakdown', 'detail'].forEach(function (n) {
      var b = $('hseg-' + n);
      if (b) b.addEventListener('click', function () { switchHistorySeg(n); });
    });
    ['category', 'payer'].forEach(function (n) {
      var b = $('brkbtn-' + n);
      if (b) b.addEventListener('click', function () { switchBreakdown(n); });
    });
  }).catch(function (err) {
    body.innerHTML = '<div class="empty-note">読み込みに失敗しました：' + esc(err.message || '') + '</div>';
  });
}

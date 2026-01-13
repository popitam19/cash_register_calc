const yen = (n) => n.toLocaleString("ja-JP") + "円";

const getInt = (id) => {
  const v = Number(document.getElementById(id).value);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
};

function addEnvelopeRow(tbody, label, rolls, pieces, amount) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${label}</td>
    <td style="text-align:right;">${rolls ?? ""}</td>
    <td style="text-align:right;">${pieces ?? ""}</td>
    <td style="text-align:right;">${yen(amount)}</td>
  `;
  tbody.appendChild(tr);
}

/* ===== 追加：レジ金/売上金 の枚数表を描画する関数 ===== */
function renderSplitTable(tbodyId, changeCounts, salesCounts) {
  const tb = document.getElementById(tbodyId);
  if (!tb) return;

  tb.innerHTML = "";

  const trChange = document.createElement("tr");
  trChange.innerHTML = `
    <td>レジ金</td>
    <td>${changeCounts.y10}枚</td>
    <td>${changeCounts.y50}枚</td>
    <td>${changeCounts.y100}枚</td>
    <td>${changeCounts.y500}枚</td>
    <td>${changeCounts.y1000}枚</td>
    <td>${changeCounts.y2000}枚</td>
    <td>${changeCounts.y5000}枚</td>
    <td>${changeCounts.y10000}枚</td>
  `;

  const trSales = document.createElement("tr");
  trSales.innerHTML = `
    <td>売上金</td>
    <td>${salesCounts.y10}枚</td>
    <td>${salesCounts.y50}枚</td>
    <td>${salesCounts.y100}枚</td>
    <td>${salesCounts.y500}枚</td>
    <td>${salesCounts.y1000}枚</td>
    <td>${salesCounts.y2000}枚</td>
    <td>${salesCounts.y5000}枚</td>
    <td>${salesCounts.y10000}枚</td>
  `;

  tb.appendChild(trChange);
  tb.appendChild(trSales);
}

/**
 * 目的：
 * - 棒金は全てレジ金に固定
 * - 低額から優先してレジ金に入れる（ただし最終的にレジ金=50,000円ぴったりが可能な範囲で）
 * - 2000円札は必ず売上
 *
 * アプローチ：
 * - 棒金で確定したレジ金を引いた残り(need)を、硬貨→紙幣の順でちょうど埋める
 * - 硬貨は「レジ金として使う金額」をDPで探索（0〜need）
 * - その硬貨金額に対して、紙幣(1000/5000/10000)で残りが埋められるかをチェック
 * - 複数解がある場合は「硬貨をできるだけ多くレジ金に残す」かつ「低額硬貨優先」かつ「低額紙幣優先」で選ぶ
 */

function betterPlan(a, b) {
  if (!a) return b;
  if (!b) return a;

  if (a.coinAmount !== b.coinAmount) return a.coinAmount > b.coinAmount ? a : b;

  const ca = a.coins, cb = b.coins;
  if (ca.ex10 !== cb.ex10) return ca.ex10 > cb.ex10 ? a : b;
  if (ca.ex50 !== cb.ex50) return ca.ex50 > cb.ex50 ? a : b;
  if (ca.ex100 !== cb.ex100) return ca.ex100 > cb.ex100 ? a : b;
  if (ca.ex500 !== cb.ex500) return ca.ex500 > cb.ex500 ? a : b;

  const ba = a.bills, bb = b.bills;
  if (ba.ex1000 !== bb.ex1000) return ba.ex1000 > bb.ex1000 ? a : b;
  if (ba.ex5000 !== bb.ex5000) return ba.ex5000 > bb.ex5000 ? a : b;
  if (ba.ex10000 !== bb.ex10000) return ba.ex10000 < bb.ex10000 ? a : b;

  return a;
}

function chooseBills(rem, n1000, n5000, n10000) {
  if (rem < 0 || rem % 1000 !== 0) return null;

  let best = null;
  const max10000 = Math.min(n10000, Math.floor(rem / 10000));
  for (let ex10000 = 0; ex10000 <= max10000; ex10000++) {
    const remAfter10000 = rem - ex10000 * 10000;

    const max5000 = Math.min(n5000, Math.floor(remAfter10000 / 5000));
    for (let ex5000 = 0; ex5000 <= max5000; ex5000++) {
      const remAfter5000 = remAfter10000 - ex5000 * 5000;
      const ex1000 = remAfter5000 / 1000;

      if (ex1000 <= n1000) {
        const cand = { ex1000, ex5000, ex10000 };
        if (!best) best = cand;
        else {
          if (cand.ex1000 !== best.ex1000) best = (cand.ex1000 > best.ex1000 ? cand : best);
          else if (cand.ex5000 !== best.ex5000) best = (cand.ex5000 > best.ex5000 ? cand : best);
          else if (cand.ex10000 !== best.ex10000) best = (cand.ex10000 < best.ex10000 ? cand : best);
        }
      }
    }
  }
  return best;
}

function findBestPlan({
  barTotal,
  c10, c50, c100, c500,
  b1000, b5000, b10000
}) {
  const TARGET = 50000;

  if (barTotal > TARGET) {
    return { ok: false, reason: `棒金だけで${yen(barTotal)}あり、50,000円を超えています。` };
  }

  const needAfterBars = TARGET - barTotal;

  // DP: dp[amt] = 硬貨で amt 円をレジ金にできるときの枚数構成（低額優先で保持）
  const dp = Array(needAfterBars + 1).fill(null);
  dp[0] = { ex10: 0, ex50: 0, ex100: 0, ex500: 0 };

  function betterCoinsForSameAmt(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.ex10 !== b.ex10) return a.ex10 > b.ex10 ? a : b;
    if (a.ex50 !== b.ex50) return a.ex50 > b.ex50 ? a : b;
    if (a.ex100 !== b.ex100) return a.ex100 > b.ex100 ? a : b;
    if (a.ex500 !== b.ex500) return a.ex500 > b.ex500 ? a : b;
    return a;
  }

  const denoms = [
    { d: 10,  max: c10,  key: "ex10" },
    { d: 50,  max: c50,  key: "ex50" },
    { d: 100, max: c100, key: "ex100" },
    { d: 500, max: c500, key: "ex500" },
  ];

  // bounded knapsack
  for (const { d, max, key } of denoms) {
    const next = dp.slice();
    for (let amt = 0; amt <= needAfterBars; amt++) {
      const base = dp[amt];
      if (!base) continue;
      for (let k = 1; k <= max; k++) {
        const na = amt + d * k;
        if (na > needAfterBars) break;
        const cand = { ...base, [key]: base[key] + k };
        next[na] = betterCoinsForSameAmt(next[na], cand);
      }
    }
    for (let i = 0; i <= needAfterBars; i++) dp[i] = next[i];
  }

  // 硬貨金額 coinAmt と、紙幣で埋める残り rem が両立するものから最良を選ぶ
  let best = null;

  for (let coinAmt = needAfterBars; coinAmt >= 0; coinAmt--) {
    const coins = dp[coinAmt];
    if (!coins) continue;

    const rem = needAfterBars - coinAmt;
    const bills = chooseBills(rem, b1000, b5000, b10000);
    if (!bills) continue;

    const plan = { ok: true, coinAmount: coinAmt, coins, bills };
    best = betterPlan(best, plan);
  }

  if (!best) {
    return { ok: false, reason: "現在の組み合わせでは、レジ金を50,000円ぴったりにできません。：エラー" };
  }

  return best;
}

document.getElementById("calc").onclick = () => {
  const warn = [];

  // 入力
  const bar10  = getInt("bar10");
  const bar50  = getInt("bar50");
  const bar100 = getInt("bar100");

  const c10   = getInt("c10");
  const c50   = getInt("c50");
  const c100  = getInt("c100");
  const c500  = getInt("c500");

  const b1000  = getInt("b1000");
  const b2000  = getInt("b2000"); // 売上固定
  const b5000  = getInt("b5000");
  const b10000 = getInt("b10000");

  // 棒金（全部レジ金）
  const amtBar10  = bar10  * 500;
  const amtBar50  = bar50  * 2500;
  const amtBar100 = bar100 * 5000;
  const barTotal = amtBar10 + amtBar50 + amtBar100;

  // 計画探索（2000円札は売上固定なので探索対象から除外）
  const plan = findBestPlan({
    barTotal,
    c10, c50, c100, c500,
    b1000, b5000, b10000
  });

  // 表示エリア
  document.getElementById("resultArea").style.display = "block";
  const tbody = document.getElementById("envelopeRows");
  tbody.innerHTML = "";

  if (!plan.ok) {
    // 不可能：棒金だけレジ金、他は全部売上として表示
    warn.push(plan.reason);

    const salesTotal =
      (c10*10 + c50*50 + c100*100 + c500*500) +
      (b1000*1000 + b2000*2000 + b5000*5000 + b10000*10000);

    document.getElementById("salesOnly").textContent = `売上金合計：${yen(salesTotal)}`;

    addEnvelopeRow(tbody, "10円",   `${bar10}本`,  `0枚`, amtBar10);
    addEnvelopeRow(tbody, "50円",   `${bar50}本`,  `0枚`, amtBar50);
    addEnvelopeRow(tbody, "100円",  `${bar100}本`, `0枚`, amtBar100);
    addEnvelopeRow(tbody, "500円",  "",            `0枚`, 0);
    addEnvelopeRow(tbody, "1,000円", "",           `0枚`, 0);
    addEnvelopeRow(tbody, "2,000円", "",           `0枚`, 0);
    addEnvelopeRow(tbody, "5,000円", "",           `0枚`, 0);
    addEnvelopeRow(tbody, "10,000円","",           `0枚`, 0);

    /* ===== 追加：レジ金/売上金 の枚数表（不可能時） ===== */
    renderSplitTable(
      "splitTableBody",
      { y10: 0, y50: 0, y100: 0, y500: 0, y1000: 0, y2000: 0, y5000: 0, y10000: 0 },
      { y10: c10, y50: c50, y100: c100, y500: c500, y1000: b1000, y2000: b2000, y5000: b5000, y10000: b10000 }
    );


    document.getElementById("warn").textContent = "注意: " + warn.join(" / ");
    return;
  }

  // 探索結果
  const ex10 = plan.coins.ex10;
  const ex50 = plan.coins.ex50;
  const ex100 = plan.coins.ex100;
  const ex500 = plan.coins.ex500;

  const ex1000 = plan.bills.ex1000;
  const ex5000 = plan.bills.ex5000;
  const ex10000 = plan.bills.ex10000;

  // 2000円札は売上固定
  const ex2000 = 0;

  // レジ金（封筒）各金額
  const amt10   = ex10   * 10;
  const amt50   = ex50   * 50;
  const amt100  = ex100  * 100;
  const amt500  = ex500  * 500;
  const amt1000 = ex1000 * 1000;
  const amt2000 = 0; // 固定
  const amt5000 = ex5000 * 5000;
  const amt10000= ex10000* 10000;

  // 売上合計
  const sales10  = c10  - ex10;
  const sales50  = c50  - ex50;
  const sales100 = c100 - ex100;
  const sales500 = c500 - ex500;

  const sales1000  = b1000  - ex1000;
  const sales2000  = b2000; // 全部売上
  const sales5000  = b5000  - ex5000;
  const sales10000 = b10000 - ex10000;

  const salesTotal =
    sales10*10 + sales50*50 + sales100*100 + sales500*500 +
    sales1000*1000 + sales2000*2000 + sales5000*5000 + sales10000*10000;

  document.getElementById("salesOnly").textContent = `売上金合計：${yen(salesTotal)}`;

  // 封筒に入れること（レジ金）表：指定形式
  addEnvelopeRow(tbody, "10円",    `${bar10}本`,   `${ex10}枚`,    amtBar10  + amt10);
  addEnvelopeRow(tbody, "50円",    `${bar50}本`,   `${ex50}枚`,    amtBar50  + amt50);
  addEnvelopeRow(tbody, "100円",   `${bar100}本`,  `${ex100}枚`,   amtBar100 + amt100);
  addEnvelopeRow(tbody, "500円",   "",             `${ex500}枚`,   amt500);
  addEnvelopeRow(tbody, "1,000円", "",             `${ex1000}枚`,  amt1000);
  addEnvelopeRow(tbody, "2,000円", "",             `0枚`,         amt2000);
  addEnvelopeRow(tbody, "5,000円", "",             `${ex5000}枚`,  amt5000);
  addEnvelopeRow(tbody, "10,000円","",             `${ex10000}枚`, amt10000);

  // 最終チェック：レジ金は必ず50,000円
  const exchangeTotal =
    barTotal +
    amt10 + amt50 + amt100 + amt500 +
    amt1000 + amt5000 + amt10000;

  if (exchangeTotal !== 50000) {
    warn.push(`内部計算の結果が50,000円になっていません（現在 ${yen(exchangeTotal)}）。`);
  }

  document.getElementById("warn").textContent = warn.length ? "注意: " + warn.join(" / ") : "";

  /* ===== 追加：レジ金/売上金 の枚数表（成功時） ===== */
  renderSplitTable(
  "splitTableBody",
  {
    y10: ex10,
    y50: ex50,
    y100: ex100,
    y500: ex500,
    y1000: ex1000,
    y2000: 0,
    y5000: ex5000,
    y10000: ex10000
  },
  {
    y10: sales10,
    y50: sales50,
    y100: sales100,
    y500: sales500,
    y1000: sales1000,
    y2000: sales2000,
    y5000: sales5000,
    y10000: sales10000
  }
);


  // 内部用：yenToNum（不可能時の表示にだけ使用）
  function yenToNum(x) { return x; }
};

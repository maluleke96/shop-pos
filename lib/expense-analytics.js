/**
 * Expense dashboard analytics — pure functions over expense rows.
 */
const li = require('./expense-line-items');

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10) + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(d) {
  return d.toLocaleDateString('en-CA');
}

function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function endOfWeek(d) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return e;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function monthStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthEnd(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function prevMonthStart(d) {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
}

function prevMonthEnd(d) {
  return new Date(d.getFullYear(), d.getMonth(), 0);
}

function inRange(dateStr, from, to) {
  const d = String(dateStr || '').slice(0, 10);
  return d >= from && d <= to;
}

function sumExpenses(rows) {
  return roundMoney((rows || []).reduce((s, e) => s + (Number(e.amount) || 0), 0));
}

function filterByRange(rows, from, to) {
  return (rows || []).filter((e) => inRange(e.expense_date, from, to));
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p <= 0.009) return c > 0 ? 100 : 0;
  return roundMoney(((c - p) / p) * 100);
}

function groupByCategory(rows) {
  const map = {};
  for (const e of rows || []) {
    const cat = String(e.category || 'other').trim() || 'other';
    map[cat] = (map[cat] || 0) + (Number(e.amount) || 0);
  }
  return Object.entries(map)
    .map(([name, amount]) => ({ name, amount: roundMoney(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

function groupByShop(rows, branchNames) {
  const map = {};
  for (const e of rows || []) {
    let name = branchNames[e.branch_id] || branchNames[String(e.branch_id)];
    if (!name && e.branch_name) name = e.branch_name;
    if (!name) {
      const m = String(e.description || '').match(/(?:shop|location|branch)\s*:\s*([^·|,]+)/i);
      name = m ? m[1].trim() : 'Unassigned';
    }
    map[name] = (map[name] || 0) + (Number(e.amount) || 0);
  }
  return Object.entries(map)
    .map(([name, amount]) => ({ name, amount: roundMoney(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

function aggregateProducts(rows) {
  const map = {};
  for (const e of rows || []) {
    const items = li.parseLineItems(e.line_items_json);
    for (const item of items) {
      const key = String(item.name || '').trim().toLowerCase();
      if (!key) continue;
      if (!map[key]) {
        map[key] = { name: item.name.trim(), purchaseCount: 0, totalCost: 0 };
      }
      map[key].purchaseCount += 1;
      map[key].totalCost = roundMoney(map[key].totalCost + (Number(item.amount) || 0));
    }
  }
  return Object.values(map).sort((a, b) => b.purchaseCount - a.purchaseCount || b.totalCost - a.totalCost);
}

function dailyTotals(rows, from, to) {
  const map = {};
  let d = parseDate(from);
  const end = parseDate(to);
  if (!d || !end) return [];
  while (d <= end) {
    map[toIso(d)] = 0;
    d = addDays(d, 1);
  }
  for (const e of rows || []) {
    const day = String(e.expense_date || '').slice(0, 10);
    if (map[day] != null) map[day] = roundMoney(map[day] + (Number(e.amount) || 0));
  }
  return Object.entries(map).map(([date, total]) => ({ date, total }));
}

function productEmoji(name) {
  const n = String(name || '').toLowerCase();
  if (/potato/.test(n)) return '🥔';
  if (/chicken/.test(n)) return '🍗';
  if (/oil|cooking/.test(n)) return '🛢️';
  if (/beef|meat|steak/.test(n)) return '🥩';
  if (/pack|box|bag/.test(n)) return '📦';
  if (/fuel|petrol|diesel/.test(n)) return '⛽';
  if (/electric|power/.test(n)) return '⚡';
  return '🛒';
}

function formatCatLabel(cat) {
  return String(cat || 'other').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildAdvice(ctx) {
  const tips = [];
  const {
    weekTotal, lastWeekTotal, monthTotal, lastMonthTotal,
    topCategoryWeek, topProductMonth, topShopWeek, topShopMonth,
    weekCategories, monthProducts
  } = ctx;

  const weekPct = pctChange(weekTotal, lastWeekTotal);
  if (Math.abs(weekPct) >= 5) {
    const dir = weekPct > 0 ? 'increased' : 'decreased';
    tips.push({
      icon: '💡',
      title: 'Spending Alert',
      message: `Your total spending ${dir} ${Math.abs(weekPct)}% compared with last week.`
    });
  }

  const monthPct = pctChange(monthTotal, lastMonthTotal);
  if (Math.abs(monthPct) >= 8 && tips.length < 4) {
    const dir = monthPct > 0 ? 'up' : 'down';
    tips.push({
      icon: '📈',
      title: 'Monthly trend',
      message: `This month is ${Math.abs(monthPct)}% ${dir} versus the same period last month.`
    });
  }

  if (topCategoryWeek && weekTotal > 0) {
    const pct = roundMoney((topCategoryWeek.amount / weekTotal) * 100);
    tips.push({
      icon: '⚠️',
      title: 'Category focus',
      message: `${formatCatLabel(topCategoryWeek.name)} is your biggest expense this week — ${pct}% of total spending.`
    });
  }

  if (topProductMonth) {
    tips.push({
      icon: '💡',
      title: 'Buying pattern',
      message: `${topProductMonth.name} is your most frequently purchased item this month (${topProductMonth.purchaseCount} purchases, ${topProductMonth.totalCost} total).`
    });
  }

  const shopRef = topShopWeek || topShopMonth;
  const shopTotal = weekTotal || monthTotal;
  if (shopRef && shopTotal > 0) {
    const pct = roundMoney((shopRef.amount / shopTotal) * 100);
    tips.push({
      icon: '💡',
      title: 'Attention',
      message: `${shopRef.name} has the highest expenses — ${pct}% of spending in the selected period.`
    });
  }

  const repeat = (monthProducts || []).find((p) => p.purchaseCount >= 3);
  if (repeat && tips.length < 5) {
    tips.push({
      icon: '💡',
      title: 'Recommendation',
      message: `You purchased ${repeat.name} ${repeat.purchaseCount} times recently. Consider buying a larger quantity if the unit price is lower in bulk.`
    });
  }

  return tips.slice(0, 5);
}

/**
 * @param {object[]} expenses - rows with amount, category, expense_date, line_items_json, branch_id, branch_name
 * @param {Record<number|string,string>} branchNames
 * @param {Date} [asOf]
 */
function computeExpenseDashboard(expenses, branchNames = {}, asOf = new Date()) {
  const today = toIso(asOf);
  const weekStart = toIso(startOfWeek(asOf));
  const weekEnd = toIso(endOfWeek(asOf));
  const lastWeekEnd = toIso(addDays(parseDate(weekStart), -1));
  const lastWeekStart = toIso(startOfWeek(parseDate(lastWeekEnd)));

  const monthFrom = toIso(monthStart(asOf));
  const monthTo = today;
  const lastMonthFrom = toIso(prevMonthStart(asOf));
  const lastMonthTo = toIso(prevMonthEnd(asOf));

  const daysInMonthSoFar = Math.max(1, Math.floor((asOf - monthStart(asOf)) / 86400000) + 1);
  const lastMonthSameTo = toIso(addDays(parseDate(lastMonthFrom), daysInMonthSoFar - 1));

  const weekRows = filterByRange(expenses, weekStart, weekEnd);
  const lastWeekRows = filterByRange(expenses, lastWeekStart, lastWeekEnd);
  const monthRows = filterByRange(expenses, monthFrom, monthTo);
  const lastMonthRows = filterByRange(expenses, lastMonthFrom, lastMonthSameTo);
  const lastMonthFullRows = filterByRange(expenses, lastMonthFrom, lastMonthTo);

  const weekTotal = sumExpenses(weekRows);
  const lastWeekTotal = sumExpenses(lastWeekRows);
  const monthTotal = sumExpenses(monthRows);
  const lastMonthTotal = sumExpenses(lastMonthRows);
  const lastMonthFullTotal = sumExpenses(lastMonthFullRows);

  const daysInWeek = Math.min(7, Math.max(1, Math.floor((asOf - parseDate(weekStart)) / 86400000) + 1));

  const weekCategories = groupByCategory(weekRows);
  const monthCategories = groupByCategory(monthRows);
  const weekShops = groupByShop(weekRows, branchNames);
  const monthShops = groupByShop(monthRows, branchNames);
  const weekProducts = aggregateProducts(weekRows);
  const monthProducts = aggregateProducts(monthRows);

  const topCategoryWeek = weekCategories[0] || null;
  const topProductMonth = monthProducts[0] ? { ...monthProducts[0], emoji: productEmoji(monthProducts[0].name) } : null;
  const topShopWeek = weekShops[0] || null;
  const topShopMonth = monthShops[0] || null;

  const advice = buildAdvice({
    weekTotal, lastWeekTotal, monthTotal, lastMonthTotal: lastMonthFullTotal,
    topCategoryWeek, topProductMonth, topShopWeek, topShopMonth,
    weekCategories, monthProducts
  });

  const timelineDaily = dailyTotals(expenses, weekStart, weekEnd);

  return {
    asOf: today,
    ranges: { weekStart, weekEnd, monthFrom, monthTo, lastWeekStart, lastWeekEnd, lastMonthFrom, lastMonthTo },
    cards: {
      weekTotal,
      monthTotal,
      biggestCategory: topCategoryWeek ? formatCatLabel(topCategoryWeek.name) : '—',
      topProduct: topProductMonth?.name || '—',
      topShop: topShopMonth?.name || topShopWeek?.name || '—'
    },
    overview: {
      weekTotal,
      monthTotal,
      avgPerDayWeek: roundMoney(weekTotal / daysInWeek),
      avgPerDayMonth: roundMoney(monthTotal / daysInMonthSoFar),
      lastWeekTotal,
      lastMonthTotal: lastMonthFullTotal,
      weekChangePct: pctChange(weekTotal, lastWeekTotal),
      monthChangePct: pctChange(monthTotal, lastMonthTotal)
    },
    topCategoriesWeek: weekCategories.map((c) => ({
      ...c,
      label: formatCatLabel(c.name),
      pct: weekTotal > 0 ? roundMoney((c.amount / weekTotal) * 100) : 0
    })),
    topCategoriesMonth: monthCategories.map((c) => ({
      ...c,
      label: formatCatLabel(c.name),
      pct: monthTotal > 0 ? roundMoney((c.amount / monthTotal) * 100) : 0
    })),
    topProductsWeek: weekProducts.slice(0, 10).map((p) => ({ ...p, emoji: productEmoji(p.name) })),
    topProductsMonth: monthProducts.slice(0, 10).map((p) => ({ ...p, emoji: productEmoji(p.name) })),
    byShopWeek: weekShops.map((s) => ({
      ...s,
      pct: weekTotal > 0 ? roundMoney((s.amount / weekTotal) * 100) : 0
    })),
    byShopMonth: monthShops.map((s) => ({
      ...s,
      pct: monthTotal > 0 ? roundMoney((s.amount / monthTotal) * 100) : 0
    })),
    charts: {
      categories: weekCategories.slice(0, 8),
      timeline: timelineDaily,
      products: weekProducts.slice(0, 8).map((p) => ({ name: p.name, total: p.totalCost }))
    },
    advice,
    expenseCount: {
      week: weekRows.length,
      month: monthRows.length
    }
  };
}

module.exports = {
  computeExpenseDashboard,
  roundMoney,
  formatCatLabel,
  productEmoji,
  groupByCategory,
  aggregateProducts
};

const state = {
  investors: [],
  signals: [],
  companies: {},
  meta: {},
  view: "timeline",
  search: "",
  investor: "",
  direction: "",
  type: "",
  confidence: ""
};

const titles = {
  timeline: ["实时观点流", "按时间倒序查看投资者公开观点、操作线索和主题信号。"],
  assets: ["标的聚合", "按 ticker 聚合所有观点，并进入公司研究卡片。"],
  investors: ["投资者画像", "记录每个信号源的能力圈、披露约束和主要风险。"],
  sources: ["数据源", "查看静态 JSON 和自动任务如何更新数据。"]
};

function unique(values) {
  return [...new Set(values)].filter(Boolean).sort();
}

function directionClass(value = "") {
  if (value.includes("看空") || value.includes("为空")) return "bearish";
  if (value.includes("反转")) return "reversal";
  if (value.includes("观察")) return "watch";
  return "bullish";
}

function confidenceClass(value = "") {
  if (value === "高") return "high";
  if (value === "中") return "medium";
  return "low";
}

function actionClass(value = "") {
  if (value.includes("已买") || value.includes("持仓")) return "bullish";
  if (value.includes("转空") || value.includes("卖出")) return "bearish";
  if (value.includes("未确认")) return "medium";
  return "watch";
}

function companyFor(ticker) {
  return state.companies[ticker] || {};
}

function marketPriorityFor(ticker) {
  return companyFor(ticker).marketPriority ?? 9;
}

function marketLabelFor(ticker) {
  const company = companyFor(ticker);
  return company.marketLabel || company.market || "市场待确认";
}

function formatQuoteValue(value, currency = "") {
  if (value === undefined || value === null || value === "") return "行情源待接入";
  return `${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}${currency ? ` ${currency}` : ""}`;
}

async function loadJson(path) {
  const url = `${path}?v=${Date.now()}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${path} 读取失败`);
  return response.json();
}

async function loadState() {
  const [investors, signals, companies, meta] = await Promise.all([
    loadJson("data/investors.json"),
    loadJson("data/signals.json"),
    loadJson("data/companies.json"),
    loadJson("data/meta.json")
  ]);
  state.investors = investors;
  state.signals = signals;
  state.companies = companies;
  state.meta = meta;
  renderAll();
}

function filteredSignals() {
  const text = state.search.trim().toLowerCase();
  return state.signals.filter(item => {
    const haystack = [
      item.investor, item.handle, item.ticker, item.assetName, item.direction,
      item.signalType, item.theme, item.summary, item.notes
    ].join(" ").toLowerCase();
    return (!text || haystack.includes(text))
      && (!state.investor || item.investor === state.investor)
      && (!state.direction || item.direction === state.direction)
      && (!state.type || item.signalType === state.type)
      && (!state.confidence || item.confidence === state.confidence);
  }).sort((a, b) => {
    const priority = marketPriorityFor(a.ticker) - marketPriorityFor(b.ticker);
    if (priority !== 0) return priority;
    return String(b.datetime).localeCompare(String(a.datetime));
  });
}

function fillSelect(id, values) {
  const select = document.getElementById(id);
  const label = select.options[0].textContent;
  const current = select.value;
  select.innerHTML = `<option value="">${label}</option>`;
  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = current;
}

function renderFilters() {
  fillSelect("investorFilter", unique(state.signals.map(item => item.investor)));
  fillSelect("directionFilter", unique(state.signals.map(item => item.direction)));
  fillSelect("typeFilter", unique(state.signals.map(item => item.signalType)));
  fillSelect("confidenceFilter", unique(state.signals.map(item => item.confidence)));
}

function renderMetrics() {
  document.getElementById("metricInvestors").textContent = unique(state.signals.map(item => item.investor)).length || state.investors.length;
  document.getElementById("metricSignals").textContent = state.signals.length;
  document.getElementById("metricAssets").textContent = unique(state.signals.map(item => item.ticker)).length;
  document.getElementById("metricReversals").textContent = state.signals.filter(item => item.signalType === "观点反转").length;
  document.getElementById("lastUpdated").textContent = state.meta.lastUpdatedAt ? new Date(state.meta.lastUpdatedAt).toLocaleString("zh-CN") : "种子数据";
  document.getElementById("dataMode").textContent = state.meta.mode || "静态 JSON";
}

function renderTimeline() {
  const rows = filteredSignals();
  const body = document.getElementById("signalsBody");
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty">没有匹配的信号</div></td></tr>`;
    return;
  }
  rows.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.datetime || ""}<div class="muted">${item.id || ""}</div></td>
      <td><strong>${item.investor || ""}</strong><div class="muted">@${String(item.handle || "").replace("@", "")}</div></td>
      <td><button class="ticker ticker-button" data-company="${item.ticker}">${item.ticker}</button><div class="muted">${item.assetName || item.ticker}</div><span class="pill">${marketLabelFor(item.ticker)}</span></td>
      <td><span class="pill ${directionClass(item.direction)}">${item.direction || "观察"}</span></td>
      <td><span class="pill ${actionClass(item.actionStatus)}">${item.actionStatus || "未确认买入"}</span><div class="muted">${item.actionEvidence || item.signalType || ""}</div></td>
      <td>${item.theme || ""}</td>
      <td class="summary">${item.summary || ""}<div class="muted">${item.notes || ""}</div></td>
      <td><span class="pill ${confidenceClass(item.confidence)}">${item.confidence || "低"}</span></td>
      <td><a href="${item.sourceUrl || "#"}" target="_blank" rel="noreferrer">来源</a></td>
    `;
    body.appendChild(tr);
  });
  bindCompanyButtons();
}

function renderAssets() {
  const grouped = new Map();
  state.signals.forEach(item => {
    if (!item.ticker) return;
    if (!grouped.has(item.ticker)) {
      grouped.set(item.ticker, {
        ticker: item.ticker,
        assetName: item.assetName || item.ticker,
        latest: item.datetime || "",
        direction: item.direction || "观察",
        confidence: item.confidence || "低",
        themes: new Set(),
        summary: item.summary || "",
        count: 0
      });
    }
    const group = grouped.get(item.ticker);
    group.count += 1;
    group.themes.add(item.theme || "未分类");
  });
  const grid = document.getElementById("assetsGrid");
  grid.innerHTML = "";
  [...grouped.values()]
    .sort((a, b) => marketPriorityFor(a.ticker) - marketPriorityFor(b.ticker) || a.ticker.localeCompare(b.ticker))
    .forEach(item => {
    const company = companyFor(item.ticker);
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="asset-row">
        <div><button class="ticker ticker-button" data-company="${item.ticker}">${item.ticker}</button></div>
        <div>
          <div class="asset-name">${item.assetName}</div>
          <div class="muted">${company.tradableNote || ""} · ${[...item.themes].join(" / ")}</div>
        </div>
        <span class="pill ${directionClass(item.direction)}">${company.marketLabel || item.direction}</span>
      </div>
      <p>${item.summary}</p>
      <p style="margin-top:10px;"><span class="pill ${confidenceClass(item.confidence)}">${item.confidence}</span> <span class="pill">${item.count} 条信号</span></p>
    `;
    grid.appendChild(card);
  });
  bindCompanyButtons();
}

function renderInvestors() {
  const grid = document.getElementById("investorsGrid");
  grid.innerHTML = "";
  state.investors.forEach(item => {
    const count = state.signals.filter(signal => signal.investor === item.name).length;
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <h3>${item.name} <span class="muted">@${item.handle}</span></h3>
      <p>${item.focus || ""}</p>
      <p style="margin-top:10px;"><strong>风格：</strong>${item.style || ""}</p>
      <p style="margin-top:10px;"><strong>风险：</strong>${item.risk || ""}</p>
      <p style="margin-top:12px;"><span class="pill">${count} 条信号</span></p>
    `;
    grid.appendChild(card);
  });
}

function renderList(items = []) {
  return `<ul>${items.map(item => `<li>${item}</li>`).join("")}</ul>`;
}

function valueOrNote(value, fallback = "待接入") {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function openCompany(ticker) {
  const data = state.companies[ticker] || { ticker, name: ticker };
  const related = state.signals.filter(item => item.ticker === ticker);
  const quote = data.quote || {};
  const target = data.priceTarget || {};
  document.getElementById("companyTitle").textContent = `${ticker} · ${data.name || ticker}`;
  document.getElementById("companySubtitle").textContent = `${data.marketLabel || data.market || "市场待确认"} · ${data.exchange || "交易所待确认"} · ${data.sector || "行业待确认"} · ${data.tradableNote || ""}`;
  document.getElementById("companyDetail").innerHTML = `
    <article class="detail-card wide">
      <h3>业务简介</h3>
      <p>${data.business || "暂无公司简介。"}</p>
      ${data.dataNotes ? `<p style="margin-top:10px;"><strong>数据说明：</strong>${data.dataNotes}</p>` : ""}
    </article>
    <article class="detail-card">
      <h3>股价快照</h3>
      <div class="kv"><span>最新价</span><strong>${formatQuoteValue(quote.c, quote.currency)}</strong></div>
      <div class="kv"><span>日内涨跌</span><strong>${formatQuoteValue(quote.d)} / ${valueOrNote(quote.dp, "行情源待接入")}%</strong></div>
      <div class="kv"><span>前收盘</span><strong>${formatQuoteValue(quote.pc, quote.currency)}</strong></div>
      <div class="kv"><span>价格来源</span><strong>${quote.source || "待接入"}</strong></div>
    </article>
    <article class="detail-card">
      <h3>分析师观点</h3>
      ${renderList(data.analystView || ["待接入分析师观点。"])}
      <div class="kv"><span>目标价均值</span><strong>${valueOrNote(target.targetMean, "评级源待接入")}</strong></div>
    </article>
    <article class="detail-card">
      <h3>基本面看点</h3>
      ${renderList(data.fundamentals || ["待接入基本面数据。"])}
    </article>
    <article class="detail-card">
      <h3>主要风险</h3>
      ${renderList(data.risks || ["待补充风险。"])}
    </article>
    <article class="detail-card wide">
      <h3>外部资料</h3>
      <p>
        <a class="pill" href="https://finance.yahoo.com/quote/${data.yahooSymbol || ticker}" target="_blank" rel="noreferrer">Yahoo Finance</a>
        <a class="pill" href="https://www.google.com/search?q=${encodeURIComponent(ticker + " analyst rating fundamentals")}" target="_blank" rel="noreferrer">评级/基本面搜索</a>
        <a class="pill" href="https://www.google.com/search?q=${encodeURIComponent(ticker + " earnings transcript")}" target="_blank" rel="noreferrer">财报电话会</a>
      </p>
    </article>
    <article class="detail-card wide">
      <h3>相关推特信号</h3>
      ${related.map(item => `
        <div class="kv">
          <span>${item.datetime || ""}</span>
          <div><strong>${item.direction || ""} · ${item.actionStatus || item.signalType || ""}</strong><br><span class="muted">${item.summary || ""}</span></div>
        </div>
      `).join("") || "<p>暂无相关信号。</p>"}
    </article>
  `;
  document.getElementById("companyModal").classList.add("open");
}

function bindCompanyButtons() {
  document.querySelectorAll("[data-company]").forEach(button => {
    button.onclick = () => openCompany(button.dataset.company);
  });
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach(item => item.classList.toggle("active", item.id === view));
  document.querySelectorAll(".nav-button").forEach(item => item.classList.toggle("active", item.dataset.view === view));
  document.getElementById("viewTitle").textContent = titles[view][0];
  document.getElementById("viewSubtitle").textContent = titles[view][1];
  document.getElementById("toolbar").style.display = view === "timeline" ? "grid" : "none";
}

function renderAll() {
  renderFilters();
  renderMetrics();
  renderTimeline();
  renderAssets();
  renderInvestors();
}

function bindEvents() {
  document.querySelectorAll(".nav-button").forEach(button => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  document.getElementById("reloadButton").addEventListener("click", () => loadState());
  document.getElementById("searchInput").addEventListener("input", event => {
    state.search = event.target.value;
    renderTimeline();
  });
  [
    ["investorFilter", "investor"],
    ["directionFilter", "direction"],
    ["typeFilter", "type"],
    ["confidenceFilter", "confidence"]
  ].forEach(([id, key]) => {
    document.getElementById(id).addEventListener("change", event => {
      state[key] = event.target.value;
      renderTimeline();
    });
  });
  document.getElementById("closeCompany").addEventListener("click", () => {
    document.getElementById("companyModal").classList.remove("open");
  });
  document.getElementById("companyModal").addEventListener("click", event => {
    if (event.target.id === "companyModal") {
      document.getElementById("companyModal").classList.remove("open");
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") document.getElementById("companyModal").classList.remove("open");
  });
}

bindEvents();
loadState().catch(error => {
  document.getElementById("signalsBody").innerHTML = `<tr><td colspan="9"><div class="empty">加载失败：${error.message}</div></td></tr>`;
});

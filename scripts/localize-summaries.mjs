import { readFile, writeFile } from "node:fs/promises";

function extractTickers(text) {
  const matches = String(text || "").match(/\$[A-Z][A-Z0-9._-]{0,9}/g) || [];
  return [...new Set(matches.map(item => item.slice(1).replace(".", "-")))];
}

function isMostlyEnglish(text = "") {
  const letters = String(text).match(/[A-Za-z]/g)?.length || 0;
  const chinese = String(text).match(/[\u4e00-\u9fff]/g)?.length || 0;
  return letters > 20 && letters > chinese * 2;
}

function compactText(text = "", limit = 120) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, limit);
}

function chineseSummaryFromTweet(text, ticker) {
  const source = String(text || "");
  if (!isMostlyEnglish(source)) return source;
  const lower = source.toLowerCase();
  const tickers = extractTickers(source);
  const names = tickers.length ? tickers.map(item => `$${item}`).join("、") : ticker ? `$${ticker}` : "相关标的";
  const points = [];

  if (lower.includes("position") || lower.includes("long") || lower.includes("bought") || lower.includes("own")) {
    points.push("博主提到自己已有仓位或做多敞口");
  }
  if (lower.includes("bullish") || lower.includes("favorite") || lower.includes("high conviction")) {
    points.push("语气偏积极，认为该方向具备较高确定性");
  }
  if (lower.includes("bearish") || lower.includes("short") || lower.includes("trim") || lower.includes("sold")) {
    points.push("语气偏谨慎，可能涉及减仓、看空或风险提示");
  }
  if (lower.includes("photonics") || lower.includes("laser") || lower.includes("cpo") || lower.includes("siph") || lower.includes("optical")) {
    points.push("核心逻辑集中在光通信、激光器、CPO 或硅光子供应链");
  }
  if (lower.includes("ai") || lower.includes("gpu") || lower.includes("datacenter") || lower.includes("data center")) {
    points.push("与 AI 数据中心、GPU 或算力基础设施需求相关");
  }
  if (lower.includes("supply") || lower.includes("bottleneck") || lower.includes("chokepoint")) {
    points.push("强调供应瓶颈或产业链卡点带来的定价权");
  }
  if (lower.includes("earnings") || lower.includes("revenue") || lower.includes("backlog") || lower.includes("pipeline")) {
    points.push("关注业绩、收入管线、订单或 backlog 的变化");
  }
  if (lower.includes("tam") || lower.includes("market")) {
    points.push("讨论潜在市场空间或估值重估");
  }
  if (lower.includes("dilution") || lower.includes("atm") || lower.includes("risk")) {
    points.push("同时提示增发、融资或其他风险因素");
  }
  if (lower.includes("jensen") || lower.includes("nvidia") || lower.includes("$nvda")) {
    points.push("提到英伟达生态或 Jensen 相关表述作为产业验证线索");
  }

  const core = points.length ? points.join("；") : `英文原文提到：${compactText(source, 90)}`;
  return `提到 ${names}：${core}。`;
}

const file = new URL("../public/data/signals.json", import.meta.url);
const signals = JSON.parse(await readFile(file, "utf8"));
let changed = 0;

for (const signal of signals) {
  if (!isMostlyEnglish(signal.summary || "")) continue;
  signal.originalSummary = signal.originalSummary || signal.summary;
  signal.summary = chineseSummaryFromTweet(signal.summary, signal.ticker);
  changed += 1;
}

await writeFile(file, `${JSON.stringify(signals, null, 2)}\n`, "utf8");
console.log(`已中文化 ${changed} 条英文摘要。`);

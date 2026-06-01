import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const dataDir = path.join(root, "public", "data");
const rawDir = path.join(root, "raw");

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "";

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function extractTickers(text) {
  const matches = text.match(/\$[A-Z][A-Z0-9._-]{0,9}/g) || [];
  return [...new Set(matches.map(item => item.slice(1).replace(".", "-")))];
}

function classify(text) {
  const lower = text.toLowerCase();
  if (lower.includes("sold") || lower.includes("trim") || lower.includes("bearish") || lower.includes("short")) {
    return { direction: "看空", signalType: "卖出/看空", confidence: "中" };
  }
  if (lower.includes("bought") || lower.includes("added") || lower.includes("long") || lower.includes("own")) {
    return { direction: "看多", signalType: "明确操作/持仓", confidence: "高" };
  }
  if (lower.includes("risk") || lower.includes("dilution") || lower.includes("atm")) {
    return { direction: "风险提示", signalType: "风险提示", confidence: "中" };
  }
  return { direction: "观察", signalType: "观察名单提及", confidence: "低" };
}

function normalizeTweet(tweet) {
  return {
    id: tweet.id || tweet.tweetId || tweet.url || "",
    datetime: tweet.createdAt || tweet.datetime || tweet.date || "",
    handle: String(tweet.handle || tweet.username || tweet.author?.userName || "aleabitoreddit").replace("@", ""),
    text: tweet.fullText || tweet.text || tweet.content || "",
    url: tweet.url || tweet.sourceUrl || ""
  };
}

function tweetsToSignals(tweets, investors) {
  const investorByHandle = new Map(investors.map(item => [String(item.handle).replace("@", ""), item]));
  const signals = [];
  for (const raw of tweets) {
    const tweet = normalizeTweet(raw);
    if (!tweet.text) continue;
    const tickers = extractTickers(tweet.text);
    const investor = investorByHandle.get(tweet.handle);
    const cls = classify(tweet.text);
    for (const ticker of tickers) {
      signals.push({
        id: `AUTO-${tweet.id}-${ticker}`,
        datetime: tweet.datetime,
        investor: investor?.name || tweet.handle,
        handle: tweet.handle,
        ticker,
        assetName: ticker,
        direction: cls.direction,
        signalType: cls.signalType,
        theme: "自动抽取",
        summary: tweet.text.length > 220 ? `${tweet.text.slice(0, 220)}...` : tweet.text,
        sourceUrl: tweet.url || `https://x.com/${tweet.handle}`,
        confidence: cls.confidence,
        notes: "由定时任务自动生成，需人工复核语境。"
      });
    }
  }
  return signals;
}

function mergeSignals(existing, incoming) {
  const map = new Map(existing.map(item => [item.id, item]));
  incoming.forEach(item => map.set(item.id, { ...map.get(item.id), ...item }));
  return [...map.values()].sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
}

async function updateCompany(ticker, existing) {
  if (!FINNHUB_API_KEY) return existing;
  const [profile, quote, recommendation, target] = await Promise.allSettled([
    fetchJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_API_KEY}`),
    fetchJson(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_API_KEY}`),
    fetchJson(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${FINNHUB_API_KEY}`),
    fetchJson(`https://finnhub.io/api/v1/stock/price-target?symbol=${ticker}&token=${FINNHUB_API_KEY}`)
  ]);
  const ok = result => result.status === "fulfilled" ? result.value : null;
  const profileData = ok(profile) || {};
  const latestRecommendation = Array.isArray(ok(recommendation)) ? ok(recommendation)[0] : null;
  const targetData = ok(target);
  return {
    ...existing,
    ticker,
    name: profileData.name || existing?.name || ticker,
    exchange: profileData.exchange || existing?.exchange || "",
    sector: profileData.finnhubIndustry || existing?.sector || "",
    business: existing?.business || (profileData.name ? `${profileData.name}，行业分类：${profileData.finnhubIndustry || "未知"}。` : "暂未读取到公司简介。"),
    fundamentals: [
      `市值：${profileData.marketCapitalization ? `${profileData.marketCapitalization} 百万美元` : "暂无"}`,
      `IPO 日期：${profileData.ipo || "暂无"}`,
      `国家/地区：${profileData.country || "暂无"}`
    ],
    analystView: [
      latestRecommendation ? `评级分布：强买 ${latestRecommendation.strongBuy || 0}，买入 ${latestRecommendation.buy || 0}，持有 ${latestRecommendation.hold || 0}，卖出 ${latestRecommendation.sell || 0}，强卖 ${latestRecommendation.strongSell || 0}。` : "暂无评级分布。",
      targetData ? `目标价：高 ${targetData.targetHigh || "暂无"}，均值 ${targetData.targetMean || "暂无"}，低 ${targetData.targetLow || "暂无"}。` : "暂无目标价。"
    ],
    quote: ok(quote),
    priceTarget: targetData,
    recommendation: ok(recommendation),
    updatedAt: new Date().toISOString()
  };
}

async function main() {
  const investorsPath = path.join(dataDir, "investors.json");
  const signalsPath = path.join(dataDir, "signals.json");
  const companiesPath = path.join(dataDir, "companies.json");
  const metaPath = path.join(dataDir, "meta.json");
  const tweetsPath = path.join(rawDir, "tweets.json");

  const investors = await readJson(investorsPath, []);
  const existingSignals = await readJson(signalsPath, []);
  const companies = await readJson(companiesPath, {});
  const rawTweets = await readJson(tweetsPath, []);

  const generatedSignals = Array.isArray(rawTweets) ? tweetsToSignals(rawTweets, investors) : [];
  const signals = mergeSignals(existingSignals, generatedSignals);
  const tickers = [...new Set(signals.map(item => item.ticker).filter(Boolean))];

  for (const ticker of tickers) {
    try {
      companies[ticker] = await updateCompany(ticker, companies[ticker] || { ticker, name: ticker });
    } catch (error) {
      console.warn(`${ticker} 公司数据更新失败：${error.message}`);
    }
  }

  await writeJson(signalsPath, signals);
  await writeJson(companiesPath, companies);
  await writeJson(metaPath, {
    lastUpdatedAt: new Date().toISOString(),
    mode: "GitHub Actions 静态 JSON",
    notes: generatedSignals.length ? `本次从 raw/tweets.json 生成 ${generatedSignals.length} 条信号。` : "本次未发现 raw/tweets.json 新数据，仅刷新公司信息和更新时间。"
  });

  console.log(`已更新 ${signals.length} 条信号，${tickers.length} 个标的。`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const dataDir = path.join(root, "public", "data");
const rawDir = path.join(root, "raw");

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "";
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || "";
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || "xquik/x-tweet-scraper";
const TRACKED_HANDLES = (process.env.TRACKED_HANDLES || "aleabitoreddit")
  .split(",")
  .map(item => item.trim().replace("@", ""))
  .filter(Boolean);

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

async function fetchJsonWithOptions(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function getXUserId(handle) {
  if (!X_BEARER_TOKEN) return null;
  const data = await fetchJsonWithOptions(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=description`,
    { headers: { authorization: `Bearer ${X_BEARER_TOKEN}` } }
  );
  return data?.data?.id || null;
}

async function fetchTweetsFromX(handle) {
  if (!X_BEARER_TOKEN) return [];
  const userId = await getXUserId(handle);
  if (!userId) return [];
  const url = new URL(`https://api.x.com/2/users/${userId}/tweets`);
  url.searchParams.set("max_results", "50");
  url.searchParams.set("tweet.fields", "created_at,entities");
  url.searchParams.set("exclude", "retweets");
  const data = await fetchJsonWithOptions(url, {
    headers: { authorization: `Bearer ${X_BEARER_TOKEN}` }
  });
  return (data.data || []).map(tweet => ({
    id: tweet.id,
    createdAt: tweet.created_at,
    handle,
    source: "x-api",
    text: tweet.text,
    url: `https://x.com/${handle}/status/${tweet.id}`,
    debug: {
      keys: Object.keys(tweet).slice(0, 40),
      sample: compactDebugSample(tweet)
    }
  }));
}

function compactDebugSample(item) {
  return Object.fromEntries(Object.entries(item).slice(0, 30).map(([key, value]) => {
    if (typeof value === "string") return [key, value.slice(0, 800)];
    if (value === null || value === undefined) return [key, value];
    if (typeof value === "number" || typeof value === "boolean") return [key, value];
    return [key, JSON.stringify(value).slice(0, 800)];
  }));
}

function normalizeDate(value) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function cleanTweetText(value) {
  return String(value || "")
    .replaceAll("鈥檚", "'s")
    .replaceAll("鈥檓", "'m")
    .replaceAll("鈥檙", "'r")
    .replaceAll("鈥檝", "'v")
    .replaceAll("鈥檇", "'d")
    .replaceAll("鈥檒", "'l")
    .replaceAll("鈥?", "\"")
    .replaceAll("鈥?", "\"")
    .replaceAll("鈥?", "'")
    .replaceAll("鈥?", "'")
    .replaceAll("鈥?", "-");
}

async function fetchTweetsFromApify(handle) {
  if (!APIFY_TOKEN || !APIFY_ACTOR_ID) return [];
  const input = apifyInputForHandle(handle);
  const actorPath = APIFY_ACTOR_ID.replace("/", "~");
  const runUrl = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
  const data = await fetchJsonWithOptions(runUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return Array.isArray(data) ? data.filter(isRealTweetRow).map(item => ({
    id: item.id || item.tweetId || item.tweet_id || item.url || `${handle}-${item.createdAt || item.date || ""}`,
    createdAt: normalizeDate(item.createdAt || item.created_at || item.timestamp || item.date || item.created_at_iso || ""),
    handle,
    source: "apify",
    text: cleanTweetText(item.fullText || item.full_text || item.text || item.content || item.tweetText || ""),
    url: item.url || item.twitterUrl || `https://x.com/${handle}`,
    debug: {
      keys: Object.keys(item).slice(0, 40),
      sample: compactDebugSample(item)
    }
  })) : [];
}

function apifyInputForHandle(handle) {
  if (APIFY_ACTOR_ID.includes("xquik/x-tweet-scraper")) {
    return {
      twitterHandles: [handle],
      maxItems: 50,
      queryType: "Latest",
      includeSearchTerms: true
    };
  }
  if (APIFY_ACTOR_ID.includes("forge-api/x-scraper") || APIFY_ACTOR_ID.includes("mikolabs/tweets-scraper")) {
    return {
      twitterHandles: [handle],
      maxItems: 50,
      searchType: "profile_tweets"
    };
  }
  return {
    searchTerms: [`from:${handle}`],
    maxItems: 50,
    sort: "Latest"
  };
}

function isRealTweetRow(item) {
  return Boolean(item && !item.noResults && !item.demo && !item.status);
}

async function fetchTrackedTweets() {
  const tweets = [];
  for (const handle of TRACKED_HANDLES) {
    try {
      const xTweets = await fetchTweetsFromX(handle);
      tweets.push(...xTweets);
      if (xTweets.length) continue;
    } catch (error) {
      console.warn(`${handle} X API 抓取失败：${error.message}`);
    }
    try {
      const apifyTweets = await fetchTweetsFromApify(handle);
      tweets.push(...apifyTweets);
    } catch (error) {
      console.warn(`${handle} Apify 抓取失败：${error.message}`);
    }
  }
  return tweets;
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

function classifyTheme(text) {
  const lower = text.toLowerCase();
  if (lower.includes("tron") || lower.includes("trx") || text.includes("波场")) {
    return {
      theme: "TRON 生态 / 稳定币结算",
      direction: "趋势看多",
      summary: "检测到 TRON/TRX/波场相关趋势讨论，适合映射到加密生态和稳定币结算主题。"
    };
  }
  if (lower.includes("htx") || lower.includes("huobi") || text.includes("火币")) {
    return {
      theme: "交易所 / HTX / 流动性周期",
      direction: "观察",
      summary: "检测到交易所或 HTX 相关讨论，可作为加密交易活跃度和风险偏好的辅助信号。"
    };
  }
  if (lower.includes("bitcoin") || lower.includes("btc") || text.includes("比特币")) {
    return {
      theme: "比特币 / 加密风险偏好",
      direction: "趋势看多",
      summary: "检测到 BTC/比特币相关讨论，可映射到 BTC ETF、矿股和加密交易平台。"
    };
  }
  if (lower.includes("ethereum") || lower.includes("eth") || text.includes("以太坊")) {
    return {
      theme: "以太坊 / 链上应用",
      direction: "趋势看多",
      summary: "检测到 ETH/以太坊相关讨论，可映射到 ETH ETF、链上应用和交易活跃度。"
    };
  }
  return null;
}

function proxyForTheme(theme) {
  if (theme.includes("TRON")) {
    return [
      { ticker: "COIN", name: "Coinbase", market: "美股", reason: "加密交易活跃度代理" },
      { ticker: "IBIT", name: "iShares Bitcoin Trust", market: "美股 ETF", reason: "加密风险偏好代理" }
    ];
  }
  if (theme.includes("交易所")) {
    return [
      { ticker: "COIN", name: "Coinbase", market: "美股", reason: "交易所收入和加密活跃度代理" },
      { ticker: "HOOD", name: "Robinhood", market: "美股", reason: "零售交易和加密交易活跃度代理" }
    ];
  }
  if (theme.includes("比特币")) {
    return [
      { ticker: "IBIT", name: "iShares Bitcoin Trust", market: "美股 ETF", reason: "BTC 价格敞口" },
      { ticker: "MSTR", name: "MicroStrategy", market: "美股", reason: "BTC beta 代理" }
    ];
  }
  if (theme.includes("以太坊")) {
    return [
      { ticker: "ETHA", name: "iShares Ethereum Trust", market: "美股 ETF", reason: "ETH 价格敞口" },
      { ticker: "COIN", name: "Coinbase", market: "美股", reason: "链上交易和加密交易活跃度代理" }
    ];
  }
  return [];
}

function tweetsToThemes(tweets, investors, existingThemes) {
  const investorByHandle = new Map(investors.map(item => [String(item.handle).replace("@", ""), item]));
  const byKey = new Map((existingThemes || []).map(item => [`${item.handle}-${item.theme}`, item]));
  for (const raw of tweets) {
    const tweet = normalizeTweet(raw);
    if (!tweet.text) continue;
    const investor = investorByHandle.get(tweet.handle);
    if (investor?.excludeCryptoTrading) {
      const key = `${tweet.handle}-中文商业/科技舆论与行业趋势`;
      const existing = byKey.get(key);
      byKey.set(key, {
        id: existing?.id || `THEME-${tweet.handle}-cn-business-trends`,
        theme: "中文商业/科技舆论与行业趋势",
        investor: investor?.name || tweet.handle,
        handle: tweet.handle,
        direction: "观察",
        firstMention: existing?.firstMention && existing.firstMention !== "待自动抓取确认"
          ? [existing.firstMention, tweet.datetime].filter(Boolean).sort()[0]
          : tweet.datetime || "待自动抓取确认",
        latestMention: [existing?.latestMention, tweet.datetime].filter(Boolean).sort().at(-1) || "待自动抓取确认",
        summary: "该账号主要用于观察中文商业、科技、监管、互联网平台和新兴产业的舆论与趋势判断；不要求出现个股代码，也不默认转成币圈交易信号。",
        tradableProxies: [],
        risk: existing?.risk || "强项目方属性和营销属性较高，除非明确涉及你可交易市场的上市公司或行业趋势，否则不进入标的池。",
        sourceUrl: tweet.url || `https://x.com/${tweet.handle}`
      });
      continue;
    }
    const theme = classifyTheme(tweet.text);
    if (!theme) continue;
    const key = `${tweet.handle}-${theme.theme}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      id: existing?.id || `THEME-${tweet.handle}-${theme.theme}`.replace(/[^A-Za-z0-9_-]/g, "-"),
      theme: theme.theme,
      investor: investor?.name || tweet.handle,
      handle: tweet.handle,
      direction: theme.direction,
      firstMention: existing?.firstMention && existing.firstMention !== "待自动抓取确认"
        ? [existing.firstMention, tweet.datetime].filter(Boolean).sort()[0]
        : tweet.datetime || "待自动抓取确认",
      latestMention: [existing?.latestMention, tweet.datetime].filter(Boolean).sort().at(-1) || "待自动抓取确认",
      summary: theme.summary,
      tradableProxies: existing?.tradableProxies?.length ? existing.tradableProxies : proxyForTheme(theme.theme),
      risk: existing?.risk || "主题信号不是个股推荐，需要结合价格、链上数据和市场风险偏好验证。",
      sourceUrl: tweet.url || `https://x.com/${tweet.handle}`
    });
  }
  return [...byKey.values()];
}

function mergeSignals(existing, incoming) {
  const map = new Map(existing.map(item => [item.id, item]));
  incoming.forEach(item => map.set(item.id, { ...map.get(item.id), ...item }));
  return [...map.values()].sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
}

async function fetchYahooQuote(symbol) {
  if (!symbol) return null;
  const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`);
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) return null;
  const closes = (result.indicators?.quote?.[0]?.close || []).filter(value => value !== null && value !== undefined);
  const previousClose = meta.chartPreviousClose ?? closes.at(-2) ?? null;
  const price = meta.regularMarketPrice ?? closes.at(-1) ?? null;
  const change = price !== null && previousClose !== null ? price - previousClose : null;
  const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;
  return {
    c: price,
    d: change,
    dp: changePercent,
    pc: previousClose,
    currency: meta.currency || "",
    symbol: meta.symbol || symbol,
    source: "Yahoo Finance",
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null
  };
}

function stooqSymbolFor(ticker, existing) {
  if (existing?.stooqSymbol) return existing.stooqSymbol;
  if (existing?.market === "美股" || existing?.marketLabel?.includes("美股")) return `${ticker}.US`;
  if (ticker === "XFAB") return "XFAB.FR";
  return null;
}

async function fetchStooqQuote(symbol) {
  if (!symbol) return null;
  const data = await fetchJson(`https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}&f=sd2t2ohlcv&h&e=json`);
  const quote = data?.symbols?.[0];
  if (!quote || quote.close === undefined || quote.close === null) return null;
  const previousClose = quote.open ?? null;
  const change = previousClose ? quote.close - previousClose : null;
  const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;
  return {
    c: quote.close,
    d: change,
    dp: changePercent,
    pc: previousClose,
    currency: "",
    symbol: quote.symbol || symbol,
    source: "Stooq",
    marketTime: quote.date && quote.time ? `${quote.date}T${quote.time}` : null
  };
}

async function updateCompany(ticker, existing) {
  const yahooQuote = await fetchYahooQuote(existing?.yahooSymbol || ticker).catch(() => null);
  const stooqQuote = yahooQuote ? null : await fetchStooqQuote(stooqSymbolFor(ticker, existing)).catch(() => null);
  const fallbackQuote = yahooQuote || stooqQuote || null;
  if (!FINNHUB_API_KEY) {
    return {
      ...existing,
      quote: fallbackQuote || existing?.quote || null,
      updatedAt: new Date().toISOString()
    };
  }
  const [profile, quote, recommendation, target] = await Promise.allSettled([
    fetchJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_API_KEY}`),
    fetchJson(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_API_KEY}`),
    fetchJson(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${FINNHUB_API_KEY}`),
    fetchJson(`https://finnhub.io/api/v1/stock/price-target?symbol=${ticker}&token=${FINNHUB_API_KEY}`)
  ]);
  const ok = result => result.status === "fulfilled" ? result.value : null;
  const profileData = ok(profile) || {};
  const hasProfile = Boolean(profileData.name || profileData.exchange || profileData.finnhubIndustry);
  if (!hasProfile && existing?.business) {
    return {
      ...existing,
      quote: fallbackQuote || ok(quote) || existing.quote || null,
      priceTarget: ok(target) || existing.priceTarget || null,
      recommendation: ok(recommendation) || existing.recommendation || null,
      updatedAt: new Date().toISOString()
    };
  }
  const latestRecommendation = Array.isArray(ok(recommendation)) ? ok(recommendation)[0] : null;
  const targetData = ok(target);
  return {
    ...existing,
    ticker,
    name: profileData.name || existing?.name || ticker,
    exchange: profileData.exchange || existing?.exchange || "",
    sector: profileData.finnhubIndustry || existing?.sector || "",
    business: existing?.business || (profileData.name ? `${profileData.name}，行业分类：${profileData.finnhubIndustry || "未知"}。` : "暂未读取到公司简介。"),
    fundamentals: existing?.fundamentals?.length ? existing.fundamentals : [
      `市值：${profileData.marketCapitalization ? `${profileData.marketCapitalization} 百万美元` : "暂无"}`,
      `IPO 日期：${profileData.ipo || "暂无"}`,
      `国家/地区：${profileData.country || "暂无"}`
    ],
    analystView: existing?.analystView?.length ? existing.analystView : [
      latestRecommendation ? `评级分布：强买 ${latestRecommendation.strongBuy || 0}，买入 ${latestRecommendation.buy || 0}，持有 ${latestRecommendation.hold || 0}，卖出 ${latestRecommendation.sell || 0}，强卖 ${latestRecommendation.strongSell || 0}。` : "暂无评级分布。",
      targetData ? `目标价：高 ${targetData.targetHigh || "暂无"}，均值 ${targetData.targetMean || "暂无"}，低 ${targetData.targetLow || "暂无"}。` : "暂无目标价。"
    ],
    risks: existing?.risks || ["自动读取信息需要人工复核。", "分析师一致预期可能滞后于市场价格。"],
    quote: fallbackQuote || ok(quote),
    priceTarget: targetData,
    recommendation: ok(recommendation),
    updatedAt: new Date().toISOString()
  };
}

async function main() {
  const investorsPath = path.join(dataDir, "investors.json");
  const signalsPath = path.join(dataDir, "signals.json");
  const companiesPath = path.join(dataDir, "companies.json");
  const themesPath = path.join(dataDir, "themes.json");
  const metaPath = path.join(dataDir, "meta.json");
  const debugTweetsPath = path.join(dataDir, "debug-tweets.json");
  const tweetsPath = path.join(rawDir, "tweets.json");

  const investors = await readJson(investorsPath, []);
  const existingSignals = await readJson(signalsPath, []);
  const companies = await readJson(companiesPath, {});
  const existingThemes = await readJson(themesPath, []);
  const rawTweets = await readJson(tweetsPath, []);
  const fetchedTweets = await fetchTrackedTweets();

  const allTweets = [
    ...(Array.isArray(rawTweets) ? rawTweets : []),
    ...fetchedTweets
  ];
  const generatedSignals = tweetsToSignals(allTweets, investors);
  const themes = tweetsToThemes(allTweets, investors, existingThemes);
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
  await writeJson(themesPath, themes);
  await writeJson(debugTweetsPath, {
    updatedAt: new Date().toISOString(),
    trackedHandles: TRACKED_HANDLES,
    rawTweetCount: Array.isArray(rawTweets) ? rawTweets.length : 0,
    fetchedTweetCount: fetchedTweets.length,
    totalTweetCount: allTweets.length,
    samples: allTweets.slice(0, 80).map(tweet => {
      const normalized = normalizeTweet(tweet);
      return {
        id: normalized.id,
        datetime: normalized.datetime,
        handle: normalized.handle,
        source: tweet.source || "raw",
        url: normalized.url,
        text: normalized.text.slice(0, 1000),
        tickers: extractTickers(normalized.text),
        debug: tweet.debug || null
      };
    })
  });
  await writeJson(metaPath, {
    lastUpdatedAt: new Date().toISOString(),
    mode: "GitHub Actions 静态 JSON",
    notes: generatedSignals.length
      ? `本次从静态/自动推文源生成 ${generatedSignals.length} 条信号。`
      : "本次未发现新推文数据，仅刷新公司信息和更新时间。"
  });

  console.log(`已更新 ${signals.length} 条信号，${tickers.length} 个标的。`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

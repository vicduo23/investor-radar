# Apify 自动抓取配置

这个站点已经预留好 Apify 抓取 X/Twitter 观点的入口。GitHub Actions 每 6 小时运行一次：

1. 读取 `TRACKED_HANDLES` 里的账号。
2. 优先尝试 X API。
3. 如果没有 X API，使用 Apify actor 抓取最近推文。
4. 把推文转换为观点和主题数据，再刷新 `public/data/*.json`。

## GitHub Variables

进入 GitHub 仓库：

`Settings -> Secrets and variables -> Actions -> Variables`

需要有：

```text
TRACKED_HANDLES=aleabitoreddit,sunyuchentron
APIFY_ACTOR_ID=xquik/x-tweet-scraper
```

## GitHub Secrets

进入：

`Settings -> Secrets and variables -> Actions -> Secrets`

需要添加：

```text
APIFY_TOKEN=你的 Apify API token
```

没有 `APIFY_TOKEN` 时，网站仍然可以部署，但不会自动抓取新的 X/Twitter 内容，只会使用现有 JSON 数据和行情数据。

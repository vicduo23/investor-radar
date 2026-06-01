# 推特投研雷达静态版

这是无服务器版本，适合部署到 GitHub Pages。

## 架构

```text
GitHub Actions / Apify 定时任务
  -> 更新 public/data/signals.json、companies.json、investors.json、meta.json
  -> GitHub Pages 静态网站读取 JSON
```

网站本身不需要本地服务器，也不需要后端常驻进程。

## 本地打开

直接打开：

```text
public/index.html
```

如果浏览器因为 `file://` 限制不允许读取本地 JSON，可以部署到 GitHub Pages，或使用任意静态文件服务。

## GitHub Pages 部署

1. 创建一个 GitHub 仓库。
2. 把本目录内容上传到仓库。
3. 在仓库 Settings -> Pages 中选择 GitHub Actions 部署。
4. 保留 `.github/workflows/pages.yml`。
5. 打开 Actions，手动运行一次，或等待定时任务。

## 自动数据更新

目前内置的 `scripts/update-data.mjs` 支持：

- 无 API key 时：保留现有 JSON，并更新时间戳
- 有 X API key 时：直接读取 `TRACKED_HANDLES` 指定账号的最新推文
- 有 Apify key 时：通过 Apify actor 抓取 X/Twitter 内容
- 有 Finnhub API key 时：更新美股公司行情、目标价和评级
- 有 Apify 导出 JSON 时：可转换为信号数据

脚本会优先尝试 X 官方 API；如果没有配置或失败，会尝试 Apify；同时也会读取 `raw/tweets.json` 作为人工/外部任务导入源。

## 需要配置的 GitHub Secrets

- `FINNHUB_API_KEY`
- `X_BEARER_TOKEN`
- `APIFY_TOKEN`
- `APIFY_ACTOR_ID`

没有 secrets 时网站仍可用，只是显示种子数据。

## GitHub Variables

进入 Settings -> Secrets and variables -> Actions -> Variables，添加：

```text
TRACKED_HANDLES=aleabitoreddit
```

多个账号用英文逗号分隔：

```text
TRACKED_HANDLES=aleabitoreddit,anotherhandle
```

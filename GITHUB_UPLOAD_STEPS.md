# 手动上传到 GitHub Pages

由于当前机器没有 `git` 和 `gh` 命令，可以先用网页方式部署。

## 1. 创建仓库

1. 打开 https://github.com/new
2. Repository name 建议填写：`investor-radar`
3. 选择 Private 或 Public
4. 创建仓库

## 2. 上传文件

上传压缩包里的全部内容，而不是上传外层文件夹。

仓库根目录应该长这样：

```text
README.md
package.json
public/
scripts/
raw/
.github/
```

如果 GitHub 网页不显示 `.github` 文件夹，可以使用 “Add file -> Upload files” 上传整个目录解压后的内容。

## 3. 开启 GitHub Pages

1. 进入仓库 Settings
2. 点击 Pages
3. Source 选择 GitHub Actions
4. 回到 Actions
5. 运行 `Deploy Investor Radar`

## 4. 配置 Secrets

进入 Settings -> Secrets and variables -> Actions，添加：

```text
FINNHUB_API_KEY
X_BEARER_TOKEN
APIFY_TOKEN
APIFY_ACTOR_ID
```

如果暂时没有 X 或 Apify key，可以先只填 `FINNHUB_API_KEY`。网站仍然可用，只是推文观点不会自动抓取。

进入 Settings -> Secrets and variables -> Actions -> Variables，添加：

```text
TRACKED_HANDLES=aleabitoreddit
```

## 5. 数据更新

GitHub Actions 默认每 6 小时运行一次。

如果有新的推文抓取结果，把它保存为：

```text
raw/tweets.json
```

格式参考：

```text
raw/tweets.example.json
```

脚本会把其中出现的 `$TICKER` 自动转换成信号，并更新 `public/data/signals.json`。

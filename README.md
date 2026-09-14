# QR Cool

本仓库当前提供一个本地、无网络、无付费调用的 Artistic QR Poster dry-run CLI。它从海报中的中央描黑区域生成遮罩，把现有的 qrcode.antfu.me 风格二维码按整数模块缩放并放入区域内，然后输出供人工检查和后续图片编辑使用的文件。

当前版本不会调用 OpenAI，也不会生成最终的 `poster.png`。

## 环境与运行

需要 Node.js 24+ 和 pnpm。

```bash
pnpm install

pnpm qr-poster -- \
  --dry-run \
  --input source/poster.png \
  --qr source/qr.png \
  --out-dir output
```

示例二维码会被解码为：

```text
https://www.instagram.com/grandpasbeehaven/
```

成功后 CLI 会打印识别区域、二维码版本、放置位置和扫码结果。`report.json` 中的 `qualified` 只有在原始二维码、缩放二维码、完整预览、50% 缩小预览和 JPEG quality 80 版本全部可解码时才为 `true`。

## 参数

| 参数 | 说明 |
| --- | --- |
| `--dry-run` | 必填安全标记；当前版本只支持 dry-run。 |
| `--input <path>` | 必填，带中央描黑区域的 PNG 海报。 |
| `--qr <path>` | 必填，带 2 模块留白的 qrcode.antfu.me 风格正方形 PNG。 |
| `--out-dir <path>` | 必填，产物目录。 |
| `--text <value>` | 可选，期望二维码内容；与解码结果不同时失败。 |
| `--mask <path>` | 可选，手动区域遮罩。必须与海报同尺寸；白色且不透明/半透明表示 M，黑色或透明表示区域外。 |
| `--qr-box <x,y,size>` | 可选，手动指定 Q；size 必须是二维码总模块数的整数倍，且 Q 完全位于 M。 |
| `--force` | 覆盖产物目录中已有的已知输出文件。 |

自动识别不确定时，CLI 会以 `MASK_AMBIGUOUS` 退出并要求使用 `--mask`，不会猜测或扩大到整张线稿。

## 产物

```text
output/
  region-mask.png    # 白色为识别出的 M
  qr.png             # 按整数模块缩放后的二维码
  layout-preview.png # 区域轮廓和 Q 的诊断预览
  edit-mask.png      # E=M-Q 透明，其余不透明的 RGBA 编辑遮罩
  before-ai.png      # 二维码已覆盖、其余黑区未填充的输入预览
  report.json        # 输入摘要、布局、耗时和扫码结果
```

`before-ai.png` 不是最终成品。CLI 刻意不输出 `poster.png`。

## 库接口

```ts
import { compositePoster, preparePoster } from 'qr-cool'

const result = await preparePoster({
  inputPath: 'source/poster.png',
  qrPath: 'source/qr.png',
  outputDir: 'output',
  dryRun: true,
})

console.log(result.report.qualified)
```

`compositePoster()` 已提供给后续图片生成阶段：它只在 E 内采用生成背景，保持 M 外原图像素不变，并在最后精确覆盖 Q。

## 开发验证

```bash
pnpm test
pnpm typecheck
pnpm build
```

测试不会联网，不会调用图片 API，也不会修改 `source/`。

## 当前限制

- 只接受 PNG 输入。
- 直接使用现有 QR 图片，不支持从 `--text` 生成新二维码。
- 自动识别针对“中央实心描黑区域”；复杂或歧义输入应提供手动 mask。
- 尚未实现 OpenAI 图片编辑、最终海报导出、Web 服务或手机实测。

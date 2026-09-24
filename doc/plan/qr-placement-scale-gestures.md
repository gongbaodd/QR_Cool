# QR 编辑器拖动与缩放体验优化

状态：原生 Pointer Events 实现已落地，作为当前迁移基线；浏览器手动检查仍待维护者执行。后续改用 React Moveable 的决策与步骤见 [React Moveable 迁移计划](react-moveable-placement-controls.md)。稳定约束已同步到 `AGENTS.md`、`README.md` 和 `doc/plan/web-qr-poster.md`。

## 目标与现状

让 SVG 预览中的移动、等比缩放和旋转符合指针方向；拖动时平滑，松手后显示的二维码与提交的 `Placement` 一致。保留 SVG 海报与二维码渲染、Marker 点击、Fill region、键盘微调、`Placement` 字段和现有 `onChange(Placement)` 提交边界。手势只更新本地预览；一次完成的手势最多提交一次。仍允许区域外或画布外的放置，精确校验只在 Assemble 时进行。

现有实现位于 `src/components/editor/PreviewPanel.tsx` 的 `PosterCanvas`。它通过 SVG `getScreenCTM()` 将指针映射到原图像素，`requestAnimationFrame` 临时写入 `[data-gesture-target]` 的 `transform`，然后在 `pointerup` 调用 `onChange`。当前缩放把 `dx + dy` 除以二后立即按总模块数取整；右下角手柄实际绕中心缩放；旋转后的增量没有先转换到二维码局部坐标。React 渲染的组本身已有中心旋转，临时写入整个 `transform` 时必须明确它是替换还是组合，否则可能双重旋转或松手闪动。

**必须先解决的约束冲突：** `src/lib/editor/schema.ts` 的 `canonicalPlacement()` 把 `x/y` 取整，并把 `size` 量化为总模块数的整数倍；`src/core/placement.ts` 要求整数模块像素且至少 4 px。保留这一渲染契约时，连续的浮点缩放与任意松手尺寸完全一致不可能同时成立。计划采用连续的手势预览，并在结束时将预览平滑收敛到将要提交的规范尺寸，再提交一次。量化最多改变半个模块的边长，锚点也可能因整数坐标最多偏移约一个原图像素。若要求任意尺寸都精确停在指针所在位置，必须另立任务修改整个整数模块渲染契约，不能只改交互库。

## 几何与提交契约

1. 手势开始时固定起始 `Placement`、指针位置、模块数和旋转中心。每帧由**起始值**计算候选值，避免累计误差。用当前 SVG 的逆 `getScreenCTM()` 映射指针；不要直接把 CSS 像素或 Moveable 的平移量写进 `Placement`。`fit` 只负责显示比例，存储和计算始终使用海报像素。
2. 移动保留本地浮点 `x/y`，提交前取整。旋转以起始中心到指针的角度差计算，并用 `canonicalizeRotation()` 规范化。移动、缩放、旋转均不得在预览阶段扫描蒙版、触发 worker 准备或自动夹回有效区域。
3. 默认右下角等比缩放：将指针位移逆旋转到二维码局部坐标；沿局部 `(1, 1)` 对角方向投影，得到连续的 `size`。用起始状态的**局部左上角（该手柄的对角角点）**作为固定锚点，通过共享旋转几何求新中心，再反推出未旋转方框的 `x/y`。`Alt` 按下时改为固定中心；切换修饰键时重置手势基准，避免突跳。限制最小候选尺寸为 `modules × 4`，但不在每帧按模块数取整。
4. 用与 `canonicalPlacement(candidate, modules)` 相同的规则规范尺寸和角度。对固定角锚点缩放，尺寸量化后重新从同一视觉锚点求中心，再对 `x/y` 取整；中心缩放则保持起始中心。把这一步封装为供预览结束、库事件适配和测试共用的纯函数，输出满足现有 schema 的 `Placement`。松手后的短暂收敛动画只改变本地 SVG 预览，最终帧使用**即将提交的规范值**；随后调用一次 `onChange`。若 React 更新、组件卸载或新手势打断动画，清理旧帧和旧手势令牌，不允许旧提交覆盖新状态。
5. 预览变换必须来自同一个候选 `Placement`。明确使用一个完整的矩阵映射 `F(candidate) × F(start)⁻¹`（起始方框到候选方框），或独立的外层临时组与内层 React 旋转组；只对完整二维码板应用一次旋转。Marker 命中区、选框和手柄与二维码图像走同一变换。提交后清除临时变换，再由 React 的规范 `Placement` 绘制相同最终姿态。
6. `Escape`、`pointercancel`、丢失 pointer capture 和卸载均取消手势，撤销本地变换，不调用 `onChange`。仅有 pointer down/up 而无有效变化也不提交。若设置尺寸标签或吸附提示，它们是本地 UI 状态，不创建文档 revision。

## 分步实施

### 1. 抽出几何并修复当前手势

- 在客户端编辑器附近增加可单测的纯几何函数：屏幕点转 SVG 点、移动/旋转候选、局部对角线等比缩放、固定视觉锚点、规范化后的锚点恢复。复用 `src/core/rotate.ts` 的旋转方向与点变换约定，不自行引入相反的角度符号。
- 用这些函数替换现有 `move()` 的 `Math.round((size + dx + dy) / 2 / modules) * modules` 和中心缩放。修正临时 SVG 变换的组合顺序及结束/取消清理。保留当前手柄作为短期验证入口。
- 先检查 `fit = 1、0.5、0.25` 及 `0°、45°、90°`：同一屏幕位移应产生接近相同的屏幕视觉位移；右下角缩放不移动视觉左上角；松手后的规范姿态与最后的本地预览一致。

### 2. 评估 React Moveable

其[官方手册](https://github.com/daybrush/moveable/blob/master/handbook/handbook.md)说明支持 SVG，但 SVG 应用 `scalable` 而非 `resizable`；[API 文档](https://daybrush.com/moveable/release/latest/doc/Moveable.html)提供 `updateRect()`、容器和事件选项。试接入必须验证以下条件后才保留依赖：

- 移动、等比缩放和旋转控制框在嵌套 SVG、滚动容器和三个 `fit` 比例下与视觉方框对齐；滚动、窗口改变尺寸或提交后能更新控制框位置。
- Marker 的 pointer/click/键盘事件仍能打开原生对话框，控制框不会遮挡 Marker；Fill region 点击区域仍以原始蒙版为来源。
- Moveable 的开始、更新、结束事件能映射到上述本地候选几何与取消逻辑。Moveable 负责指针和手柄，`Placement` 仍由同一纯函数计算。不得直接把库给出的 CSS `transform`、scale 或 rotate 字符串当作最终 `Placement`。
- `Alt` 固定中心、Escape/取消、触屏滚动与手势互斥可实现。先验证库对修饰键及取消事件的实际行为，再决定是否提供 Shift 25% 精细缩放。

若通过试接入，则让库独占拖动/缩放/旋转监听，删除旧的 `begin/move/end` 和旧 SVG 手柄。配置 `draggable`、`scalable`、`rotatable`、`keepRatio`，先关闭无明确几何语义的自动吸附；只在能与整数模块提交规则一致时添加参考线或吸附。控制框样式保持现有视觉语言及足够的触控命中区。若无法满足这些条件，则保留修好的原生 Pointer Events 实现，不保留试接入依赖。

历史实现决策：当前版本保留了原生 Pointer Events，因为它仍需自行做 `getScreenCTM()` 坐标换算、模块规范化、预览矩阵、取消恢复和单次提交。当时没有完成 Moveable 的浏览器试接入，因此这一决定不代表库不适合本编辑器。后续按 [React Moveable 迁移计划](react-moveable-placement-controls.md)让库接管手势和控制框，同时保留必要的 `Placement` 几何适配。

### 3. 体验与验证

- 显示当前候选尺寸（原图像素与每模块像素）；量化目标可用细线或标签提示，结束时做短暂收敛而非瞬间跳到另一姿态。动画尊重 reduced motion；关闭动画时仍必须先把本地预览设为规范姿态再提交。
- 测试小/大二维码、不同模块数、最小尺寸、边界外编辑、连续快速手势、Alt 切换、旋转后缩放、鼠标和触屏。验证 `Escape`、`pointercancel`、失焦/丢失 capture 不提交，并且下一次手势能正常开始。
- 增加有意义的纯几何测试，覆盖局部坐标、锚点、量化前后姿态和多比例映射。手动浏览器检查 Marker、Fill region、键盘微调、组装与导出。仓库没有用户可操作的撤销/重做界面；验证一次手势仅有一次文档提交和一次只读 Zundo 历史记录，不新增撤销/重做控件。
- 按仓库规则，仅在维护者明确要求时运行 `pnpm test`、`pnpm typecheck`、`pnpm build`；维护者要求更新浏览器旅程时再修改 `e2e/editor.spec.ts`，要求运行时才执行 `pnpm test:e2e`。

## 验收

- 手柄移动期间尺寸连续变化，不以整模块为步长跳跃；屏幕手感不随 `fit` 改变。
- 默认缩放固定旋转后的视觉对角锚点，`Alt` 固定中心；移动与旋转在 `0°、45°、90°` 方向正确。
- 结束收敛后的 SVG 姿态、提交的规范 `Placement` 和最终组装使用同一位置、尺寸及角度；不存在双重旋转或松手闪回。
- 每个完成手势至多调用一次 `onChange`；取消与无变化不提交。旧动画和旧手势不能覆盖新操作。
- Marker 编辑、区域填充、键盘微调、无效位置可编辑性以及最终海报组装保持可用。

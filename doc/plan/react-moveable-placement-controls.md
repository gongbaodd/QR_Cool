# 用 React Moveable 接管 QR 放置手势

状态：放弃。此计划取代 [原生手势优化计划](qr-placement-scale-gestures.md)中的“保留 Pointer Events”实现决策。现有原生实现是迁移基线，不是两套手势长期并存的方案。

## 目标与边界

在 `PosterCanvas` 中使用 `react-moveable` 的控制框和手势事件，接管二维码的移动、等比缩放和旋转。特别解决当前手写缩放的手柄命中、修饰键、缩放后控制框同步等维护成本。保留 SVG 海报和二维码渲染、Marker 编辑、Fill region、键盘微调、`Placement` 数据结构及 `onChange(Placement)` 单次提交接口。Moveable 只负责交互；原图坐标中的放置值仍由本项目计算。

不改变 `src/lib/editor/schema.ts` 的规范化规则或引擎的整数模块像素契约。手势预览可以使用浮点尺寸；结束时以与组装一致的规范 `Placement` 收敛并提交。无效位置和画布外位置仍可编辑，精确校验仍在 Assemble 时进行。

## 实施步骤

### 1. 接入并确定 SVG 控制目标

1. 安装 `react-moveable`，提交 manifest 和锁文件。`PosterCanvas` 已在客户端组件中；按仓库本机 Next 文档检查第三方组件的客户端加载方式，若库在预渲染阶段访问 DOM，再改为仅客户端加载。
2. 给二维码板建立稳定的 SVG target ref。其几何边界必须是完整的二维码方板，不能由 Marker 命中区、装饰选框或旧手柄撑大。Moveable 的 `target`、`container`、`rootContainer` 和控制框挂载位置以实际嵌套 SVG/滚动容器的浏览器试接入结果确定；不要假定 CSS 像素等于海报像素。
3. 使用 `draggable`、`scalable`、`rotatable`、`keepRatio`，从右下角缩放手柄和旋转手柄开始配置；`throttleDrag`、`throttleScale`、`throttleRotate` 从 0 起试。SVG 按[官方手册](https://github.com/daybrush/moveable/blob/master/handbook/handbook.md)使用 `scalable`，不套用 HTML 的 `resizable` 示例。先关闭自动吸附，待其语义能与最终模块量化一致时再添加。
4. 明确 QR 板的拖动入口，必要时使用独立 `dragTarget`，使 Marker 的点击、触屏点按、键盘激活和 Fill region 的点击不启动放置手势。控制框的交互层不应遮挡 Marker。控制柄样式使用现有品牌 token 和组件级样式，不往 `globals.css` 添加应用样式。

### 2. 建立单一 Placement 适配层

1. 在 Moveable 的开始事件中保存起始 `Placement`、模块数、目标框、SVG `getScreenCTM()` 和手势种类；更新事件将指针坐标转换到 SVG 原图坐标，再产生本地浮点候选。重新检查滚动与 `fit` 变化时矩阵是否需要实时读取。现有 `src/lib/editor/placement-gesture.ts` 的旋转、局部对角缩放、固定锚点和规范化函数可复用，但 Moveable 接管 pointer 生命周期和手柄，不让两层同时处理同一动作。
2. 默认缩放固定当前旋转角度下的对角角点；按 `Alt` 从中心缩放。用 Moveable 的 [Scalable 事件](https://daybrush.com/moveable/release/latest/doc/Moveable.Scalable.html)和 `setFixedDirection` 在所安装版本中实测固定点、手柄方向和修饰键切换。切换时重设计算基准，不能突跳。保持 `modules × 4` 的最小尺寸；拖动过程不按模块数取整。若 Moveable 的默认缩放量与本项目锚点几何不一致，以指针和原图坐标计算候选值，并让控制框跟随这个候选值。
3. 每帧仅由同一个候选 `Placement` 决定二维码板的完整 SVG 姿态、Marker 命中区、选框和尺寸读数。定义单一 transform 所有者；不能同时应用 Moveable 给出的 CSS `transform` 与原有 SVG `transform`，也不能重复旋转。Moveable 的控制框在本地预览、规范化收敛、React 提交、`fit`/容器大小变化和滚动之后调用适用的刷新机制（如 [`updateRect()`](https://daybrush.com/moveable/release/latest/doc/Moveable.html)），并在浏览器里验证位置。
4. 结束事件只对实际发生变化的完整手势生成一次规范 `Placement`，必要时以尊重 reduced motion 的短暂本地收敛使预览到达该姿态，然后调用一次 `onChange`。检查缩放/旋转期间附带的拖动事件，不让它们产生第二次提交。`Escape`、取消、失焦、源图/QR/模块数变化和卸载应停止 Moveable 手势、恢复提交前姿态且不提交；实测库在 `pointercancel` 和停止手势时发出的 end 事件，不能把取消当完成。

### 3. 删除旧手势并收尾

1. Moveable 完成上述交互后，删除 `PosterCanvas` 的 `begin/move/end`、SVG 上的 pointer move/up/cancel/capture 监听和自绘的缩放/旋转手柄。保留 Fill region、Marker 和键盘事件。清理不再使用的几何辅助函数及测试；仍被适配层使用的纯函数保留。
2. 调整键盘说明、尺寸提示及控制柄的焦点/触控表现。尺寸每帧反馈不放在自动播报区；键盘微调继续可用。触屏缩放不能无意阻断海报滚动，控制柄要有可操作的命中区域。
3. 实施完成后把稳定行为写入 `AGENTS.md`、`README.md` 和 `doc/plan/web-qr-poster.md`，删除这份已完成计划及被取代的旧计划；此前保留两份计划以说明迁移背景。

## 浏览器验收

- 在 `fit = 1、0.5、0.25`，旋转 `0°、45°、90°`，滚动、改变窗口尺寸及移动端触屏下，控制框紧贴二维码板，手柄连续跟随指针；默认对角锚点稳定，`Alt` 中心缩放切换无突跳。
- 松手后的 SVG、Moveable 控制框、规范 `Placement` 及最终组装的位置、尺寸、角度一致，无双重旋转或闪回。最小尺寸、不同模块数、画布外位置和快速连续手势仍可编辑。
- 每次完整手势最多产生一次 `onChange`/文档历史提交；无变化、`Escape`、`pointercancel`、失焦和源变化不提交。Marker 点击/键盘激活、Fill region、键盘微调和海报组装继续工作。
- 检查桌面鼠标、触屏、滚动容器及 reduced motion。只有在维护者明确要求时运行 `pnpm test`、`pnpm typecheck`、`pnpm build`；按仓库规则，浏览器旅程只在要求更新或运行时处理。

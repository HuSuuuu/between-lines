# v11 谱面 / v1 谱包

时间统一为音乐文件起点之后的秒数；不要求固定 BPM。`tempo` 只辅助预告、吸附和编辑显示。几何单位为世界尺度，生成器默认 speed=2。

顶层包含 `version:11`、稳定的 `id`、`songId`、作品信息、`duration`、`seed`、`tempo`、`speed`、`events`、`tracks`、`duets`、`forks`、`groups`、`chapters`、`lyrics`、`template`、`warnings`、`revision`。

- events：`{id,t,kind,track,rawTimes?}`。kind 为 tap/double/swipe；同拍用一个 double 事件，不放两个重叠 tap。rawTimes 记录原始接触，编辑与吸附不覆盖它。
- tracks：id 0 和 1，各有 `{t,x,y}` 关键帧，覆盖 0 到 duration；每段长度必须等于 speed×时间差。第二条路线只在 duet 区间显示。
- duets：`{id,start,end}`。区间不能重叠，两个球在 start/end 必须位于同一点。
- forks：关联一个 swipe 事件，含起止时间、两个方向及 keysA/keysB；两条路同长同时间并汇合；新生成的路线在起点之后共用 80ms 的直行段，供同拍手势完成选择而不使球瞬移。首版不允许岔路与双球区间或相邻 420ms 内的另一操作冲突。
- groups：完整文字组，保留 text、role、orientation、section 和 glyphs；每个字形含 text/x/y/size。role 为 body / hero / fill：body 保留原歌词完整句，hero 为重点大词，fill 为允许重复的填缝词组。每组字形拼接必须与 text 一致。
- lyrics：`{id,text,t?}`，LRC 可以带时间，普通文本没有时间也能生成。
- chapters：段落起止与锚点；template 为 horizontal/vertical/inset。

JSON Schema 可验证基本结构；`npm run validate -- file.json` 同时检查时间、路线速度、分合、岔路与字群间隙。revision 可以先留空，导入时根据规范化内容重算。AI 生成数据时应使用公开示例及 Schema，不能加入 JavaScript。

生成接口：`generate(request: GenerationRequest): Chart`，类型位于 src/types.ts。传入原始事件、歌词、双球范围、固定种子及模板，返回完整几何和可恢复警告；输入数组不被修改。

谱包是 ZIP：

```
manifest.json
charts/0-example.json
lyrics.txt
audio.bin              # 只导谱面时省略
```

manifest 含 `format:"between-lines"`、`version:1`、entry 元数据、charts 文件路径列表，以及 audio 的 MIME、文件名、SHA-256。完整音乐指纹用于验证后续附加的原文件。直接导入 JSON 时，附加音频还需核对解码时长。

成绩以 `chartId:revision:difficulty` 区分。修改输入时间、几何、歌词、种子或身份会产生新的内容版本；自动演示和练习不写最高分。

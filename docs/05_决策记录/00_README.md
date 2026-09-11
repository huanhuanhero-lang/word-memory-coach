# 决策记录

记录关键产品和技术决策。每条记录包含：

- 日期：
- 议题：
- 背景与冲突点：
- 各角色观点摘要：
- 最终决策：
- 决策人/讨论来源：
- 备选方案与放弃原因：
- 决策后的影响：

编号规则：D001、D002…，时间倒序追加。

---

## 决策索引

| 编号 | 标题 | 状态 | 落地版本 | 涉及文件 |
|---|---|---|---|---|
| D001 | 听写环节加入核心流程 | ✅ 通过 | v0.1 | app.js、tts.js、02_角色定义 |
| D002 | 用 HTML+JS+localStorage，延后小程序 | ✅ 通过 | v0.1 → 推迟 v0.3 | README、03_产品backlog |
| D003 | 数据存储策略：分层存储，v0.1 不上数据库（2026-09-11 修订：云同步改为 v0.6+ 可选） | ✅ 通过 | v0.1 → v0.6+ 可选 | storage.js、app.js 首启弹窗、OCR/AI 复核 v0.6+ |
| D004 | 听音男女混声（原方案） | ⚠️ 被 D005 覆盖 | v0.2 早期 | tts.js（已重构） |
| D005 | TTS 遍数可配置，1-3 次每步 | ✅ 通过 | v0.3.x | tts.js、app.js 设置页、app.css stepper |
| D006 | TTS 声音可选，默认女声 | ✅ 通过 | v0.3.x | tts.js、app.js 设置页（gender 下拉） |
| D007 | 单元组织：家长/学生手动切换，不自动解锁 | ✅ 通过 | v0.4 | app.js (loadWords/loadAllUnits/renderHome)、app/data/unit1-unit10.json、storage.js current_unit |
| D008 | 重点/了解词分级（importance 字段） | ✅ 通过 | v0.4 | app/data/unitN.json (importance)、app.js (getTodayWordQueue/renderDictation)、app.css (.importance-badge) |
| **D009** | **单词线性私教 + 听写批量** | ✅ 通过 | **v0.4.x** | **app.js (renderCard 步骤加 8 步听写前跟读 / v0.5 听写批量)** |
| **D010** | **复习穿插算法：priority 队列 + 复习快速通道** | ✅ 通过 | **v0.4.x** | **app.js (getPriorityQueue)、renderCard 走 3 步、storage.js study_type、app.css .review-badge** |
| **D011** | **听写拍照上传 + 手动批改** | ✅ 通过 | **v0.5** | **app.js (renderDictationBatch/stepDictationPhotoUpload/stepDictationGrade)、storage.js dictation_photos** |
| **D012** | **听写前跟读** | ✅ 通过 | **v0.4.x** | **app.js (stepPreDictationFollow)** |

> ⚠️ 标注：被覆盖的旧决策仍保留原文，便于回溯。

## 待办

- v0.4 试用后回访 D007 假设 H1（家长能否记得学校进度）
- v0.4 试用后回访 D007 假设 H2（跨 unit 复习偏置）
- v0.5 评估 D007 假设 H3（半路切回上一单元是否提示）

## 引用规范

- 决策记录文件名：`D0XX_标题.md`
- 新增决策前，先用 7 角色评审机制在群里讨论；写文件时只保留结论 + 理由 + 验收标准
- 决策被覆盖时，旧文件保留并标 "⚠️ 被 DX 覆盖"

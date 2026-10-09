import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent, buildTurns, newTurn } from "./transcript.ts";

const at = "2026-10-09T10:44:00+00:00";
const event = (sequence, type, data = {}) => ({ sequence, type, created: at, data });

test("记录里以 task.state 收尾的一轮不再显示“正在思考”", () => {
  const record = {
    id: "s", workspace_id: "w", study_id: null, state: "completed", waiting_reason: null, created: at, updated: at, proposals: [], steps: [],
    events: [
      event(1, "chat.message", { role: "user", content: "结论是什么？" }),
      event(2, "tool.call", { id: "t1", tool: "project_digest", title: "汇总工程研究结论" }),
      event(3, "tool.result", { id: "t1", status: "ok", summary: "已读取" }),
      event(4, "chat.message", { role: "assistant", content: "允许电流 748.3 A。" }),
      event(5, "task.state", { state: "completed", waiting_reason: null }),
      event(6, "chat.message", { role: "user", content: "准不准？" }),
      event(7, "chat.message", { role: "assistant", content: "部分复现。" }),
    ],
  };
  const turns = buildTurns(record);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].running, false);
  // 第二轮没有 task.state，但会话已完成，同样不能停在“思考中”
  assert.equal(turns[1].running, false);
});

test("实时显示：被退回重写后正文开始输出，核对步骤随之收尾", () => {
  let turn = newTurn("结论是什么？");
  turn = applyEvent(turn, { type: "error", code: "UNGROUNDED_QUANTITY", message: "数值须匹配证据" }, new Map());
  assert.equal(turn.steps.find((step) => step.tool === "answer-check").status, "running");
  turn = applyEvent(turn, { type: "message.delta", text: "允许电流 748.3 A。" }, new Map());
  assert.equal(turn.steps.find((step) => step.tool === "answer-check").status, "ok");
});

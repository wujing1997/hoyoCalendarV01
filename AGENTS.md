# 日程 Agent 工具维护规则

修改任一日程 Agent 工具时，应同步核对：

1. `TOOL_DEFINITIONS` 中的模型可见 schema。
2. `PlanningContext.execute()` 中的真实执行语义。
3. Electron 客户端审批 action 的落地规则。
4. `cloud/tests/test_agent_tool_semantics.py` 的确定性回归测试。
5. OpenAPI schema 与客户端请求/响应结构。

任一项发生契约变化时，其余项必须同步更新并通过前后端测试。

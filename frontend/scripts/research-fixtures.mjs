import { randomUUID } from "node:crypto";

export async function request(base, endpoint, method = "GET", body) {
  if (
    method !== "GET" &&
    (process.env.E2E_ISOLATED !== "1" || base !== process.env.FRONTEND_URL)
  )
    throw Error("Writing UI checks require the isolated database runner");
  const response = await fetch(base + endpoint, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  const raw=await response.text();
  let value;
  try{value=JSON.parse(raw);}catch{throw Error(`${method} ${endpoint}: ${response.status} ${raw.slice(0,500)}`);}
  if (!response.ok)
    throw Error(
      `${method} ${endpoint}: ${response.status} ${JSON.stringify(value)}`,
    );
  return value;
}

export async function currentSelection(base) {
  const workspaces = await request(base, "/api/workspaces");
  let study;
  for (const workspace of workspaces) {
    const studies = await request(
      base,
      `/api/workspaces/${workspace.id}/studies`,
    );
    study = studies.find(
      (value) =>
        value.definition.driver.kind === "selection" &&
        value.definition.method.plugin_id === "cablesim.iec60287" &&
        value.definition.driver.candidate_ids.length > 0,
    );
    if (study) break;
  }
  if (!study) throw Error("缺少已保存的真实 IEC 候选选型输入");
  const wid = study.workspace,
    sid = study.id,
    prefix = `/api/workspaces/${wid}/studies/${sid}`;
  let runs = (await request(base, prefix + "/runs")).items;
  let run = runs.findLast(
    (value) =>
      value.freshness === "current" &&
      value.integrity === "verified" &&
      ["succeeded", "partial"].includes(value.status),
  );
  if (!run) {
    // Explicit test-only release selection; do not reinterpret saved historical outputs.
    const methods = await request(base, "/api/methods");
    const selectedPin = (old) => {
      const entry = methods.find(
        (value) =>
          value.method.plugin_id === old.plugin_id &&
          value.capabilities.some((cap) => cap.id === old.capability),
      );
      if (!entry || old.plugin_id !== "cablesim.iec60287")
        throw Error("只有正式 IEC 能力可用于本地界面验收；不发起原生仿真");
      return { ...entry.method, capability: old.capability };
    };
    const definition = structuredClone(study.definition);
    definition.method = selectedPin(definition.method);
    for (const completion of Object.values(
      definition.candidate_completions || {},
    ))
      completion.method = selectedPin(completion.method);
    const workspace = await request(base, `/api/workspaces/${wid}`);
    study = await request(base, prefix, "PUT", {
      ...definition,
      expected_revision: workspace.revision,
      expected_study_revision: study.revision,
    });
    const check = await request(
      base,
      prefix +
        `/preflight?expected_revision=${workspace.revision}&expected_study_revision=${study.revision}`,
    );
    if (!check.ready)
      throw Error(
        "真实 IEC 输入预检不通过：" +
          JSON.stringify(
            check.cases.map((value) => ({
              status: value.status,
              error: value.error,
            })),
          ),
      );
    run = await request(base, prefix + "/runs", "POST", {
      request_id: randomUUID(),
      expected_revision: workspace.revision,
      expected_study_revision: study.revision,
      lock_digest: check.lock_digest,
      scope_acknowledged: true,
    });
    for (
      let attempt = 0;
      ["accepted", "running", "validating"].includes(run.status) &&
      attempt < 120;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      run = await request(base, prefix + "/runs/" + run.id);
    }
    if (
      run.integrity !== "verified" ||
      run.freshness !== "current" ||
      !["succeeded", "partial"].includes(run.status)
    )
      throw Error("真实 IEC 当前运行未成功：" + JSON.stringify(run.error));
  }
  const book = await request(
    base,
    `/api/workspaces/${wid}/deliveries/current`,
    "POST",
    { run_ids: [run.id], request_id: randomUUID() },
  );
  return { study, run, book };
}

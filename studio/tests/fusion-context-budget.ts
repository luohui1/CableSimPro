// Both passes of the six maintainer prompts share one real, cumulative conversation. The model's transport rejects over-budget requests,
// while saved runs, full review cards and the eleven-row manufacturer workflow still use the ordinary platform.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { fauxAssistantMessage, fauxText, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createSidecar, type Sidecar } from '../fusion/server.ts';
import type { ChatView, Proposal } from '../shared/types.ts';
import { budgetedModel, CONTEXT_TOKENS, OUTPUT_TOKENS } from './fusion-budget.ts';
import { importInventory, installStructureImport, manufacturerWorkbook } from './fusion-import-scripts.ts';
import { installConditionWorkflow, installStudyRead, installStudyWorkflow, type FlowState } from './fusion-scripts.ts';
import { steps, toolText } from './support.ts';
import { assertFormalPdf, formalFileCount } from './fusion-deliveries.ts';
import { FORMAL_DOCUMENT, FORMAL_DOCUMENT_PROMPT } from './fusion-scripts.ts';

interface Options {
  repo: string;
  home: string;
  url: string;
  token: string;
  manifest: { types: { name: string; workspace: string; teaching?: boolean }[] };
  fixture: { workspace: string; study: string; run: string };
}

const answer = (value: string) => fauxAssistantMessage([fauxText(value)]);
const call = (tool: string, args: Record<string, any>) =>
  fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: 'toolUse' });
const data = (context: TranscriptContext): Record<string, any> => {
  assert.equal((context.messages.at(-1) as { isError?: boolean }).isError, false, toolText(context));
  return JSON.parse(toolText(context)).data;
};
const visibleText = (context: TranscriptContext): string => context.messages.map(message =>
  typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text')
    .map(part => part.text).join('\n')).join('\n');

export async function verifyContextBudget(options: Options, t: TestContext): Promise<void> {
  const { repo, home, url, token, fixture: initialFixture, manifest } = options;
  const budget = await budgetedModel();
  const sidecarHome = join(home, 'context-budget');
  const openSidecar = () => createSidecar({ backendUrl: url, token, home: sidecarHome, port: 8111, runtime: budget.runtime });
  let sidecar: Sidecar = openSidecar();
  let conversation: string | undefined;
  let originalDomain: Record<string, any> | undefined;
  const context = { workspace_id: initialFixture.workspace, study_id: initialFixture.study, label: '城南线路直埋校核' };
  let round = 0;
  let nextFixture = initialFixture;
  const roundReports: Record<string, any>[] = [];
  const approvalObservations: { id: string; operation: string; round: number; nativeSummaries: number; request: number }[] = [];
  const accepted: Proposal[] = [];
  const api = async (path: string, body?: unknown, method: 'POST' | 'PUT' = 'POST'): Promise<any> => {
    const response = await fetch(url + path, body === undefined ? {} : {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.ok(response.ok, `${path}: ${JSON.stringify(result)}`);
    return result;
  };

  const settle = async (verify?: (proposal: Proposal) => Promise<void>): Promise<ChatView> => {
    assert.ok(conversation);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const view = await sidecar.agent.view(conversation);
      if (!view.running) return view;
      assert.ok(view.waiting.length <= 1, 'one immutable proposal is reviewed at a time');
      const proposal = view.waiting[0];
      if (proposal) {
        assert.ok(proposal.changes.length && proposal.checks?.length, 'the reviewer retains complete changes and effects');
        await verify?.(proposal);
        assert.ok(!accepted.some(item => item.id === proposal.id), 'one saved proposal receives exactly one test decision');
        accepted.push(proposal);
        approvalObservations.push({ id: proposal.id, operation: proposal.operation, round,
          nativeSummaries: budget.nativeSummaries.length, request: budget.requests.length });
        await sidecar.agent.decide(proposal.id, true, '隔离预算验收：测试逐项显式接受', conversation);
      } else await new Promise(done => setTimeout(done, 30));
    }
    throw new Error('64k workflow did not finish: ' + JSON.stringify(await sidecar.agent.view(conversation)));
  };
  const send = async (flow: string, prompt: string, attachment?: { filename: string; content_base64: string }) => {
    budget.flow(`第${round}遍 · ${flow}`);
    const result = await sidecar.agent.send(conversation, prompt, context,
      attachment ? [{ filename: attachment.filename, content_base64: attachment.content_base64 }] : undefined);
    conversation ??= result.session;
    assert.equal(result.session, conversation, 'both six-prompt passes must retain the same conversation identity');
  };
  const completed = (state: FlowState, view: ChatView) => {
    if (budget.violations.length || state.failure) {
      const pages = [...budget.toolInputs.values()].filter(result => result.tool === 'type_read').map(result => {
        const value = JSON.parse(result.text).data ?? {};
        return { view: value.view, total: value.total, items: value.items?.length, next: value.next_page?.after,
          characters: result.text.length, sections: (value.items ?? []).map((item: any) => item.section),
          largestFields: Object.entries(value).map(([key, item]) => ({ key, characters: JSON.stringify(item)?.length ?? 0 }))
            .sort((left, right) => right.characters - left.characters).slice(0, 3),
          examples: (value.items ?? []).filter((item: any) => item.section === 'checks').slice(0, 2).map((item: any) => ({
            keys: Object.keys(item), message: String(item.message ?? '').slice(0, 160),
            resultKeys: Object.keys(item.result ?? {}), quantities: item.quantities?.length,
          })) };
      });
      t.diagnostic(JSON.stringify({ rejected: budget.violations, lastRequests: budget.requests.slice(-2),
        flowStarts: budget.requests.filter((request, index) => index === 0 || budget.requests[index - 1].flow !== request.flow),
        toolHistory: [...new Set([...budget.toolInputs.values()].map(item => item.tool))].map(tool => {
          const values = [...budget.toolInputs.values()].filter(item => item.tool === tool);
          return { tool, calls: values.length, characters: values.reduce((sum, item) => sum + item.text.length, 0) };
        }),
        typePages: [...pages.slice(0, 2), ...pages.slice(-2)] }));
    }
    assert.equal(budget.violations.length, 0, JSON.stringify(budget.violations));
    assert.equal(state.failure, undefined);
    assert.equal(state.done, true, 'a stopped or truncated answer is not a completed workflow: ' + JSON.stringify(view.items.at(-1)));
    assert.equal(view.waiting.length, 0);
    assert.ok(steps(view).every(step => step.status === 'done'), 'every real tool step must complete');
  };

  try {
    originalDomain = structuredClone((await api(`/api/workspaces/${initialFixture.workspace}`)).domain);
    const database = join(home, 'engineering.sqlite');
    const initialInventory = importInventory(repo, database);
    const originalStudyCount = (await api(`/api/workspaces/${initialFixture.workspace}/studies`)).length;
    const originalDeliveryCount = (await api(`/api/workspaces/${initialFixture.workspace}/deliveries`)).length;
    const originalFormalCount = formalFileCount(repo, database, initialFixture.workspace);
    for (round = 1; round <= 2; round += 1) {
      const fixture = nextFixture;
      const targetSoil = round === 1 ? 1.2 : 1.3;
      // The workbench keeps the conversation's original binding. Newly
      // accepted studies are adopted through their real receipts, not by
      // silently rebinding the same conversation on the second pass.
      const firstRequest = budget.requests.length + 1;
      // 1. Saved conclusions and limitations, using the release seed's actual successful run.
      const read = installStudyRead(budget.faux, { ...fixture, discoverRun: true, inspectSavedDetail: true });
      await send('研究结论与限制', '这项研究的结论是什么，受什么限制？');
      const readView = await settle();
      completed(read, readView);
      const runCard = steps(readView).map(step => step.card).findLast(card => card?.kind === 'saved_run' && card.href.includes(fixture.run));
      assert.ok(runCard?.kind === 'saved_run');
      assert.equal(runCard.view.current, read.result!.headlines.find((row: any) => row.key === 'ampacity').display_value.toFixed(1));
      assert.ok(runCard.view.limiting.name && runCard.view.tier_note, 'constraints are retained beside the actual current');

      // 2. Read the type identity and structure, the eight main input facts, all saved checks, then the geometry headline.
      // This is a question about principal parameters, not an edit requiring every input field or a full standards report.
      const sourceType = manifest.types.find(item => item.name.startsWith('YJV22') && !item.teaching);
      assert.ok(sourceType?.workspace);
      const typeWorkspace = await api(`/api/workspaces/${sourceType.workspace}`);
      const cable = typeWorkspace.domain.cable_types[0];
      const escape = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
      const cablePath = '/cable_types/' + escape(cable.id);
      assert.equal(cable.cores.length, 3, 'use the released three-core design');
      const mainFacts = [
        ...cable.cores.map((core: any) => ({ path: cablePath + '/cores/' + escape(core.id) + '/layers/insulation/thickness',
          value: core.layers.find((layer: any) => layer.role === 'insulation').thickness, unit: 'm' })),
        { path: cablePath + '/common_layers/oversheath/thickness', value: cable.common_layers.find((layer: any) => layer.role === 'oversheath').thickness, unit: 'm' },
        { path: cablePath + '/cores/' + escape(cable.cores[0].id) + '/conductor/r20', value: cable.cores[0].conductor.r20, unit: 'ohm/m' },
        { path: cablePath + '/cores/' + escape(cable.cores[0].id) + '/conductor/nominal_area', value: cable.cores[0].conductor.nominal_area * 1_000_000, unit: 'mm²' },
        { path: cablePath + '/rating/u0', value: cable.rating.u0, unit: 'V' },
        { path: cablePath + '/rating/u', value: cable.rating.u, unit: 'V' },
      ];
      const typeState: FlowState = { done: false };
      const typeItems: Record<string, any>[] = [];
      const checkSources = new Map<string, Record<string, any>>();
      let selectedType = '';
      let runItemCount = 0;
      let runItemTotal: number | undefined;
      let geometry: Record<string, any> | undefined;
      const typeGeometry = (current: TranscriptContext): ReturnType<typeof fauxAssistantMessage> => {
        try {
          const saved = data(current);
          assert.equal(saved.status, 'succeeded');
          const diameter = saved.headlines.find((item: any) => item.key === 'x-cablesim.outer-diameter');
          assert.ok(diameter && typeof diameter.display_value === 'number' && diameter.display_value > 0,
            'the external diameter must come from actual saved geometry evidence');
          typeState.result = saved;
          typeState.done = true;
          return answer('型号的保存结构、主要尺寸和缺项已读回；外径来自已保存几何结果，来源和标准核对范围见型号卡。');
        } catch (error) {
          typeState.failure = error instanceof Error ? error.message : String(error);
          return answer('型号读取未完成，不能给出完整结论。');
        }
      };
      const typeOutline = (current: TranscriptContext): ReturnType<typeof fauxAssistantMessage> => {
        try {
          const outline = data(current);
          assert.equal(outline.workspace_revision, typeWorkspace.revision);
          assert.equal(outline.freshness, 'current');
          const cableObject = outline.objects.cable_types[0];
          const areaPaths: string[] = cableObject.fields.filter((field: any) => /\/conductor\/nominal_area$/.test(field.path))
            .map((field: any) => field.path);
          assert.equal(areaPaths.length, 3, 'discover all three stable core identities from the actual model-visible outline');
          // Only the stable object/core prefixes come from discovery; these scalar suffixes are the documented domain fields.
          const requestedPaths = [...areaPaths.map(path => path.replace('/conductor/nominal_area', '/layers/insulation/thickness')),
            cableObject.path + '/common_layers/oversheath/thickness', areaPaths[0].replace('/nominal_area', '/r20'), areaPaths[0],
            cableObject.path + '/rating/u0', cableObject.path + '/rating/u'];
          assert.deepEqual(requestedPaths, mainFacts.map(item => item.path), 'the external API is an oracle, never a hidden model input');
          budget.faux.setResponses([current => {
            try {
              const selected = data(current);
              assert.equal(selected.workspace_revision, typeWorkspace.revision);
              assert.equal(selected.freshness, 'current');
              const fields = selected.fields;
              assert.equal(fields.length, mainFacts.length);
              for (const expected of mainFacts) {
                const actual = fields.find((item: any) => item.path === expected.path);
                assert.ok(actual, 'the model reads each named main parameter through the real tool');
                assert.equal(actual.unit, expected.unit);
                assert.ok(typeof actual.value === 'number' && Math.abs(actual.value - expected.value) <= 5e-13,
                  'a model-visible parameter matches the saved fact within the platform display precision (12 decimal places)');
                if (expected.path.endsWith('/r20')) {
                  assert.equal(actual.display_unit, 'Ω/km');
                  assert.equal(actual.display_value, Number((actual.value * 1000).toPrecision(12)));
                }
              }
              budget.faux.setResponses([typePage]);
              return call('type_read', { type_id: selectedType, view: 'runs', limit: 20 });
            } catch (error) {
              typeState.failure = error instanceof Error ? error.message : String(error);
              return answer('主要参数读取未完成，不能给出完整结论。');
            }
          }]);
          return call('workspace_read', { workspace_id: selectedType, paths: requestedPaths });
        } catch (error) {
          typeState.failure = error instanceof Error ? error.message : String(error);
          return answer('主要参数读取未完成，不能给出完整结论。');
        }
      };
      const typePage = (current: TranscriptContext): ReturnType<typeof fauxAssistantMessage> => {
        try {
          const saved = data(current);
          assert.equal(saved.type_id, selectedType);
          assert.equal(saved.view, 'runs');
          assert.equal(saved.type_revision, typeWorkspace.revision, 'structure, parameters and checks refer to one saved input revision');
          if (!runItemCount) {
            const overview = saved.items.find((item: any) => item.section === 'overview');
            assert.equal(overview?.construction, cable.construction);
            assert.equal(overview.source.kind, 'saved_type_input');
            assert.equal(overview.source.type_id, selectedType);
            assert.equal(overview.source.revision, typeWorkspace.revision);
            assert.match(overview.source.digest, /^[0-9a-f]{64}$/);
            assert.ok(saved.next_page, 'read every page after the actual saved overview');
          }
          typeItems.push(...saved.items);
          for (const item of saved.items.filter((item: any) => item.section === 'checks')) {
            const origin = typeof item.source?.index === 'number' ? saved.sources?.[item.source.index] : item.source;
            assert.ok(origin?.run_id && origin.study_id && origin.method,
              'every check names the actual saved source, resolving its page-local index');
            checkSources.set(item.id, origin);
          }
          const read = JSON.parse(toolText(current)).detail?.read;
          assert.equal(read?.tool, 'type_read');
          assert.equal(read.arguments.type_id, selectedType);
          assert.equal(read.arguments.view, 'runs');
          assert.match(read.arguments.result_digest, /^[0-9a-f]{64}$/, 'the original page and full source traces have a bound read');
          runItemTotal ??= saved.total;
          assert.equal(saved.total, runItemTotal, 'all checks and run references are read from one consistent saved view');
          runItemCount += saved.items.length;
          if (saved.next_page) {
            budget.faux.setResponses([typePage]);
            return call('type_read', saved.next_page);
          }
          assert.equal(runItemCount, runItemTotal, 'every advertised check and run reference must survive the model projection');
          assert.ok(typeItems.some(item => item.section === 'checks'), 'missing or uncovered evidence remains readable');
          geometry = typeItems.find(item => item.section === 'runs' && item.channel === 'geometry');
          assert.ok(geometry?.run_id && geometry.study_id, 'use the type evidence channel, not a guessed run identity');
          budget.faux.setResponses([typeGeometry]);
          return call('run_read', { workspace_id: selectedType, study_id: geometry.study_id, run_id: geometry.run_id });
        } catch (error) {
          typeState.failure = error instanceof Error ? error.message : String(error);
          return answer('型号读取未完成，不能给出完整结论。');
        }
      };
      budget.faux.setResponses([
        () => call('object_find', { kind: 'type', q: sourceType.name, limit: 20 }),
        current => {
          const matches = data(current).items.filter((item: any) => item.name === sourceType.name);
          assert.equal(matches.length, 1, 'the explicitly named type must resolve unambiguously through the real index');
          selectedType = matches[0].id;
          assert.equal(selectedType, sourceType.workspace, 'the API fixture is only a verification oracle for the discovered identity');
          budget.faux.setResponses([typeOutline]);
          return call('workspace_read', { workspace_id: selectedType });
        },
      ]);
      await send('型号结构与参数', `“${sourceType.name}”型号的结构和主要参数是什么，还有哪些缺项？`);
      completed(typeState, await settle());
      assert.ok(budget.requests.filter(request => request.flow === `第${round}遍 · 型号结构与参数`).length > 2, 'exercise genuine type pagination');
      assert.equal(runItemCount, 65, 'retain all release evidence entries, not a budget-selected subset');
      assert.equal(typeItems.filter(item => item.section === 'checks').length, 59, 'all actual saved checks, including missing and excluded states, remain model-readable');
      // This full public record is an assertion oracle only, after the model has completed all its bounded pages. It never
      // enters the scripted model's context or supplies a subsequent tool argument. Missing/null values are facts, too.
      const fullSpecification = await api(`/api/types/${selectedType}/specification?audience=internal&view=full`);
      const overview = typeItems.find(item => item.section === 'overview');
      assert.ok(overview);
      assert.deepEqual(overview.base_reference, fullSpecification.payload.base_reference,
        'retain the entire actual source, standard limits and every non-manufacturer/non-approved qualification once');
      assert.equal(overview.source.revision, fullSpecification.payload.revision);
      const rawChecks = fullSpecification.payload.checks;
      const modelChecks = typeItems.filter(item => item.section === 'checks');
      assert.deepEqual(modelChecks.map(item => item.id).sort(), rawChecks.map((item: any) => item.id).sort(),
        'the model actually read every original check identity, including all missing-input conclusions');
      for (const raw of rawChecks) {
        const projected = modelChecks.find(item => item.id === raw.id)!;
        for (const key of ['channel', 'message', 'blocking', 'excluded', 'exclusion_reason', 'status', 'missing'])
          if (key in raw) assert.deepEqual(projected[key], raw[key], `saved check ${raw.id}: ${key}`);
        for (const key of ['actual', 'actual_unrounded', 'design_actual', 'limit', 'value', 'unit', 'margin', 'comparison',
          'verdict', 'status', 'satisfied', 'basis', 'source_status', 'missing', 'missing_parameters', 'target', 'standard', 'clause'])
          if (raw.result && key in raw.result) assert.deepEqual(projected.result?.[key], raw.result[key], `saved check ${raw.id}: result.${key}`);
        if (Array.isArray(raw.result?.basis_missing_fields)) {
          assert.equal(projected.result.basis_missing_fields.length, raw.result.basis_missing_fields.length);
          raw.result.basis_missing_fields.forEach((field: any, index: number) => {
            if (!field || typeof field !== 'object') { assert.deepEqual(projected.result.basis_missing_fields[index], field); return; }
            for (const key of ['field', 'label', 'unit', 'type', 'storage', 'required', 'status', 'reason'])
              if (key in field) assert.deepEqual(projected.result.basis_missing_fields[index][key], field[key], `missing input ${raw.id}: ${key}`);
          });
        }
        const source = fullSpecification.payload.sources.find((item: any) => item.channel === raw.channel);
        assert.ok(source);
        for (const key of ['run_id', 'study_id', 'workspace_revision', 'study_revision', 'method', 'freshness', 'status', 'engineering_approval'])
          if (key in source) assert.deepEqual(checkSources.get(raw.id)?.[key], source[key], `saved check ${raw.id}: source.${key}`);
      }
      const geometryRun = await api(`/api/workspaces/${sourceType.workspace}/studies/${geometry!.study_id}/runs/${geometry!.run_id}?view=full`);
      assert.equal(geometryRun.integrity, 'verified');
      const diameter = typeState.result!.headlines.find((item: any) => item.key === 'x-cablesim.outer-diameter');
      const originalDiameter = geometryRun.output.cases.flatMap((item: any) => item.results)
        .find((item: any) => item.key === diameter.key && item.entity === diameter.entity);
      assert.ok(originalDiameter && typeof originalDiameter.value === 'number', 'the saved geometry contains the actual reported quantity');
      assert.equal(diameter.value, originalDiameter.value);
      assert.equal(diameter.unit, originalDiameter.unit);
      assert.equal(diameter.unit, 'm');
      assert.equal(diameter.display_unit, 'mm');
      assert.equal(diameter.display_value, originalDiameter.value * 1000);

      // 3. Create and run only; exporting is the separate fifth user request.
      const existingStudies = await api(`/api/workspaces/${fixture.workspace}/studies`);
      const created = installStudyWorkflow(budget.faux, { ...fixture, title: `64k 上下文验收第${round}遍 · 直埋单回校核`, exportBook: false });
      await send('新建直埋并计算', '按这项已保存的600 A工况新建一项直埋单回校核并算出来。');
      completed(created, await settle(async proposal => {
        if (proposal.operation === 'propose_study')
          assert.equal((await api(`/api/workspaces/${fixture.workspace}/studies`)).length, existingStudies.length);
        if (proposal.operation === 'propose_study_run')
          assert.equal((await api(`/api/workspaces/${fixture.workspace}/studies/${created.study}/runs`)).items.length, 0);
      }));
      assert.ok(created.study && created.run && created.result);

      // 4. The exact previously failing path: a real changed input, recomputation and full saved-run comparison.
      const workspace = await api(`/api/workspaces/${fixture.workspace}`);
      const soil = workspace.domain.materials.find((item: any) => item.id === 'material/soil');
      assert.ok(soil && soil.thermal_resistivity !== targetSoil, 'the release fixture must exercise an actual condition change');
      const observedStudy = [...budget.toolInputs.values()].findLast(result => result.tool === 'study_read');
      assert.ok(observedStudy);
      const savedSoil = JSON.parse(observedStudy.text).data.input_fields.find((field: any) =>
        field.entity === 'material/soil' && field.path.endsWith('/thermal_resistivity'));
      assert.ok(savedSoil?.path, 'reuse the actual soil field identity already read by the model from the saved study');
      const path = savedSoil.path;
      assert.equal(path, '/materials/' + soil.id.replaceAll('~', '~0').replaceAll('/', '~1') + '/thermal_resistivity');
      const changed = installConditionWorkflow(budget.faux, { workspace: fixture.workspace, study: created.study,
        run: created.run, path, value: targetSoil, requireVisibleReferences: true });
      await send('改条件重算对比', `把土壤热阻率改为${targetSoil} K·m/W，重新计算，并与刚才的运行对比。`);
      completed(changed, await settle(async proposal => {
        if (proposal.operation === 'propose_domain_changes')
          assert.equal((await api(`/api/workspaces/${fixture.workspace}`)).domain.materials.find((item: any) => item.id === soil.id).thermal_resistivity, soil.thermal_resistivity);
        if (proposal.operation === 'propose_study_run')
          assert.equal((await api(`/api/workspaces/${fixture.workspace}/studies/${created.study}/runs`)).items.length, 1);
      }));
      assert.ok(changed.run && changed.comparison);
      const rawComparison = await api(`/api/workspaces/${fixture.workspace}/study-comparisons`, { run_ids: [created.run, changed.run] });
      const rawPoint = rawComparison.differences[0].quantities.find((row: any) => row.key === 'ampacity' && row.unit === 'A');
      const summaryPoint = changed.comparison.differences[0].quantities.find((row: any) => row.key === 'ampacity' && row.unit === 'A');
      for (const [key, value] of Object.entries(rawPoint))
        assert.deepEqual(summaryPoint[key], value, 'the bounded summary retains the backend-computed ' + key + ' exactly');
      assert.ok(rawPoint.difference < 0);
      const oldRun = await api(`/api/workspaces/${fixture.workspace}/studies/${created.study}/runs/${created.run}?view=full`);
      assert.equal(oldRun.integrity, 'verified');
      assert.equal(oldRun.freshness, 'historical');
      const unboundedComparisonChars = JSON.stringify(rawComparison).length;
      assert.ok(unboundedComparisonChars > 500_000, 'this regression must reproduce the genuinely large saved comparison');
      const unbounded = budget.withUnboundedResult('study_compare', { status: 'ok', data: { comparison: rawComparison } });
      assert.ok(unbounded.totalTokens > CONTEXT_TOKENS, 'restoring the full real comparison must exceed 64k');

      // A restart loads the same persisted messages. Full cards must survive without becoming model content again.
      await sidecar.close();
      sidecar = openSidecar();

      // 5. Export the actual newly computed run after another independent test approval.
      const exportState: FlowState = { done: false };
      const deliveries = await api(`/api/workspaces/${fixture.workspace}/deliveries`);
      const formalCount = formalFileCount(repo, database, fixture.workspace);
      budget.faux.setResponses([
        current => {
          assert.ok(visibleText(current).includes(changed.run!),
          'after restarting, the model must still see the actual changed run identity in its persisted history');
          return call('propose_delivery', { workspace_id: fixture.workspace, run_ids: [changed.run], document: FORMAL_DOCUMENT });
        },
        current => {
          const saved = data(current).receipt;
          assert.equal(saved.kind, 'delivery');
          assert.ok(saved.download_url);
          exportState.file = saved.download_url;
          exportState.done = true;
          return answer('计算书已从这次保存结果生成，可以预览和下载。');
        },
      ]);
      await send('导出计算书', '把刚才这次重算结果导出为正式计算书 PDF。' + FORMAL_DOCUMENT_PROMPT);
      const exportedView = await settle(async proposal => {
        assert.equal(proposal.operation, 'propose_delivery');
        assert.equal(formalFileCount(repo, database, fixture.workspace), formalCount);
        assert.equal((await fetch(url + '/api/agent/files/' + proposal.id)).status, 404, 'unaccepted exports have no file');
        assert.equal((await api(`/api/workspaces/${fixture.workspace}/deliveries`)).length, deliveries.length);
      });
      completed(exportState, exportedView);
      assert.ok(steps(exportedView).some(step => step.card?.kind === 'saved_file'));
      const fileResponse = await fetch(url + exportState.file);
      const exported = await assertFormalPdf(fileResponse, 'calculation', FORMAL_DOCUMENT);
      assert.equal(exported.model.source_identity.pins.length, 1);
      assert.equal(exported.model.source_identity.pins[0].run_id, changed.run);
      assert.equal(formalFileCount(repo, database, fixture.workspace), formalCount + 1);

      // 6. Real original workbook -> full preview -> eleven drafts -> eleven ordinary standard-check runs.
      const workbook = manufacturerWorkbook(repo);
      const inventory = importInventory(repo, database);
      const imported = installStructureImport(budget.faux, { workspace: fixture.workspace,
        seriesName: `64k 上下文验收第${round}遍 · 人民电器结构表`, inspectSavedDetail: true });
      const importApprovals: Proposal[] = [];
      if (round === 2) budget.injectLengthOnceAfter('propose_structure_upload');
      await send('厂家表导入核对', '把附上的厂家结构表导进型号库并核对，所有写操作逐项交我审阅。', workbook);
      const importView = await settle(async proposal => {
        const counts = importInventory(repo, database);
        const phase = importApprovals.length;
        assert.equal(counts.type_table_uploads, inventory.type_table_uploads + (phase >= 1 ? 1 : 0));
        assert.equal(counts.type_table_previews, inventory.type_table_previews + (phase >= 2 ? 1 : 0));
        assert.equal(counts.type_series, inventory.type_series + (phase >= 3 ? 1 : 0));
        assert.equal(counts.type_series_specs, inventory.type_series_specs + (phase >= 3 ? 11 : 0));
        assert.equal(counts.domain_cable_models, inventory.domain_cable_models + (phase >= 3 ? 11 : 0));
        assert.equal(counts.study_runs, inventory.study_runs, 'the batch cannot execute before its own fourth acceptance');
        importApprovals.push(proposal);
      });
      completed(imported, importView);
      assert.deepEqual(importApprovals.map(proposal => proposal.operation),
        ['propose_structure_upload', 'propose_structure_preview', 'propose_structure_import', 'propose_structure_check']);
      const cards = steps(importView).map(step => step.card);
      const preview = cards.find(card => card?.kind === 'structure_preview' && card.view.preview_id === imported.preview!.preview_id);
      const draft = cards.find(card => card?.kind === 'structure_import' && card.view.series_id === imported.imported!.series_id);
      const check = cards.find(card => card?.kind === 'structure_check' && card.view.batch_id === imported.checked!.batch_id);
      assert.ok(preview?.kind === 'structure_preview' && draft?.kind === 'structure_import' && check?.kind === 'structure_check');
      assert.equal(preview.view.complete, true);
      assert.equal(preview.view.rows.length, 11);
      assert.equal(preview.view.sha256, imported.attachment!.sha256);
      assert.equal(preview.view.preview_digest, imported.preview!.preview_digest);
      assert.equal(draft.view.created, 11);
      assert.equal(draft.view.specs.length, 11);
      assert.equal(check.view.complete, true);
      assert.equal(check.view.items.length, 11);
      assert.ok(importApprovals.find(proposal => proposal.operation === 'propose_structure_import')!.changes.length > 300,
        'complete field changes remain in the human review, not a summary substituted for approval');
      const previewRecord = JSON.parse(execFileSync(process.env.CABLE_STUDIO_PYTHON ?? 'python', ['-c',
        "import sqlite3,sys; db=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); row=db.execute('SELECT payload FROM type_table_previews WHERE id=?',(sys.argv[2],)).fetchone(); assert row; print(row[0]); db.close()",
        database, imported.preview!.preview_id], { cwd: repo, encoding: 'utf8', maxBuffer: 4_194_304 }));
      assert.deepEqual(preview.view.rows, previewRecord.rows.map(({ payload: _payload, ...row }: Record<string, any>) => row),
        'every displayed preview field, source, unit, issue and missing item equals the full immutable record');
      assert.deepEqual(imported.previewDetail, preview.view.rows[0].values[0],
        'the model can follow the bounded result guidance and read an actual field after two stable continuation pages');
      const savedSeries = await api(`/api/type-library/series/${draft.view.series_id}`);
      assert.equal(savedSeries.specs.length, 11);
      for (const item of check.view.items) {
        const run = await api(`/api/workspaces/${item.workspace_id}/studies/${item.study_id}/runs/${item.run_id}?view=full`);
        assert.equal(run.status, 'succeeded');
        assert.equal(run.integrity, 'verified');
        assert.equal(run.input_digest, item.input_digest);
        assert.equal(run.output_digest, item.output_digest);
        assert.equal(run.snapshot.definition.method.plugin_id, 'cablesim.standard-check');
      }
      assert.equal(importInventory(repo, database).study_runs, inventory.study_runs + 11);

      roundReports.push({ round, firstRequest, lastRequest: budget.requests.length, targetSoil,
        typeId: selectedType, typeEntries: runItemCount, typeChecks: modelChecks.length,
        study: created.study, run: changed.run, comparisonCharacters: unboundedComparisonChars,
        unboundedComparisonTotalTokens: unbounded.totalTokens, preview: preview.view, imported: draft.view, checked: check.view,
        uploadId: imported.upload!.upload_id,
        approvalIds: importApprovals.map(proposal => proposal.id) });
      nextFixture = { workspace: fixture.workspace, study: created.study, run: changed.run };
    }

    await sidecar.agent.idle(conversation!);
    const sessionDirectory = join(sidecarHome, 'agent', 'sessions');
    const savedSession = (await SessionManager.list(join(sidecarHome, 'agent', 'workspace'), sessionDirectory))
      .find(item => item.id === conversation);
    assert.ok(savedSession, 'native pi owns the persisted conversation');
    const entries = SessionManager.open(savedSession.path).getEntries();
    const compactions = entries.filter(entry => entry.type === 'compaction');
    assert.ok(compactions.length > 0 && budget.nativeSummaries.length >= compactions.length,
      'native compaction must call the actual model adapter and save genuine checkpoints');
    for (const entry of compactions) {
      assert.ok(entry.tokensBefore > 0 && entries.some(item => item.id === entry.firstKeptEntryId));
      assert.ok(entry.usage && entry.usage.input > 0 && entry.usage.output > 0, 'saved checkpoint usage comes from the measured upstream response');
      assert.ok(budget.nativeSummaries.some(summary => entry.summary.includes(summary.text)),
        'the persisted native summary includes the actual scripted upstream answer, not an injected replacement checkpoint');
      assert.match(entry.summary, /<cablesim-state>/);
    }
    assert.equal(entries.filter(entry => entry.type === 'message' && entry.message.role === 'user').length, 12,
      'both complete six-prompt passes remain in the original persistent conversation after compaction and restart');
    const lengthProbe = budget.requests.filter(request => request.injectedLength);
    assert.equal(lengthProbe.length, 1, 'exercise one production length recovery without consuming a business model response');
    assert.ok(budget.nativeSummaries.some(summary => summary.request < lengthProbe[0].request),
      'natural context pressure must trigger native compaction before the explicit length-recovery probe');
    const secondUpload = approvalObservations.find(item => item.round === 2 && item.operation === 'propose_structure_upload')!;
    const secondPreview = approvalObservations.find(item => item.round === 2 && item.operation === 'propose_structure_preview')!;
    const recoveredSummaries = budget.nativeSummaries.filter(summary => summary.request > secondUpload.request && summary.request < secondPreview.request);
    assert.ok(recoveredSummaries.length && secondPreview.nativeSummaries > secondUpload.nativeSummaries,
      'after the accepted upload, length recovery compacts before the next pending preview can be reviewed and accepted');
    assert.ok(recoveredSummaries.some(summary => summary.state.accepted_receipts.some((item: any) =>
      item.receipt?.upload_id === roundReports[1].uploadId && item.receipt.status === 'succeeded')),
    'the summarizer itself receives the real accepted upload identity, so it can continue without replaying that write');
    assert.equal(accepted.length, 18);
    assert.equal(new Set(accepted.map(proposal => proposal.id)).size, 18);
    for (const operation of ['propose_structure_upload', 'propose_structure_preview', 'propose_structure_import', 'propose_structure_check']) {
      assert.equal(accepted.filter(proposal => proposal.operation === operation).length, 2);
      assert.equal([...budget.firstToolInputs.values()].filter(result => result.tool === operation).length, 2,
        'each manufacturer write executes once per explicit acceptance, including across length recovery');
    }
    const finalInventory = importInventory(repo, database);
    for (const [table, count] of Object.entries({ type_table_uploads: 2, type_table_previews: 2, type_series: 2,
      type_series_specs: 22, domain_cable_models: 22, study_runs: 26 }))
      assert.equal(finalInventory[table], initialInventory[table] + count, 'exactly-once persistent writes: ' + table);
    assert.equal((await api(`/api/workspaces/${initialFixture.workspace}/studies`)).length, originalStudyCount + 2);
    assert.equal((await api(`/api/workspaces/${initialFixture.workspace}/deliveries`)).length, originalDeliveryCount, 'formal exports do not create legacy HTML delivery records');
    assert.equal(formalFileCount(repo, database, initialFixture.workspace), originalFormalCount + 2);
    const requestsBeforeReplay = budget.requests.length;
    for (const proposal of accepted.filter(item => ['propose_delivery', 'propose_structure_check'].includes(item.operation)))
      await assert.rejects(sidecar.agent.decide(proposal.id, true, '复验已接受回执不重复执行', conversation!),
        { code: 'PROPOSAL_UNKNOWN' }, 'a resolved card cannot execute its accepted write again');
    assert.deepEqual(importInventory(repo, database), finalInventory);
    assert.equal(formalFileCount(repo, database, initialFixture.workspace), originalFormalCount + 2);
    assert.equal(budget.requests.length, requestsBeforeReplay, 'repeated acceptance after compaction neither reruns a write nor restarts the model');
    const finalView = await sidecar.agent.view(conversation!);
    for (const report of roundReports) {
      const card = steps(finalView).map(step => step.card).find(card =>
        card?.kind === 'structure_preview' && card.view.preview_id === report.preview.preview_id);
      assert.ok(card?.kind === 'structure_preview');
      assert.deepEqual(card.view, report.preview, 'full earlier review cards survive native compaction and subsequent user turns');
    }

    const toolInputs = [...budget.toolInputs.values()];
    assert.ok(toolInputs.every(result => result.text.length <= 12_000), 'every actual model tool message obeys the hard character ceiling');
    assert.ok(budget.requests.every(request => request.largestToolResultChars <= 12_000 && request.largestToolResultBytes <= 18_000),
      'later history projection must not hide an oversized tool message sent in an earlier request');
    for (const tool of ['study_compare', 'propose_structure_preview', 'propose_structure_import']) {
      const first = JSON.parse([...budget.firstToolInputs.values()].find(result => result.tool === tool)!.text);
      const latest = JSON.parse(toolInputs.find(result => result.tool === tool)!.text);
      assert.deepEqual(latest.detail?.read, first.detail?.read,
        'history keeps the exact saved detail reference for ' + tool);
      assert.equal(latest.detail?.original_characters, first.detail?.original_characters,
        'history does not relabel its own shortened text as the original ' + tool + ' result');
      for (const inputs of [budget.firstToolInputs, budget.toolInputs]) {
        const result = JSON.parse([...inputs.values()].find(result => result.tool === tool)!.text);
        assert.ok(result.detail?.read, tool + ' explains how to page through full saved details, including after history projection');
        assert.ok(result.detail.original_characters > 12_000, tool + ' exercises an actually oversized platform result');
        assert.ok((result.data?.proposal?.changes?.length ?? 0) <= 4,
          'the model may receive a few simple change headlines, while full proposal changes belong to the review card');
      }
    }
    const previewModel = JSON.parse(toolInputs.find(result => result.tool === 'propose_structure_preview')!.text).data.receipt;
    assert.equal(previewModel.preview, undefined, 'full row values do not get repeated into model history');
    assert.equal(previewModel.valid_count, 11);
    assert.equal(previewModel.error_count, 0);
    assert.equal(previewModel.incomplete_count, 0);
    assert.equal(budget.requests.at(-1)!.logicalUserTurns, 12);
    assert.equal(new Set(budget.requests.map(request => request.flow)).size, 12);
    assert.ok(budget.requests.some(request => request.kind === 'conversation' && request.userMessages < request.logicalUserTurns),
      'native checkpoints must actually replace old messages in model input while retaining the original conversation for review');
    assert.ok(budget.requests.every(request => (request.kind === 'compaction' || request.outputTokens === OUTPUT_TOKENS)
      && request.outputTokens > 0 && request.outputTokens <= OUTPUT_TOKENS && request.totalTokens <= CONTEXT_TOKENS));
    assert.ok(budget.requests.every(request => request.framingReserve > 0 && request.reportedInputTokens === request.encodedTokens
      && request.inputTokens === request.encodedTokens + request.framingReserve
      && request.totalTokens === request.encodedTokens + request.framingReserve + OUTPUT_TOKENS),
    'the gate includes every framing reserve while upstream usage reports the actual tokenizer measurement, never a virtual allowance');
    assert.equal(budget.violations.length, 0);
    t.diagnostic(JSON.stringify({ tokenizer: 'max(cl100k_base, o200k_base); not the GLM tokenizer', contextTokens: CONTEXT_TOKENS,
      reservedOutputTokens: OUTPUT_TOKENS, requests: budget.requests.length,
      maxEncodedInputTokens: Math.max(...budget.requests.map(request => request.encodedTokens)),
      maxFramingReserve: Math.max(...budget.requests.map(request => request.framingReserve)),
      maxInputTokens: Math.max(...budget.requests.map(request => request.inputTokens)),
      maxOutputTokens: Math.max(...budget.requests.map(request => request.outputTokens)),
      maxTotalTokens: Math.max(...budget.requests.map(request => request.totalTokens)),
      maxRequestUtf8Bytes: Math.max(...budget.requests.map(request => request.utf8Bytes)),
      maxToolResultChars: Math.max(...budget.requests.map(request => request.largestToolResultChars)),
      maxToolResultBytes: Math.max(...budget.requests.map(request => request.largestToolResultBytes)),
      largeResults: [...budget.firstToolInputs.entries()]
        .filter(([_id, result]) => ['study_compare', 'propose_structure_preview', 'propose_structure_import'].includes(result.tool))
        .map(([id, result]) => ({ tool: result.tool, initialModelCharacters: result.text.length,
          finalHistoryCharacters: budget.toolInputs.get(id)!.text.length,
          completeCharacters: JSON.parse(result.text).detail.original_characters })),
      perFlow: [...new Set(budget.requests.map(request => request.flow))].map(flow => ({ flow,
        requests: budget.requests.filter(request => request.flow === flow).length,
        maxInputTokens: Math.max(...budget.requests.filter(request => request.flow === flow).map(request => request.inputTokens)),
        maxTotalTokens: Math.max(...budget.requests.filter(request => request.flow === flow).map(request => request.totalTokens)) })),
      nativeCompactions: compactions.length,
      nativeSummaryRequests: budget.nativeSummaries.map(summary => ({ request: summary.request, flow: summary.flow,
        promptCharacters: summary.promptCharacters, summaryCharacters: summary.text.length,
        stateCharacters: JSON.stringify(summary.state).length, stateBytes: Buffer.byteLength(JSON.stringify(summary.state)),
        stateBlockCharacters: summary.stateBlockCharacters, stateBlockBytes: summary.stateBlockBytes,
        stateBlockTokens: summary.stateBlockTokens, summaryTokens: summary.summaryTokens })),
      lengthRecoveryRequest: lengthProbe[0].request,
      rounds: roundReports.map(report => ({ round: report.round, firstRequest: report.firstRequest, lastRequest: report.lastRequest,
        targetSoil: report.targetSoil, typeEntries: report.typeEntries, typeChecks: report.typeChecks,
        comparisonCharacters: report.comparisonCharacters, unboundedComparisonTotalTokens: report.unboundedComparisonTotalTokens })),
      approvals: accepted.length, importedDrafts: roundReports.reduce((sum, report) => sum + report.imported.created, 0),
      completedCheckRuns: roundReports.reduce((sum, report) => sum + report.checked.items.length, 0) }));
  } catch (error) {
    // Keep the exact bounded texts from the disposable run available for diagnosis after integration's database cleanup.
    // These are real serialized model inputs, not a replacement fixture or an alternative passing budget calculation.
    const trace = join(repo, '.tmp', 'fusion-budget-failure.json');
    mkdirSync(join(repo, '.tmp'), { recursive: true });
    writeFileSync(trace, JSON.stringify({ requests: budget.requests, violations: budget.violations,
      firstToolInputs: [...budget.firstToolInputs.entries()], finalToolInputs: [...budget.toolInputs.entries()],
      nativeSummaries: budget.nativeSummaries, approvalObservations,
      lastRequest: budget.lastRequest() }, null, 2));
    t.diagnostic('Actual budget failure inputs: ' + trace);
    throw error;
  } finally {
    try { await sidecar.close(); }
    finally {
      // The suite shares a disposable platform. Restore the initial input and its provenance through its ordinary optimistic
      // write API after the measured conversation ends; keep every accepted study/run and its immutable historical evidence.
      if (originalDomain) {
        const workspace = await api(`/api/workspaces/${initialFixture.workspace}`);
        if (!isDeepStrictEqual(workspace.domain, originalDomain)) {
          await api(`/api/workspaces/${initialFixture.workspace}/domain`, {
            expected_revision: workspace.revision, document: originalDomain,
          }, 'PUT');
          assert.deepEqual((await api(`/api/workspaces/${initialFixture.workspace}`)).domain, originalDomain,
            'test teardown restores the complete initial input and provenance without replacing saved results');
        }
      }
    }
  }
}

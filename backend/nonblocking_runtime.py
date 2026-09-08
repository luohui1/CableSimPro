"""Async-safe runtime wrapper for the local engineering service.

SQLite is deliberately synchronous.  The base runtime's async invoke/plan path used
short SQLite transactions directly on the ASGI event-loop thread.  A Windows file
system or writer wait could therefore stall unrelated GET requests.  This subclass
preserves the same task ledger, CAS checks, handlers and error semantics while
running only the synchronous database boundaries in Starlette's worker pool.
"""
from __future__ import annotations

import inspect
import json

from fastapi import HTTPException
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from .agent import PlanRequest
from .runtime import EngineeringRuntime as BaseEngineeringRuntime, Invocation
from .workbench import PLANNER, fingerprint, stamp


class EngineeringRuntime(BaseEngineeringRuntime):
    async def _prepare_plan(self, wid, args):
        """Build a proposal without writing it; caller decides the transaction boundary."""
        state = await run_in_threadpool(self.store.snapshot, wid)
        result = await PLANNER.ainvoke({
            'request': PlanRequest(scenario=state['scenario'], **args.model_dump()),
            'providers': self.providers,
        })
        return {**result['plan'], 'message': args.message, 'events': result['events']}

    async def plan(self, wid, revision, args):
        # Preserve the public handler contract for callers outside invoke().
        proposal = await self._prepare_plan(wid, args)
        if proposal['ready']:
            return await run_in_threadpool(self.store.stage, wid, revision, proposal)
        return proposal

    async def invoke(self, wid, body: Invocation):
        capability = self.capabilities.get(body.capability)
        if capability is None:
            raise HTTPException(422, '未注册的工程能力。')
        try:
            args = capability.schema.model_validate(body.arguments)
        except ValidationError as exc:
            raise HTTPException(422, [
                {'loc': e['loc'], 'msg': e['msg'], 'type': e['type']} for e in exc.errors()
            ]) from None

        request_hash = fingerprint({
            'capability': body.capability,
            'revision': body.expected_revision,
            'arguments': args.model_dump(mode='json'),
        })
        tid = str(body.request_id)

        def register():
            with self.store.db(True) as db:
                existing = db.execute(
                    'SELECT * FROM engineering_tasks WHERE workspace=? AND id=?', (wid, tid)
                ).fetchone()
                if existing:
                    if existing['request_hash'] != request_hash:
                        raise HTTPException(409, '同一请求标识不能用于不同参数。')
                    if existing['status'] == 'running':
                        raise HTTPException(409, '请求仍在执行；不会重复启动。')
                    saved = json.loads(existing['output'])
                    if existing['status'] == 'failed':
                        raise HTTPException(saved['status_code'], saved['detail'])
                    return saved, None
                row, state = self.store.load(db, wid, body.expected_revision)
                context = {
                    'scenario': state['scenario'],
                    'design_basis': state.get('design_basis'),
                    'product_binding': state.get('product_binding'),
                    'source_ids': [source['id'] for source in state['sources']],
                    'arguments': args.model_dump(mode='json'),
                }
                db.execute(
                    'INSERT INTO engineering_tasks VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (tid, wid, body.capability, row['revision'], request_hash, 'running',
                     json.dumps(context, ensure_ascii=False), None, stamp(), None),
                )
                return None, context

        saved, context = await run_in_threadpool(register)
        if saved is not None:
            return saved
        assert context is not None

        envelope_base = {
            'task_id': tid,
            'capability': body.capability,
            'base_revision': body.expected_revision,
            'input_sha256': fingerprint(context),
            'runtime_version': self.version,
        }

        try:
            if body.capability == 'task.plan':
                # A ready plan used to stage the proposal in one write transaction
                # and then open another transaction only to mark this task succeeded.
                # Build first, then commit proposal + ledger atomically.
                proposal = await self._prepare_plan(wid, args)
                if proposal['ready']:
                    return await run_in_threadpool(
                        self.store.stage_and_finish_task,
                        wid, body.expected_revision, proposal, tid, envelope_base,
                    )
                result = proposal
            elif inspect.iscoroutinefunction(capability.handler):
                result = await capability.handler(wid, body.expected_revision, args)
            else:
                result = await run_in_threadpool(
                    capability.handler, wid, body.expected_revision, args
                )

            def finish():
                with self.store.db(True) as db:
                    # Reads and studies still fail closed if the engineering revision
                    # changed while their handler was executing.
                    self.store.load(db, wid, body.expected_revision)
                    envelope = {**envelope_base, 'result': result}
                    db.execute(
                        "UPDATE engineering_tasks SET status='succeeded',output=?,finished=? "
                        "WHERE workspace=? AND id=?",
                        (json.dumps(envelope, ensure_ascii=False), stamp(), wid, tid),
                    )
                    return envelope

            return await run_in_threadpool(finish)
        except Exception as exc:
            code = (
                exc.status_code if isinstance(exc, HTTPException)
                else 422 if isinstance(exc, ValueError)
                else 500
            )
            detail = (
                exc.detail if isinstance(exc, HTTPException)
                else '工程操作失败；输入未被自动放宽，请检查参数或重新规划。'
            )

            def fail():
                with self.store.db(True) as db:
                    db.execute(
                        "UPDATE engineering_tasks SET status='failed',output=?,finished=? "
                        "WHERE workspace=? AND id=?",
                        (json.dumps({'status_code': code, 'detail': detail}, ensure_ascii=False),
                         stamp(), wid, tid),
                    )

            await run_in_threadpool(fail)
            raise HTTPException(code, detail) from None

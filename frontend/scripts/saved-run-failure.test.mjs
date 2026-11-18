import test from 'node:test';
import assert from 'node:assert/strict';
import { savedRunFailureReason } from '../src/features/type/saved-run-failure.ts';

test('a failed saved case exposes its actual source diagnosis, never a successful preflight', () => {
  const saved = {
    status: 'failed', error: null, output: { cases: [
      {case_id:'case-0', status:'failed', error:{code:'TYPE_INPUT_INVALID',
        message:'标准依据快照与已封签判据不一致，请重新查询当前发行。'}},
    ]},
  };
  assert.match(savedRunFailureReason(saved), /标准依据快照/);
  assert.doesNotMatch(savedRunFailureReason(saved), /已通过预检/);
});

test('top-level saved diagnostics take precedence over unrelated cases', () => {
  assert.equal(savedRunFailureReason({error:{message:'已保存结果封签未通过'},
    output:{cases:[{status:'failed',error:{message:'低优先级'}}]}}), '已保存结果封签未通过');
});

test('missing failure details cannot be silently reported as success', () => {
  assert.match(savedRunFailureReason({status:'failed',output:{cases:[{status:'failed',error:{}}]}}), /不采用预检结论/);
  assert.match(savedRunFailureReason(null), /失败诊断/);
});

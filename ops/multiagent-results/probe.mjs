import { SimClient } from '../multiagent-client.mjs';

const c = new SimClient('http://127.0.0.1:8793', 'admin-probe');

function shape(v, depth = 0) {
  if (depth > 3) return '...';
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[len=${v.length}] sample=${v.length ? JSON.stringify(shape(v[0], depth + 1)).slice(0, 400) : ''}`;
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = shape(v[k], depth + 1);
    return o;
  }
  return v;
}

const b = await c.bootstrapAdmin('ma-test-admin-token', 'admin_ma@test.dev', 'AdminPass123!long');
console.log('BOOTSTRAP', JSON.stringify({ status: b.status, ok: b.ok, data: shape(b.data), error: b.error }));

for (const p of [
  '/api/admin/queue',
  '/api/tasks',
  '/api/events',
  '/api/admin/metrics',
  '/api/admin/audit',
  '/api/admin/risk',
  '/api/admin/backup',
  '/api/admin/ops',
]) {
  const r = await c.get(p);
  console.log('\n=== ' + p + ' status=' + r.status + ' ok=' + r.ok + ' ===');
  console.log(JSON.stringify(shape(r.data), null, 1).slice(0, 2500));
  if (r.error) console.log('ERROR', JSON.stringify(r.error));
}

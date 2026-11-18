return (async () => {
  const assert = require('node:assert/strict');
  const http = require('node:http');
  const {createServer, validateInput, validateResult, configFromEnv, LIMITS} = backend;
  const input = {datasetId: 'synthetic-v1', question: '添加设备失败，能否定位？', coverage: '仅有客户端片段，未提供设备侧日志。', evidence: [{id: 'E1', text: '12:00:00 阶段=scan 结果=fail'}]};
  const result = {status: 'hypothesis', summary: '观察到扫描阶段失败，原因尚不确定。', observations: [{text: '扫描记录为失败。', evidenceIds: ['E1']}], hypotheses: [{text: '可能是扫描前置条件未满足。', evidenceIds: ['E1'], counterEvidenceIds: [], missingEvidence: ['同操作的前置登录响应']}], limitations: ['只有一条客户端记录。'], nextChecks: ['补充同一操作的登录请求与响应。']};
  assert.throws(() => configFromEnv({AI_BASE_URL: 'http://external.example/v1'}));
  assert.throws(() => configFromEnv({PORT: 'NaN'}));
  assert.throws(() => validateInput({...input, evidence: [input.evidence[0], input.evidence[0]]}));
  assert.throws(() => validateInput({...input, rawLogs: 'not allowed'}));
  assert.throws(() => validateInput({...input, evidence: [{id: 'E1', text: 'x'.repeat(2001)}]}));
  assert.throws(() => validateInput({...input, evidence: Array.from({length: 60}, (_, i) => ({id: `E${i}`, text: '中'.repeat(1900)}))}), e => e.code === 'CONTEXT_TOO_LARGE');
  assert.throws(() => validateResult({...result, observations: [{text: 'Invented', evidenceIds: ['E999']}]}, input.evidence));
  assert.throws(() => validateResult({...result, status: 'supported_stage', observations: []}, input.evidence));
  assert.throws(() => validateResult({...result, hypotheses: [{...result.hypotheses[0], missingEvidence: []}]}, input.evidence));

  let mode = 'ok', calls = 0, received;
  const provider = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    received = JSON.parse(raw); calls++;
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer TEST_SECRET');
    if (mode === 'slow') { setTimeout(() => res.end('{}'), 100); return; }
    if (mode === 'error') { res.writeHead(401); res.end('TEST_SECRET provider details'); return; }
    if (mode === 'large') { res.end('x'.repeat(LIMITS.upstreamBytes + 1)); return; }
    const answer = mode === 'invented' ? {...result, observations: [{text: 'invented', evidenceIds: ['E9']}]} : result;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{finish_reason: mode === 'truncated' ? 'length' : 'stop', message: {content: mode === 'bad-json' ? 'not JSON' : JSON.stringify(answer)}}]}));
  });
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await listen(provider);
  const config = {endpoint: `http://127.0.0.1:${provider.address().port}/v1/chat/completions`, model: 'test-model', apiKey: 'TEST_SECRET', timeoutMs: 2000, maxConcurrent: 1};
  const server = createServer({assets, config}); await listen(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = input, headers = {}) => fetch(base + '/api/diagnose', {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body)});
  try {
    const home = await fetch(base); assert.equal(home.status, 200); assert.match(await home.text(), /LogLens/);
    const script = await fetch(base + '/parser.js'); assert.match(await script.text(), /function createParser/);
    assert.equal((await fetch(base + '/server/index.cjs')).status, 404);
    assert.equal((await fetch(base + '/README.md')).status, 404);
    const health = await (await fetch(base + '/api/health')).json(); assert.equal(health.aiConfigured, true); assert(!JSON.stringify(health).includes('TEST_SECRET'));
    const badHostStatus = await new Promise((resolve, reject) => {
      const request = http.get(base, {headers: {Host: 'evil.example'}}, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
    });
    assert.equal(badHostStatus, 403, 'reject forged Host');
    assert.equal((await post(input, {Origin: 'https://evil.example'})).status, 403);
    assert.equal((await post(input, {'Content-Type': 'text/plain'})).status, 415);
    assert.equal((await post('{bad')).status, 400);
    assert.equal((await post('x'.repeat(LIMITS.bodyBytes + 1))).status, 413);
    const chunkedStatus = await new Promise((resolve, reject) => {
      const request = http.request(base + '/api/diagnose', {method: 'POST', headers: {'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked'}}, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end('x'.repeat(LIMITS.bodyBytes + 1));
    });
    assert.equal(chunkedStatus, 413, 'chunked bodies must also respect size limit');
    assert.equal(calls, 0);
    const noEvidence = await (await post({...input, evidence: []})).json();
    assert.equal(noEvidence.diagnosis.status, 'insufficient_evidence'); assert.equal(calls, 0);
    config.apiKey = '';
    assert.equal((await post()).status, 503); config.apiKey = 'TEST_SECRET';
    const valid = await post(); assert.equal(valid.status, 200);
    const payload = await valid.json(); assert.equal(payload.datasetId, input.datasetId); assert.deepEqual(payload.diagnosis, result);
    assert.equal(received.store, false); assert.equal(received.max_completion_tokens, 3000);
    assert.match(received.messages[0].content, /不要求一定得出根因/);
    assert.deepEqual(JSON.parse(received.messages[1].content), input);
    for (const failure of ['invented', 'truncated', 'bad-json', 'error', 'large']) {
      mode = failure; const response = await post(); assert.equal(response.status, 502, failure);
      assert(!(await response.text()).includes('TEST_SECRET'));
    }
    mode = 'slow'; config.timeoutMs = 25;
    const first = post();
    // Wait until the upstream call begins, then verify in-flight capacity.
    const previous = calls;
    for (let i = 0; i < 30 && calls === previous; i++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal((await post()).status, 429);
    assert.equal((await first).status, 504);
    mode = 'ok'; config.timeoutMs = 2000;
    assert.equal((await post()).status, 200, 'capacity released after timeout');
    console.log('PASS: page assets, localhost boundary, input/context limits, empty evidence, provider transport, evidence validation, redacted errors, timeout and concurrency recovery.');
  } finally {
    await Promise.all([server, provider].map(s => new Promise(resolve => { s.close(resolve); s.closeAllConnections(); })));
  }
})();

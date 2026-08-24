// Throwaway: evaluate an expression in a Flank chrome target over CDP.
// node tools/cdp-eval.mjs <url-substring> "<expression>"
const [match, expression] = process.argv.slice(2);

const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
const target = targets.find((t) => (t.url ?? '').includes(match));
if (!target) {
  console.error('no target matching', match, '— have:', targets.map((t) => t.url));
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));
ws.send(
  JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true }
  })
);
const reply = await new Promise((resolve) => {
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id === 1) resolve(msg);
  });
});
console.log(JSON.stringify(reply.result, null, 2));
ws.close();

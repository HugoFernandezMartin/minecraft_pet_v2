// Dev probe: measures fps / CPU / WebGL renderer of a running instance, flying vs resting.
// Run: npm run build && npx electron . --remote-debugging-port=9222   (other terminal)  node scripts/linux-probe.mjs
import { execSync } from 'node:child_process';
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); };
const ev = (expr) => new Promise((res) => { const i = ++id; pending.set(i, (m) => res(m.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })); });
const cpu = () => {
  const out = execSync("ps -eo pid,pcpu,rss,comm,args --no-headers | grep -E 'electron' | grep -v grep || true").toString().trim().split('\n');
  let total = 0, rss = 0, gpu = 0; for (const l of out) { const p = l.trim().split(/\s+/); total += +p[1]; rss += +p[2]; if (l.includes('gpu-process')) gpu += +p[1]; } return { total, gpu, rssMB: Math.round(rss / 1024) };
};
// frame-time sampler inside the page for 10 s
const sample = (label, ms = 10000) => ev(`new Promise(res=>{const t=[];let l=performance.now();const end=l+${ms};function f(n){t.push(n-l);l=n;if(n<end)requestAnimationFrame(f);else{t.shift();t.sort((a,b)=>a-b);const avg=t.reduce((a,b)=>a+b,0)/t.length;res({frames:t.length,avgMs:+avg.toFixed(1),fps:+(1000/avg).toFixed(1),p95:+t[Math.floor(t.length*.95)].toFixed(1),max:+t[t.length-1].toFixed(1)})}}requestAnimationFrame(f)})`);
const info = await ev(`({w:innerWidth,h:innerHeight,dpr:devicePixelRatio,screen:[screen.width,screen.height],avail:[screen.availWidth,screen.availHeight],pr:window.mob.stage.renderer.getPixelRatio(),maxLift:window.mob.character.placement.maxLift,gl:(()=>{const g=window.mob.stage.renderer.getContext();const e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'?'})()})`);
console.log('INFO', JSON.stringify(info));
const run = async (label, setup) => { await ev(setup); await new Promise((r) => setTimeout(r, 2500)); const c0 = cpu(); const s = await sample(label); const c1 = cpu(); const st = await ev(`({state:window.mob.character.stateName,lift:+window.mob.character.lift.toFixed(2),pr:window.mob.stage.renderer.getPixelRatio()})`); console.log(label.padEnd(8), JSON.stringify(s), 'cpu%(before/after)=', c0.total, c1.total, 'gpuproc%=', c1.gpu, 'rssMB=', c1.rssMB, JSON.stringify(st)); };
await run('flying', `(()=>{const c=window.mob.character;c.settings.autoWalk=true;c.trigger('walk',{x:c.loco.maxX*0.8,lift:c.placement.maxLift*0.6,then:'walk'},true);window.__iv=setInterval(()=>{if(c.stateName!=='walk'||c.loco.arrived){const r=Math.random();c.trigger('walk',{x:c.loco.minX+r*(c.loco.maxX-c.loco.minX),lift:Math.random()*c.placement.maxLift,then:'idle'},true)}},500);})()`);
await run('idle', `(()=>{const c=window.mob.character;clearInterval(window.__iv);c.brain.nextAction=()=>'idle';c.restLift=c.lift;c.trigger('idle',{},true)})()`);
ws.close(); process.exit(0);

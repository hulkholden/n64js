import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const [base, proto, rom, output] = process.argv.slice(2);
mkdirSync(output, {recursive:true});
const results = [];
const orders = ['baseline','prototype','prototype','baseline','baseline','prototype','prototype','baseline','baseline','prototype'];
let index = 0;
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/result' || url.pathname === '/error') {
      let body = ''; for await (const chunk of req) body += chunk;
      if (url.pathname === '/error') { console.log(body); writeFileSync(resolve(output,'error.txt'),body); }
      else {
        const run = Number(url.searchParams.get('run'));
        const result = JSON.parse(body);
        const variant = orders[run];
        if (run < 2) {
          writeFileSync(resolve(output,variant+'.png'),Buffer.from(result.canvasPNG.split(',')[1],'base64'));
          for (const [pc,fragment] of Object.entries(result.sources)) {
            if (fragment?.code) writeFileSync(resolve(output,`${variant}-${pc}.js`),fragment.code+'\n');
          }
          writeFileSync(resolve(output,variant+'-fragments.json'),JSON.stringify(result.sources,null,2));
        }
        delete result.canvasPNG; delete result.sources;
        results.push({pair:Math.floor(run/2)+1,variant,...result});
        writeFileSync(resolve(output,'browser.json'),JSON.stringify(results,null,2));
        console.log(JSON.stringify({run,variant,ms:result.gameplayMs,vi:result.vi,renderer:result.renderer}));
      }
      res.end('ok'); return;
    }
    if (url.pathname === '/') index = Number(url.searchParams.get('run') || 0);
    const root=resolve(orders[index]==='baseline'?base:proto);
    if (url.pathname === '/driver.js') {
      res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});
      res.end(readFileSync(new URL('./driver.mjs',import.meta.url))); return;
    }
    const path = url.pathname === '/rom' ? rom : resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    let content=readFileSync(path);
    if (url.pathname==='/') content=content.toString().replace('<head>',`<head><script>localStorage.clear();window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};</script>`).replace('</body>','<script type="module" src="/driver.js"></script></body>');
    res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'application/javascript','.css':'text/css'}[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(content);
  } catch(e) {console.log(String(e));res.writeHead(404);res.end();}
});
server.listen(8386,'127.0.0.1',()=>console.log('http://127.0.0.1:8386'));

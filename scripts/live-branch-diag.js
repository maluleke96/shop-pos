const B = 'https://peaceful-motivation-production-7dd2.up.railway.app';
async function rpc(m,a,t){const h={'Content-Type':'application/json'};if(t)h['X-Session-Token']=t;const r=await fetch(B+'/rpc',{method:'POST',headers:h,body:JSON.stringify({method:m,args:a})});const j=await r.json();return{j,t:r.headers.get('X-Session-Token')||j.sessionToken||t};}
(async()=>{
  const pass=require('fs').readFileSync(0,'utf8').trim();
  const login=await rpc('auth:login',['chisa96',pass]);
  const t=login.t;
  const branches=await rpc('branches:get',[],t);
  const view=await rpc('branches:getView',[],t);
  const active=await rpc('branches:getActive',[],t);
  const p=(await rpc('products:getOne',[2],t)).j.data;
  console.log(JSON.stringify({branches:branches.j.data,view:view.j.data,active:active.j.data,product:p},null,2));
})();

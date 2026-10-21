'use strict';
const $=id=>document.getElementById(id);
const col=k=>getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const u16=(f,i)=>(f[i]<<8)|f[i+1];
const frame=cmd=>{const f=[0xA5,0x40,cmd,8,0,0,0,0,0,0,0,0];f.push(f.reduce((a,b)=>a+b)&255);return new Uint8Array(f)};
const fh=m=>m==null?'—':(m>=60?Math.floor(m/60)+' ч '+String(m%60).padStart(2,'0')+' мин':m+' мин');
const stamp=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`};
const SVC=0xfff0,PERIOD=2000,LONG_STEP=30,MAXLONG=5760;
const L=["РАБОТАЕТ ПРАВИЛЬНО","ВНИМАНИЕ","НЕИСПРАВНОСТЬ / НЕТ СВЯЗИ"];

const CHEM={
 lfp:{name:'LiFePO4',vmax:3650,hiWarn:3600,loWarn:2800,loBad:2500,top:3450,
  ocv:[[2.50,0],[3.00,2],[3.15,8],[3.20,15],[3.25,25],[3.28,35],[3.30,45],[3.32,60],[3.33,70],[3.35,80],[3.40,90],[3.45,95],[3.60,100]]},
 nmc:{name:'Li-ion NMC',vmax:4200,hiWarn:4150,loWarn:3200,loBad:2800,top:4100,
  ocv:[[3.00,0],[3.30,5],[3.50,20],[3.60,35],[3.70,50],[3.80,65],[3.90,77],[4.00,88],[4.10,95],[4.20,100]]}
};
const SPREAD_WARN=150,SPREAD_BAD=300,TOP_SPREAD=60,T_WARN=45,T_BAD=55,SUM_TOL=.5,RISE_MIN=2,DROP_V=.3;
const FAULTS=[[0,[0,1],"перенапряжение ячейки"],[0,[2,3],"недонапряжение ячейки"],[0,[4,5],"перенапряжение сборки"],[0,[6,7],"недонапряжение сборки"],
 [1,[0,1],"перегрев при заряде"],[1,[2,3],"холод при заряде"],[1,[4,5],"перегрев при разряде"],[1,[6,7],"холод при разряде"],
 [2,[0,1],"перегрузка заряда"],[2,[2,3],"перегрузка разряда"],[2,[4,5],"SOC высокий"],[2,[6,7],"SOC низкий"],[3,[0,1],"перекос напряжений"],[3,[2,3],"перекос температур"],
 [4,[0],"перегрев ключа заряда"],[4,[1],"перегрев ключа разряда"],[4,[2],"датчик ключа заряда"],[4,[3],"датчик ключа разряда"],[4,[4],"залип ключ заряда"],[4,[5],"залип ключ разряда"],[4,[6],"обрыв ключа заряда"],[4,[7],"обрыв ключа разряда"],
 [5,[0],"сбой AFE"],[5,[1],"ячейка не читается"],[5,[2],"датчик температуры"],[5,[3],"EEPROM"],[5,[4],"RTC"],[5,[5],"предзаряд"],[5,[6],"связь"],[5,[7],"внутренняя связь"],
 [6,[0],"датчик тока"],[6,[1],"датчик напряжения"],[6,[2],"короткое замыкание"],[6,[3],"заряд запрещён: низкое напряжение"]];
const SOFT=['SOC низкий','SOC высокий'];
function decodeFaults(b){const o=[];if(!b)return o;FAULTS.forEach(([by,bits,n])=>bits.forEach((bit,l)=>{if(by<b.length&&(b[by]>>bit)&1)o.push(n+(bits.length>1?' (ур. '+(l+1)+')':''))}));return o}
const ocvSoc=(tab,v)=>{if(v<=tab[0][0])return 0;for(let i=1;i<tab.length;i++){if(v<=tab[i][0]){const a=tab[i-1],b=tab[i];return a[1]+(b[1]-a[1])*(v-a[0])/(b[0]-a[0])}}return 100};
const ocvV=(tab,s)=>{if(s<=0)return tab[0][0];for(let i=1;i<tab.length;i++){if(s<=tab[i][1]){const a=tab[i-1],b=tab[i];return a[0]+(b[0]-a[0])*(s-a[1])/(b[1]-a[1])}}return tab[tab.length-1][0]};

// ---------- журнал, сигнал ----------
let ac=null;const audio=()=>{try{ac=ac||new AudioContext();ac.resume()}catch(e){}};
const glog=m=>{const e=$('log');e.innerHTML=`<div>${esc(stamp().slice(11))} ${esc(m)}</div>`+e.innerHTML.split('</div>').slice(0,30).join('</div>')};
let lastAlarm=0;
function alarm(msg){glog('СИГНАЛ: '+msg);if(Date.now()-lastAlarm<60000)return;lastAlarm=Date.now();
 try{navigator.vibrate&&navigator.vibrate([400,150,400,150,400])}catch(e){}
 try{if(ac)for(let i=0;i<5;i++){const o=ac.createOscillator(),g=ac.createGain();o.frequency.value=i%2?880:660;o.connect(g);g.connect(ac.destination);g.gain.value=.25;o.start(ac.currentTime+i*.35);o.stop(ac.currentTime+i*.35+.28)}}catch(e){}
 try{if(Notification.permission==='granted'&&navigator.serviceWorker)navigator.serviceWorker.ready.then(r=>r.showNotification('Daly BMS',{body:msg,vibrate:[300,100,300],tag:'daly'}))}catch(e){}}
let wl=null;async function lock(){try{wl=await navigator.wakeLock.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&devs.size)lock()});

// ---------- облако (по согласию) ----------
const CLOUD_URL='https://script.google.com/macros/s/AKfycby54kxPT5gWs_qx9VQ2ik9eq3DkxZ-ZsE5iaYbGoaHodTINODHj-A5DSdcxjROeEwHftA/exec';   // адрес Google Apps Script; задаётся при публикации
const cloudUrl=()=>CLOUD_URL||localStorage.getItem('daly2:cloudurl')||'';
const cloudOn=()=>localStorage.getItem('daly2:cloud')==='1'&&!!cloudUrl();
const anon=(()=>{let a=localStorage.getItem('daly2:anon');if(!a){a=([...crypto.getRandomValues(new Uint8Array(6))].map(x=>x.toString(16).padStart(2,'0')).join(''));localStorage.setItem('daly2:anon',a)}return a})();
const hash6=s=>{let h=5381;for(const c of s)h=((h<<5)+h+c.charCodeAt(0))>>>0;return h.toString(16).padStart(8,'0')};
const MIN_GAP=60000;   // защита от частых отправок: не чаще раза в минуту с одного устройства
function toast(msg,kind){const t=$('toast'),d=document.createElement('div');d.textContent=msg;if(kind)d.className=kind;t.appendChild(d);setTimeout(()=>d.remove(),4500);while(t.children.length>3)t.firstChild.remove()}
const pending=dv=>({rows:dv.long.filter(x=>x[0]>dv.upT).length,evs:dv.events.filter(e=>e.t>dv.upE).length});
function cloudLine(dv){if(!cloudOn())return localStorage.getItem('daly2:cloud')==='1'?'☁ облако не настроено':'☁ отправка в облако выключена';
 const p=pending(dv),when=dv.sentAt?new Date(dv.sentAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
 const st=dv.sentOk===false?'последняя попытка не удалась':dv.sentAt?'последняя отправка '+when+(dv.sentOk===true?' ✓ подтверждена':' (без подтверждения)'):'ещё не отправляли';
 return `☁ отправлено ${dv.sent} замеров · ждёт отправки ${p.rows} · ${st}`}
async function upload(dv,manual){
 if(!cloudOn()){if(manual)toast(localStorage.getItem('daly2:cloud')==='1'?'Облако не настроено':'Включите галочку «Отправлять данные» на стартовом экране');return}
 if(dv.sending)return;const wait=MIN_GAP-(Date.now()-dv.lastTry);
 if(wait>0){if(manual)toast(`Слишком часто: подождите ${Math.ceil(wait/1000)} с`,'bad');return}
 const p=pending(dv);if(!p.rows&&!p.evs){if(manual)toast('Всё уже отправлено, новых данных нет','ok');return}
 const rows=dv.long.filter(x=>x[0]>dv.upT).slice(0,500),evs=dv.events.filter(e=>e.t>dv.upE).reverse().slice(0,100);
 const body=JSON.stringify({v:1,sid:anon+'-'+hash6(dv.id),chem:dv.chem,cap:dv.cap,cycles:dv.last&&dv.last.cycles,rows:rows.map(x=>[x[0],x[1],...x[2]]),events:evs.map(e=>[e.t,e.level,e.text])});
 dv.sending=true;dv.lastTry=Date.now();let confirmed=false;
 try{try{const r=await fetch(cloudUrl(),{method:'POST',headers:{'Content-Type':'text/plain'},body,referrerPolicy:'no-referrer',credentials:'omit'}),t=(await r.text()).trim();
    if(t!=='ok')throw new Error(t.slice(0,80)||'пустой ответ');confirmed=true}
   catch(e){if(!(e instanceof TypeError))throw e;await fetch(cloudUrl(),{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body,referrerPolicy:'no-referrer',credentials:'omit'})}
  if(rows.length)dv.upT=rows[rows.length-1][0];if(evs.length)dv.upE=evs[evs.length-1].t;dv.sent+=rows.length;dv.sentAt=Date.now();dv.sentOk=confirmed?true:'noconf';dv.save();
  if(manual||!dv.toasted){dv.toasted=true;toast(`☁ Отправлено: ${rows.length} замеров, ${evs.length} событий${confirmed?' · подтверждено':' · без подтверждения'}`,'ok')}glog(`отправлено в облако: ${rows.length} замеров, ${evs.length} событий`)}
 catch(e){dv.sentOk=false;if(manual||!dv.failToast||Date.now()-dv.failToast>600000){dv.failToast=Date.now();toast('☁ Не отправлено: '+(e.message||e),'bad')}glog('облако: '+(e.message||e))}
 finally{dv.sending=false}}
const uploadAll=m=>devs.forEach(d=>upload(d,m));

// ---------- BMS ----------
class Dev{
 constructor(device){this.dev=device;this.id=device.id;this.name=device.name||device.id;this.key='daly2:'+device.id;
  this.buf=[];this.frames=[];this.waiter=null;this.hist=[];this.long=[];this.events=[];this.chem='lfp';this.cap=105;
  this.last=null;this.prev=null;this.online=false;this.err='подключение…';this.want=true;this.running=false;this.badUntil=0;
  this.ahIn=0;this.ahOut=0;this.t0=Date.now();this.longT=0;this.checks=[];this.level=3;
  this.upT=0;this.upE='';this.sent=0;this.sentAt=0;this.sentOk=null;this.lastTry=0;this.sending=false;
  try{const s=JSON.parse(localStorage.getItem(this.key)||'{}');if(CHEM[s.chem])this.chem=s.chem;if(Number.isFinite(s.cap))this.cap=Math.min(2000,Math.max(1,s.cap));
   const num=x=>typeof x==='number'&&Number.isFinite(x);
   this.long=(Array.isArray(s.long)?s.long:[]).filter(x=>Array.isArray(x)&&num(x[0])&&num(x[1])&&Array.isArray(x[2])&&x[2].length>0&&x[2].length<=32&&x[2].every(c=>num(c)&&c>=0&&c<6000)).slice(-MAXLONG);
   this.events=(Array.isArray(s.events)?s.events:[]).filter(e=>e&&typeof e.t==='string'&&typeof e.text==='string').slice(0,200).map(e=>({t:e.t.slice(0,25),level:e.level|0,text:e.text.slice(0,200)}));
   this.upT=num(s.upT)?s.upT:0;this.upE=typeof s.upE==='string'?s.upE.slice(0,25):'';this.sent=num(s.sent)?s.sent:0;this.sentAt=num(s.sentAt)?s.sentAt:0;
   this.longT=this.long.length?this.long[this.long.length-1][0]:0}catch(e){}
  device.addEventListener('gattserverdisconnected',()=>{this.running=false;this.setOnline(false,'связь потеряна');upload(this);if(this.want)this.reconnect()})}
 get C(){return CHEM[this.chem]}
 save(){try{localStorage.setItem(this.key,JSON.stringify({chem:this.chem,cap:this.cap,long:this.long.slice(-MAXLONG),events:this.events.slice(0,200),upT:this.upT,upE:this.upE,sent:this.sent,sentAt:this.sentAt}))}catch(e){glog('история не сохраняется: '+e)}}
 event(level,text){this.events.unshift({t:stamp(),level,text});if(this.events.length>200)this.events.pop();if(level==2)alarm(this.name+': '+text)}
 setOnline(on,err){if(on!==this.online){this.event(on?0:1,on?'связь установлена':'связь потеряна: '+(err||''))}this.online=on;if(!on)this.err=err||''}
 async reconnect(){for(let i=0;this.want&&!this.running;i++){await sleep(Math.min(3000+i*1000,10000));if(!this.want||this.running)return;
   try{await this.connect()}catch(e){this.err='переподключаюсь… ('+(i+1)+')'}}}
 async connect(){
  const srv=await this.dev.gatt.connect();const s=await srv.getPrimaryService(SVC);
  let cs=[];for(let i=0;i<4&&!cs.length;i++){try{cs=await s.getCharacteristics()}catch(e){await sleep(1000)}}
  const rx=cs.find(c=>c.uuid.startsWith('0000fff1'))||cs.find(c=>c.properties.notify);
  this.tx=cs.find(c=>c.uuid.startsWith('0000fff2'))||cs.find(c=>c.properties.writeWithoutResponse||c.properties.write);
  if(!rx||!this.tx)throw new Error('нет нужных характеристик (удалите устройство в настройках Bluetooth телефона и добавьте заново)');
  await rx.startNotifications();rx.addEventListener('characteristicvaluechanged',e=>this.onData(e));
  this.buf=[];this.running=true;this.setOnline(true);lock();this.loop()}
 onData(ev){const v=new Uint8Array(ev.target.value.buffer);this.buf.push(...v);
  while(this.buf.length>=13){const i=this.buf.indexOf(0xA5);if(i<0){this.buf=[];return}if(i>0)this.buf.splice(0,i);if(this.buf.length<13)return;
   const f=this.buf.splice(0,13);if((f.slice(0,12).reduce((a,b)=>a+b)&255)!==f[12])continue;this.frames.push(f);if(this.waiter)this.waiter()}}
 async ask(cmd,n=1){this.frames=[];await this.tx.writeValueWithoutResponse(frame(cmd));const end=Date.now()+1500;
  for(;;){const got=this.frames.filter(f=>f[2]===cmd);if(got.length>=n||Date.now()>=end)return got;
   await new Promise(r=>{const t=setTimeout(r,Math.max(50,end-Date.now()));this.waiter=()=>{clearTimeout(t);this.waiter=null;r()}})}}
 async poll(){const d={t:Date.now()/1000};let f=await this.ask(0x90);if(!f.length)throw new Error('нет ответа');f=f[0];
  d.V=u16(f,4)/10;d.I=(u16(f,8)-30000)/10;d.soc=u16(f,10)/10;
  f=await this.ask(0x92);if(f.length){d.tmax=f[0][4]-40;d.tmin=f[0][6]-40}
  f=await this.ask(0x93);if(f.length){f=f[0];d.state=f[4];d.chg=f[5];d.dis=f[6];d.cap=((f[8]<<24)|(f[9]<<16)|(f[10]<<8)|f[11])/1000}
  f=await this.ask(0x94);if(f.length){f=f[0];d.n=f[4];d.charger=f[6];d.load=f[7];d.cycles=u16(f,9)}
  const n=d.n||8,fr=(await this.ask(0x95,Math.ceil(n/3))).sort((a,b)=>a[4]-b[4]);let cells=[];fr.forEach(g=>{for(let k=0;k<3;k++)cells.push(u16(g,5+2*k))});d.cells=cells.slice(0,n);
  f=await this.ask(0x97);d.bal=f.length?d.cells.map((_,i)=>(f[0][4+(i>>3)]>>(i&7))&1):[];
  f=await this.ask(0x98);d.fault=f.length?f[0].slice(4,12):[];d.asleep=d.V===0&&!d.cells.some(x=>x);return d}
 async loop(){while(this.running){const t0=Date.now();try{this.update(await this.poll())}catch(e){if(this.running)this.err=String(e.message||e)}await sleep(Math.max(100,PERIOD-(Date.now()-t0)))}}

 slope(t){const p=this.hist.filter(h=>h.t>=t-300&&h.sum);if(p.length<2||p[p.length-1].t-p[0].t<120)return null;return(p[p.length-1].sum-p[0].sum)*1000/((p[p.length-1].t-p[0].t)/60)}
 evaluate(d){const ck=[],C=this.C,add=(name,level,text)=>ck.push({name,level,text});
  if(d.asleep){add('BMS отвечает',1,'BMS спит: модуль отвечает, данные нулевые');return ck}
  add('BMS отвечает',0,'данные получены');const cs=d.cells,mx=Math.max(...cs),mn=Math.min(...cs),sm=cs.reduce((a,b)=>a+b,0)/1000,sp=mx-mn;
  add('Сумма ячеек = сборка',Math.abs(sm-d.V)<=SUM_TOL?0:1,`${sm.toFixed(2)} В против ${d.V.toFixed(1)} В`);
  add('Ячейки в пределах',mx>=C.vmax||mn<=C.loBad?2:(mx>=C.hiWarn||mn<=C.loWarn?1:0),`${(mn/1000).toFixed(3)}…${(mx/1000).toFixed(3)} В`);
  add('Перекос ячеек',sp>=SPREAD_BAD?2:sp>=SPREAD_WARN?1:0,`${sp} мВ (макс яч. ${cs.indexOf(mx)+1}, мин яч. ${cs.indexOf(mn)+1})`);
  if(d.tmax!=null)add('Температура',d.tmax>=T_BAD||d.tmax<0?2:d.tmax>=T_WARN?1:0,`${d.tmin}…${d.tmax} °C`);
  const fl=decodeFaults(d.fault),hard=fl.filter(x=>!SOFT.some(k=>x.startsWith(k)));
  add('Защиты BMS',hard.length?2:0,fl.length?fl.join('; ')+(hard.length?'':' (SOC не откалиброван, не критично)'):'нет');
  const sl=this.slope(d.t);
  if(d.charger&&!d.chg)add('Ключ заряда',2,'зарядное подключено, а ключ заряда ВЫКЛ');else add('Ключ заряда',d.chg?0:1,d.chg?'вкл':'выкл (зарядное не обнаружено)');
  if(d.I>.3)add('Заряд идёт',0,`ток ${d.I.toFixed(1)} А`);
  else if(sl==null)add('Заряд идёт',0,'копится история (нужно 2 мин)');
  else if(sl>=RISE_MIN)add('Заряд идёт',0,`сумма ячеек растёт +${sl.toFixed(1)} мВ/мин`);
  else if(mx>=C.top)add('Заряд идёт',0,'ячейки у верха, рост остановился (CV или конец)');
  else add('Заряд идёт',1,`нет роста напряжения за 5 мин (${sl.toFixed(1)} мВ/мин): заряд не идёт или завершён`);
  add('Обрыв заряда',Date.now()<this.badUntil?2:0,Date.now()<this.badUntil?'недавно напряжение упало: заряд оборвался (см. события)':'не было');
  if(d.I>.3){const cr=d.I/this.cap;add('Ток заряда',d.I>60?2:cr>.5?1:0,`${d.I.toFixed(1)} А = ${cr.toFixed(2)}C (норма 0,1–0,3C = ${(.1*this.cap).toFixed(0)}–${(.3*this.cap).toFixed(0)} А)`)}
  if(mx>=C.top)add('Балансировка у верха',sp<=TOP_SPREAD?0:1,`перекос ${sp} мВ, цель ≤${TOP_SPREAD}; балансир ${d.bal.some(x=>x)?'работает':'не включён'}`);
  return ck}
 detect(d){const p=this.prev;if(p&&!d.asleep&&!p.asleep){[['chg','ключ заряда'],['dis','ключ разряда'],['charger','зарядное']].forEach(([k,nm])=>{if(d[k]!==p[k]&&d[k]!=null)this.event(k!=='chg'||d[k]?1:2,`${nm}: ${d[k]?'вкл':'выкл'}`)});
   if(String(d.fault)!==String(p.fault)){const fl=decodeFaults(d.fault);this.event(fl.some(x=>!SOFT.some(k=>x.startsWith(k)))?2:1,'защиты: '+(fl.join('; ')||'сняты'))}
   const old=this.hist.find(h=>h.sum&&h.t>=d.t-70&&h.t<=d.t-50),sm=d.cells.reduce((a,b)=>a+b,0)/1000;
   if(old&&old.sum-sm>=DROP_V&&(p.chg||d.I>.3||p.I>.3)){this.event(2,`заряд оборвался: сумма ячеек упала на ${(old.sum-sm).toFixed(2)} В за минуту`);this.badUntil=Date.now()+600000}}
  if(p&&d.asleep!==p.asleep)this.event(1,d.asleep?'BMS уснула':'BMS проснулась')}
 update(d){d.sum=d.cells.reduce((a,b)=>a+b,0)/1000;
  if(this.prev&&!d.asleep){const dt=Math.min(d.t-this.prev.t,10);if(d.I>0)this.ahIn+=d.I*dt/3600;else this.ahOut+=-d.I*dt/3600}
  this.detect(d);this.hist.push(d);if(this.hist.length>1800)this.hist.shift();
  this.checks=this.evaluate(d);this.level=Math.max(...this.checks.map(c=>c.level));
  if(!d.asleep&&d.cells.length&&d.t-this.longT>=LONG_STEP){this.longT=d.t;this.long.push([Math.round(d.t),d.I,d.cells,d.bal]);if(this.long.length>MAXLONG)this.long.shift();if(this.long.length%4===0)this.save()}
  this.prev=this.last=d;this.err=''}
 metrics(){const d=this.last;if(!d||d.asleep||!d.cells.length)return null;const C=this.C,cs=d.cells,I=d.I,mvA=735/this.cap;
  const avg=cs.reduce((a,b)=>a+b,0)/cs.length,soc=ocvSoc(C.ocv,(avg-mvA*Math.max(I,0))/1000);
  const pts=this.hist.filter(h=>h.t>=d.t-900);let phase='нет заряда',eta=null;
  if(I>.3){phase='CC (постоянный ток)';const rem=(100-soc)/100*this.cap;eta=rem/I*60+60;
   if(pts.length>=40){const a=pts.slice(0,10).reduce((x,h)=>x+h.I,0)/10,b=pts.slice(-10).reduce((x,h)=>x+h.I,0)/10;
    if(b<a*.9&&Math.max(...cs)>=C.top-50&&b>0){phase='CV (ток падает)';const k=Math.log(b/a)/((pts[pts.length-1].t-pts[0].t)/60),end=.03*this.cap;eta=b>end&&k<0?Math.max(0,Math.log(end/b)/k):0}}}
  const f=this.long[0],first=f?f[2]:null,i0=f?f[1]:0,s0=f?ocvSoc(C.ocv,(first.reduce((a,b)=>a+b,0)/first.length-mvA*Math.max(i0,0))/1000):0;
  const cur=this.long.map(x=>x[1]).filter(x=>x>.3).sort((a,b)=>a-b);
  return{phase,soc:Math.round(soc),eta:eta==null?null:Math.round(eta),cycles:d.cycles,cap:this.cap,n:cs.length,s0,iset:cur.length?cur[cur.length>>1]:0,ahIn:this.ahIn,ahOut:this.ahOut,capBms:d.cap}}
 csv(){const nc=Math.max(0,...this.long.map(x=>x[2].length)),h='time,I,sum_V,'+Array.from({length:nc},(_,i)=>'c'+(i+1)).join(',')+'\n';
  return h+this.long.map(x=>[new Date(x[0]*1000).toISOString(),x[1],(x[2].reduce((a,b)=>a+b,0)/1000).toFixed(3),...x[2]].join(',')).join('\n')+'\n\nevents\n'+this.events.map(e=>[e.t,e.level,'"'+e.text+'"'].join(',')).join('\n')}
}

// ---------- графики ----------
function ideal(I,C){const n=I.n,cap=I.cap,iset=I.iset>.3?I.iset:.1*cap,vmax=C.vmax/1000,iend=.03*cap,off=(735/cap)/1000,dt=.05;
 const V=[],A=[];let t=0,s=Math.min(I.s0||0,95),tcv=null;
 while(t<80){const vc=ocvV(C.ocv,s)+off*iset;if(vc>=vmax){tcv=t;break}V.push([t,n*vc]);A.push([t,iset]);s+=iset*dt/cap*100;t+=dt;if(s>=100)break}
 if(tcv==null)tcv=t;const rem=Math.max(.5,(100-s)/100*cap),tau=rem/iset;let tt=tcv;
 for(;;){const i=iset*Math.exp(-(tt-tcv)/tau);V.push([tt,n*vmax]);A.push([tt,i]);if(i<=iend||tt-tcv>14)break;tt+=dt}
 return{V,A,tEnd:tt,iset}}
function plot(c,o){const r=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;if(!w)return;c.width=w*r;c.height=h*r;const g=c.getContext('2d');g.scale(r,r);
 const P={l:42,r:8,t:8,b:20},W=w-P.l-P.r,H=h-P.t-P.b,X=x=>P.l+(x-o.x[0])/(o.x[1]-o.x[0]||1)*W,Y=y=>P.t+H-(y-o.y[0])/(o.y[1]-o.y[0]||1)*H;
 g.font='10px system-ui';(o.bands||[]).forEach(b=>{g.fillStyle=b.c;const y1=Y(Math.min(b.y1,o.y[1])),y0=Y(Math.max(b.y0,o.y[0]));g.fillRect(P.l,y1,W,y0-y1)});
 const ty=o.yt||4;for(let i=0;i<=ty;i++){const v=o.y[0]+(o.y[1]-o.y[0])*i/ty,y=Y(v);g.strokeStyle=col('--bd');g.lineWidth=1;g.beginPath();g.moveTo(P.l,y);g.lineTo(P.l+W,y);g.stroke();g.fillStyle=col('--mut');g.textAlign='right';g.fillText((o.yf||(v=>v.toFixed(1)))(v),P.l-4,y+4)}
 const tx=o.xt||4;for(let i=0;i<=tx;i++){const v=o.x[0]+(o.x[1]-o.x[0])*i/tx;g.fillStyle=col('--mut');g.textAlign=i==tx?'right':i==0?'left':'center';g.fillText(v.toFixed(1)+' ч',X(v),h-5)}
 (o.lines||[]).forEach(l=>{if(!l.pts||l.pts.length<2)return;g.beginPath();g.strokeStyle=l.c.startsWith('--')?col(l.c):l.c;g.lineWidth=l.w||2;g.setLineDash(l.d||[]);l.pts.forEach((p,i)=>{const x=X(p[0]),y=Y(p[1]);i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke();g.setLineDash([])});
 if(o.now!=null){g.strokeStyle=col('--fg');g.globalAlpha=.4;g.setLineDash([2,4]);g.beginPath();g.moveTo(X(o.now),P.t);g.lineTo(X(o.now),P.t+H);g.stroke();g.setLineDash([]);g.globalAlpha=1}}
function heat(c,pts,n){const r=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;if(!w)return;c.width=w*r;c.height=h*r;const g=c.getContext('2d');g.scale(r,r);
 const L0=42,W=w-L0-8,rh=(h-6)/n;g.font='10px system-ui';for(let i=0;i<n;i++){g.fillStyle=col('--mut');g.textAlign='right';g.fillText(i+1,L0-6,3+i*rh+rh/2+3)}
 if(pts.length<2)return;const cw=W/pts.length;
 pts.forEach((p,k)=>{const cs=p[2],m=cs.reduce((a,b)=>a+b,0)/cs.length;cs.forEach((v,i)=>{const d=v-m,a=Math.min(1,Math.abs(d)/70);g.fillStyle=d>=0?`rgba(239,83,80,${a})`:`rgba(100,181,246,${a})`;g.fillRect(L0+k*cw,3+i*rh,cw+.6,rh-1.5)})});
 g.strokeStyle=col('--bd');g.strokeRect(L0,3,W,h-6)}

// ---------- панели ----------
const devs=new Map(),panels=new Map();
function mk(dv){const el=$('tpl').content.firstElementChild.cloneNode(true);$('root').appendChild(el);const q=s=>el.querySelector(s);
 q('.chem').value=dv.chem;q('.cap').value=dv.cap;
 q('.chem').onchange=()=>{dv.chem=q('.chem').value;dv.save()};q('.cap').onchange=()=>{dv.cap=Math.max(1,+q('.cap').value||105);dv.save()};
 q('.bcloud').onclick=()=>upload(dv,true);
 q('.bdis').onclick=()=>{dv.want=false;dv.running=false;try{dv.dev.gatt.disconnect()}catch(e){}};
 q('.bclr').onclick=()=>{if(confirm('Стереть историю и события этой BMS?')){dv.long=[];dv.events=[];dv.ahIn=dv.ahOut=0;dv.t0=Date.now();dv.save()}};
 const file=()=>new File([dv.csv()],`daly_${dv.name}_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.csv`,{type:'text/csv'});
 q('.bcsv').onclick=()=>{const f=file(),a=document.createElement('a');a.href=URL.createObjectURL(f);a.download=f.name;a.click()};
 q('.bshare').onclick=async()=>{const f=file();try{if(navigator.canShare&&navigator.canShare({files:[f]}))await navigator.share({files:[f],title:'Daly BMS'});else q('.bcsv').click()}catch(e){}};
 const SH=JSON.parse(localStorage.getItem('daly2:shut')||'{}');
 el.querySelectorAll('.card>h2').forEach(h=>{const c=h.parentElement,k=h.textContent.trim();if(SH[k]===undefined?(/Перекос|Ресурс/.test(k)&&matchMedia('(max-width:600px)').matches):SH[k])c.classList.add('shut');
  h.onclick=()=>{c.classList.toggle('shut');SH[k]=c.classList.contains('shut');try{localStorage.setItem('daly2:shut',JSON.stringify(SH))}catch(e){}if(!c.classList.contains('shut'))devs.forEach(upd)}});
 const P={el,q};panels.set(dv.id,P);return P}
function upd(dv){const P=panels.get(dv.id)||mk(dv),q=P.q,d=dv.last,I=dv.metrics(),lv=!dv.online?2:(dv.last?dv.level:3);
 q('.ban').className='ban l'+lv;q('.nm').textContent=dv.name;q('.st').textContent=!dv.last&&dv.online?'ЖДУ ДАННЫЕ':L[lv==3?1:lv];
 q('.pc').textContent=I?I.soc:'–';q('.g1').setAttribute('stroke-dasharray',(I?I.soc:0)+' 100');
 q('.eta').textContent=!dv.online?('Нет связи'+(dv.err?': '+dv.err:'')):(I&&I.eta!=null?`До конца заряда ≈ ${fh(I.eta)} (к ${new Date(Date.now()+I.eta*60000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}) · ${I.phase}`:(I?I.phase:''));
 q('.kp').innerHTML=d?`<div><b>${d.V.toFixed(1)} В</b>сборка</div><div><b>${d.I.toFixed(1)} А</b>ток</div><div><b>${d.tmax??'—'} °C</b>температура</div>`:'';
 q('.cloud').textContent=cloudLine(dv);
 q('.chips').innerHTML=dv.checks.map(c=>`<span class="chip c${c.level}"><i></i>${esc(c.name)}</span>`).join('');
 q('.issues').innerHTML=dv.checks.filter(c=>c.level>0).map(c=>`<div class="i${c.level}">${esc(c.name)}: ${esc(c.text)}</div>`).join('');
 if(d&&d.cells.length){const C=dv.C,cs=d.cells,mx=Math.max(...cs),mn=Math.min(...cs),m=cs.reduce((a,v)=>a+v,0)/cs.length,lo=C.loBad+200,hi=C.vmax+50,pos=v=>Math.max(0,Math.min(100,(v-lo)/(hi-lo)*100));
  q('.bats').innerHTML=cs.map((v,i)=>`<div class="b1 ${v===mx&&mx!==mn?'mx':v===mn&&mx!==mn?'mn':''}"><div class="tube"><i style="height:${pos(v)}%"></i><u style="bottom:${pos(m)}%"></u></div><b>${(v/1000).toFixed(3)}</b><span>${i+1}${d.bal&&d.bal[i]?' <em class="bal">⚖</em>':''}</span></div>`).join('')}
 q('.res').innerHTML=I?`<div><b>${I.cycles??'—'}</b>циклов (типовой ресурс ~3000)<div class="rb"><i style="width:${Math.min(100,(I.cycles||0)/3000*100)}%"></i></div></div><div><b>${I.ahIn.toFixed(2)}</b>принято А·ч</div><div><b>${I.ahOut.toFixed(2)}</b>отдано А·ч</div><div><b>${I.capBms??'—'}</b>остаток по BMS, А·ч</div>`:'';
 q('.evl').innerHTML=dv.events.slice(0,15).map(e=>`<div class="e${e.level}">${esc(e.t.slice(5))}  ${esc(e.text)}</div>`).join('')||'пока нет';
 charts(dv,I,P)}
function charts(dv,I,P){const q=P.q,lg=dv.long;if(!I||lg.length<2)return;const C=dv.C,t0=lg[0][0],sum=p=>p[2].reduce((a,v)=>a+v,0)/1000,
 act=lg.map(p=>[(p[0]-t0)/3600,sum(p)]),cur=lg.map(p=>[(p[0]-t0)/3600,p[1]]),spr=lg.map(p=>[(p[0]-t0)/3600,Math.max(...p[2])-Math.min(...p[2])]),
 id=ideal(I,C),xn=act[act.length-1][0],xmax=Math.max(id.tEnd,xn)*1.03||1,n=I.n,vm=C.vmax/1000,vlo=C.ocv[0][0];
 plot(q('.cV'),{x:[0,xmax],y:[n*vlo,n*(vm+.1)],yf:v=>v.toFixed(0)+' В',now:xn,bands:[{y0:n*vm,y1:n*(vm+.1),c:'rgba(198,40,40,.10)'}],
  lines:[{pts:[[0,n*vm],[xmax,n*vm]],c:'--bad',w:1,d:[6,4]},{pts:id.V,c:'--acc2',d:[7,5],w:2},{pts:act,c:'--acc',w:2.5}]});
 plot(q('.cI'),{x:[0,xmax],y:[0,Math.max(id.iset*1.25,...cur.map(p=>p[1]),1)],yf:v=>v.toFixed(0)+' А',now:xn,yt:3,lines:[{pts:id.A,c:'--acc2',d:[7,5],w:2},{pts:cur,c:'--acc',w:2.5}]});
 heat(q('.heat'),lg,n);
 plot(q('.spr'),{x:[0,xmax],y:[0,200],yf:v=>v.toFixed(0)+' мВ',now:xn,bands:[{y0:0,y1:30,c:'rgba(46,125,50,.18)'},{y0:30,y1:150,c:'rgba(194,122,0,.10)'},{y0:150,y1:200,c:'rgba(198,40,40,.12)'}],
  lines:[{pts:[[0,100],[id.tEnd*.7,100],[id.tEnd,30]],c:'--acc2',d:[7,5],w:2},{pts:spr,c:'--acc',w:2.5}]})}

async function addDevice(all){audio();try{Notification.requestPermission&&Notification.requestPermission()}catch(e){}
 try{const opt=all?{acceptAllDevices:true,optionalServices:[SVC]}:{filters:[{namePrefix:'DL-'},{services:[SVC]}],optionalServices:[SVC]};
  const device=await navigator.bluetooth.requestDevice(opt);
  if(devs.has(device.id)){const o=devs.get(device.id);if(!o.running){o.want=true;o.reconnect()}glog('уже добавлена: '+o.name);return}
  const dv=new Dev(device);devs.set(device.id,dv);$('hero').style.display='none';upd(dv);glog('подключаю '+dv.name+', в истории '+dv.long.length+' точек');
  try{await dv.connect()}catch(e){dv.err=String(e.message||e);glog(dv.name+': '+dv.err);dv.reconnect()}
 }catch(e){glog('не подключилось: '+e.message);if(/not supported on this platform/i.test(e.message))$('sup').innerHTML='<b>Этот браузер не поддерживает Bluetooth.</b> Откройте ссылку в Google Chrome (не во встроенном браузере телефона, не в Яндексе, Samsung Internet или Telegram). В Android включите Bluetooth и геолокацию, дайте Chrome разрешение «Устройства поблизости».'}}
$('add').onclick=()=>addDevice(false);$('addall').onclick=()=>addDevice(true);
const ua=navigator.userAgent;if(/SamsungBrowser|YaBrowser|OPR\/|UCBrowser|MiuiBrowser|VivoBrowser|; wv\)|Telegram|FB_IAB|FBAN/i.test(ua))$('sup').textContent='Похоже, это не Google Chrome: Bluetooth может не работать. Откройте ссылку в Chrome.';
if(!navigator.bluetooth){$('sup').textContent='Web Bluetooth недоступен: откройте страницу в Chrome на Android (или Chrome/Edge на компьютере) по адресу https.';$('add').disabled=$('addall').disabled=true}
$('cloudOn').checked=localStorage.getItem('daly2:cloud')==='1';
$('cloudOn').onchange=()=>{localStorage.setItem('daly2:cloud',$('cloudOn').checked?'1':'0');if($('cloudOn').checked&&!cloudUrl())glog('облако пока не настроено автором');$('cloudInfo').textContent=cloudUrl()?'':' (облако пока не подключено)'};
$('cloudInfo').textContent=cloudUrl()?'':' (облако пока не подключено)';
setInterval(uploadAll,60000);
setInterval(()=>{$('clock').textContent=new Date().toLocaleTimeString();devs.forEach(upd)},2000);
addEventListener('beforeunload',()=>devs.forEach(d=>d.save()));
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(()=>{});

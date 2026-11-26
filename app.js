'use strict';
const LANG=(()=>{let l='';try{const m=/[?&]lang=(en|ru)\b/.exec(location.search);l=m?m[1]:localStorage.getItem('daly2:lang')||''}catch(e){}if(l!=='en'&&l!=='ru')l=/^(ru|uk|be|kk)\b/i.test(navigator.language||'')?'ru':'en';return l})();
const tr=(ru,en)=>LANG==='ru'?ru:en;
const uV=tr('В','V'),uA=tr('А','A'),umV=tr('мВ','mV');
const $=id=>document.getElementById(id);
const col=k=>getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const u16=(f,i)=>(f[i]<<8)|f[i+1];
const frame=(cmd,b0=0,fill=0)=>{const f=[0xA5,0x40,cmd,8,b0,fill,fill,fill,fill,fill,fill,fill];f.push(f.reduce((a,b)=>a+b)&255);return new Uint8Array(f)};
const crc16=(b,n=b.length)=>{let c=0xFFFF;for(let i=0;i<n;i++){c^=b[i];for(let j=0;j<8;j++)c=(c&1)?(c>>>1)^0xA001:c>>>1}return c};
const mbFrame=(a,fn,reg,val)=>{const b=[a,fn,reg>>8,reg&255,val>>8,val&255],c=crc16(b);b.push(c&255,c>>8);return new Uint8Array(b)};
const fh=m=>m==null?'—':(m>=60?Math.floor(m/60)+tr(' ч ',' h ')+String(m%60).padStart(2,'0')+tr(' мин',' min'):m+tr(' мин',' min'));
const stamp=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`};
const SVC=0xfff0,SVC2=0xff00,PERIOD=2000,LONG_STEP=30,MAXLONG=5760;
const L=[tr('РАБОТАЕТ ПРАВИЛЬНО','WORKING CORRECTLY'),tr('ВНИМАНИЕ','ATTENTION'),tr('НЕИСПРАВНОСТЬ / НЕТ СВЯЗИ','FAULT / NO CONNECTION')];

const CHEM={
 lfp:{name:'LiFePO4',vmax:3650,hiWarn:3600,loWarn:2800,loBad:2500,top:3450,
  ocv:[[2.50,0],[3.00,2],[3.15,8],[3.20,15],[3.25,25],[3.28,35],[3.30,45],[3.32,60],[3.33,70],[3.35,80],[3.40,90],[3.45,95],[3.60,100]]},
 nmc:{name:'Li-ion NMC',vmax:4200,hiWarn:4150,loWarn:3200,loBad:2800,top:4100,
  ocv:[[3.00,0],[3.30,5],[3.50,20],[3.60,35],[3.70,50],[3.80,65],[3.90,77],[4.00,88],[4.10,95],[4.20,100]]}
};
const NEN={'BMS отвечает':'BMS responds','Сумма ячеек = сборка':'Cells sum = pack','Ячейки в пределах':'Cells in range','Пороги BMS':'BMS thresholds','Сопротивление ячеек':'Cell impedance','Перекос ячеек':'Cell spread','Температура':'Temperature','Защиты BMS':'BMS protections','Ключ заряда':'Charge switch','Ключ разряда':'Discharge switch','Контакт балансира':'Balance tap','Обрыв отвода ячейки':'Open balance lead','Малый ток (мёртвая зона)':'Low-current deadband','Заряд идёт':'Charging','Обрыв заряда':'Charge interruption','Ток заряда':'Charge current','Балансировка у верха':'Top balancing'};
const SPREAD_WARN=150,SPREAD_BAD=300,TOP_SPREAD=60,T_WARN=45,T_BAD=55,SUM_TOL=.5,RISE_MIN=2,DROP_V=.3;
const FAULTS=[[0,[0,1],"перенапряжение ячейки"],[0,[2,3],"недонапряжение ячейки"],[0,[4,5],"перенапряжение сборки"],[0,[6,7],"недонапряжение сборки"],
 [1,[0,1],"перегрев при заряде"],[1,[2,3],"холод при заряде"],[1,[4,5],"перегрев при разряде"],[1,[6,7],"холод при разряде"],
 [2,[0,1],"перегрузка заряда"],[2,[2,3],"перегрузка разряда"],[2,[4,5],"SOC высокий"],[2,[6,7],"SOC низкий"],[3,[0,1],"перекос напряжений"],[3,[2,3],"перекос температур"],
 [4,[0],"перегрев ключа заряда"],[4,[1],"перегрев ключа разряда"],[4,[2],"датчик ключа заряда"],[4,[3],"датчик ключа разряда"],[4,[4],"залип ключ заряда"],[4,[5],"залип ключ разряда"],[4,[6],"обрыв ключа заряда"],[4,[7],"обрыв ключа разряда"],
 [5,[0],"сбой AFE"],[5,[1],"ячейка не читается"],[5,[2],"датчик температуры"],[5,[3],"EEPROM"],[5,[4],"RTC"],[5,[5],"предзаряд"],[5,[6],"связь"],[5,[7],"внутренняя связь"],
 [6,[0],"датчик тока"],[6,[1],"датчик напряжения"],[6,[2],"короткое замыкание"],[6,[3],"заряд запрещён: низкое напряжение"]];
const FEN={'перенапряжение ячейки':'cell overvoltage','недонапряжение ячейки':'cell undervoltage','перенапряжение сборки':'pack overvoltage','недонапряжение сборки':'pack undervoltage','перегрев при заряде':'overtemperature (charge)','холод при заряде':'undertemperature (charge)','перегрев при разряде':'overtemperature (discharge)','холод при разряде':'undertemperature (discharge)','перегрузка заряда':'charge overcurrent','перегрузка разряда':'discharge overcurrent','SOC высокий':'SOC high','SOC низкий':'SOC low','перекос напряжений':'voltage imbalance','перекос температур':'temperature imbalance','перегрев ключа заряда':'charge MOSFET overheat','перегрев ключа разряда':'discharge MOSFET overheat','датчик ключа заряда':'charge MOSFET sensor','датчик ключа разряда':'discharge MOSFET sensor','залип ключ заряда':'charge MOSFET stuck','залип ключ разряда':'discharge MOSFET stuck','обрыв ключа заряда':'charge MOSFET open','обрыв ключа разряда':'discharge MOSFET open','сбой AFE':'AFE failure','ячейка не читается':'cell read failure','датчик температуры':'temperature sensor','EEPROM':'EEPROM','RTC':'RTC','предзаряд':'precharge','связь':'communication','внутренняя связь':'internal communication','датчик тока':'current sensor','датчик напряжения':'voltage sensor','короткое замыкание':'short circuit','заряд запрещён: низкое напряжение':'charging inhibited: low voltage'};
const tf=n=>LANG==='ru'?n:(FEN[n]||n);
const SOFT=['SOC низкий','SOC высокий'].map(tf);
function decodeFaults(b){const o=[];if(!b)return o;FAULTS.forEach(([by,bits,n])=>bits.forEach((bit,l)=>{if(by<b.length&&(b[by]>>bit)&1)o.push(tf(n)+(bits.length>1?tr(' (ур. ',' (lvl ')+(l+1)+')':''))}));if(b.length>7&&b[7])o.push(tr('код ошибки: ','fault code: ')+b[7]);return o}
const ocvSoc=(tab,v)=>{if(v<=tab[0][0])return 0;for(let i=1;i<tab.length;i++){if(v<=tab[i][0]){const a=tab[i-1],b=tab[i];return a[1]+(b[1]-a[1])*(v-a[0])/(b[0]-a[0])}}return 100};
const ocvV=(tab,s)=>{if(s<=0)return tab[0][0];for(let i=1;i<tab.length;i++){if(s<=tab[i][1]){const a=tab[i-1],b=tab[i];return a[0]+(b[0]-a[0])*(s-a[1])/(b[1]-a[1])}}return tab[tab.length-1][0]};

// ---------- журнал, сигнал ----------
let ac=null;const audio=()=>{try{ac=ac||new AudioContext();ac.resume()}catch(e){}};
const glog=m=>{const e=$('log');e.innerHTML=`<div>${esc(stamp().slice(11))} ${esc(m)}</div>`+e.innerHTML.split('</div>').slice(0,30).join('</div>')};
let lastAlarm=0;
function alarm(msg){glog(tr('СИГНАЛ: ','ALARM: ')+msg);if(Date.now()-lastAlarm<60000)return;lastAlarm=Date.now();
 try{navigator.vibrate&&navigator.vibrate([400,150,400,150,400])}catch(e){}
 try{if(ac)for(let i=0;i<5;i++){const o=ac.createOscillator(),g=ac.createGain();o.frequency.value=i%2?880:660;o.connect(g);g.connect(ac.destination);g.gain.value=.25;o.start(ac.currentTime+i*.35);o.stop(ac.currentTime+i*.35+.28)}}catch(e){}
 try{if(Notification.permission==='granted'&&navigator.serviceWorker)navigator.serviceWorker.ready.then(r=>r.showNotification('Daly BMS',{body:msg,vibrate:[300,100,300],tag:'daly'}))}catch(e){}}
let wl=null;async function lock(){try{wl=await navigator.wakeLock.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&devs.size)lock()});

// ---------- облако (по согласию) ----------
const CLOUD_URL='https://script.google.com/macros/s/AKfycby54kxPT5gWs_qx9VQ2ik9eq3DkxZ-ZsE5iaYbGoaHodTINODHj-A5DSdcxjROeEwHftA/exec';   // адрес Google Apps Script; задаётся при публикации
const cloudUrl=()=>CLOUD_URL||localStorage.getItem('daly2:cloudurl')||'';
const cloudOn=()=>!!cloudUrl();
const anon=(()=>{let a=localStorage.getItem('daly2:anon');if(!a){a=([...crypto.getRandomValues(new Uint8Array(6))].map(x=>x.toString(16).padStart(2,'0')).join(''));localStorage.setItem('daly2:anon',a)}return a})();
const hash6=s=>{let h=5381;for(const c of s)h=((h<<5)+h+c.charCodeAt(0))>>>0;return h.toString(16).padStart(8,'0')};
const MIN_GAP=60000;   // защита от частых отправок: не чаще раза в минуту с одного устройства
function toast(msg,kind){const t=$('toast'),d=document.createElement('div');d.textContent=msg;if(kind)d.className=kind;t.appendChild(d);setTimeout(()=>d.remove(),4500);while(t.children.length>3)t.firstChild.remove()}
const pending=dv=>({rows:dv.long.filter(x=>x[0]>dv.upT).length,evs:dv.events.filter(e=>e.t>dv.upE).length});
function cloudLine(dv){if(dv.demo)return tr('☁ демо: данные никуда не отправляются','☁ demo: nothing is sent anywhere');if(!cloudOn())return tr('☁ облако не настроено','☁ cloud not configured');
 const p=pending(dv),when=dv.sentAt?new Date(dv.sentAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
 const st=dv.sentOk===false?tr('последняя попытка не удалась','last attempt failed'):dv.sentAt?tr('последняя отправка ','last upload ')+when+(dv.sentOk===true?tr(' ✓ подтверждена',' ✓ confirmed'):tr(' (без подтверждения)',' (unconfirmed)')):tr('ещё не отправляли','nothing uploaded yet');
 return tr(`☁ отправлено ${dv.sent} замеров · ждёт отправки ${p.rows} · ${st}`,`☁ uploaded ${dv.sent} samples · pending ${p.rows} · ${st}`)}
async function upload(dv,manual){
 if(dv.demo){if(manual)toast(tr('В демо ничего не отправляется','Nothing is sent in demo mode'));return}
 if(!cloudOn()){if(manual)toast(tr('Облако не настроено','Cloud not configured'));return}
 if(dv.sending)return;const wait=MIN_GAP-(Date.now()-dv.lastTry);
 if(wait>0){if(manual)toast(tr(`Слишком часто: подождите ${Math.ceil(wait/1000)} с`,`Too often: wait ${Math.ceil(wait/1000)} s`),'bad');return}
 const p=pending(dv);if(!p.rows&&!p.evs){if(manual)toast(tr('Всё уже отправлено, новых данных нет','Everything is already uploaded'),'ok');return}
 const rows=dv.long.filter(x=>x[0]>dv.upT).slice(0,500),evs=dv.events.filter(e=>e.t>dv.upE).reverse().slice(0,100);
 const body=JSON.stringify({v:1,sid:anon+'-'+hash6(dv.id),chem:dv.chem,cap:dv.cap,cycles:dv.last&&dv.last.cycles,lim:dv.lim,ir:dv.ir,sn:dv.sn,rcap:dv.rcap,rows:rows.map(x=>[x[0],x[1],...x[2]]),x:rows.map(x=>{const m=x[4]||{},b=(x[3]||[]).map((v,i)=>v?i+1:0).filter(Boolean).join(',');return{V:m.V,soc:m.soc,tmin:m.tmin,tmax:m.tmax,st:m.st,chg:m.chg,dis:m.dis,chgr:m.chgr,load:m.load,cap:m.cap,bal:b,flt:m.flt||''}}),events:evs.map(e=>[e.t,e.level,e.text])});
 dv.sending=true;dv.lastTry=Date.now();let confirmed=false;
 try{try{const r=await fetch(cloudUrl(),{method:'POST',headers:{'Content-Type':'text/plain'},body,referrerPolicy:'no-referrer',credentials:'omit'}),t=(await r.text()).trim();
    if(t!=='ok')throw new Error(t.slice(0,80)||tr('пустой ответ','empty response'));confirmed=true}
   catch(e){if(!(e instanceof TypeError))throw e;await fetch(cloudUrl(),{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body,referrerPolicy:'no-referrer',credentials:'omit'})}
  if(rows.length)dv.upT=rows[rows.length-1][0];if(evs.length)dv.upE=evs[evs.length-1].t;dv.sent+=rows.length;dv.sentAt=Date.now();dv.sentOk=confirmed?true:'noconf';dv.save();
  if(manual||!dv.toasted){dv.toasted=true;toast(tr(`☁ Отправлено: ${rows.length} замеров, ${evs.length} событий${confirmed?' · подтверждено':' · без подтверждения'}`,`☁ Uploaded: ${rows.length} samples, ${evs.length} events${confirmed?' · confirmed':' · unconfirmed'}`),'ok')}glog(tr(`отправлено в облако: ${rows.length} замеров, ${evs.length} событий`,`uploaded: ${rows.length} samples, ${evs.length} events`))}
 catch(e){dv.sentOk=false;if(manual||!dv.failToast||Date.now()-dv.failToast>600000){dv.failToast=Date.now();toast(tr('☁ Не отправлено: ','☁ Not uploaded: ')+(e.message||e),'bad')}glog(tr('облако: ','cloud: ')+(e.message||e))}
 finally{dv.sending=false}}
const uploadAll=m=>devs.forEach(d=>upload(d,m));

// ---------- BMS ----------
class Dev{
 constructor(device){this.dev=device;this.id=device.id;this.name=device.name||device.id;this.key='daly2:'+device.id;
  this.buf=[];this.frames=[];this.waiter=null;this.rx=null;this._onData=e=>this.onData(e);this.q=Promise.resolve();this.hist=[];this.long=[];this.events=[];this.chem='lfp';this.cap=105;
  this.last=null;this.prev=null;this.online=false;this.err=tr('подключение…','connecting…');this.want=true;this.running=false;this.badUntil=0;
  this.ahIn=0;this.ahOut=0;this.t0=Date.now();this.longT=0;this.checks=[];this.level=3;this.lim=null;this.ir=null;this.sn='';this.rcap=null;this.limDone=false;this.proto=null;
  this.upT=0;this.upE='';this.sent=0;this.sentAt=0;this.sentOk=null;this.lastTry=0;this.sending=false;
  try{const s=JSON.parse(localStorage.getItem(this.key)||'{}');if(CHEM[s.chem])this.chem=s.chem;if(Number.isFinite(s.cap))this.cap=Math.min(2000,Math.max(1,s.cap));
   const num=x=>typeof x==='number'&&Number.isFinite(x);
   this.long=(Array.isArray(s.long)?s.long:[]).filter(x=>Array.isArray(x)&&num(x[0])&&num(x[1])&&Array.isArray(x[2])&&x[2].length>0&&x[2].length<=32&&x[2].every(c=>num(c)&&c>=0&&c<6000)).slice(-MAXLONG);
   this.events=(Array.isArray(s.events)?s.events:[]).filter(e=>e&&typeof e.t==='string'&&typeof e.text==='string').slice(0,200).map(e=>({t:e.t.slice(0,25),level:e.level|0,text:e.text.slice(0,200)}));
   this.upT=num(s.upT)?s.upT:0;this.upE=typeof s.upE==='string'?s.upE.slice(0,25):'';this.sent=num(s.sent)?s.sent:0;this.sentAt=num(s.sentAt)?s.sentAt:0;
   this.longT=this.long.length?this.long[this.long.length-1][0]:0}catch(e){}
  device.addEventListener('gattserverdisconnected',()=>{this.running=false;this.buf=[];this.frames=[];if(this.waiter)this.waiter();this.setOnline(false,tr('связь потеряна','connection lost'));upload(this);if(this.want)this.reconnect()})}
 get C(){return CHEM[this.chem]}
 save(){try{localStorage.setItem(this.key,JSON.stringify({chem:this.chem,cap:this.cap,long:this.long.slice(-MAXLONG),events:this.events.slice(0,200),upT:this.upT,upE:this.upE,sent:this.sent,sentAt:this.sentAt}))}catch(e){glog('история не сохраняется: '+e)}}
 event(level,text){this.events.unshift({t:stamp(),level,text});if(this.events.length>200)this.events.pop();if(level==2)alarm(this.name+': '+text)}
 setOnline(on,err){if(on!==this.online){this.event(on?0:1,on?tr('связь установлена','connected'):tr('связь потеряна: ','connection lost: ')+(err||''))}this.online=on;if(!on)this.err=err||''}
 async reconnect(){for(let i=0;this.want&&!this.running;i++){await sleep(Math.min(3000+i*1000,10000));if(!this.want||this.running)return;
   try{await this.connect()}catch(e){this.err=tr('переподключаюсь… (','reconnecting… (')+(i+1)+')'}}}
 async connect(){
  const srv=await this.dev.gatt.connect(),s=await srv.getPrimaryService(SVC).catch(()=>srv.getPrimaryService(SVC2));
  let cs=[];for(let i=0;i<4&&!cs.length;i++){try{cs=await s.getCharacteristics()}catch(e){await sleep(1000)}}
  const rx=cs.find(c=>c.uuid.startsWith('0000fff1')||c.uuid.startsWith('0000ff01'))||cs.find(c=>c.properties.notify);
  this.tx=cs.find(c=>c.uuid.startsWith('0000fff2')||c.uuid.startsWith('0000ff02'))||cs.find(c=>c.properties.writeWithoutResponse||c.properties.write);
  if(!rx||!this.tx)throw new Error(tr('нет нужных характеристик (удалите устройство в настройках Bluetooth телефона и добавьте заново)','required characteristics not found (remove the device in your phone\'s Bluetooth settings and add it again)'));
  if(this.rx&&this.rx!==rx)this.rx.removeEventListener('characteristicvaluechanged',this._onData);
  rx.removeEventListener('characteristicvaluechanged',this._onData);rx.addEventListener('characteristicvaluechanged',this._onData);this.rx=rx;
  await rx.startNotifications();await sleep(200);
  this.buf=[];this.frames=[];this.running=true;this.setOnline(true);lock();if(!this.proto)await this.detectProto();this.loop()}
 onData(ev){const dv=ev.target.value,v=new Uint8Array(dv.buffer,dv.byteOffset,dv.byteLength);this.buf.push(...v);
  if(this.proto==='d2'||this.proto==='81'){
   const okA=a=>this.proto==='d2'?a===0xD2:(a===0x51||a===0x81);
   while(this.buf.length>=3){if(!okA(this.buf[0])){this.buf.shift();continue}
    const fn=this.buf[1],len=fn===0x03?this.buf[2]+5:fn===0x06?8:(fn&0x80)?5:0;
    if(!len||len>260){this.buf.shift();continue}if(this.buf.length<len)return;
    if(crc16(this.buf,len-2)!==(this.buf[len-2]|(this.buf[len-1]<<8))){this.buf.shift();continue}
    this.frames.push(this.buf.splice(0,len));if(this.waiter)this.waiter()}
   return}
  while(this.buf.length>=13){const i=this.buf.indexOf(0xA5);if(i<0){this.buf=[];return}if(i>0)this.buf.splice(0,i);if(this.buf.length<13)return;
   let sum=0;for(let k=0;k<12;k++)sum+=this.buf[k];if((sum&255)!==this.buf[12]){this.buf.splice(0,1);continue}
   this.frames.push(this.buf.splice(0,13));if(this.waiter)this.waiter()}}
 enqueue(fn){const p=this.q.then(fn,fn);this.q=p.catch(()=>{});return p}
 async _write(pkt){
  if(this.tx.properties.writeWithoutResponse&&this.tx.writeValueWithoutResponse){
   try{await this.tx.writeValueWithoutResponse(pkt)}catch(e){if(this.tx.properties.write&&this.tx.writeValueWithResponse)await this.tx.writeValueWithResponse(pkt);else throw e}
  }else await this.tx.writeValueWithResponse(pkt)}
 async _wait(pred,to){const end=Date.now()+to;
  for(;;){const got=this.frames.filter(pred);if(got.length||Date.now()>=end||!this.running)return got;
   await new Promise(r=>{const done=()=>{clearTimeout(t);this.waiter=null;r()};const t=setTimeout(done,Math.max(50,end-Date.now()));this.waiter=done})}}
 async _ask(cmd,n=1,b0=0,fill=0,to=1500){if(!this.running||!this.tx)return[];this.frames=[];await this._write(frame(cmd,b0,fill));
  const end=Date.now()+to;
  for(;;){const got=this.frames.filter(f=>f[2]===cmd);if(got.length>=n||Date.now()>=end||!this.running)return got;
   await new Promise(r=>{const done=()=>{clearTimeout(t);this.waiter=null;r()};const t=setTimeout(done,Math.max(50,end-Date.now()));this.waiter=done})}}
 async _mb(addr,fn,reg,val,to=1500){if(!this.running||!this.tx)return null;this.frames=[];await this._write(mbFrame(addr,fn,reg,val));
  const got=await this._wait(f=>f[1]===fn,to);return got.length?got[0]:null}
 async detectProto(){return this.enqueue(async()=>{
  this.proto='a5';this.buf=[];if((await this._ask(0x90,1,0,0,600)).length)return;
  this.proto='d2';this.buf=[];if(await this._mb(0xD2,3,0x0000,0x003E,600))return;
  this.proto='81';this.buf=[];if(await this._mb(0x81,3,0x0000,0x0040,600))return;
  this.proto='a5';this.buf=[]})}
 ask(cmd,n=1,b0=0){return this.enqueue(()=>this._ask(cmd,n,b0))}
 async cmd(c,b0,label){if(this.demo){toast(tr('В демо управление BMS недоступно','BMS control is unavailable in demo'));return}
  if(!this.running||!this.tx){toast(tr('Сначала подключитесь к BMS','Connect to BMS first'),'bad');return}
  if(this.proto!=='a5'&&c===0x00){toast(tr('Сброс недоступен для Modbus BMS','Reset is unavailable on Modbus BMS'),'bad');return}
  return this.enqueue(async()=>{try{
    let ok=false;
    if(this.proto==='d2'){const reg=c===0xDA?0x00A5:0x00A6;ok=!!(await this._mb(0xD2,6,reg,b0))}
    else if(this.proto==='81'){const reg=c===0xDA?0x0121:0x0122;ok=!!(await this._mb(0x81,6,reg,b0))}
    else{ok=!!(await this._ask(c,1,b0)).length}
    if(!ok)throw new Error(tr('нет ответа','no response'));
    this.event(1,label);glog(label);toast(label,'ok');if(c!==0x00)this.update(await this._poll())}
   catch(e){toast(tr('Команда не выполнена: ','Command failed: ')+(e.message||e),'bad');glog(label+': '+(e.message||e))}})}
 async _poll(){const d={t:Date.now()/1000};
  if(this.proto==='d2'){const f=await this._mb(0xD2,3,0x0000,0x003E);if(!f)throw new Error(tr('нет ответа','no response'));
   const p=f.slice(3,-2),n=Math.min(u16(p,98)||8,32),nt=Math.min(u16(p,100)||0,8);d.n=n;
   d.cells=[];for(let i=0;i<n;i++)d.cells.push(u16(p,i*2));
   const ts=[];for(let i=0;i<nt;i++){const t=u16(p,64+i*2);if(t>0&&t<255)ts.push(t-40)}
   if(ts.length){d.tmax=Math.max(...ts);d.tmin=Math.min(...ts)}
   d.V=u16(p,80)/10;d.I=(u16(p,82)-30000)/10;d.soc=u16(p,84)/10;d.state=u16(p,94);d.cap=u16(p,96)/10;
   d.cycles=u16(p,102);d.chg=u16(p,106)?1:0;d.dis=u16(p,108)?1:0;d.charger=null;d.load=null;d.bal=[];d.fault=[];
   d.asleep=d.V===0&&(!d.cells.length||!d.cells.some(x=>x));return d}
  if(this.proto==='81'){const f1=await this._mb(0x81,3,0x0000,0x0040),f2=await this._mb(0x81,3,0x0041,0x003E);
   if(!f1||!f2)throw new Error(tr('нет ответа','no response'));
   const p1=f1.slice(3,-2),p2=f2.slice(3,-2),n=Math.min(u16(p1,120)||8,48),nt=Math.min(u16(p1,122)||0,8);d.n=n;
   d.cells=[];for(let i=0;i<n;i++)d.cells.push(u16(p1,i*2));
   const ts=[];for(let i=0;i<nt;i++){const t=u16(p1,96+i*2);if(t>0&&t<255)ts.push(t-40)}
   if(ts.length){d.tmax=Math.max(...ts);d.tmin=Math.min(...ts)}
   d.V=u16(p1,112)/10;d.I=(u16(p1,114)-30000)/10;d.soc=u16(p1,116)/10;
   d.cap=u16(p2,20)/10;d.cycles=u16(p2,22);d.chg=u16(p2,34)?1:0;d.dis=u16(p2,36)?1:0;
   d.state=d.I>.3?1:(d.I<-.3?2:0);d.charger=null;d.load=null;d.bal=[];d.fault=[];
   d.asleep=d.V===0&&(!d.cells.length||!d.cells.some(x=>x));return d}
  let f=await this._ask(0x90);if(!f.length)throw new Error(tr('нет ответа','no response'));f=f[0];
  d.V=u16(f,4)/10;d.I=(u16(f,8)-30000)/10;d.soc=u16(f,10)/10;
  f=await this._ask(0x92);if(f.length){d.tmax=f[0][4]-40;d.tmin=f[0][6]-40}
  f=await this._ask(0x93);if(f.length){f=f[0];d.state=f[4];d.chg=f[5];d.dis=f[6];d.cap=(((f[8]<<24)|(f[9]<<16)|(f[10]<<8)|f[11])>>>0)/1000}
  f=await this._ask(0x94);if(f.length){f=f[0];d.n=f[4];d.charger=f[6];d.load=f[7];d.cycles=u16(f,9)}
  const n=d.n||8,fr=await this._ask(0x95,Math.ceil(n/3)),byIdx=new Map();
  fr.forEach(g=>{if(g[4]!==0xFF&&g[4]>0&&!byIdx.has(g[4]))byIdx.set(g[4],g)});
  let cells=[];[...byIdx.entries()].sort((a,b)=>a[0]-b[0]).forEach(([,g])=>{for(let k=0;k<3;k++)cells.push(u16(g,5+2*k))});d.cells=cells.slice(0,n);
  f=await this._ask(0x97);d.bal=d.cells.length&&f.length?d.cells.map((_,i)=>(f[0][4+(i>>3)]>>(i&7))&1):[];
  f=await this._ask(0x98);d.fault=f.length?f[0].slice(4,12):(this.last?this.last.fault:[]);d.asleep=d.V===0&&(!d.cells.length||!d.cells.some(x=>x));
  if(!this.limDone&&!d.asleep){this.limDone=true;const l=await this._ask(0x59,1,0xAA,0xAA,500);
   if(l.length){const ov1=u16(l[0],4),ov2=u16(l[0],6),uv1=u16(l[0],8),uv2=u16(l[0],10);
    if(uv2>=2000&&uv2<=uv1&&uv1<ov1&&ov1<=ov2&&ov2<=4500){this.lim={ov1,ov2,uv1,uv2};glog(tr(`пороги BMS: ${uv2}–${ov2} мВ`,`BMS limits: ${uv2}–${ov2} mV`))}}
   const p0=await this._ask(0x50,1,0xAA,0xAA,500);
   if(p0.length){const rc=(((p0[0][4]<<24)|(p0[0][5]<<16)|(p0[0][6]<<8)|p0[0][7])>>>0)/1000;if(rc>=1&&rc<=2000){this.rcap=Math.round(rc*10)/10;glog(tr(`паспорт BMS: ${this.rcap} А·ч`,`BMS rated cap: ${this.rcap} Ah`))}}
   const s57=await this._ask(0x57,5,0xAA,0xAA,500);
   if(s57.length){const sn=s57.sort((a,b)=>a[4]-b[4]).map(f=>f.slice(5,12).filter(c=>c>=32&&c<=126).map(c=>String.fromCharCode(c)).join('')).join('').trim();
    if(sn){this.sn=sn;glog(tr('код BMS: ','BMS code: ')+sn)}}}
  return d}
 poll(){return this.enqueue(()=>this._poll())}
 async loop(){while(this.running){const t0=Date.now();try{this.update(await this.poll())}catch(e){if(this.running)this.err=String(e.message||e)}await sleep(Math.max(100,PERIOD-(Date.now()-t0)))}}

 slope(t){const p=this.hist.filter(h=>h.t>=t-300&&h.sum);if(p.length<2||p[p.length-1].t-p[0].t<120)return null;return(p[p.length-1].sum-p[0].sum)*1000/((p[p.length-1].t-p[0].t)/60)}
 evaluate(d){const ck=[],C=this.C,add=(name,level,text)=>ck.push({name:LANG==='ru'?name:(NEN[name]||name),level,text});
  if(d.asleep){add('BMS отвечает',1,tr('BMS спит: подключите зарядку на 2 с или нажмите кнопку пробуждения на BMS','BMS is asleep: connect charger for 2 s or press the BMS wake button'));return ck}
  if(!d.cells.length){add('BMS отвечает',1,tr('нет данных по ячейкам','no cell data'));return ck}
  add('BMS отвечает',0,tr('данные получены','data received'));const cs=d.cells,mx=Math.max(...cs),mn=Math.min(...cs),sm=cs.reduce((a,b)=>a+b,0)/1000,sp=mx-mn;
  const h3=this.hist.slice(-3),p30=this.hist.filter(h=>h.t>=d.t-30),atRest=p30.length>=10&&d.t-p30[0].t>=28&&p30.every(h=>Math.abs(h.I)<.5),underLoad=Math.abs(d.I)>10;
  const mirrorIdx=c=>{if(c.length<2)return-1;const m=c.reduce((a,b)=>a+b,0)/c.length;for(let i=0;i<c.length-1;i++){const a=c[i]-m,b=c[i+1]-m;if(a*b<0&&Math.abs(a)>80&&Math.abs(b)>80&&Math.abs((c[i]+c[i+1])/2-m)<30)return i}return-1};
  const mp=mirrorIdx(cs),dead=d.V>16?cs.map((v,i)=>v<=500?i+1:0).filter(Boolean):[];
  if(dead.length)add('Обрыв отвода ячейки',2,tr(`яч. ${dead.join(', ')} ≤500 мВ при сборке ${d.V.toFixed(1)} В — обрыв балансирного провода или мёртвый канал`,`cell ${dead.join(', ')} ≤500 mV at ${d.V.toFixed(1)} V pack — open balance lead or dead AFE channel`));
  if(mp>=0&&h3.length===3&&h3.every(h=>mirrorIdx(h.cells)===mp))add('Контакт балансира',2,tr(`зеркальный сдвиг яч. ${mp+1} и ${mp+2} (±>80 мВ при среднем <30 мВ) — плохой контакт отвода балансира`,`mirror swing on cells ${mp+1} & ${mp+2} (±>80 mV, pair avg <30 mV) — loose balance tap`));
  add('Сумма ячеек = сборка',Math.abs(sm-d.V)<=SUM_TOL?0:1,`${sm.toFixed(2)} ${uV} ${tr('против','vs')} ${d.V.toFixed(1)} ${uV}`);
  const hi2=this.lim?this.lim.ov2:C.vmax,hi1=this.lim?this.lim.ov1:C.hiWarn,lo2=this.lim?this.lim.uv2:C.loBad,lo1=this.lim?this.lim.uv1:C.loWarn;
  add('Ячейки в пределах',mx>=hi2||mn<=lo2?2:(mx>=hi1||mn<=lo1?1:0),`${(mn/1000).toFixed(3)}…${(mx/1000).toFixed(3)} ${uV}`+(this.lim?` (BMS ${lo2}…${hi2} ${umV})`:''));
  if(this.lim&&((this.chem==='lfp'&&this.lim.ov2>3800)||(this.chem==='nmc'&&this.lim.ov2<3900)))add('Пороги BMS',1,tr(`в BMS ${this.lim.uv2}–${this.lim.ov2} мВ — не похоже на ${C.name}`,`BMS ${this.lim.uv2}–${this.lim.ov2} mV does not match ${C.name}`));
  const spTag=atRest?tr(' (в покое ≥30 с)',' (at rest ≥30 s)'):(underLoad?tr(` (под нагрузкой ${d.I.toFixed(1)} А — возможен вклад R_вн)`,` (under ${d.I.toFixed(1)} A load — IR drop possible)`):'');
  add('Перекос ячеек',sp>=SPREAD_BAD?2:sp>=SPREAD_WARN?1:0,tr(`${sp} мВ (макс яч. ${cs.indexOf(mx)+1}, мин яч. ${cs.indexOf(mn)+1})`,`${sp} mV (max cell ${cs.indexOf(mx)+1}, min cell ${cs.indexOf(mn)+1})`)+spTag);
  if(this.ir){const v=this.ir.filter(x=>x!=null);if(v.length){const s=[...v].sort((a,b)=>a-b),med=s[s.length>>1],bad=this.ir.map((r,i)=>r!=null&&r>1.5&&r>med*2?i+1:0).filter(Boolean);
   if(bad.length)add('Сопротивление ячеек',1,tr(`повышено на яч. ${bad.join(', ')}: ${bad.map(i=>this.ir[i-1]+' мОм').join(', ')} (медиана ${med.toFixed(2)})`,`high on cell ${bad.join(', ')}: ${bad.map(i=>this.ir[i-1]+' mΩ').join(', ')} (median ${med.toFixed(2)})`))}}
  if(d.tmax!=null)add('Температура',d.tmax>=T_BAD||d.tmin<0?2:d.tmax>=T_WARN?1:0,`${d.tmin}…${d.tmax} °C`);
  const fl=decodeFaults(d.fault),hard=fl.filter(x=>!SOFT.some(k=>x.startsWith(k)));
  add('Защиты BMS',hard.length?2:0,fl.length?fl.join('; ')+(hard.length?'':tr(' (SOC не откалиброван, не критично)',' (SOC not calibrated, not critical)')):tr('нет','none'));
  const sl=this.slope(d.t),stuckChg=h3.length===3&&h3.every(h=>h.chg===0&&h.I>1),stuckDis=h3.length===3&&h3.every(h=>h.dis===0&&h.I<-1);
  if(stuckChg)add('Ключ заряда',2,tr(`ключ заряда ВЫКЛ, но ток заряда ${d.I.toFixed(1)} А — возможно пробит/залип ключ`,`charge switch is OFF, yet charge current is ${d.I.toFixed(1)} A — MOSFET may be shorted/stuck`));
  else if(d.charger&&!d.chg)add('Ключ заряда',2,tr('зарядное подключено, а ключ заряда ВЫКЛ','charger is connected but the charge switch is OFF'));else add('Ключ заряда',d.chg?0:1,d.chg?tr('вкл','on'):tr('выкл (зарядное не обнаружено)','off (no charger detected)'));
  if(stuckDis)add('Ключ разряда',2,tr(`ключ разряда ВЫКЛ, но ток разряда ${(-d.I).toFixed(1)} А — возможно пробит/залип ключ`,`discharge switch is OFF, yet discharge current is ${(-d.I).toFixed(1)} A — MOSFET may be shorted/stuck`));
  if(d.I>.3)add('Заряд идёт',0,tr(`ток ${d.I.toFixed(1)} А`,`current ${d.I.toFixed(1)} A`));
  else if(!d.charger)add('Заряд идёт',0,d.I<-.3?tr(`разряд ${(-d.I).toFixed(1)} А`,`discharging ${(-d.I).toFixed(1)} A`):tr('покой (зарядное не подключено)','idle (no charger)'));
  else if(sl==null)add('Заряд идёт',0,tr('копится история (нужно 2 мин)','collecting history (needs 2 min)'));
  else if(sl>=RISE_MIN)add('Заряд идёт',0,tr(`сумма ячеек растёт +${sl.toFixed(1)} мВ/мин`,`cell sum rising +${sl.toFixed(1)} mV/min`));
  else if(mx>=C.top)add('Заряд идёт',0,tr('ячейки у верха, рост остановился (CV или конец)','cells are at the top, rise has stopped (CV or finished)'));
  else add('Заряд идёт',1,tr(`нет роста напряжения за 5 мин (${sl.toFixed(1)} мВ/мин): заряд не идёт или завершён`,`no voltage rise in 5 min (${sl.toFixed(1)} mV/min): not charging or finished`));
  const p120=this.hist.filter(h=>h.t>=d.t-120),dvPack=(p120.length>=30&&d.t-p120[0].t>=115&&p120.every(h=>h.I===0))?Math.abs(d.sum-p120[0].sum)*1000:0;
  if(dvPack>80)add('Малый ток (мёртвая зона)',1,tr(`ток 0 А ≥2 мин, но напряжение сборки изменилось на ${dvPack.toFixed(0)} мВ — возможен скрытый ток ниже порога датчика`,`current 0 A for ≥2 min, yet pack voltage shifted by ${dvPack.toFixed(0)} mV — hidden current below shunt deadband`));
  add('Обрыв заряда',Date.now()<this.badUntil?2:0,Date.now()<this.badUntil?tr('недавно напряжение упало: заряд оборвался (см. события)','voltage dropped recently: charging was interrupted (see events)'):tr('не было','none'));
  if(d.I>.3){const cr=d.I/this.cap;add('Ток заряда',d.I>60?2:cr>.5?1:0,tr(`${d.I.toFixed(1)} А = ${cr.toFixed(2)}C (норма 0,1–0,3C = ${(.1*this.cap).toFixed(0)}–${(.3*this.cap).toFixed(0)} А)`,`${d.I.toFixed(1)} A = ${cr.toFixed(2)}C (normal 0.1–0.3C = ${(.1*this.cap).toFixed(0)}–${(.3*this.cap).toFixed(0)} A)`))}
  if(mx>=C.top)add('Балансировка у верха',sp<=TOP_SPREAD?0:1,tr(`перекос ${sp} мВ, цель ≤${TOP_SPREAD}; балансир ${d.bal.some(x=>x)?'работает':'не включён'}`,`spread ${sp} mV, target ≤${TOP_SPREAD}; balancer ${d.bal.some(x=>x)?'active':'off'}`));
  return ck}
 detect(d){const p=this.prev;if(p&&!d.asleep&&!p.asleep){[['chg',tr('ключ заряда','charge switch')],['dis',tr('ключ разряда','discharge switch')],['charger',tr('зарядное','charger')]].forEach(([k,nm])=>{if(d[k]!==p[k]&&d[k]!=null)this.event(k!=='chg'||d[k]?1:2,`${nm}: ${d[k]?tr('вкл','on'):tr('выкл','off')}`)});
   if(String(d.fault)!==String(p.fault)){const fl=decodeFaults(d.fault);this.event(fl.some(x=>!SOFT.some(k=>x.startsWith(k)))?2:1,tr('защиты: ','protections: ')+(fl.join('; ')||tr('сняты','cleared')))}
   const old=this.hist.find(h=>h.sum&&h.t>=d.t-70&&h.t<=d.t-50),sm=d.cells.length?d.cells.reduce((a,b)=>a+b,0)/1000:0;
   if(d.cells.length&&old&&old.sum-sm>=DROP_V&&(p.chg||d.I>.3||p.I>.3)){this.event(2,tr(`заряд оборвался: сумма ячеек упала на ${(old.sum-sm).toFixed(2)} В за минуту`,`charging interrupted: cell sum dropped by ${(old.sum-sm).toFixed(2)} V in a minute`));this.badUntil=Date.now()+600000}}
  if(p&&d.asleep!==p.asleep)this.event(1,d.asleep?tr('BMS уснула','BMS fell asleep'):tr('BMS проснулась','BMS woke up'))}
 estIR(d){const pts=this.hist.filter(h=>h.t>=d.t-150&&h.cells.length===d.cells.length&&Math.min(...h.cells)>=2700&&Math.max(...h.cells)<=3600);
  if(pts.length<15)return;const iv=pts.map(h=>h.I),im=iv.reduce((a,b)=>a+b,0)/iv.length,rng=Math.max(...iv)-Math.min(...iv);
  const sxx=iv.reduce((s,x)=>s+(x-im)*(x-im),0),std=Math.sqrt(sxx/iv.length);if(rng<8||std<2||!sxx)return;
  const res=d.cells.map((_,ci)=>{const vv=pts.map(h=>h.cells[ci]),vm=vv.reduce((a,b)=>a+b,0)/vv.length;
   let syy=0,sxy=0;for(let k=0;k<pts.length;k++){const dx=iv[k]-im,dy=vv[k]-vm;syy+=dy*dy;sxy+=dx*dy}
   if(!syy||sxy<=0||(sxy*sxy)/(sxx*syy)<.75)return null;
   const r=((syy-sxx)+Math.sqrt((syy-sxx)*(syy-sxx)+4*sxy*sxy))/(2*sxy);return r>=.1&&r<=15?+r.toFixed(2):null});
  if(res.filter(x=>x!=null).length>=Math.ceil(d.cells.length/2))this.ir=res}
 update(d){d.sum=d.cells.length?d.cells.reduce((a,b)=>a+b,0)/1000:0;
  if(this.prev&&!d.asleep){const dt=Math.min(d.t-this.prev.t,10);if(d.I>0)this.ahIn+=d.I*dt/3600;else this.ahOut+=-d.I*dt/3600}
  this.detect(d);this.hist.push(d);if(this.hist.length>1800)this.hist.shift();
  if(!d.asleep&&d.cells.length)this.estIR(d);
  this.checks=this.evaluate(d);this.level=Math.max(...this.checks.map(c=>c.level));
  if(!d.asleep&&d.cells.length&&d.t-this.longT>=LONG_STEP){this.longT=d.t;const flt=(d.fault||[]).map(b=>b.toString(16).padStart(2,'0')).join('');this.long.push([Math.round(d.t),d.I,d.cells,d.bal,{V:d.V,soc:d.soc,tmin:d.tmin,tmax:d.tmax,st:d.state,chg:d.chg,dis:d.dis,chgr:d.charger,load:d.load,cap:d.cap,flt:/^0*$/.test(flt)?'':flt}]);if(this.long.length>MAXLONG)this.long.shift();if(this.long.length%4===0)this.save()}
  this.prev=this.last=d;this.err=''}
 metrics(){const d=this.last;if(!d||d.asleep||!d.cells.length)return null;const C=this.C,cs=d.cells,I=d.I,mvA=735/this.cap;
  const avg=cs.reduce((a,b)=>a+b,0)/cs.length,soc=ocvSoc(C.ocv,(avg-mvA*Math.max(I,0))/1000);
  const pts=this.hist.filter(h=>h.t>=d.t-900);let phase=tr('нет заряда','not charging'),eta=null;
  if(I>.3){phase=tr('CC (постоянный ток)','CC (constant current)');const rem=(100-soc)/100*this.cap;eta=rem/I*60+60;
   if(pts.length>=40){const a=pts.slice(0,10).reduce((x,h)=>x+h.I,0)/10,b=pts.slice(-10).reduce((x,h)=>x+h.I,0)/10;
    if(b<a*.9&&Math.max(...cs)>=C.top-50&&b>0){phase=tr('CV (ток падает)','CV (current falling)');const k=Math.log(b/a)/((pts[pts.length-1].t-pts[0].t)/60),end=.03*this.cap;eta=b>end&&k<0?Math.max(0,Math.log(end/b)/k):0}}}
  const f=this.long[0],first=f?f[2]:null,i0=f?f[1]:0,s0=f?ocvSoc(C.ocv,(first.reduce((a,b)=>a+b,0)/first.length-mvA*Math.max(i0,0))/1000):0;
  const cur=this.long.map(x=>x[1]).filter(x=>x>.3).sort((a,b)=>a-b);
  return{phase,soc:Math.round(soc),eta:eta==null?null:Math.round(eta),cycles:d.cycles,cap:this.cap,n:cs.length,s0,iset:cur.length?cur[cur.length>>1]:0,ahIn:this.ahIn,ahOut:this.ahOut,capBms:d.cap}}
 csv(){const nc=Math.max(0,...this.long.map(x=>x[2].length)),h='time,I,sum_V,'+Array.from({length:nc},(_,i)=>'c'+(i+1)).join(',')+',V_bms,soc_bms,tmin,tmax,state,chg,dis,charger,load,cap_bms,bal,fault_hex\n';
  return h+this.long.map(x=>{const m=x[4]||{},b=(x[3]||[]).map((v,i)=>v?i+1:0).filter(Boolean).join(';');return[new Date(x[0]*1000).toISOString(),x[1],(x[2].reduce((a,b)=>a+b,0)/1000).toFixed(3),...x[2],m.V??'',m.soc??'',m.tmin??'',m.tmax??'',m.st??'',m.chg??'',m.dis??'',m.chgr??'',m.load??'',m.cap??'',b,m.flt??''].join(',')}).join('\n')+'\n\nevents\n'+this.events.map(e=>[e.t,e.level,'"'+e.text+'"'].join(',')).join('\n')}
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
 const tx=o.xt||4;for(let i=0;i<=tx;i++){const v=o.x[0]+(o.x[1]-o.x[0])*i/tx;g.fillStyle=col('--mut');g.textAlign=i==tx?'right':i==0?'left':'center';g.fillText(v.toFixed(1)+tr(' ч',' h'),X(v),h-5)}
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
 q('.bclr').onclick=()=>{if(confirm(tr('Стереть историю и события этой BMS?','Erase the history and events of this BMS?'))){dv.long=[];dv.events=[];dv.ahIn=dv.ahOut=0;dv.t0=Date.now();dv.save()}};
 q('.bchg').onclick=()=>{const on=!(dv.last&&dv.last.chg);if(confirm(on?tr('Включить (открыть) ключ заряда на BMS?','Turn ON (enable) the charge switch on BMS?'):tr('Выключить (закрыть) ключ заряда? Зарядка прекратится.','Turn OFF (disable) the charge switch? Charging will stop.')))dv.cmd(0xDA,on?1:0,tr('команда: ключ заряда ','command: charge switch ')+(on?tr('вкл','on'):tr('выкл','off')))};
 q('.bdisw').onclick=()=>{const on=!(dv.last&&dv.last.dis);if(confirm(on?tr('Включить (открыть) ключ разряда на BMS?','Turn ON (enable) the discharge switch on BMS?'):tr('Выключить (закрыть) ключ разряда? Нагрузка будет обесточена.','Turn OFF (disable) the discharge switch? Load will be disconnected.')))dv.cmd(0xD9,on?1:0,tr('команда: ключ разряда ','command: discharge switch ')+(on?tr('вкл','on'):tr('выкл','off')))};
 q('.brst').onclick=()=>{if(confirm(tr('Перезагрузить (сбросить) BMS? Связь кратковременно прервётся.','Reboot (reset) the BMS? Connection will briefly drop.')))dv.cmd(0x00,0,tr('команда: сброс BMS','command: BMS reset'))};
 const file=()=>new File([dv.csv()],`daly_${dv.name}_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.csv`,{type:'text/csv'});
 q('.bcsv').onclick=()=>{const f=file(),a=document.createElement('a');a.href=URL.createObjectURL(f);a.download=f.name;a.click()};
 q('.bshare').onclick=async()=>{const f=file();try{if(navigator.canShare&&navigator.canShare({files:[f]}))await navigator.share({files:[f],title:'Daly BMS'});else q('.bcsv').click()}catch(e){}};
 const SH=JSON.parse(localStorage.getItem('daly2:shut')||'{}');
 el.querySelectorAll('.card>h2').forEach(h=>{const c=h.parentElement,k=h.textContent.trim();if(SH[k]===undefined?(/Перекос|Ресурс/.test(k)&&matchMedia('(max-width:600px)').matches):SH[k])c.classList.add('shut');
  h.onclick=()=>{c.classList.toggle('shut');SH[k]=c.classList.contains('shut');try{localStorage.setItem('daly2:shut',JSON.stringify(SH))}catch(e){}if(!c.classList.contains('shut'))devs.forEach(upd)}});
 trDom(el);
 const P={el,q};panels.set(dv.id,P);return P}
function upd(dv){const P=panels.get(dv.id)||mk(dv),q=P.q,d=dv.last,I=dv.metrics(),lv=!dv.online?2:(dv.last?dv.level:3);
 q('.ban').className='ban l'+lv;q('.nm').textContent=dv.name;q('.st').textContent=!dv.last&&dv.online?tr('ЖДУ ДАННЫЕ','WAITING FOR DATA'):L[lv==3?1:lv];
 q('.pc').textContent=I?I.soc:'–';q('.g1').setAttribute('stroke-dasharray',(I?I.soc:0)+' 100');
 q('.eta').textContent=!dv.online?(tr('Нет связи','No connection')+(dv.err?': '+dv.err:'')+tr(' — закройте Smart BMS, поднесите телефон ближе или подключите зарядку на 2 с',' — close Smart BMS app, move closer, or connect charger for 2 s')):(I&&I.eta!=null?`${tr('До конца заряда','Time to full')} ≈ ${fh(I.eta)} (${tr('к','by')} ${new Date(Date.now()+I.eta*60000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}) · ${I.phase}`:(I?I.phase:''));
 q('.kp').innerHTML=d?`<div><b>${d.V.toFixed(1)} ${uV}</b>${tr('сборка','pack')}</div><div><b>${d.I.toFixed(1)} ${uA}</b>${tr('ток','current')}</div><div><b>${d.tmax??'—'} °C</b>${tr('температура','temperature')}</div>`:'';
 q('.cloud').textContent=cloudLine(dv);
 q('.bchg').textContent=tr('Ключ заряда','Charge switch')+(d&&d.chg!=null?': '+(d.chg?tr('ВКЛ','ON'):tr('ВЫКЛ','OFF')):'');
 q('.bdisw').textContent=tr('Ключ разряда','Discharge switch')+(d&&d.dis!=null?': '+(d.dis?tr('ВКЛ','ON'):tr('ВЫКЛ','OFF')):'');
 q('.chips').innerHTML=dv.checks.map(c=>`<span class="chip c${c.level}"><i></i>${esc(c.name)}</span>`).join('');
 q('.issues').innerHTML=dv.checks.filter(c=>c.level>0).map(c=>`<div class="i${c.level}">${esc(c.name)}: ${esc(c.text)}</div>`).join('');
 if(d&&d.cells.length){const C=dv.C,cs=d.cells,mx=Math.max(...cs),mn=Math.min(...cs),m=cs.reduce((a,v)=>a+v,0)/cs.length,lo=C.loBad+200,hi=C.vmax+50,pos=v=>Math.max(0,Math.min(100,(v-lo)/(hi-lo)*100));
  q('.bats').innerHTML=cs.map((v,i)=>`<div class="b1 ${v===mx&&mx!==mn?'mx':v===mn&&mx!==mn?'mn':''}"><div class="tube"><i style="height:${pos(v)}%"></i><u style="bottom:${pos(m)}%"></u></div><b>${(v/1000).toFixed(3)}</b><span>${i+1}${d.bal&&d.bal[i]?' <em class="bal">⚖</em>':''}</span></div>`).join('')}
 q('.res').innerHTML=I?`<div><b>${I.cycles??'—'}</b>${tr('циклов (типовой ресурс ~3000)','cycles (typical life ~3000)')}<div class="rb"><i style="width:${Math.min(100,(I.cycles||0)/3000*100)}%"></i></div></div><div><b>${I.ahIn.toFixed(2)}</b>${tr('принято А·ч','charged, Ah')}</div><div><b>${I.ahOut.toFixed(2)}</b>${tr('отдано А·ч','discharged, Ah')}</div><div><b>${I.capBms??'—'}</b>${tr('остаток по BMS, А·ч','remaining per BMS, Ah')}</div>`
  +(dv.ir?`<div><b>${dv.ir.map(r=>r??'—').join(' / ')}</b>${tr('R_вн ячеек, мОм','cell IR, mΩ')}</div>`:'')
  +(dv.lim?`<div><b>${dv.lim.uv2}–${dv.lim.ov2}</b>${tr('пороги BMS, мВ','BMS limits, mV')}</div>`:'')
  +(dv.rcap||dv.sn?`<div><b>${[dv.rcap?dv.rcap+' А·ч':'',dv.sn].filter(Boolean).join(' · ')}</b>${tr('паспорт BMS','BMS info')}</div>`:''):'';
 q('.evl').innerHTML=dv.events.slice(0,15).map(e=>`<div class="e${e.level}">${esc(e.t.slice(5))}  ${esc(e.text)}</div>`).join('')||tr('пока нет','none yet');
 charts(dv,I,P)}
function charts(dv,I,P){const q=P.q,lg=dv.long;if(!I||lg.length<2)return;const C=dv.C,t0=lg[0][0],sum=p=>p[2].reduce((a,v)=>a+v,0)/1000,
 act=lg.map(p=>[(p[0]-t0)/3600,sum(p)]),cur=lg.map(p=>[(p[0]-t0)/3600,p[1]]),spr=lg.map(p=>[(p[0]-t0)/3600,Math.max(...p[2])-Math.min(...p[2])]),
 id=ideal(I,C),xn=act[act.length-1][0],xmax=Math.max(id.tEnd,xn)*1.03||1,n=I.n,vm=C.vmax/1000,vlo=C.ocv[0][0];
 plot(q('.cV'),{x:[0,xmax],y:[n*vlo,n*(vm+.1)],yf:v=>v.toFixed(0)+' '+uV,now:xn,bands:[{y0:n*vm,y1:n*(vm+.1),c:'rgba(198,40,40,.10)'}],
  lines:[{pts:[[0,n*vm],[xmax,n*vm]],c:'--bad',w:1,d:[6,4]},{pts:id.V,c:'--acc2',d:[7,5],w:2},{pts:act,c:'--acc',w:2.5}]});
 plot(q('.cI'),{x:[0,xmax],y:[0,Math.max(id.iset*1.25,...cur.map(p=>p[1]),1)],yf:v=>v.toFixed(0)+' '+uA,now:xn,yt:3,lines:[{pts:id.A,c:'--acc2',d:[7,5],w:2},{pts:cur,c:'--acc',w:2.5}]});
 heat(q('.heat'),lg,n);
 plot(q('.spr'),{x:[0,xmax],y:[0,200],yf:v=>v.toFixed(0)+' '+umV,now:xn,bands:[{y0:0,y1:30,c:'rgba(46,125,50,.18)'},{y0:30,y1:150,c:'rgba(194,122,0,.10)'},{y0:150,y1:200,c:'rgba(198,40,40,.12)'}],
  lines:[{pts:[[0,100],[id.tEnd*.7,100],[id.tEnd,30]],c:'--acc2',d:[7,5],w:2},{pts:spr,c:'--acc',w:2.5}]})}

async function addDevice(all){audio();try{Notification.requestPermission&&Notification.requestPermission()}catch(e){}
 try{const opt=all?{acceptAllDevices:true,optionalServices:[SVC,SVC2]}:{filters:[{namePrefix:'DL-'},{services:[SVC]},{services:[SVC2]}],optionalServices:[SVC,SVC2]};
  const device=await navigator.bluetooth.requestDevice(opt);
  if(devs.has(device.id)){const o=devs.get(device.id);if(!o.running){o.want=true;o.reconnect()}glog(tr('уже добавлена: ','already added: ')+o.name);return}
  const dv=new Dev(device);devs.set(device.id,dv);$('hero').style.display='none';upd(dv);glog(tr('подключаю ','connecting ')+dv.name+tr(', в истории ',', history: ')+dv.long.length+tr(' точек',' points'));
  try{await dv.connect()}catch(e){dv.err=String(e.message||e);glog(dv.name+': '+dv.err);dv.reconnect()}
 }catch(e){glog(tr('не подключилось: ','could not connect: ')+e.message);if(/not supported on this platform/i.test(e.message))$('sup').innerHTML=tr('<b>Этот браузер не поддерживает Bluetooth.</b> Откройте ссылку в Google Chrome (не во встроенном браузере телефона, не в Яндексе, Samsung Internet или Telegram). В Android включите Bluetooth и геолокацию, дайте Chrome разрешение «Устройства поблизости».','<b>This browser does not support Bluetooth.</b> Open the link in Google Chrome (not in an in-app browser, Yandex, Samsung Internet or Telegram). On Android turn on Bluetooth and location and allow Chrome the "Nearby devices" permission.')}}
$('add').onclick=()=>addDevice(false);$('addall').onclick=()=>addDevice(true);
const ua=navigator.userAgent,isIOS=/iPhone|iPad|iPod/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const badBrowser=isIOS||!navigator.bluetooth||!/Chrome\/|Edg\//i.test(ua)||/SamsungBrowser|YaBrowser|OPR\/|UCBrowser|MiuiBrowser|VivoBrowser|; wv\)|Telegram|FB_IAB|FBAN/i.test(ua);
const DICT={'Daly BMS монитор':'Daly BMS Monitor','Подключите Daly BMS':'Connect your Daly BMS','Включите BMS и закройте приложение Smart BMS.':'Turn the BMS on and close the Smart BMS app.','⚡ Ячейки':'⚡ Cells','⏱ CC / CV':'⏱ CC / CV','🛡 Защиты':'🛡 Protections','Подключить BMS':'Connect BMS','Демо без BMS':'Demo without a BMS','Все Bluetooth-устройства':'All Bluetooth devices','Журнал':'Log','заряд, ≈%':'charge, ≈%','Заряд: идеал и сейчас':'Charge: ideal vs now','сейчас':'now','идеал':'ideal','предел ячейки':'cell limit','Ячейки и балансировка':'Cells and balancing','■ выше среднего':'■ above average','■ ниже среднего':'■ below average','⚖ балансир работает':'⚖ balancing active','Перекос ячеек':'Cell spread','■ цель ≤30 мВ':'■ target ≤30 mV','■ допуск ≤150':'■ limit ≤150','Ресурс':'Lifetime','Настройки и данные':'Settings and data','Химия':'Chemistry','Ёмкость, А·ч':'Capacity, Ah','Скачать CSV':'Download CSV','Поделиться':'Share','Отправить сейчас':'Upload now','Очистить историю':'Clear history','Отключить':'Disconnect','Управление BMS:':'BMS control:','Ключ заряда':'Charge switch','Ключ разряда':'Discharge switch','Сброс BMS':'Reset BMS','Ёмкость нужна для оценки времени до конца заряда и «идеальной» кривой. Химия задаёт предел ячейки (3,65 В для LiFePO4, 4,2 В для NMC).':'Capacity is used for the time-to-full estimate and the "ideal" curve. Chemistry sets the cell limit (3.65 V for LiFePO4, 4.2 V for NMC).','События':'Events'};
function trDom(root){if(LANG==='ru')return;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const s=n.nodeValue.trim();if(DICT[s])n.nodeValue=n.nodeValue.replace(s,DICT[s])}}
document.documentElement.lang=LANG;trDom(document.body);
if(LANG==='en'){document.title='Daly BMS Monitor';const m=document.querySelector('meta[name=description]');if(m)m.content='Daly Smart BMS monitor over Bluetooth: charge charts, cells, balancing, checks.'}
$('lang').textContent=LANG==='ru'?'EN':'RU';
$('lang').onclick=()=>{try{localStorage.setItem('daly2:lang',LANG==='ru'?'en':'ru')}catch(e){}const q=new URLSearchParams(location.search);q.delete('lang');location.search=q.toString()};
if(badBrowser){
 const msg=isIOS?tr('На iPhone и iPad работа с Bluetooth (Web Bluetooth) в браузерах, включая Chrome, не поддерживается. Откройте сайт в Google Chrome на Android или в Chrome / Edge на компьютере.','On iPhone and iPad, Web Bluetooth is not supported in browsers (including Chrome). Open this site in Google Chrome on Android or in Chrome / Edge on a computer.')
  :tr('Этот браузер не поддерживается. Откройте сайт в Google Chrome на Android или в Chrome / Edge на компьютере.','This browser is not supported. Open this site in Google Chrome on Android or in Chrome / Edge on a computer.');
 document.querySelectorAll('#root,body>details').forEach(e=>e.remove());
 $('hero').innerHTML=`<h2>${tr('Откройте в Google Chrome','Open in Google Chrome')}</h2><p class="note">${msg}</p>`;
}else{
 setInterval(uploadAll,60000);
 setInterval(()=>devs.forEach(upd),2000);
 addEventListener('beforeunload',()=>devs.forEach(d=>d.save()));
}
setInterval(()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');$('clock').textContent=`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(Math.floor(d.getMilliseconds()/10))}`},50);
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(()=>{});

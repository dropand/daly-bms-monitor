'use strict';
// Демо-режим: имитация зарядки LiFePO4 8S без железа. В localStorage не пишет, в облако не отправляет.
const DEMO={n:8,cap:105,iset:21,dev:[0,4,12,-2,3,-10,1,-5],vcv:3.55};   // dev: отклонения ячеек, мВ
function demoD(st,t,dt){const C=CHEM.lfp,mvA=735/DEMO.cap/1000;
 st.s=Math.min(99.5,st.s+st.I*dt/3600/DEMO.cap*100);
 const vc=ocvV(C.ocv,st.s)+mvA*st.I;
 if(st.cv||vc>=DEMO.vcv){st.cv=true;st.I=Math.max(.03*DEMO.cap,st.I*Math.exp(-dt/1200))}
 const base=Math.min(vc,DEMO.vcv)*1000,cells=DEMO.dev.map(o=>Math.round(base+o+Math.random()*2-1)),
  avg=cells.reduce((a,b)=>a+b,0)/cells.length,hi=avg>=C.top;
 return{t,V:cells.reduce((a,b)=>a+b,0)/1000,I:+st.I.toFixed(1),soc:Math.round(st.s*10)/10,tmax:Math.round(27+st.s/20),tmin:Math.round(25+st.s/25),
  state:1,chg:1,dis:1,cap:+(st.s/100*DEMO.cap).toFixed(1),n:DEMO.n,charger:1,load:0,cycles:142,cells,
  bal:cells.map(v=>hi&&v>avg+5?1:0),fault:[0,0,0,0,0,0,0,0],asleep:false}}
class DemoDev extends Dev{
 constructor(){super({id:'demo',name:tr('DEMO (симуляция)','DEMO (simulated)'),addEventListener(){}});this.demo=true;this.chem='lfp';this.cap=DEMO.cap}
 save(){}
 start(){const st={s:40,I:DEMO.iset,cv:false},T=Date.now()/1000-7200;
  for(let k=0;k<3600;k++)this.update(demoD(st,T+k*2,2));   // 2 часа «прошлого», чтобы графики не были пустыми
  this.setOnline(true);this.running=true;
  this.timer=setInterval(()=>this.update(demoD(st,Date.now()/1000,2)),2000)}
 stop(){clearInterval(this.timer);this.running=false}}
function exitDemo(dv){dv.stop();devs.delete('demo');const P=panels.get('demo');if(P)P.el.remove();panels.delete('demo');$('hero').style.display=''}
$('demo').onclick=()=>{if(devs.has('demo'))return;const dv=new DemoDev();devs.set('demo',dv);$('hero').style.display='none';dv.start();upd(dv);
 panels.get('demo').q('.bdis').onclick=()=>exitDemo(dv);toast(tr('Демо: данные симулируются, BMS не нужна','Demo: data is simulated, no BMS needed'),'ok')};
if(/[?&]demo\b/.test(location.search))$('demo').click();

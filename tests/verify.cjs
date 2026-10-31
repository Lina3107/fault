'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8').split('buildInterface();renderControls();syncPlay();fitInstrument();')[0];
function fixture(){
 const nodes=new Map(),events=[],changes=[];
 const element=s=>{if(!nodes.has(s))nodes.set(s,{style:{setProperty(){}},classList:{toggle(){}},setAttribute(k,v){this[k]=v;},textContent:''});return nodes.get(s);};
 const ctx=vm.createContext({console,document:{querySelector:element,querySelectorAll:()=>[]},window:{},requestAnimationFrame:()=>0,events,changes});
 vm.runInContext(source,ctx);
 vm.runInContext(`
 window.Tone=Tone={now:()=>0,getDraw:()=>({schedule:fn=>fn()}),Time:()=>({toSeconds:()=>60/108/2})};
 const param=name=>({rampTo:(value,duration,time)=>changes.push({name,value,duration,time})});
 audio={transport:{state:'started',position:0,stop(){this.state='stopped';},pause(){this.state='paused';},start(){this.state='started';}},
  synths:[0,1].map(i=>({set:settings=>changes.push({name:'wave'+i,value:settings.oscillator.type}),triggerAttackRelease:(note,duration,time,velocity)=>events.push({kind:'voice',i,note,time,velocity,tick:state.ticks}),triggerRelease(){}})),
  appliedWaves:['triangle','sine'],voiceChannels:[0,1].map(i=>({volume:param('volume'+i)})),
  effects:[0,1,2,3].map(i=>({wet:param('fx'+i)})),master:{gain:param('master')},
  drums:[0,1,2,3].map(i=>({triggerAttackRelease:(...args)=>events.push({kind:'drum',i,args,tick:state.ticks})}))};
 state.playing=true;
 `,ctx);
 return {run:code=>vm.runInContext(code,ctx),events,changes,nodes};
}
(async()=>{
 {
  const f=fixture();f.run('selectWave(0,"square");');
  assert.equal(f.changes.length,0,'A UI click must not interrupt a held oscillator.');
  f.run('state.ticks=1;scheduleStep(1);');
  assert.equal(f.changes.filter(x=>x.name==='wave0').length,0,'Do not change waveform on a melodic rest.');
  f.run('state.ticks=3;scheduleStep(3);');
  assert.equal(f.changes.filter(x=>x.name==='wave0').length,1,'Apply wave at the next melodic note.');
  f.run('state.voices[0].volume=63;setVoiceVolume(0,4);applyEffects(4);prepareVoice(0,5);');
  assert.equal(f.changes.filter(x=>x.name.startsWith('wave')).length,1,'Volume and FX do not reset oscillators.');
  f.run('state.voices[0].volume=0;setVoiceVolume(0,6);');
  assert.equal(f.changes.filter(x=>x.name==='volume0').at(-1).value,-Infinity,'Zero volume must silence the voice.');
  f.run('state.effects[0].enabled=true;applyEffects(7);');
  assert.equal(f.changes.filter(x=>x.name==='fx0').at(-1).value,.18);
  assert.equal(f.changes.filter(x=>x.name==='fx0').at(-1).time,7);
  f.run('state.effects[0].enabled=false;applyEffects(8);');
  assert.equal(f.changes.filter(x=>x.name==='fx0').at(-1).value,0);
 }
 {
  const f=fixture();f.run('for(let i=0;i<44;i++)scheduleStep(i);');
  for(let i=0;i<2;i++)assert(f.events.some(e=>e.kind==='voice'&&e.i===i));
  for(let i=0;i<4;i++)assert(f.events.some(e=>e.kind==='drum'&&e.i===i));
  assert(f.events.filter(e=>e.kind==='voice'&&e.i===1).every(e=>[0,3,7,10].includes(e.tick%11)));
  assert.equal(f.run('state.drums.every(pattern=>pattern.length===11)'),true);
  const start=f.events.length;
  f.run('state.drumMuted[2]=true;for(let i=0;i<44;i++)scheduleStep(i);');
  assert(!f.events.slice(start).some(e=>e.kind==='drum'&&e.i===2));
  const before=f.run('JSON.stringify(state.drums[2])');
  f.run('state.drumMuted[2]=false;');
  assert.equal(f.run('JSON.stringify(state.drums[2])'),before,'Muting preserves editable hits.');
 }
 {
  const f=fixture();f.run('state.effects[1].enabled=true;selectWave(0,"sawtooth");for(let i=0;i<600;i++)scheduleStep(i);');
  assert.equal(f.run('state.playing'),true,'No automatic ending.');
  assert.equal(f.run('state.effects[1].enabled'),true,'No automated parameter changes.');
  assert.equal(f.run('state.voices[0].wave'),'sawtooth');
  f.run('stopPlayback();');
  assert.equal(f.run('state.ticks'),0);
  assert.equal(f.run('state.playing'),false);
  assert.equal(f.run('state.effects[1].enabled'),true,'Stop preserves performer settings.');
 }
 {
  const f=fixture();f.run('state.playing=false;initAudio=()=>new Promise(resolve=>{window.finishInit=resolve;});');
  const pending=f.run('togglePlay()');f.run('stopPlayback();window.finishInit();');await pending;
  assert.equal(f.run('state.playing'),false,'Stop during audio initialization cancels pending Play.');
 }
 console.log('PASS: note-boundary wave changes, independent volume, silence at zero, timed FX/bypass, six sources, eleven-step sync, drum mute, no automatic performance, Stop/reset and initialization cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1;});

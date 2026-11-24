import {get,post} from "../api.js";
import {escapeText} from "../ui.js";
import {getSettings,useGameMusic,setMusicEnabled} from "../pages/settings.js";
import {GameAudio,spatialAudio} from "./game-audio.js";
import {ArenaScene} from "./arena-scene.js";
const API="/api/arcade/arena",clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const icons={
 back:'<path d="m14 5-7 7 7 7M7 12h13"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2.5M12 17h.01"/>',
 sound:'<path d="M9 18V6l10-2v12M9 9l10-2"/><ellipse cx="6.5" cy="18.5" rx="2.6" ry="1.9"/><ellipse cx="16.5" cy="16.5" rx="2.6" ry="1.9"/>',
 fire:'<circle cx="12" cy="12" r="6"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
 board:'<path d="M5 20V10h4v10m2 0V4h4v16m2 0v-7h4v7M3 20h20"/>',
};
const svg=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
const modes={duel:["1 × 1","Дуэль","7 устранений · 3 минуты"],teams:["2 × 2","Команды","15 устранений · 4 минуты"],waves:["Волны","Оборона","6 волн · вся команда против снеговиков"]};
const names={pistol:"Снежный пистолет",rapid:"Ледяной автомат",spread:"Снежный дробовик",cannon:"Морозная пушка",heal:"Аптечка · +28 здоровья",shield:"Щит · 3 секунды"};
export class SnowArena{
 constructor(modal,registerCleanup){
  this.modal=modal;this.root=modal.querySelector(".arena-screen");this.canvas=modal.querySelector(".arena-canvas");
  this.layer=modal.querySelector(".arena-layer");this.hud=modal.querySelector(".arena-hud");this.controls=modal.querySelector(".arena-controls");
  this.toastEl=modal.querySelector(".arena-toast");this.netEl=modal.querySelector("[data-arena=network]");
  this.hpEl=modal.querySelector("[data-arena=hp]");this.healthFill=modal.querySelector(".arena-health i");
  this.weaponEl=modal.querySelector("[data-arena=weapon]");this.ammoEl=modal.querySelector("[data-arena=ammo]");
  this.shieldEl=modal.querySelector(".arena-shield");this.scoreEl=modal.querySelector(".arena-score");
  this.timerEl=modal.querySelector("[data-arena=timer]");this.mini=modal.querySelector(".arena-minimap");
  this.miniCtx=this.mini.getContext("2d");this.musicButton=modal.querySelector("[data-action=music]");
  this.clock=0;this.lastFrame=0;this.lastSend=0;this.lastHud=0;this.seq=0;this.lastEvent=0;this.disposed=false;
  this.yaw=2.15;this.pitch=-.03;this.mode="teams";this.preferences=getSettings();this.phase="loading";this.keys=new Set();this.listeners=[];
  this.move={x:0,y:0};this.lookPointer=null;this.fire=false;this.fireLatchUntil=0;this.held=false;this.room=null;this.samples=[];
  this.music=useGameMusic(new URL("../media/arena/winter-breakbeat.mp3",import.meta.url).href);
  this.music.setLevel(.78);this.music.setPaused(false);
  this.sounds=new GameAudio({npc:true});this.sounds.unlock();this.footsteps=new Map();this.refreshMusic();
  this.listen(modal,"click",e=>{const button=e.target.closest("[data-action]");if(button&&!button.disabled)this.action(button.dataset.action,button);});
  this.listen(modal,"change",e=>{if(e.target.matches("[data-arena=bots]")&&this.room&&this.room.owner)this.command("/bots",{bots:e.target.checked});});
  this.listen(document,"keydown",e=>this.key(e,true),{capture:true});
  this.listen(document,"keyup",e=>this.key(e,false),{capture:true});
  this.listen(window,"blur",()=>this.stopInput());
  this.listen(document,"pointerlockchange",()=>{this.held=document.pointerLockElement===this.canvas;if(!this.held)this.stopInput();});
  this.listen(document,"mousemove",e=>{if(document.pointerLockElement===this.canvas&&this.isPlaying())this.turn(e.movementX,e.movementY);});
  this.listen(this.canvas,"contextmenu",e=>{if(this.isPlaying())e.preventDefault();});
  this.listen(this.canvas,"pointerdown",e=>{
   if(!this.isPlaying()||(e.pointerType==="mouse"&&e.button!==0))return;this.sounds.unlock();
   if(e.pointerType==="mouse"){this.startFiring();try{const p=this.canvas.requestPointerLock();p?.catch?.(()=>{});}catch(_){}}
   else if(e.clientX>this.canvas.getBoundingClientRect().left+this.canvas.clientWidth*.34){
    e.preventDefault();this.lookPointer={id:e.pointerId,x:e.clientX,y:e.clientY};this.canvas.setPointerCapture(e.pointerId);
   }
  },{passive:false});
  this.listen(this.canvas,"pointermove",e=>{
   if(this.lookPointer?.id===e.pointerId){this.turn(e.clientX-this.lookPointer.x,e.clientY-this.lookPointer.y,e.pointerType==="touch");this.lookPointer.x=e.clientX;this.lookPointer.y=e.clientY;}
  },{passive:true});
  const lookEnd=e=>{if(this.lookPointer?.id===e.pointerId)this.lookPointer=null;if(e.pointerType==="mouse")this.fire=false;};
  this.listen(this.canvas,"pointerup",lookEnd);this.listen(this.canvas,"pointercancel",lookEnd);
  this.joy=modal.querySelector(".arena-joystick");this.knob=this.joy.querySelector("i");
  this.listen(this.joy,"pointerdown",e=>{if(!this.isPlaying())return;e.preventDefault();this.joy.setPointerCapture(e.pointerId);this.joyPointer=e.pointerId;this.joystick(e);},{passive:false});
  this.listen(this.joy,"pointermove",e=>{if(this.joyPointer===e.pointerId)this.joystick(e);},{passive:true});
  const joyEnd=e=>{if(this.joyPointer===e.pointerId){this.joyPointer=null;this.move={x:0,y:0};this.knob.style.transform="translate(0,0)";}};
  for(const type of ["pointerup","pointercancel","lostpointercapture"])this.listen(this.joy,type,joyEnd);
  this.trigger=modal.querySelector(".arena-trigger");
  this.listen(this.trigger,"pointerdown",e=>{
   if(!this.isPlaying())return;e.preventDefault();this.sounds.unlock();this.trigger.setPointerCapture(e.pointerId);this.startFiring();this.trigger.classList.add("is-held");
  },{passive:false});
  const endFire=()=>{this.fire=false;this.trigger.classList.remove("is-held");};
  for(const type of ["pointerup","pointercancel","lostpointercapture"])this.listen(this.trigger,type,endFire);
  const prevent=e=>{if(e.cancelable)e.preventDefault();};
  this.listen(modal,"dblclick",prevent,{passive:false});
  for(const event of ["gesturestart","gesturechange","gestureend"])this.listen(modal,event,prevent,{passive:false});
  for(const target of [this.canvas,this.joy,this.trigger]){
   this.listen(target,"touchstart",prevent,{passive:false});
   this.listen(target,"touchend",prevent,{passive:false});
  }
  this.listen(this.trigger,"click",prevent,{passive:false});
  this.listen(this.canvas,"arena-graphics-lost",()=>this.showError("Видеоконтекст был потерян. Перезапусти арену."));
  if(window.ResizeObserver){this.observer=new ResizeObserver(()=>this.scene?.resize());this.observer.observe(this.canvas);}
  const resize=()=>{
   this.stopInput();
   if(this.resizeRAF)cancelAnimationFrame(this.resizeRAF);
   this.resizeRAF=requestAnimationFrame(()=>{this.resizeRAF=0;this.scene?.resize();});
  };
  this.listen(window,"resize",resize);
  if(window.visualViewport)this.listen(window.visualViewport,"resize",resize);
  registerCleanup(()=>this.destroy(),hidden=>this.visibility(hidden));
  this.viewportMeta=document.querySelector('meta[name="viewport"]');
  this.viewportPrevious=this.viewportMeta?.getAttribute("content");
  if(this.viewportMeta)this.viewportMeta.setAttribute("content","width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover");
  document.documentElement.classList.add("arena-active");
  this.boot();
 }
 listen(el,type,fn,options){el.addEventListener(type,fn,options);this.listeners.push(()=>el.removeEventListener(type,fn,options));}
 isPlaying(){return this.phase==="playing"&&this.room?.game?.phase==="playing"&&this.ws?.readyState===WebSocket.OPEN&&!this.overlay&&!this.disposed;}
 async boot(){
  this.layer.innerHTML='<section class="arena-panel"><span class="arena-kicker">ПОЛЯРНЫЙ ДВОР</span><h1>Готовим арену</h1><p>Подключаем зимний фронт…</p></section>';
  try{
   this.status=await get(API+"/status",{cache:false});if(this.disposed)return;
   this.scene=new ArenaScene(this.canvas,this.status.map,{reduceMotion:this.preferences.reduceMotion});
   this.raf=requestAnimationFrame(t=>this.frame(t));
   if(this.status.current){this.receive(this.status.current);this.connect();}
   else this.menu();
  }catch(error){if(!this.disposed)this.showError(error.message);}
 }
 setPhase(phase){
  if(this.phase===phase)return;
  this.phase=phase;this.root.dataset.phase=phase;
  if(["menu","lobby","finished","error"].includes(phase)){clearTimeout(this.toastTimer);this.toastEl.classList.remove("is-visible");}
  const active=["playing","countdown"].includes(phase);
  this.hud.hidden=!active;this.controls.hidden=!active;
  this.root.querySelector(".arena-crosshair").hidden=!active;
  if(!active)this.stopInput();
  this.music.setLevel(phase==="playing"?.32:.78);
  if(phase!=="playing")this.footsteps.clear();
 }
 menu(){
  this.room=null;this.samples=[];this.predicted=null;this.history=[];this.lobbyKey="";this.overlay=false;this.confirmLeave=false;this.displaced=false;this.setPhase("menu");
  this.netEl.textContent="3D · до 4 игроков";
  this.layer.innerHTML='<section class="arena-panel arena-intro"><h1>Фрост-пост</h1>'+
   '<div class="arena-modes">'+Object.entries(modes).map(([id,a])=>'<button class="arena-mode '+(this.mode===id?"is-selected":"")+'" data-action="mode" data-mode="'+id+'" aria-pressed="'+(this.mode===id)+'"><strong>'+a[0]+'</strong><span>'+a[1]+'</span></button>').join("")+'</div>'+
   '<label class="arena-bots"><span>Заполнять места ботами</span><input type="checkbox" data-arena="new-bots" checked role="switch"></label>'+
   '<button class="arena-primary" data-action="create">Создать комнату <span>→</span></button>'+
   '<div class="arena-join"><input type="text" maxlength="6" placeholder="КОД КОМНАТЫ" aria-label="Код комнаты" autocomplete="off" spellcheck="false"><button data-action="join" aria-label="Войти по коду">Войти</button></div>'+
   '<button class="arena-text-button" data-action="help">Правила</button></section>';
 }
 async action(name,el){
  this.sounds.unlock();this.sounds.play("click",{level:.44});
  if(name==="mode"){
   this.mode=el.dataset.mode;
   this.layer.querySelectorAll(".arena-mode").forEach(b=>{b.classList.toggle("is-selected",b===el);b.setAttribute("aria-pressed",String(b===el));});
   return;
  }
  if(name==="music"){setMusicEnabled(getSettings().musicPaused);this.refreshMusic();return;}
  if(name==="help"){this.help();return;}
  if(name==="resume"){this.overlay=false;this.confirmLeave=false;this.layer.innerHTML="";if(this.room?.game)this.receive(this.room,true);else if(this.room)this.lobby(true);else this.menu();return;}
  if(name==="score"){this.scoreboard();return;}
  if(name==="copy"){
   try{await navigator.clipboard.writeText(this.room.room);this.toast("Код комнаты скопирован");}
   catch(_){this.toast("Код комнаты: "+this.room.room);}return;
  }
  if(name==="quit"){
   if(this.room?.game&&this.room.game.phase!=="finished"&&!this.confirmLeave){this.confirmLeave=true;this.overlay=true;this.stopInput();this.unlockPointer();this.layer.innerHTML='<section class="arena-panel"><h2>Покинуть арену?</h2><p>Бой продолжится без тебя.</p><button class="arena-primary" data-action="exit-now">Покинуть матч</button><button class="arena-text-button" data-action="resume">Остаться</button></section>';return;}
   window.closeModal();return;
  }
  if(name==="exit-now"){window.closeModal();return;}
  if(name==="leave"){await this.leave();this.menu();return;}
  if(name==="reconnect"){this.retry=0;this.overlay=false;this.layer.innerHTML="";this.connect();return;}
  if(name==="restart"){this.reopen();return;}
  if(name==="team"){this.command("/team");return;}
  if(name==="lobby"){this.command("/lobby");return;}
  if(name==="start"){this.sounds.unlock();this.command("/start");return;}
  if(name==="create"){
   const bots=this.layer.querySelector("[data-arena=new-bots]").checked;
   await this.create("/rooms",{mode:this.mode,bots});return;
  }
  if(name==="join"){
   const code=this.layer.querySelector(".arena-join input").value.toUpperCase().replace(/\s/g,"");
   if(!/^[A-Z2-9]{6}$/.test(code)){this.toast("Введи код из шести символов");return;}
   await this.create("/join",{code});return;
  }
 }
 refreshMusic(){
  const enabled=!getSettings().musicPaused;this.musicButton.innerHTML=svg("sound");
  this.musicButton.classList.toggle("is-muted",!enabled);this.musicButton.setAttribute("aria-label",enabled?"Выключить музыку":"Включить музыку");
  this.musicButton.setAttribute("aria-pressed",String(enabled));
 }
 async create(path,body){
  if(this.busy)return;this.busy=true;this.sounds.unlock();
  const button=this.layer.querySelector('[data-action="'+(path==="/join"?"join":"create")+'"]');if(button)button.disabled=true;
  try{const room=await post(API+path,body);if(this.disposed){post(API+"/leave",{}).catch(()=>{});return;}this.receive(room);this.retry=0;await this.connect();}
  catch(error){
   if(error.status===409){try{const status=await get(API+"/status",{cache:false});if(status.current){this.receive(status.current);await this.connect();return;}}catch(_){}}
   this.toast(error.message);if(button)button.disabled=false;
  }
  finally{this.busy=false;}
 }
 async command(path,body={}){
  if(this.busy)return;this.busy=true;
  try{const response=await post(API+path,body);if(!this.disposed)this.receive(response);}
  catch(error){this.toast(error.message);}
  finally{this.busy=false;}
 }
 async connect(){
  if(this.connecting||this.disposed||!this.room)return;this.connecting=true;
  const generation=(this.generation||0)+1;this.generation=generation;this.netEl.textContent="Подключение…";
  try{
   const info=await post(API+"/ticket",{});if(this.disposed||generation!==this.generation)return;
   const url=new URL(info.path,location.href);url.protocol=location.protocol==="https:"?"wss:":"ws:";
   const ws=new WebSocket(url);this.ws=ws;
   ws.onopen=()=>{if(this.disposed){ws.close();return;}ws.send(JSON.stringify({ticket:info.ticket}));this.lastPacket=performance.now();};
   ws.onmessage=e=>{
    if(this.disposed||this.ws!==ws)return;
    let data;try{data=JSON.parse(e.data);}catch(_){return;}
    this.lastPacket=performance.now();this.retry=0;
    if(data.type==="state"){this.displaced=false;this.netEl.textContent="В сети";this.root.classList.remove("is-offline");this.receive(data);}
    else if(data.type==="left"){this.room=null;ws.close();this.menu();}
   };
   ws.onclose=e=>{
    if(this.disposed||this.ws!==ws)return;this.ws=null;this.stopInput();this.connecting=false;
    if(!this.room)return;
    this.netEl.textContent=e.code===4001?"Открыто другое окно":"Переподключение…";this.root.classList.add("is-offline");
    if(e.code===4001){this.displaced=true;this.overlay=true;this.layer.innerHTML='<section class="arena-panel"><h2>Игра в другом окне</h2><p>Одна комната — одно активное подключение на игрока.</p><button class="arena-primary" data-action="reconnect">Вернуться сюда</button><button class="arena-text-button" data-action="leave">Выйти из комнаты</button></section>';return;}
    this.retry=(this.retry||0)+1;
    if(this.retry<=6)this.reconnectTimer=setTimeout(()=>this.connect(),Math.min(4000,500*this.retry));
    else this.showError("Связь с ареной потеряна. Вернись в комнату или создай новую.");
   };
   ws.onerror=()=>{};
   if(!this.heartbeat)this.heartbeat=setInterval(()=>{
    if(this.ws?.readyState===WebSocket.OPEN){this.ws.send(JSON.stringify({type:"ping"}));if(performance.now()-this.lastPacket>6000)this.ws.close();}
   },4000);
  }catch(error){
   if(this.disposed)return;
   this.toast(error.message);
   if(error.status===404){this.room=null;this.menu();}
   else this.reconnectTimer=setTimeout(()=>this.connect(),1800);
  }finally{this.connecting=false;}
 }
 receive(data,force=false){
  if(this.disposed||data.type!=="state")return;
  const previous=this.room?.game,oldPhase=this.phase;this.room=data;this.mode=data.mode;
  const g=data.game;
  if(!g){this.samples=[];this.lastEvent=0;this.lobby(force||Boolean(previous));return;}
  if(!previous||g.tick<(previous.tick||0)){this.lastEvent=0;this.footsteps.clear();this.countNumber=null;this.lobbyKey="";this.predicted=null;this.history=[];this.overlay=false;this.samples=[];this.resultKey="";}
  const now=performance.now(),me=g.actors.find(p=>p.id===data.me);
  if(me){
   if(!this.predicted||Math.hypot(this.predicted.x-me.x,this.predicted.z-me.z)>2.2||(!previous?.actors.find(p=>p.id===data.me)?.hp&&me.hp>0)){
    this.predicted={x:me.x,z:me.z};this.history=[];
    this.yaw=Math.atan2(me.ax,-me.az);this.pitch=me.pitch||0;
   }else{
    const sample=this.history?.find(h=>h.seq===data.ack),ref=sample||this.predicted;
    const dx=clamp(me.x-ref.x,-.5,.5)*.55,dz=clamp(me.z-ref.z,-.5,.5)*.55;
    this.predicted.x+=dx;this.predicted.z+=dz;
    for(const h of this.history||[]){h.x+=dx;h.z+=dz;}
   }
  }
  this.samples.push({at:now,game:g});if(this.samples.length>5)this.samples.shift();
  for(const event of g.events||[]){
   if(event.id<=this.lastEvent)continue;this.lastEvent=event.id;this.scene?.addEvent(event,data.me);
   if(g.tick-(event.tick??g.tick)<=15)this.eventSound(event,g,me);
   if(event.kind==="hit"){
    if(event.actor===data.me){this.root.classList.add("is-hurt");clearTimeout(this.hurtTimer);this.hurtTimer=setTimeout(()=>this.root.classList.remove("is-hurt"),200);}
    else if(event.owner===data.me){this.root.classList.add("is-hit");clearTimeout(this.hitTimer);this.hitTimer=setTimeout(()=>this.root.classList.remove("is-hit"),160);}
   }
   if(event.kind==="pickup"&&event.actor===data.me){
    const label=event.item==="heal"?(event.healed>0?"Аптечка · +"+event.healed+" здоровья":"Аптечка подобрана · здоровье полное"):event.item==="shield"?"Щит включён · 3 секунды":"Подобрано: "+names[event.item];
    this.toast(label);this.root.classList.add("is-pickup");
    clearTimeout(this.pickupTimer);this.pickupTimer=setTimeout(()=>this.root.classList.remove("is-pickup"),350);
   }
   if(event.kind==="wave"){this.toast("Волна "+event.wave+" из 6");}
   if(event.kind==="enemy_spawn"&&event.boss)this.toast("Морозный великан на арене!");
   if(event.kind==="wave_clear")this.toast("Волна отбита · передышка 5 секунд");
   if(event.kind==="spawn_item"&&["rapid","spread","cannon"].includes(event.kind_name))this.toast(names[event.kind_name]+" на арене");
   if(event.kind==="down")this.killFeed(event);
  }
  if(g.phase==="countdown"&&Math.ceil(g.countdown)!==this.countNumber){
   this.countNumber=Math.ceil(g.countdown);this.sounds.play("countdown");
  }
  this.setPhase(g.phase);
  if(!this.overlay){
   if(g.phase==="countdown"&&(this.countdownRendered!==this.countNumber||force||oldPhase!=="countdown")){
    this.countdownRendered=this.countNumber;
    this.layer.innerHTML='<div class="arena-countdown"><strong>'+Math.ceil(g.countdown)+'</strong><span>'+modes[data.mode][1]+' · Полярный двор</span></div>';
   }else if(g.phase==="playing"&&(oldPhase!=="playing"||force))this.layer.innerHTML="";
   else if(g.phase==="finished")this.result();
  }
  if(g.phase!=="playing")this.unlockPointer();
 }
 eventSound(event, game, me) {
  const own=event.actor===me?.id;
  const actor=game.actors.find(p=>p.id===event.actor);
  const position=spatialAudio(me,event.x??actor?.x,event.z??actor?.z,this.yaw,19);
  const near=own?{level:.88,pan:0}:position;
  const play=(key,options=near)=>this.sounds.play(key,options);
  switch(event.kind){
   case "shot": play(event.weapon);break;
   case "hit":
    if(own)play("hurt");
    else if(event.owner===me?.id)play("hit",{level:.75});
    else play("impact");
    break;
   case "impact":play(event.big?"blast":"impact",position);break;
   case "block":play("block");break;
   case "pickup":play(event.item==="heal"?"heal":event.item==="shield"?"shield":"weapon");break;
   case "shield_off":play("shieldOff");break;
   case "empty":if(own)play("weapon");break;
   case "respawn": play("spawn");break;
   case "spawn_item":play("spawn",{...position,level:position.level*.68});break;
   case "enemy_spawn":if(event.boss)play("boss",{level:.85});else play("snowman",position);break;
   case "go":play("start",{level:.75});break;
   case "wave":play("wave",{level:.83});break;
   case "wave_clear":play("clear",{level:.85});break;
   case "down":
    if(event.npc??(actor?.enemy||actor?.bot))this.sounds.npcDown(near);
    else play("down");
    break;
   case "finish":play(event.winner===me?.team?"finish":"fail",{level:.86});break;
  }
 }
 movementAudio(game, me, dt){
  const active=this.phase==="playing"&&this.ws?.readyState===WebSocket.OPEN;
  if((this.ambientTick=(this.ambientTick||0)+dt)>.14){
   this.sounds.ambient("iceWind",active?.16:0);this.ambientTick=0;
  }
  if(!active||!me)return;
  for(const actor of game?.actors||[]){
   if(actor.hp<=0)continue;
   const state=this.footsteps.get(actor.id)||{distance:0,windup:0};
   const speed=Math.hypot(actor.vx,actor.vz);
   const own=actor.id===me.id;
   const nearby=spatialAudio(me,actor.x,actor.z,this.yaw,10);
   state.distance+=speed*dt;
   if(state.distance>=(actor.enemy?.86:1.13)){
    state.distance=0;
    this.sounds.play(actor.enemy?"snowman":"foot",own?{level:.44,gap:.045}:{...nearby,level:nearby.level*.48});
   }
   if(actor.windup>.16&&state.windup<=.16)this.sounds.play("windup",nearby);
   state.windup=actor.windup;
   this.footsteps.set(actor.id,state);
  }
 }
 lobby(force=false){
  const r=this.room;this.setPhase("lobby");this.overlay=false;
  const key=JSON.stringify([r.members,r.bots,r.owner]);
  if(key===this.lobbyKey&&!force)return;this.lobbyKey=key;
  const slots=r.slots,groups=r.mode==="waves"?[0]:[0,1],cap=r.mode==="waves"?4:slots/2;
  const roster=groups.map(team=>{
   const members=r.members.filter(m=>m.team===team);
   let rows=members.map(m=>'<div class="arena-member"><i class="'+(m.connected?"online":"")+'"></i><strong>'+escapeText(m.name)+'</strong><small>'+(m.id===r.me?"ты":m.owner?"хост":"игрок")+'</small></div>').join("");
   for(let i=members.length;i<cap;i++)rows+='<div class="arena-member is-empty"><i></i><strong>'+(r.bots?"Снежный бот":"Свободное место")+'</strong><small>'+(r.bots?"бот":"ждём")+'</small></div>';
   return '<div class="arena-team team-'+team+'"><span>'+(r.mode==="waves"?"Команда обороны":team===0?"Синий отряд":"Красный отряд")+'</span>'+rows+'</div>';
  }).join("");
  this.layer.innerHTML='<section class="arena-panel arena-lobby"><span class="arena-kicker">'+modes[r.mode][0]+' · ПОЛЯРНЫЙ ДВОР</span><h2>Собираем отряд</h2><button class="arena-room-code" data-action="copy" aria-label="Скопировать код комнаты '+r.room+'"><span>КОД КОМНАТЫ</span><strong>'+r.room+'</strong><small>Нажми, чтобы скопировать</small></button>'+
   '<div class="arena-roster '+(r.mode==="waves"?"is-coop":"")+'">'+roster+'</div>'+
   (r.owner?'<label class="arena-bots"><span>Заполнять места ботами</span><input type="checkbox" data-arena="bots" role="switch" '+(r.bots?"checked":"")+'></label><button class="arena-primary" data-action="start" '+(r.members.some(m=>m.id===r.me&&m.connected)?'':'disabled')+'>Начать бой <span>→</span></button>':'<p class="arena-wait">Создатель комнаты запустит бой</p>')+
   (r.mode!=="waves"?'<button class="arena-text-button" data-action="team">Сменить команду</button>':'')+
   '<button class="arena-text-button" data-action="leave">Выйти из комнаты</button></section>';
 }
 result(){
  const r=this.room,g=r.game,me=g.actors.find(p=>p.id===r.me),win=g.winner!==null&&g.winner===me?.team;
  const key=g.tick+":"+r.owner+":"+g.actors.filter(p=>!p.enemy).map(p=>p.id+":"+p.bot).join("|");if(this.resultKey===key)return;this.resultKey=key;this.stopInput();
  const title=g.winner===null?"Ничья":win?r.mode==="waves"?"Оборона выдержала":"Победа отряда":r.mode==="waves"?"Снеговики наступают":"Реванш впереди";
  const rows=g.actors.filter(p=>!p.enemy).sort((a,b)=>b.kills-a.kills).map(p=>'<tr class="'+(p.id===r.me?"is-me":"")+'"><td>'+escapeText(p.name)+(p.bot?'<small>бот</small>':"")+'</td><td>'+p.kills+'</td><td>'+p.deaths+'</td></tr>').join("");
  this.layer.innerHTML='<section class="arena-panel arena-result"><span class="arena-kicker">МАТЧ ЗАВЕРШЁН</span><h2>'+title+'</h2><p>'+escapeText(g.reason)+'</p><div class="arena-final-score">'+(r.mode==="waves"?'Волна <b>'+g.wave+' / 6</b>':'<b>'+g.score[0]+'</b><span>:</span><b>'+g.score[1]+'</b>')+'</div><table><thead><tr><th>Игрок</th><th>Устр.</th><th>Выбыл</th></tr></thead><tbody>'+rows+'</tbody></table>'+
   (r.owner?'<button class="arena-primary" data-action="lobby">В комнату · ещё матч</button>':'<p>Ожидаем создателя комнаты</p>')+
   '<button class="arena-text-button" data-action="leave">К выбору режима</button></section>';
 }
 help(){
  this.overlay=true;this.stopInput();this.unlockPointer();
  this.layer.innerHTML='<section class="arena-panel arena-help"><h2>Правила</h2><ul><li><b>Телефон:</b> стик слева для движения, свайп справа для обзора. Удерживай кнопку огня.</li><li><b>Компьютер:</b> WASD, мышь и левая кнопка для стрельбы.</li><li>Проходи через подсвеченные площадки, чтобы подобрать оружие, щит или аптечку.</li><li>В матче набери больше очков. В обороне переживи все волны снеговиков.</li></ul>'+
   (this.room?.game?.phase==="playing"?'<p>Это сетевой бой: пока открыта подсказка, матч продолжается.</p>':'')+
   '<button class="arena-primary" data-action="resume">Понятно</button></section>';
 }
 scoreboard(){
  if(!this.room?.game)return;
  this.overlay=true;this.stopInput();this.unlockPointer();
  const players=this.room.game.actors.filter(p=>!p.enemy).map(p=>'<tr><td>'+escapeText(p.name)+(p.bot?'<small>бот</small>':"")+'</td><td>'+p.kills+'</td><td>'+p.deaths+'</td></tr>').join("");
  this.layer.innerHTML='<section class="arena-panel"><span class="arena-kicker">СТАТИСТИКА МАТЧА</span><h2>Отряды</h2><table><thead><tr><th>Игрок</th><th>Устр.</th><th>Выбыл</th></tr></thead><tbody>'+players+'</tbody></table><button class="arena-primary" data-action="resume">Вернуться в бой</button></section>';
 }
 showError(text){
  this.setPhase("error");this.stopInput();this.unlockPointer();
  this.layer.innerHTML='<section class="arena-panel"><h2>Арена недоступна</h2><p>'+escapeText(text)+'</p>'+(this.room?'<button class="arena-primary" data-action="reconnect">Переподключиться</button><button class="arena-text-button" data-action="leave">Выйти из комнаты</button>':'')+'<button class="arena-text-button" data-action="quit">Вернуться к играм</button></section>';
 }
 toast(text){
  if(!text)return;this.toastEl.textContent=text;this.toastEl.classList.add("is-visible");clearTimeout(this.toastTimer);
  this.toastTimer=setTimeout(()=>this.toastEl.classList.remove("is-visible"),2400);
 }
 killFeed(e){
  const el=document.createElement("div");el.textContent=e.by+"  ›  "+e.name;
  const host=this.root.querySelector(".arena-feed");host.prepend(el);while(host.children.length>3)host.lastElementChild.remove();
  setTimeout(()=>el.remove(),4500);
 }
 joystick(e){
  const rect=this.joy.getBoundingClientRect(),radius=rect.width*.33,dx=e.clientX-(rect.left+rect.width/2),dy=e.clientY-(rect.top+rect.height/2);
  const mag=Math.hypot(dx,dy),scale=mag>radius?radius/mag:1;
  this.move={x:dx*scale/radius,y:dy*scale/radius};this.knob.style.transform="translate("+dx*scale+"px,"+dy*scale+"px)";
 }
 startFiring(held=true){
  if(!this.isPlaying())return;
  if(held)this.fire=true;const now=performance.now();this.fireLatchUntil=now+100;
  if(now-this.lastSend>=25){this.sendInput(this.control(0));this.lastSend=now;}
 }
 turn(dx,dy,touch=false){this.yaw+=dx*(touch?.005:.0028);this.pitch=clamp(this.pitch-dy*(touch?.004:.0025),-1.42,1.25);}
 key(e,down){
  if(!this.modal.isConnected||e.target.matches("input,textarea"))return;
  const key=e.key.toLowerCase();
  if(key==="escape"&&down&&this.room?.game?.phase==="playing"){
   e.preventDefault();e.stopImmediatePropagation();this.overlay?this.action("resume"):this.help();return;
  }
  if(["w","a","s","d","arrowleft","arrowright","arrowup","arrowdown"," ","tab"].includes(key)&&this.room?.game?.phase==="playing"){
   e.preventDefault();e.stopImmediatePropagation();
   if(key==="tab"){if(down&&!this.overlay)this.scoreboard();else if(!down&&this.overlay)this.action("resume");return;}
   if(down){this.keys.add(key);if(key===" ")this.startFiring(false);}else this.keys.delete(key);
  }
 }
 stopInput(){
  this.keys.clear();this.move={x:0,y:0};this.fire=false;this.fireLatchUntil=0;this.lookPointer=null;this.joyPointer=null;
  if(this.knob)this.knob.style.transform="translate(0,0)";
  this.trigger?.classList.remove("is-held");
  if(this.ws?.readyState===WebSocket.OPEN)this.sendInput({mx:0,mz:0,ax:Math.sin(this.yaw),az:-Math.cos(this.yaw),pitch:this.pitch,fire:false});
 }
 unlockPointer(){if(document.pointerLockElement===this.canvas)document.exitPointerLock();}
 control(dt){
  if(this.keys.has("arrowleft"))this.yaw-=dt*1.65;if(this.keys.has("arrowright"))this.yaw+=dt*1.65;
  if(this.keys.has("arrowup"))this.pitch=clamp(this.pitch+dt*.8,-1.42,1.25);if(this.keys.has("arrowdown"))this.pitch=clamp(this.pitch-dt*.8,-1.42,1.25);
  let x=this.move.x+(this.keys.has("d")?1:0)-(this.keys.has("a")?1:0),y=this.move.y+(this.keys.has("s")?1:0)-(this.keys.has("w")?1:0);
  const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}
  return {mx:x*Math.cos(this.yaw)-y*Math.sin(this.yaw),mz:x*Math.sin(this.yaw)+y*Math.cos(this.yaw),ax:Math.sin(this.yaw),az:-Math.cos(this.yaw),pitch:this.pitch,fire:this.fire||this.keys.has(" ")||performance.now()<this.fireLatchUntil};
 }
 sendInput(control){
  if(this.ws?.readyState!==WebSocket.OPEN||!this.room?.game)return;
  const message={type:"input",seq:this.seq++,...control};
  this.ws.send(JSON.stringify(message));
  if(this.predicted){this.history??=[];this.history.push({seq:message.seq,x:this.predicted.x,z:this.predicted.z});if(this.history.length>90)this.history.shift();}
 }
 predict(control,dt){
  if(!this.predicted)return;
  const p=this.predicted,covers=this.status.map.covers,r=.34;
  const blocked=(x,z)=>covers.some(c=>Math.abs(x-c[0])<c[2]/2+r&&Math.abs(z-c[1])<c[3]/2+r);
  const x=clamp(p.x+control.mx*4.5*dt,-12.7,12.7);if(!blocked(x,p.z))p.x=x;
  const z=clamp(p.z+control.mz*4.5*dt,-12.7,12.7);if(!blocked(p.x,z))p.z=z;
 }
 renderState(now){
  const latest=this.room?.game;if(!latest)return this.preview();
  const target=now-55;let left=this.samples[0],right=this.samples[this.samples.length-1];
  for(let i=1;i<this.samples.length;i++)if(this.samples[i].at>=target){left=this.samples[i-1];right=this.samples[i];break;}
  const t=left&&right?clamp((target-left.at)/Math.max(1,right.at-left.at),0,1):1;
  const actors=latest.actors.map(p=>{
   if(p.id===this.room.me&&this.predicted&&p.hp>0)return {...p,x:this.predicted.x,z:this.predicted.z,ax:Math.sin(this.yaw),az:-Math.cos(this.yaw),pitch:this.pitch};
   const a=left?.game.actors.find(a=>a.id===p.id),b=right?.game.actors.find(a=>a.id===p.id);
   if(!a||!b||Math.hypot(a.x-b.x,a.z-b.z)>3)return p;
   const yawA=Math.atan2(a.ax,a.az),yawB=Math.atan2(b.ax,b.az);
   const diff=Math.atan2(Math.sin(yawB-yawA),Math.cos(yawB-yawA)),yaw=yawA+diff*t;
   const extra=right&&target>right.at?Math.min(.065,(target-right.at)/1000):0;
   return {...p,x:a.x+(b.x-a.x)*t+(b.vx||0)*extra,z:a.z+(b.z-a.z)*t+(b.vz||0)*extra,
    ax:Math.sin(yaw),az:Math.cos(yaw),pitch:(a.pitch||0)+((b.pitch||0)-(a.pitch||0))*t};
  });
  const balls=latest.balls.map(ball=>{
   const a=left?.game.balls.find(p=>p.id===ball.id),b=right?.game.balls.find(p=>p.id===ball.id);
   if(a&&b)return {...ball,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
   const elapsed=Math.min(.065,Math.max(0,(target-(right?.at||now))/1000));
   return {...ball,x:ball.x+(ball.vx||0)*elapsed,y:ball.y+(ball.vy||0)*elapsed,z:ball.z+(ball.vz||0)*elapsed};
  });
  return {...latest,actors,balls};
 }
 preview(){
  return {actors:[
   {id:"decor1",name:"Снеговик",x:-6,z:-2,ax:0,az:-1,vx:0,vz:0,hp:100,max_hp:100,team:1,enemy:true},
   {id:"decor2",name:"Снежок",x:-4,z:-5,ax:-.7,az:-.7,vx:0,vz:0,hp:100,max_hp:100,team:0,weapon:"rapid"},
  ],pickups:[{id:1,kind:"rapid",x:-9,z:-5},{id:2,kind:"shield",x:-7,z:-7}],balls:[]};
 }
 updateHud(now){
  const g=this.room?.game;if(!g)return;const me=g.actors.find(p=>p.id===this.room.me);
  this.root.dataset.tick=String(g.tick);this.root.dataset.x=String(me?.x||0);this.root.dataset.z=String(me?.z||0);this.root.dataset.yaw=String(this.yaw);this.root.dataset.players=String(g.actors.filter(p=>!p.enemy).length);
  this.root.classList.toggle("has-shield",me?.shield>0);
  this.hpEl.textContent=String(me?.hp||0);this.healthFill.style.transform="scaleX("+((me?.hp||0)/100)+")";
  this.weaponEl.textContent=names[me?.weapon]||names.pistol;this.ammoEl.textContent=me?.ammo>0?me.ammo+" патр.":"∞";
  this.shieldEl.hidden=!(me?.shield>0);this.shieldEl.querySelector("b").textContent=(me?.shield||0).toFixed(1)+" с";
  const secs=Math.ceil(g.remaining);this.timerEl.textContent=Math.floor(secs/60)+":"+String(secs%60).padStart(2,"0");
  this.scoreEl.innerHTML=g.mode==="waves"?'<strong>Волна '+g.wave+'<small>/ 6</small></strong><span>'+g.enemies_left+' снеговиков</span>':'<b class="blue">'+g.score[0]+'</b><i>:</i><b class="red">'+g.score[1]+'</b><small>до '+g.goal+'</small>';
  const respawn=this.root.querySelector(".arena-respawn");
  respawn.hidden=!(me?.hp===0&&g.phase==="playing");respawn.textContent="Возрождение через "+Math.ceil(me?.respawn||0)+" с";
  if(g.mode==="waves"&&g.wave_delay>0)this.toastEl.textContent="Следующая волна через "+Math.ceil(g.wave_delay)+" с";
  const ctx=this.miniCtx,s=88;ctx.clearRect(0,0,s,s);ctx.fillStyle="#d5eafa";ctx.fillRect(0,0,s,s);
  for(const c of this.status.map.covers){ctx.fillStyle="#81a9c6";ctx.fillRect((c[0]-c[2]/2+13)/26*s,(c[1]-c[3]/2+13)/26*s,c[2]/26*s,c[3]/26*s);}
  for(const d of g.pickups){ctx.fillStyle=d.kind==="heal"?"#d97d99":"#f3d183";ctx.fillRect((d.x+13)/26*s-1.5,(d.z+13)/26*s-1.5,3,3);}
  for(const p of g.actors){
   if(p.hp<=0)continue;if(me&&p.team!==me.team&&Math.hypot(p.x-me.x,p.z-me.z)>7)continue;
   ctx.fillStyle=p.id===this.room.me?"#fff":p.team===0?"#3d87bf":"#d86887";
   ctx.beginPath();ctx.arc((p.x+13)/26*s,(p.z+13)/26*s,p.id===this.room.me?3.1:2.4,0,7);ctx.fill();
  }
  if(me){const x=(me.x+13)/26*s,z=(me.z+13)/26*s;ctx.strokeStyle="#234d78";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,z);ctx.lineTo(x+Math.sin(this.yaw)*8,z-Math.cos(this.yaw)*8);ctx.stroke();}
 }
 frame(now){
  if(this.disposed)return;
  const dt=Math.min(.08,Math.max(0,(now-(this.lastFrame||now))/1000));this.lastFrame=now;
  if(!document.hidden){
   const control=this.isPlaying()?this.control(dt):{mx:0,mz:0,ax:Math.sin(this.yaw),az:-Math.cos(this.yaw),pitch:this.pitch,fire:false};
   const me=this.room?.game?.actors.find(p=>p.id===this.room.me);
   if(this.isPlaying()&&me?.hp>0)this.predict(control,dt);
   if(this.room?.game?.phase==="playing"&&now-this.lastSend>40){this.sendInput(control);this.lastSend=now;}
   const began=performance.now(),render=this.renderState(now);
   if(!this.room?.game){this.yaw=2.15+(this.preferences.reduceMotion?0:Math.sin(now/10000)*.13);this.pitch=-.40;}
   this.movementAudio(render,me,dt);
   this.scene?.draw(render,{me:this.room?.me,yaw:this.yaw,pitch:this.pitch,playing:this.isPlaying(),attract:!this.room?.game},dt);
   this.renderMs=(this.renderMs||0)*.95+(performance.now()-began)*.05;
   if(now-this.lastHud>100){this.updateHud(now);this.lastHud=now;this.root.dataset.renderMs=this.renderMs.toFixed(2);}
  }
  this.raf=requestAnimationFrame(t=>this.frame(t));
 }
 visibility(hidden){this.stopInput();this.unlockPointer();if(hidden)this.sounds.silence();this.music.setPaused(hidden);if(!hidden)this.lastFrame=performance.now();}
 async leave(){
  this.generation=(this.generation||0)+1;this.room=null;clearTimeout(this.reconnectTimer);
  const ws=this.ws;this.ws=null;if(ws)ws.close(1000);this.stopInput();this.unlockPointer();
  try{if(!this.displaced)await post(API+"/leave",{});}catch(_){}
  this.lobbyKey="";this.resultKey="";
 }
 reopen(){location.reload();}
 destroy(){
  if(this.disposed)return;this.disposed=true;this.leave();this.observer?.disconnect();
  cancelAnimationFrame(this.raf);cancelAnimationFrame(this.resizeRAF);clearInterval(this.heartbeat);
  document.documentElement.classList.remove("arena-active");
  if(this.viewportMeta&&this.viewportPrevious!=null)this.viewportMeta.setAttribute("content",this.viewportPrevious);
  for(const timer of [this.toastTimer,this.hurtTimer,this.hitTimer,this.reconnectTimer,this.pickupTimer])clearTimeout(timer);
  this.listeners.forEach(f=>f());this.listeners=[];this.scene?.dispose();this.sounds.dispose();this.music.release();
 }
}
export function openSnowArena({registerCleanup}){
 const modal=window.kov.showModal('<div class="arena-screen" data-phase="loading"><canvas class="arena-canvas" aria-label="Снежная 3D-арена от первого лица. Мышь или касание справа — обзор."></canvas>'+
  '<header class="arena-top"><button class="arena-icon-button" data-action="quit" aria-label="Выйти из снежной арены">'+svg("back")+'</button><span class="arena-brand">ФРОСТ-ПОСТ<small data-arena="network">Подключение…</small></span><button class="arena-icon-button" data-action="music" aria-label="Музыка"></button><button class="arena-icon-button" data-action="help" aria-label="Управление и правила">'+svg("help")+'</button></header>'+
  '<div class="arena-hud" hidden><div class="arena-match"><div class="arena-score"></div><time data-arena="timer">4:00</time></div><div class="arena-radar"><canvas class="arena-minimap" width="88" height="88" aria-label="Мини-карта арены"></canvas><button class="arena-icon-button" data-action="score" aria-label="Статистика матча">'+svg("board")+'</button></div>'+
  '<div class="arena-vitals"><div class="arena-health"><span>ЗДОРОВЬЕ <b data-arena="hp">100</b></span><div><i></i></div></div><div class="arena-shield" hidden>'+svg("shield")+'<b>3.0 с</b></div></div><div class="arena-weapon"><b data-arena="weapon">Снежный пистолет</b><span data-arena="ammo">∞</span></div></div>'+
  '<div class="arena-crosshair" aria-hidden="true" hidden><i></i><i></i><i></i><i></i><b>×</b></div><div class="arena-damage" aria-hidden="true"></div><div class="arena-feed" aria-live="off"></div><div class="arena-toast" role="status" aria-live="polite"></div><div class="arena-respawn" role="status" hidden></div><div class="arena-layer"></div>'+
  '<div class="arena-controls" hidden><div class="arena-joystick" role="application" aria-label="Стик движения"><i></i><span>ДВИЖЕНИЕ</span></div><button class="arena-trigger" aria-label="Стрелять снежками: удерживай">'+svg("fire")+'<span>ОГОНЬ</span></button><span class="arena-look-hint">Проводи справа для обзора</span></div></div>',{label:"Фрост-пост"});
 modal.classList.add("snow-arena-modal");modal.parentElement.classList.add("snow-arena-overlay");
 return new SnowArena(modal,registerCleanup);
}

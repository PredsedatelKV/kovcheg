import {GameAudio} from "./game-audio.js";
import { get, post } from "../api.js";
import { escapeText } from "../ui.js";
import { getSettings, useGameMusic, setMusicEnabled } from "../pages/settings.js";
import { ENGINE_VERSION, STEP_MS, TICKS, MAX_BAG, makeTrack, createState, step, result, encodeControl, zoneAt } from "./courier-engine.js";
import { CourierScene, loadAssets } from "./courier-scene.js";

const API="/api/arcade/courier";
const rallyMusic=new URL("../media/courier/christmas-rally.mp3",import.meta.url).href;
function musicIcon(enabled) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12M9 9l10-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="6.5" cy="18.5" rx="2.6" ry="1.9" fill="none" stroke="currentColor" stroke-width="1.8"/><ellipse cx="16.5" cy="16.5" rx="2.6" ry="1.9" fill="none" stroke="currentColor" stroke-width="1.8"/>'+(enabled?'':'<path d="m3 3 18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>')+'</svg>';
}
const coin=new URL("../media/coin.png",import.meta.url).href;
const sled=new URL("../media/courier/sled.webp",import.meta.url).href;
const pauseIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/></svg>';
const exitIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const number=n=>new Intl.NumberFormat("ru").format(n||0);
function dayLabel(day) { return new Date(day+"T12:00:00+03:00").toLocaleDateString("ru",{day:"numeric",month:"long"}); }

class CourierGame {
  constructor(modal, lifecycle) {
    this.modal=modal;this.root=modal.querySelector(".courier-screen");
    this.canvas=modal.querySelector("canvas");this.layer=modal.querySelector(".courier-layer");
    this.hud=modal.querySelector(".courier-hud");this.route=modal.querySelector(".courier-route");
    this.controlsEl=modal.querySelector(".courier-controls");
    this.pauseButton=modal.querySelector('[data-action="pause"]');
    this.message=modal.querySelector(".courier-message");
    this.musicButton=modal.querySelector('[data-action="music"]');
    this.preferences=getSettings();
    this.music=useGameMusic(rallyMusic);
    this.ui={};
    for(const key of ["time","score","bag","zone","delivery","delivered"])this.ui[key]=modal.querySelector('[data-courier="'+key+'"]');
    this.ui.bagMeter=modal.querySelector(".courier-bag-meter");
    this.refreshMusicControl();
    this.steer=modal.querySelector('[data-courier="steer"]');
    this.audio=new GameAudio();this.phase="loading";this.disposed=false;this.raf=0;
    this.listeners=[];this.keys=new Set();this.aim=0;this.braking=false;this.controls=[];
    this.state=createState();this.previous=null;this.accumulator=0;this.toastUntil=0;this.lastHud=0;
    this.scene=null;this.status=null;this.run=null;this.inputPointer=null;this.submitGeneration=0;
    this.listen(modal,"click",event=>{const b=event.target.closest("[data-action]");if(b&&!b.disabled)this.action(b.dataset.action);});
    this.listen(this.canvas,"pointerdown",event=>{
      if(this.phase!=="running")return;event.preventDefault();
      this.inputPointer=event.pointerId;this.canvas.setPointerCapture(event.pointerId);this.pointInput(event);
    },{passive:false});
    this.listen(this.canvas,"pointermove",event=>{if(event.pointerId===this.inputPointer&&this.phase==="running")this.pointInput(event);},{passive:true});
    const release=event=>{if(event.pointerId===this.inputPointer)this.inputPointer=null;};
    this.listen(this.canvas,"pointerup",release);this.listen(this.canvas,"pointercancel",release);
    this.listen(this.steer,"input",()=>{this.aim=Number(this.steer.value);});
    const brake=modal.querySelector(".courier-brake");
    this.listen(brake,"pointerdown",event=>{
      if(this.phase!=="running")return;event.preventDefault();event.stopPropagation();
      brake.setPointerCapture(event.pointerId);this.braking=true;brake.classList.add("is-held");
    },{passive:false});
    const unbrake=()=>{this.braking=false;brake.classList.remove("is-held");};
    for(const e of ["pointerup","pointercancel","lostpointercapture"])this.listen(brake,e,unbrake);
    this.listen(document,"keydown",e=>{
      if(!this.modal.isConnected)return;
      if(e.key==="Escape"){e.stopPropagation();if(this.phase==="running"||this.phase==="countdown")this.pause();else if(this.phase==="paused")this.resume();return;}
      const k=e.key.toLowerCase();
      if(this.phase==="running"&&["arrowleft","arrowright","a","d"," ","arrowdown","s"].includes(k)){
        e.preventDefault();this.keys.add(k);
      }
    },{capture:true});
    this.listen(document,"keyup",e=>this.keys.delete(e.key.toLowerCase()));
    this.listen(window,"blur",()=>this.pause());
    if(window.ResizeObserver){this.observer=new ResizeObserver(()=>{
      if(this.scene){
        const box=this.canvas.getBoundingClientRect();
        if(box.width>box.height&&box.height<500)this.pause();
        this.scene.resize();this.restartLoop();
      }
    });this.observer.observe(this.canvas);}
    else this.listen(window,"resize",()=>{if(this.scene){this.scene.resize();this.restartLoop();}});
    lifecycle(()=>this.destroy(),hidden=>{if(hidden){this.pause();this.audio.silence();}});
    this.boot();
  }
  listen(target,type,fn,options){target.addEventListener(type,fn,options);this.listeners.push(()=>target.removeEventListener(type,fn,options));}
  setPhase(phase) {
    const previousPhase=this.phase;
    if(phase!=="running"){this.audio.ambient("runners",0);this.audio.ambient("iceWind",0);}
    if(phase==="paused")this.audio.silence();
    if(previousPhase==="finishing"&&phase==="result")this.audio.play("finish");
    this.phase=phase;this.root.dataset.phase=phase;
    this.root.dataset.tick=String(this.state.tick);
    if(this.music){
      const suspended=["paused","countdown","starting","finishing","result"].includes(phase)||(phase==="board"&&this.boardFrom==="result");
      if(phase==="running"&&previousPhase==="countdown")this.music.restart();
      else this.music.setPaused(suspended);
    }
    if(!["running","countdown"].includes(phase)){
      this.message.classList.remove("is-visible");this.toastUntil=0;
    }
    const active=["running","countdown","paused"].includes(phase);
    this.hud.hidden=!active;this.route.hidden=!active;this.controlsEl.hidden=!active;
    this.pauseButton.hidden=!["running","countdown"].includes(phase);
    this.keys.clear();this.braking=false;this.modal.querySelector(".courier-brake").classList.remove("is-held");
  }
  async boot() {
    this.setPhase("loading");
    this.layer.innerHTML='<div class="courier-panel courier-loading"><span class="courier-spinner"></span><h2>Готовим зимний маршрут</h2><p>Скоро отправляемся</p></div>';
    try {
      const [assets,status]=await Promise.all([loadAssets(),get(API+"/status",{force:true})]);
      if(this.disposed)return;
      if(status.engine_version!==ENGINE_VERSION)throw new Error("Игра обновилась. Перезапустите мини-апп.");
      this.status=status;
      this.pendingKey="kovcheg.courier.pending.v1."+status.player_id;
      this.scene?.dispose();this.scene=new CourierScene(this.canvas,assets,this.preferences);
      this.track=makeTrack(status.seed);this.scene.setTrack(this.track,status.seed);
      this.renderIntro();this.restartLoop();
    } catch(error) {
      if(this.disposed)return;this.setPhase("error");
      this.layer.innerHTML='<div class="courier-panel"><span class="courier-eyebrow">Маршрут задерживается</span><h2>Не удалось подготовить заезд</h2><p>'+escapeText(error.message)+'</p><button class="courier-primary" data-action="boot">Повторить</button><button class="courier-secondary" data-action="quit">К играм</button></div>';
    }
  }
  pending() {
    try {
      const p=JSON.parse(localStorage.getItem(this.pendingKey)||"null");
      if(p&&[1,ENGINE_VERSION].includes(p.engine)&&Array.isArray(p.controls)&&p.controls.length===TICKS
          &&p.controls.every(c=>Number.isInteger(c)&&c>=0&&c<=4048&&(c&2047)<=2000)
          &&Number.isInteger(p.seed)&&p.seed>=0&&p.seed<=2147483647
          &&typeof p.token==="string"&&/^[A-Za-z0-9_-]{32,64}$/.test(p.token))return p;
    }catch(_){}
    return null;
  }
  renderIntro() {
    this.setPhase("intro");
    const p=this.pending(),s=this.status;
    this.layer.innerHTML='<img class="courier-intro-sled" src="'+sled+'" alt=""><div class="courier-panel courier-intro">'+
      '<h1>Чудесник</h1>'+
      '<div class="courier-bonus"><img src="'+coin+'" alt="">'+(s.reward_claimed?'Награда за сегодня получена':'+'+s.daily_reward+' за '+s.delivery_goal+' подарков в '+s.min_houses+' дома')+'</div>'+
      '<button class="courier-primary" data-action="'+(p?'recover':'start')+'">'+(p?'Сохранить прошлый результат':'Начать заезд <span>2 минуты →</span>')+'</button>'+
      '<button class="courier-secondary" data-action="board">'+(s.best?'Мой рекорд: '+number(s.best)+' · ':'')+'Рейтинг трассы</button>'+
      '<details class="courier-help"><summary>Правила</summary><p>Собирай подарки, объезжай препятствия и притормаживай у домов, чтобы сделать доставку. Управляй свайпом или стрелками, тормози кнопкой на экране или пробелом.</p></details></div>';
  }
  async start() {
    if(!["intro","result","error"].includes(this.phase))return;
    if(this.pending()){this.recover();return;}
    const box=this.canvas.getBoundingClientRect();
    if(box.width>box.height&&box.height<500)return;
    this.audio.unlock();this.setPhase("starting");
    this.layer.innerHTML='<div class="courier-panel courier-loading"><span class="courier-spinner"></span><h2>Сани готовы</h2><p>Получаем маршрут…</p></div>';
    try {
      const run=await post(API+"/start",{});
      if(this.disposed)return;
      if(run.engine_version!==ENGINE_VERSION)throw new Error("Перезапустите игру — трасса обновилась");
      this.run=run;this.track=makeTrack(run.seed);this.state=createState();this.previous=null;
      this.controls=[];this.aim=0;this.steer.value="0";this.accumulator=0;this.lastHud=0;
      this.scene.setTrack(this.track,run.seed);
      this.setPhase("countdown");this.countdownAt=performance.now();this.countdownNumber=-1;
      this.layer.innerHTML='<div class="courier-countdown"><strong>3</strong></div>';
      this.updateHud(true);this.restartLoop();
    } catch(error) {
      if(this.disposed)return;this.setPhase("error");
      this.layer.innerHTML='<div class="courier-panel"><h2>Пока не выезжаем</h2><p>'+escapeText(error.message)+'</p><button class="courier-primary" data-action="start">Попробовать снова</button><button class="courier-secondary" data-action="intro">Назад</button></div>';
    }
  }
  action(name) {
    if(this.disposed)return;
    this.audio.unlock();this.audio.play("click",{level:.52});
    if(name==="quit"){window.closeModal();return;}
    if(name==="music"){setMusicEnabled(getSettings().musicPaused);this.refreshMusicControl();return;}
    if(name==="boot"){this.boot();return;}
    if(name==="start"){this.start();return;}
    if(name==="intro"){this.renderIntro();this.restartLoop();return;}
    if(name==="pause"){this.pause();return;}
    if(name==="resume"){this.resume();return;}
    if(name==="board"){this.showBoard();return;}
    if(name==="board-back"){
      if(this.boardFrom==="result")this.renderResult(this.serverResult,this.submitError);
      else this.renderIntro();
      this.restartLoop();return;
    }
    if(name==="recover"){this.recover();return;}
    if(name==="submit"){this.finish();return;}
  }
  refreshMusicControl() {
    const enabled=!getSettings().musicPaused;
    this.musicButton.innerHTML=musicIcon(enabled);
    this.musicButton.setAttribute("aria-pressed",String(enabled));
    this.musicButton.setAttribute("aria-label",enabled?"Выключить музыку":"Включить музыку");
    this.musicButton.title="Christmas Rally";
  }
  pointInput(e) {
    const rect=this.canvas.getBoundingClientRect();
    this.aim=clamp(Math.round(((e.clientX-rect.left)/rect.width-.5)*2400),-1000,1000);
    this.steer.value=String(this.aim);
  }
  pause() {
    if(!["running","countdown"].includes(this.phase))return;
    this.beforePause=this.phase;this.pausedAt=performance.now();this.inputPointer=null;this.setPhase("paused");
    this.layer.innerHTML='<div class="courier-panel courier-pause"><span class="courier-eyebrow">Сани отдыхают</span><h2>Заезд на паузе</h2><button class="courier-primary" data-action="resume">Продолжить маршрут</button><button class="courier-secondary" data-action="quit">Выйти к играм</button></div>';
    this.restartLoop();
  }
  resume() {
    if(this.phase!=="paused"||document.hidden)return;
    if(this.beforePause==="countdown")this.countdownAt+=performance.now()-this.pausedAt;
    this.setPhase(this.beforePause);this.layer.innerHTML=this.phase==="countdown"?'<div class="courier-countdown"><strong>3</strong><span>Готовимся к старту</span></div>':"";
    this.accumulator=0;this.previous=null;this.restartLoop();
  }
  restartLoop() {
    if(this.disposed||!this.scene)return;
    if(this.raf)cancelAnimationFrame(this.raf);
    this.lastFrame=performance.now();this.raf=requestAnimationFrame(t=>this.frame(t));
  }
  frame(now) {
    this.raf=0;if(this.disposed||!this.scene)return;
    const delta=Math.max(0,now-this.lastFrame);this.lastFrame=now;
    if(["running","countdown"].includes(this.phase)&&(document.hidden||delta>700)){this.pause();return;}
    const began=performance.now();
    if(this.phase==="countdown"){
      const seconds=3-Math.floor((now-this.countdownAt)/1000);
      if(seconds<=0){this.setPhase("running");this.layer.innerHTML="";this.audio.play("start");this.accumulator=0;}
      else if(seconds!==this.countdownNumber){
        this.countdownNumber=seconds;const text=this.layer.querySelector("strong");if(text)text.textContent=seconds;this.audio.play("countdown");
      }
    }
    if(this.phase==="running") {
      this.accumulator+=Math.min(delta,200);
      let cycles=0;
      while(this.accumulator>=STEP_MS&&cycles++<4&&this.phase==="running") {
        const left=this.keys.has("arrowleft")||this.keys.has("a"),right=this.keys.has("arrowright")||this.keys.has("d");
        if(left!==right){this.aim=clamp(this.aim+(right?85:-85),-1000,1000);this.steer.value=String(this.aim);}
        const braking=this.braking||this.keys.has(" ")||this.keys.has("arrowdown")||this.keys.has("s");
        const code=encodeControl(this.aim,braking);
        this.previous={x:this.state.x,distance:this.state.distance};
        if(braking&&!this.wasBraking)this.audio.play("brake",{level:.52});
        this.wasBraking=braking;
        step(this.state,this.track,code);this.controls.push(code);this.scene.notifyStep(this.state);
        for(const e of this.state.events)this.event(e,now);
        this.accumulator-=STEP_MS;this.updateHud();
        if(this.state.finished){this.finish();break;}
      }
    }
    if(this.phase==="running"){
      const speed=this.state.speed;
      this.audio.ambient("runners",Math.min(.38,speed*.019),.70+speed*.024);
      this.audio.ambient("iceWind",Math.min(.28,speed*.012),.9+speed*.009);
    }
    if(now>this.toastUntil)this.message.classList.remove("is-visible");
    const active=["running","countdown"].includes(this.phase),intro=this.phase==="intro";
    this.scene.draw(this.state,active||intro?Math.min(delta,100)/1000:0,
      active?clamp(this.accumulator/STEP_MS,0,1):1,active?this.previous:null,intro);
    this.cost=(this.cost||0)*.95+(performance.now()-began)*.05;
    this.frames=(this.frames||0)+1;
    if(this.frames%60===0){
      this.root.dataset.renderMs=this.cost.toFixed(2);
      this.root.dataset.pixelRatio=String(this.scene.dpr);
    }
    if(active||(intro&&!this.preferences.reduceMotion))this.raf=requestAnimationFrame(t=>this.frame(t));
  }
  event(e,now) {
    const key=e.kind==="hit"?"impact":e.kind;
    this.audio.play(key,{level:e.kind==="miss"?.48:.82,gap:.10});
    if(e.kind==="gift"&&this.state.bag===MAX_BAG)this.toast("Мешок полон — пора к дому",now);
    if(e.kind==="delivery")this.toast("Доставлено "+e.value+" · +"+number(e.points),now,"success");
    if(e.kind==="hit")this.toast(e.value?"Удар! Потеряно подарков: "+e.value:"Осторожнее на поворотах",now,"warn");
    if(e.kind==="brake")this.toast("У дома нужно притормозить",now,"warn");
    if(e.kind==="miss")this.toast("Дом остался позади. Следующий впереди",now);
  }
  toast(text,now=performance.now(),kind="") {
    this.message.textContent=text;this.message.dataset.kind=kind;this.message.classList.add("is-visible");this.toastUntil=now+2300;
  }
  updateHud(force=false) {
    if(!force&&this.state.tick-this.lastHud<4)return;
    this.lastHud=this.state.tick;this.root.dataset.tick=String(this.state.tick);
    const seconds=Math.max(0,Math.ceil((TICKS-this.state.tick)*STEP_MS/1000));
    this.ui.time.textContent=Math.floor(seconds/60)+":"+String(seconds%60).padStart(2,"0");
    this.ui.score.textContent=number(this.state.score);
    this.ui.bag.textContent=this.state.bag+"/"+MAX_BAG;
    this.ui.bagMeter.style.setProperty("--cargo",String(this.state.bag/MAX_BAG));
    this.ui.bagMeter.classList.toggle("is-heavy",this.state.bag>=8);
    const z=zoneAt(this.state.distance);
    this.ui.zone.textContent=z===1?(this.state.x>=0?"Озеро · скользко":"Лесная тропа"):z===2?"Тёплое поселение":"Заснеженный лес";
    let dock=null;
    for(let i=this.state.cursor;i<this.track.length;i++){if(this.track[i].kind==="dock"){dock=this.track[i];break;}}
    const target=this.ui.delivery;
    if(dock) {
      const estimate=this.state.tick<20?30:Math.max(8,this.state.speed);
      const eta=Math.max(1,Math.round((dock.y-this.state.distance)/estimate*.05));
      target.textContent=(dock.x<0?"← Дом слева":"Дом справа →")+" · "+eta+" сек";
      this.route.classList.toggle("is-near",dock.y-this.state.distance<850&&this.state.bag>0);
    }
    this.ui.delivered.textContent=this.state.delivered+"/"+this.status.delivery_goal;
  }
  async finish() {
    if(this.submitting||this.disposed||!this.run||this.controls.length!==TICKS)return;
    this.submitting=true;this.setPhase("finishing");this.serverResult=null;this.submitError=null;
    this.pendingSaved=false;
    try{localStorage.setItem(this.pendingKey,JSON.stringify({engine:this.run.engine_version||ENGINE_VERSION,token:this.run.token,seed:this.run.seed,controls:this.controls}));this.pendingSaved=true;}catch(_){}
    this.layer.innerHTML='<div class="courier-panel courier-loading"><span class="courier-spinner"></span><h2>Подарки доставлены</h2><p>Сохраняем результат заезда…</p></div>';
    this.restartLoop();
    const generation=++this.submitGeneration;
    try {
      const answer=await post(API+"/finish",{token:this.run.token,controls:this.controls});
      try{localStorage.removeItem(this.pendingKey);}catch(_){}
      if(this.disposed||generation!==this.submitGeneration)return;
      this.serverResult=answer;
      if((answer.engine_version||this.run.engine_version)===ENGINE_VERSION){this.status.best=answer.best;this.status.rank=answer.rank;}
      if(answer.day===this.status.day)this.status.reward_claimed=answer.reward_claimed;
      this.renderResult(answer);if(answer.reward)this.audio.play("delivery");
    }catch(error){
      if(this.disposed||generation!==this.submitGeneration)return;
      const terminal=[400,404,409,422].includes(error.status);
      if(terminal){try{localStorage.removeItem(this.pendingKey);}catch(_){}}
      this.submitError={message:error.message,retry:!terminal};
      this.renderResult(null,this.submitError);
    }finally{this.submitting=false;}
  }
  async recover() {
    const p=this.pending();if(!p){this.renderIntro();return;}
    this.setPhase("finishing");
    this.layer.innerHTML='<div class="courier-panel courier-loading"><span class="courier-spinner"></span><h2>Восстанавливаем результат</h2></div>';
    try{
      const engine=p.engine===ENGINE_VERSION?{makeTrack,createState,step}:await import("./courier-engine-v1.js");
      if(this.disposed)return;
      this.run={token:p.token,seed:p.seed,engine_version:p.engine};this.controls=p.controls;
      this.track=engine.makeTrack(p.seed);this.state=engine.createState();
      for(const code of p.controls)engine.step(this.state,this.track,code);
      this.scene.setTrack(this.track,p.seed);this.finish();
    }catch(error){if(!this.disposed)this.renderResult(null,{message:error.message,retry:true});}
  }
  renderResult(server,error=null) {
    this.setPhase("result");const s=server||result(this.state);
    const success=s.delivered>=this.status.delivery_goal&&s.deliveries>=this.status.min_houses;
    this.layer.innerHTML='<div class="courier-panel courier-result">'+
      '<span class="courier-eyebrow">'+(server?'Заезд сохранён':'Ваш заезд')+'</span>'+
      '<h2>'+(success?'Тепло доставлено':'Хорошее начало')+'</h2>'+
      '<strong class="courier-final-score">'+number(s.score)+'</strong><span class="courier-score-caption">очков за маршрут</span>'+
      '<div class="courier-result-grid"><span><b>'+s.delivered+'</b>подарков</span><span><b>'+s.deliveries+'</b>домов</span><span><b>'+s.best_combo+'</b>серия доставок</span></div>'+
      '<p class="courier-result-note">'+(server?(server.rank?'Место на трассе дня: '+server.rank+' · Рекорд '+number(server.best):'Каждая доставка делает зиму теплее'):'')+'</p>'+
      (server?'<div class="courier-bonus"><img src="'+coin+'" alt="">'+(server.reward?'+'+server.reward+' ковбаксов за первый успешный заезд':server.reward_claimed?'Награда дня уже получена':'Для награды: '+this.status.delivery_goal+' подарков в '+this.status.min_houses+' дома')+'</div>':'')+
      (error?'<p class="courier-sync-error" role="status">'+escapeText(error.message)+(error.retry?(this.pendingSaved?' Результат сохранён на устройстве.':' Не закрывайте игру до отправки.'):'' )+'</p>':'')+
      '<button class="courier-primary" data-action="'+(error?.retry?'submit':'start')+'">'+(error?.retry?'Отправить результат ещё раз':'Ещё один маршрут →')+'</button>'+
      '<button class="courier-secondary" data-action="board">Рейтинг трассы</button></div>';
    this.restartLoop();
  }
  async showBoard() {
    this.boardFrom=this.phase;this.setPhase("board");
    this.layer.innerHTML='<div class="courier-panel courier-loading"><span class="courier-spinner"></span><h2>Рекорды трассы</h2></div>';this.restartLoop();
    try {
      const status=await get(API+"/status",{force:true});
      if(this.disposed||this.phase!=="board")return;this.status=status;
      const rows=status.leaders.map(row=>'<li class="'+(row.is_me?'is-me':'')+'"><b>'+row.place+'</b><span>'+escapeText(row.name)+'</span><strong>'+number(row.score)+'</strong></li>').join("");
      this.layer.innerHTML='<div class="courier-panel courier-board"><span class="courier-eyebrow">'+escapeText(dayLabel(status.day))+' · Одна трасса для всех</span><h2>Самые тёплые<br>доставки</h2>'+
        (rows?'<ol>'+rows+'</ol>':'<p class="courier-board-empty">Первый след на снегу<br>может стать твоим.</p>')+
        '<button class="courier-primary" data-action="board-back">Вернуться</button></div>';
    }catch(error) {
      if(this.disposed)return;
      this.layer.innerHTML='<div class="courier-panel"><h2>Рейтинг недоступен</h2><p>'+escapeText(error.message)+'</p><button class="courier-primary" data-action="board-back">Вернуться</button></div>';
    }
  }
  destroy() {
    this.disposed=true;this.submitGeneration++;
    if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;
    this.observer?.disconnect();this.listeners.forEach(dispose=>dispose());this.listeners=[];
    this.keys.clear();this.braking=false;this.audio.dispose();this.music.release();this.scene?.dispose();this.controls=[];
  }
}
export function openSnowCourier({registerCleanup}) {
  const modal=window.kov.showModal('<div class="courier-screen" data-phase="loading">'+
    '<canvas class="courier-canvas" aria-label="Зимняя трасса. Веди пальцем, чтобы управлять санями."></canvas>'+
    '<header class="courier-top"><button type="button" class="courier-icon-button" data-action="quit" aria-label="Выйти к играм">'+exitIcon+'</button>'+
    '<span>Чудесник <i>Зимняя доставка</i></span><button type="button" class="courier-icon-button courier-music-button" data-action="music" aria-label="Музыка" aria-pressed="false"></button><button type="button" class="courier-icon-button" data-action="pause" aria-label="Пауза" hidden>'+pauseIcon+'</button></header>'+
    '<div class="courier-hud" hidden><div><span>Очки</span><strong data-courier="score">0</strong></div>'+
    '<div class="courier-clock"><span>Осталось</span><strong data-courier="time">2:00</strong></div>'+
    '<div class="courier-bag-meter"><span>Мешок</span><strong data-courier="bag">0/12</strong><i></i></div></div>'+
    '<div class="courier-route" hidden><span data-courier="zone">Заснеженный лес</span><strong data-courier="delivery"></strong><small>Доставлено <b data-courier="delivered">0/12</b></small></div>'+
    '<div class="courier-message" role="status" aria-live="polite"></div><div class="courier-layer"></div>'+
    '<div class="courier-rotate" role="status"><div><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="21" y="9" width="22" height="44" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 27a21 21 0 0 1 9-14m-9 14-4-5m4 5 5-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><h2>Поверни экран вертикально</h2><p>Так вся зимняя трасса будет перед глазами.<br>Заезд остаётся на паузе.</p><button class="courier-secondary" data-action="quit">К играм</button></div></div>'+
    '<footer class="courier-controls" hidden><label class="courier-steering"><span>← <b>Руль саней</b> →</span>'+
    '<input type="range" min="-1000" max="1000" value="0" step="10" data-courier="steer" aria-label="Руль саней"></label>'+
    '<button type="button" class="courier-brake" aria-label="Тормоз: удерживай у дома"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6v12M12 6v12M17 6v12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span>Тормоз<small>удерживай</small></span></button></footer></div>',{label:"Чудесник"});
  modal.classList.add("courier-modal");modal.parentElement.classList.add("courier-modal-overlay");
  return new CourierGame(modal,registerCleanup);
}

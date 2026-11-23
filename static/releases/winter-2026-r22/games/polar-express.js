import {get,post} from "../api.js";
import {escapeText} from "../ui.js";
import {getSettings} from "../pages/settings.js";
import {GameAudio,spatialAudio} from "./game-audio.js";
import {stickInput} from "./ice-controls.js";
import {TrainScene} from "./train-scene.js";
import {TrainPrediction,advanceMotion,focusAt,workScore} from "./train-movement.js";

const API="/api/arcade/train";
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const guideSeen=new Set();
const targetIcons={furnace:"heat",repair:"tool",plow:"snow",bridge:"switch",valley:"switch",
  seal:"gift",store:"box",cargo:"gift",dispatch:"bell",coal:"coal",parts:"tool",parcel:"box",
  lamp:"lamp",station_coal:"coal",station_parts:"tool",station_parcel:"box",station_signal:"mail"};
const handIcons={coal:"coal",parts:"tool",parcel:"box",sealed:"gift",priority:"mail",priority_sealed:"star"};
const alerts={snow:"Сугроб · очисти плуг",bearing:"Удар по редуктору",frost:"Метель · нужен фонарь"};
const actionCopy={
  furnace:"Подбросить уголь",repair:"Починить редуктор",plow:"Сбросить снег",bridge:"Выбрать мост",
  valley:"Выбрать долину",seal:"Упаковать",cargo:"Погрузить",dispatch:"Дать сигнал",
  coal:"Взять уголь",parts:"Взять деталь",parcel:"Взять посылку",lamp:"Зажечь фонарь",
  station_coal:"Взять уголь",station_parts:"Взять деталь",station_parcel:"Взять посылку",station_signal:"Взять срочную посылку",
};
function actionLabel(id,player){
  return id==="store"?(player.hand?"Оставить в кладовой":"Забрать из кладовой"):actionCopy[id]||"Действие";
}
const activePhase=phase=>phase==="playing"||phase==="countdown";
const beforeTrip=phase=>phase==="menu"||phase==="lobby";
const names={bridge:"Ледяной мост",valley:"Тихая долина"};
const svgPaths={
  star:"<path d='m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z'/>",
  arrow:"<path d='M4 12h15m-6-6 6 6-6 6'/>",
  close:"<path d='m6 6 12 12M18 6 6 18'/>",
  clock:"<circle cx='12' cy='12' r='8'/><path d='M12 7v5l3 2'/>",
  coal:"<path d='m3 15 3-8 9-3 6 7-3 8H8Zm3-8 7 5 2-8m-2 8 5 7'/>",
  box:"<path d='M4 7l8-4 8 4v10l-8 4-8-4Zm0 0 8 4 8-4m-8 4v10M8 5l8 4'/>",
  lamp:"<path d='M10 6V4a2 2 0 0 1 4 0v2m-7 0h10l2 3H5Zm0 3 1 9h8l1-9M6 21h12m-6-9v3'/>",
  switch:"<path d='M12 21v-9m0 3 6-9m-6 6L6 6m8 1 4-1 1 4M5 10l1-4 4 1'/>",
  bell:"<path d='M18 9a6 6 0 0 0-12 0c0 5-3 6-3 8h18c0-2-3-3-3-8Zm-8 11c1 2 3 2 4 0'/>",
  mail:"<rect x='3' y='5' width='18' height='14' rx='2'/><path d='m3 7 9 6 9-6'/>",
  look:"<path d='M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z'/><circle cx='12' cy='12' r='2.5'/>",
  move:"<path d='M12 2v20M2 12h20M9 5l3-3 3 3m-6 14 3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3'/>",
  train:"<rect x='5' y='3' width='14' height='15' rx='4'/><path d='M6 11h12M8 18l-2 3m10-3 2 3M9 15h.01M15 15h.01M12 3v8'/>",
  back:"<path d='m14 5-7 7 7 7M7 12h13'/>",
  help:"<circle cx='12' cy='12' r='9'/><path d='M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2.5M12 17h.01'/>",
  hand:"<path d='M7 11V5a1.5 1.5 0 0 1 3 0v5-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v6-2a1.5 1.5 0 0 1 3 0v5a5 5 0 0 1-5 5h-2c-2 0-3-.8-4-2l-3-4a1.5 1.5 0 0 1 2-2l2 1'/>",
  heat:"<path d='M13 2c.6 4-3 4-2 8 1-1 2-1 3-3 4 3 6 6 4 10a7 7 0 0 1-12 0c-2-4 1-8 3-9 0 2 1 3 1 3'/>",
  tool:"<path d='m14 7 4-4 3 3-4 4M9 14l-5 5m2 2 5-5m0-11-3 3 8 8 3-3M3 5l2-2 3 2-3 3Z'/>",
  snow:"<path d='M12 3v18M4 7l16 10M4 17l16-10M9 5l3 3 3-3M9 19l3-3 3 3'/>",
  gift:"<rect x='4' y='7' width='16' height='14' rx='2'/><path d='M12 7v14M4 12h16M12 7c-5 0-7-5-3-5 2 0 3 5 3 5Zm0 0c5 0 7-5 3-5-2 0-3 5-3 5Z'/>",
};
const svg=key=>'<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+svgPaths[key]+'</svg>';
const panel=body=>'<section class="train-panel">'+body+'</section>';
const btn=(action,label,kind="primary")=>'<button type="button" class="train-'+kind+'" data-action="'+action+'">'+label+'</button>';
const timed=t=>Math.floor(t/60)+":"+String(Math.floor(t%60)).padStart(2,"0");

const guideSteps=[
  ["box","Возьми посылку","Посылки лежат на полке в грузовом вагоне. На неё смотришь в начале рейса."],
  ["gift","Упакуй и погрузи","Повернись к столу рядом, упакуй подарок и отнеси в лоток у другого конца вагона."],
  ["train","Довези заказ","Сверху видно, сколько подарков ждёт следующая станция. Выгрузка автоматическая."],
];
const guideRows=[
  ["heat","Топка","Уголь в служебном вагоне. Отнеси его в топку, когда жар падает."],
  ["tool","Редуктор","Запчасти там же. Неси их к редуктору после удара."],
  ["snow","Плуг","Рычаг в локомотиве. Очищай сразу после сугроба, пока поезд не замедлился."],
  ["lamp","Фонарь","Зажги в служебном вагоне до последнего перегона, чтобы смягчить удар метели."],
  ["switch","Развилка","Рычаги в локомотиве доступны перед первой станцией и на её стоянке. Мост короче, но бьёт по редуктору. Долина безопаснее."],
  ["box","Кладовая","Оставь предмет для напарника. Упакованный подарок останется упакованным."],
  ["mail","Срочные посылки","На двух остановках ищи золотую посылку у звезды. Забери её, упакуй и погрузи. Это задание для игроков."],
  ["bell","Двери и сигнал","На остановке до 29 секунд. Подай сигнал после первых 8 секунд, если все на борту. В конце стоянки проводник вернёт опоздавших без предмета."],
];
const guideList=rows=>rows.map(([icon,title,body])=>'<li>'+svg(icon)+'<div><b>'+title+'</b><p>'+body+'</p></div></li>').join("");
const guideMarkup=()=>'<div class="train-guide-body"><header class="train-guide-top">'+
  '<strong>Как играть</strong><button type="button" data-action="close-guide" aria-label="Закрыть правила">'+svg("close")+'</button></header>'+
  '<div class="train-guide-hero"><div class="train-guide-emblem">'+svg("train")+'</div><h1 id="train-guide-title">Полярный экспресс</h1>'+
  '<p>У каждой из трёх станций свой заказ. Чтобы выиграть, выполни общий план доставки к концу рейса. Три звезды получишь за выполнение каждого заказа и срочную посылку.</p></div>'+
  '<section class="train-guide-section"><h2>Первые три действия</h2><ol class="train-guide-steps">'+guideList(guideSteps)+'</ol></section>'+
  '<section class="train-guide-section train-guide-controls"><h2>Управление</h2><p>Стик слева — идти, свайп по сцене — смотреть. Наведи прицел на предмет и нажми кнопку справа. На компьютере — WASD, мышь и E.</p></section>'+
  '<details class="train-guide-section train-guide-details"><summary>Поезд, остановки и срочный груз</summary><ul>'+guideList(guideRows)+'</ul><p>В одиночку можно взять помощников. Они работают наравне с тобой. Успевай помочь им с топкой, доставкой или станцией, где осталась работа.</p></details>'+
  '<footer class="train-guide-footer">'+btn("close-guide","В лобби")+'</footer></div>';

class PolarExpress {
  constructor(modal, registerCleanup){
    this.modal=modal;
    this.root=modal.querySelector(".train-screen");
    this.canvas=this.root.querySelector("canvas");
    this.layer=this.root.querySelector(".train-layer");
    this.hud=this.root.querySelector(".train-hud");
    this.hudFields=Object.fromEntries([...this.hud.querySelectorAll("[data-train]")].map(el=>[el.dataset.train,el]));
    this.guide=this.root.querySelector(".train-guide");
    this.helpButton=this.root.querySelector("[data-action=help]");
    this.context=this.root.querySelector(".train-context");
    this.notice=this.root.querySelector(".train-notice");
    this.prompt=this.root.querySelector(".train-prompt");
    this.net=this.root.querySelector("[data-train=network]");
    this.controls=this.root.querySelector(".train-controls");
    this.useButton=this.controls.querySelector(".train-use");
    this.joy=this.controls.querySelector(".train-move");
    this.knob=this.joy.querySelector("i");
    this.preferences=getSettings();
    this.sfx=new GameAudio();
    this.sfx.unlock();
    this.keys=new Set();
    this.listeners=[];
    this.samples=[];
    this.seq=0;
    this.phase="loading";
    this.yaw=0;
    this.pitch=0;
    this.move={x:0,z:0};
    this.eventId=0;
    this.generation=0;
    this.nextSend=0;
    this.nextUI=0;
    this.foot=0;
    this.lastFrame=0;
    this.bind();
    registerCleanup(()=>this.destroy(),hidden=>this.visibility(hidden));
    this.viewport=document.querySelector('meta[name="viewport"]');
    this.oldViewport=this.viewport?.getAttribute("content");
    if(this.oldViewport)this.viewport.setAttribute("content",this.oldViewport+",maximum-scale=1,user-scalable=no");
    this.pingTimer=setInterval(()=>this.ping(),3500);
    this.boot();
  }

  listen(el,type,handler,opts){
    el.addEventListener(type,handler,opts);
    this.listeners.push(()=>el.removeEventListener(type,handler,opts));
  }

  bind(){
    this.listen(this.root,"click",event=>{
      const button=event.target.closest("[data-action]");
      if(button&&!button.disabled)this.action(button.dataset.action);
    });
    this.listen(this.root,"submit",event=>{
      if(!event.target.matches(".train-join"))return;
      event.preventDefault();
      const code=event.target.elements.code.value.trim().toUpperCase();
      if(this.guideOpen)return;
      if(!/^[A-Z2-9]{6}$/.test(code)){this.toast("Введи шесть символов кода");return;}
      this.request("/join",{code},true);
    });
    this.listen(this.root,"change",event=>{
      if(event.target.matches("[data-train=bots]"))this.request("/bots",{bots:event.target.checked});
    });

    this.listen(this.joy,"pointerdown",e=>{
      if(!this.controlling()||this.joyId!=null||e.button!==0)return;
      e.preventDefault();this.sfx.unlock();
      this.joyId=e.pointerId;this.joyOrigin=[e.clientX,e.clientY];
      try{this.joy.setPointerCapture(e.pointerId);}catch(_){this.joyId=null;}
    },{passive:false});
    this.listen(this.joy,"pointermove",e=>{
      if(this.joyId!==e.pointerId)return;
      this.move=stickInput(e.clientX-this.joyOrigin[0],e.clientY-this.joyOrigin[1]);
      this.knob.style.transform="translate("+this.move.x*22+"px,"+this.move.z*22+"px)";
    });
    for(const type of ["pointerup","pointercancel","lostpointercapture"]){
      this.listen(this.joy,type,e=>{
        if(this.joyId!==e.pointerId)return;
        this.joyId=null;this.move={x:0,z:0};this.knob.style.transform="";
      });
    }
    this.listen(this.useButton,"pointerdown",e=>{
      if(!this.controlling()||e.button!==0)return;
      e.preventDefault();
      this.beginUse();
    },{passive:false});
    this.listen(this.useButton,"click",e=>{if(e.detail===0)this.beginUse();});
    this.listen(this.useButton,"pointercancel",()=>{this.useUntil=0;});
    this.listen(this.canvas,"pointerdown",e=>{
      if(!this.controlling()||e.button!==0)return;
      e.preventDefault();this.sfx.unlock();
      if(document.pointerLockElement===this.canvas)return;
      this.lookPointer={id:e.pointerId,x:e.clientX,y:e.clientY,touch:e.pointerType!=="mouse"};
      try{this.canvas.setPointerCapture(e.pointerId);}catch(_){}
      if(e.pointerType==="mouse"){
        try{this.canvas.requestPointerLock?.()?.catch?.(()=>{});}catch(_){}
      }
    },{passive:false});
    this.listen(this.canvas,"pointermove",e=>{
      const look=this.lookPointer;
      if(look?.id!==e.pointerId||document.pointerLockElement===this.canvas)return;
      this.turn(e.clientX-look.x,e.clientY-look.y,look.touch);
      look.x=e.clientX;look.y=e.clientY;
    });
    for(const type of ["pointerup","pointercancel","lostpointercapture"]){
      this.listen(this.canvas,type,e=>{if(this.lookPointer?.id===e.pointerId)this.lookPointer=null;});
    }
    this.listen(document,"pointerlockchange",()=>{
      if(document.pointerLockElement===this.canvas)this.lookPointer=null;
    });
    this.listen(document,"mousemove",e=>{
      if(this.controlling()&&document.pointerLockElement===this.canvas)this.turn(e.movementX,e.movementY,false);
    });
    this.listen(document,"keydown",e=>this.key(e,true),true);
    this.listen(document,"keyup",e=>this.key(e,false),true);
    this.listen(window,"blur",()=>this.stopInput());
    this.listen(window,"resize",()=>{this.stopInput();this.scene?.resize();});
    this.listen(this.canvas,"dblclick",e=>e.preventDefault(),{passive:false});
    this.listen(this.canvas,"arena-graphics-lost",()=>this.error("3D-графика остановилась. Открой игру ещё раз."));
    if(window.ResizeObserver){
      this.observer=new ResizeObserver(()=>this.scene?.resize());
      this.observer.observe(this.canvas);
    }
  }

  async boot(){
    this.layer.innerHTML=panel("<h2>Готовим поезд</h2>");
    try{
      const {map,current}=await get(API+"/status",{cache:false});
      if(this.disposed)return;
      if(map.version!==2)throw Error("Обнови игру, чтобы получить новый маршрут.");
      this.map=map;
      this.prediction=new TrainPrediction(map);
      this.scene=new TrainScene(this.canvas,map,this.preferences);
      if(current){this.receive(current);this.connect();}
      else this.menu();
      this.frameId=requestAnimationFrame(now=>this.frame(now));
    }catch(e){if(!this.disposed)this.error(e.message);}
  }

  key(e,down){
    const key={KeyW:"w",KeyA:"a",KeyS:"s",KeyD:"d",KeyE:"e",Space:" "}[e.code]||e.key.toLowerCase();
    if(!down){this.keys.delete(key);return;}
    if(!this.root.isConnected||e.target.matches("input,textarea"))return;
    if(key==="escape"){
      e.preventDefault();e.stopPropagation();
      if(!e.repeat)this.action(this.guideOpen?"close-guide":this.overlay?"resume":"back");
      return;
    }
    if(!this.controlling())return;
    if(key==="e"||key===" "){
      e.preventDefault();
      if(!e.repeat)this.beginUse();
      return;
    }
    if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(key)){
      e.preventDefault();this.keys.add(key);
    }
  }

  turn(dx,dy,touch){
    this.yaw+=dx*(touch?.0064:.00315);
    if(Math.abs(this.yaw)>12.57)this.yaw%=Math.PI*2;
    this.pitch=clamp(this.pitch-dy*(touch?.0048:.0027),-1.37,1.28);
  }

  controlling(){
    return this.phase==="playing"&&!this.overlay&&!document.hidden&&
      this.socket?.readyState===WebSocket.OPEN&&this.me()!=null;
  }

  me(){return this.room?.game?.actors.find(p=>p.id===this.room.me);}

  beginUse(){
    if(!this.controlling())return;
    const p=this.local||this.me(),g=this.room.game,target=focusAt(this.map,g,p,this.yaw);
    if(!target)return;
    if(!p.actions.includes(target)){this.sfx.play("miss",{level:.43});return;}
    this.sfx.unlock();
    this.useTarget=target;
    this.useUntil=performance.now()+Math.max(480,1000*this.map.work[target][3]+325);
    this.nextSend=0;
    this.sfx.play("click",{level:.44});
  }

  stopInput(){
    this.keys.clear();this.joyId=null;this.lookPointer=null;this.knob.style.transform="";
    this.move={x:0,z:0};this.useUntil=0;this.useTarget="";
    if(document.pointerLockElement===this.canvas)document.exitPointerLock?.();
    if(this.socket?.readyState===WebSocket.OPEN&&this.phase==="playing")this.send({x:0,z:0,use:false});
  }

  menu(){
    this.room=null;this.local=null;this.samples=[];this.prediction?.reset();this.overlay=false;
    this.setPhase("menu");this.net.textContent="";
    this.layer.innerHTML=panel('<h1>Полярный<br>экспресс</h1>'+
      '<p>Доставь подарки в три станции. Можно играть одному или экипажем до четырёх.</p>'+
      '<div class="train-menu-route">'+this.map.stations.map((name,i)=>'<span><i>'+(i+1)+'</i>'+escapeText(name)+'</span>').join("")+'</div>'+
      btn("create","Собрать экипаж")+btn("practice","Рейс с помощниками","secondary")+
      '<form class="train-join"><label><span>Код комнаты</span><input name="code" minlength="6" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" required placeholder="••••••"></label><button type="submit">Войти</button></form>');
    this.maybeGuide();
  }

  setPhase(phase){
    this.phase=phase;this.root.dataset.phase=phase;
    const active=activePhase(phase);
    this.helpButton.hidden=!beforeTrip(phase);
    if(!beforeTrip(phase)&&this.guideOpen)this.closeGuide();
    if(active){
      this.notice.classList.remove("is-visible");
      this.notice.textContent="";
    }
    this.hud.hidden=!active;this.controls.hidden=phase!=="playing";this.prompt.hidden=phase!=="playing";
    if(!active){
      this.stopInput();
      this.sfx.ambient("rail",0);this.sfx.ambient("boiler",0);this.sfx.ambient("iceWind",0);
    }
  }

  guideKey(){
    const me=window.kov.me;
    return "kov-train-guide-v2:"+(me?.id??me?.telegram_id??"device");
  }

  maybeGuide(){
    if(this.guideOpen||!beforeTrip(this.phase))return;
    const key=this.guideKey();
    if(guideSeen.has(key))return;
    try{if(localStorage.getItem(key)==="1")return;}catch(_){}
    this.help();
    guideSeen.add(key);
    try{localStorage.setItem(key,"1");}catch(_){}
  }

  help(){
    if(this.guideOpen||!beforeTrip(this.phase))return;
    this.guideOpen=true;
    this.root.classList.add("is-guide-open");
    this.guide.hidden=false;
    if(!this.guide.firstElementChild)this.guide.innerHTML=guideMarkup();
    this.guide.scrollTop=0;
    this.guide.focus({preventScroll:true});
    this.stopInput();
  }

  closeGuide(){
    if(!this.guideOpen)return;
    this.guideOpen=false;
    this.guide.hidden=true;
    this.root.classList.remove("is-guide-open");
    if(beforeTrip(this.phase))this.helpButton.focus({preventScroll:true});
  }

  error(message){
    this.overlay=true;this.setPhase("error");
    this.layer.innerHTML=panel('<h2>Рейс недоступен</h2><p>'+escapeText(message)+'</p>'+btn("exit","В Аркады","secondary"));
  }

  async action(action){
    if(this.disposed||this.guideOpen&&action!=="close-guide")return;
    this.sfx.unlock();this.sfx.play("click",{level:.44});
    switch(action){
      case "create":return this.request("/rooms",{bots:true},true);
      case "practice":this.practice=true;return this.request("/rooms",{bots:true},true);
      case "start":return this.request("/start");
      case "lobby":return this.request("/lobby");
      case "copy":
        try{await navigator.clipboard.writeText(this.room.room);this.toast("Код скопирован");}
        catch(_){this.toast("Код: "+this.room.room);}
        return;
      case "help":return this.help();
      case "close-guide":return this.closeGuide();
      case "resume":
        this.overlay=false;
        return this.room?this.show(this.room,true):this.menu();
      case "reconnect":this.retry=0;this.overlay=false;this.paintOnConnect=true;return this.connect();
      case "back":
        if(this.phase==="playing"||this.phase==="countdown"){
          this.overlay=true;this.stopInput();
          this.layer.innerHTML=panel('<h2>Выйти из рейса?</h2><p>Экипаж продолжит поездку.</p>'+
            btn("resume","Остаться")+btn("exit","Выйти в Аркады","secondary"));
          return;
        }
        window.closeModal();return;
      case "leave":await this.leave();if(!this.disposed)this.menu();return;
      case "exit":window.closeModal();return;
    }
  }

  async request(path,body={},join=false){
    if(this.busy||this.disposed||this.guideOpen)return;
    this.busy=true;
    this.root.setAttribute("aria-busy","true");
    try{
      const state=await post(API+path,body);
      if(this.disposed||this.leaving){
        if(join&&state.room)await post(API+"/leave",{code:state.room}).catch(()=>{});
        return;
      }
      this.receive(state);
      if(join)this.connect();
    }catch(e){
      if(!this.disposed){
        this.practice=false;this.toast(e.message);
        if(this.phase==="lobby")this.show(this.room,true);
      }
    }finally{
      this.busy=false;this.root.removeAttribute("aria-busy");
    }
  }

  async connect(){
    if(this.connecting||this.disposed||!this.room||this.socket?.readyState===WebSocket.OPEN)return;
    this.connecting=true;
    const generation=++this.generation;
    this.net.textContent="Подключение…";
    try{
      const ticket=await post(API+"/ticket",{});
      if(this.disposed||generation!==this.generation)return;
      const url=new URL(ticket.path,location.href);
      url.protocol=location.protocol==="https:"?"wss:":"ws:";
      const socket=new WebSocket(url);
      this.socket=socket;this.seq=0;
      socket.onopen=()=>{
        if(socket!==this.socket){socket.close();return;}
        this.lastPacket=performance.now();
        socket.send(JSON.stringify({ticket:ticket.ticket}));
      };
      socket.onmessage=e=>{
        if(socket!==this.socket||this.disposed)return;
        let data;
        try{data=JSON.parse(e.data);}catch(_){return;}
        this.lastPacket=performance.now();
        if(data.type==="left"){this.socket=null;socket.close();this.menu();return;}
        if(data.type!=="state")return;
        this.retry=0;this.replaced=false;this.net.textContent="В сети";
        this.receive(data);
        if(this.paintOnConnect){this.paintOnConnect=false;this.show(this.room,true);}
        if(this.practice&&data.owner&&!data.game&&!this.busy){
          this.practice=false;this.request("/start");
        }
      };
      socket.onclose=e=>{
        if(socket!==this.socket||this.disposed)return;
        this.socket=null;this.stopInput();
        if(e.code===4001){
          this.replaced=true;this.overlay=true;
          this.net.textContent="Другое окно";
          this.layer.innerHTML=panel('<h2>Рейс открыт в другом окне</h2>'+
            btn("reconnect","Играть здесь")+btn("exit","В Аркады","secondary"));
        }else this.retryConnection();
      };
    }catch(e){
      if(this.disposed||generation!==this.generation)return;
      if(e.status===404){this.menu();this.toast("Комната закрыта");}
      else this.retryConnection();
    }finally{if(generation===this.generation)this.connecting=false;}
  }

  retryConnection(){
    clearTimeout(this.retryTimer);
    this.net.textContent="Связь потеряна";
    this.retry=(this.retry||0)+1;
    if(this.retry<=7){
      this.retryTimer=setTimeout(()=>this.connect(),Math.min(4500,500*this.retry));
      return;
    }
    this.overlay=true;
    this.layer.innerHTML=panel('<h2>Соединение прервалось</h2>'+btn("reconnect","Переподключиться")+
      btn("leave","Вернуться к выбору","secondary"));
  }

  ping(){
    if(this.socket?.readyState!==WebSocket.OPEN)return;
    if(!document.hidden&&performance.now()-this.lastPacket>8000)this.socket.close();
    else this.socket.send('{"type":"ping"}');
  }

  async leave(){
    if(this.leaving)return;
    this.leaving=true;
    this.stopInput();this.generation++;this.connecting=false;
    clearTimeout(this.retryTimer);
    const socket=this.socket;this.socket=null;socket?.close();
    if(this.room&&!this.replaced)await post(API+"/leave",{code:this.room.room}).catch(()=>{});
    this.room=null;this.leaving=false;this.replaced=false;this.practice=false;
  }

  receive(data){
    if(!data||data.type!=="state"||this.disposed||this.leaving)return;
    const old=this.room?.game,g=data.game;
    if(g&&old&&old.seed===g.seed&&old.tick>g.tick)return;
    this.room=data;
    if(!g){this.samples=[];this.local=null;}
    if(g&&g.seed!==old?.seed){
      this.samples=[];
      this.local=null;this.prediction.reset();this.serverOffset=null;
      this.eventId=0;this.countNumber=null;this.finishKey="";this.lobbyKey="";
      const me=this.me();
      if(me){this.yaw=Math.atan2(me.ax,-me.az);this.pitch=me.pitch;}
      this.overlay=false;this.foot=0;this.useUntil=0;
    }
    if(g){
      if(!old||g.tick!==old.tick||!this.samples.length){
        const at=performance.now(), serverAt=g.tick*this.map.step*1000;
        const offset=at-serverAt;
        this.serverOffset=this.serverOffset==null||Math.abs(offset-this.serverOffset)>500?offset:
          this.serverOffset+(offset-this.serverOffset)*(offset<this.serverOffset?.24:.034);
        this.samples.push({at,serverAt,actors:g.actors});
        if(this.samples.length>6)this.samples.shift();
      }
      for(const e of g.events){
        if(e.id<=this.eventId)continue;
        this.eventId=e.id;
        if(g.tick-e.tick<16)this.effect(e,g);
      }
    }
    this.show(data);
  }

  show(data,force=false){
    if(!data)return;
    const before=this.phase,g=data.game,phase=g?.phase||"lobby";
    if(phase!==before)this.setPhase(phase);
    if(this.overlay&&!force)return;
    if(!g){
      const key=JSON.stringify([data.members,data.owner,data.bots]);
      if(key===this.lobbyKey&&!force&&before==="lobby")return;
      this.lobbyKey=key;
      const roster=data.members.map(m=>'<li><b>'+escapeText(m.name)+'</b><small>'+
        (m.id===data.me?"Ты":m.owner?"Хост":m.connected?"В сети":"Подключается")+'</small></li>');
      for(let i=roster.length;i<4;i++)roster.push('<li><b>'+(data.bots?"Помощник":"Свободное место")+'</b><small>'+
        (data.bots?"Бот":"—")+'</small></li>');
      this.layer.innerHTML=panel('<h2>Экипаж</h2>'+
        '<button type="button" class="train-code" data-action="copy"><small>Код комнаты · скопировать</small><strong>'+data.room+'</strong></button>'+
        '<ul class="train-roster">'+roster.join("")+'</ul>'+
        (data.owner?'<label class="train-bots"><span>Свободные места заполняют помощники</span><input type="checkbox" data-train="bots" '+(data.bots?"checked":"")+'></label>'+
        '<button type="button" class="train-primary" data-action="start" '+(data.members.some(m=>m.id===data.me&&m.connected)?"":"disabled")+'>Отправить поезд</button>':
        '<p>Рейс запустит создатель комнаты.</p>')+btn("leave","Выйти из комнаты","secondary"));
      this.maybeGuide();
      return;
    }
    if(g.phase==="countdown"){
      const number=Math.ceil(g.countdown);
      if(number===this.countNumber&&!force)return;
      this.countNumber=number;this.sfx.play("countdown");
      this.layer.innerHTML='<div class="train-countdown"><strong>'+number+'</strong></div>';
    }else if(g.phase==="finished"){
      const key=g.seed+":"+data.owner;
      if(key===this.finishKey&&!force)return;
      this.finishKey=key;
      const manifest=g.manifest;
      const rows=this.map.stations.map((name,i)=>'<li><b>'+escapeText(name)+'</b><small>'+
        (i<=g.leg&&(i<g.leg||manifest.reached)?manifest.unloaded[i]+" / "+manifest.orders[i]:"—")+'</small></li>').join("");
      const stars=Array.from({length:3},(_,i)=>'<span class="'+(i<manifest.stars?"earned":"")+'">'+svg("star")+'</span>').join("");
      this.layer.innerHTML=panel('<div class="train-result-stars" aria-label="'+manifest.stars+' звезды из 3">'+stars+'</div>'+
        '<h2>'+(g.winner?"Заказ выполнен":manifest.reached?"Поезд в терминале":"Рейс остановлен")+'</h2>'+
        '<p>'+escapeText(g.reason)+' · '+timed(g.time)+'</p>'+
        '<div class="train-summary"><span><strong>'+g.delivered+' / '+manifest.total+'</strong>доставлено</span><span><strong>'+manifest.express+'</strong>срочные</span></div>'+
        '<ul class="train-roster">'+rows+'</ul>'+(data.owner?btn("lobby","Новый рейс"):"")+btn("leave","К выбору игры","secondary"));
    }else if(force||before!=="playing")this.layer.innerHTML="";
  }

  effect(event,g){
    const local=event.actor===this.room.me,me=this.me();
    const at=local?{level:.87}:spatialAudio(me,event.x,event.z,this.yaw,8);
    if(event.kind==="work"){
      const target=event.target;
      const sound=target==="seal"||target==="cargo"?"delivery":target==="furnace"?"furnace":
        target==="repair"||target==="plow"?"wrench":target==="bridge"||target==="valley"||target==="dispatch"?"whistle":"gift";
      this.sfx.play(sound,at);
      if(local)this.useUntil=0;
    }else if(event.kind==="start"||event.kind==="depart"||event.kind==="arrive"){
      this.sfx.play("whistle",{level:.78});
    }else if(event.kind==="hazard"){
      this.sfx.play(event.hazard==="snow"||event.hazard==="frost"?"storm":"wrench",{level:.72});
    }else if(event.kind==="recall"&&local){
      this.useUntil=0;this.sfx.play("whistle",{level:.6});
    }else if(event.kind==="finish")this.sfx.play(g.winner?"finish":"fail");
  }

  toast(message){
    if(!message||activePhase(this.phase))return;
    this.notice.textContent=message;this.notice.classList.add("is-visible");
    clearTimeout(this.toastTimer);
    this.toastTimer=setTimeout(()=>this.notice.classList.remove("is-visible"),3100);
  }

  control(dt){
    if(!this.controlling())return {x:0,z:0,use:false};
    const keys=this.keys;
    this.yaw+=(Number(keys.has("arrowright"))-Number(keys.has("arrowleft")))*dt*1.82;
    const x=this.move.x+Number(keys.has("d"))-Number(keys.has("a"));
    const z=this.move.z+Number(keys.has("s")||keys.has("arrowdown"))-Number(keys.has("w")||keys.has("arrowup"));
    const scale=Math.max(1,Math.hypot(x,z)),sin=Math.sin(this.yaw),cos=Math.cos(this.yaw);
    const p=this.local||this.me(),g=this.room.game;
    const work=this.useUntil>performance.now()&&workScore(this.map,g,p,this.yaw,this.useTarget)!=null?this.useTarget:"";
    return {x:(x*cos-z*sin)/scale,z:(x*sin+z*cos)/scale,use:!!work,work};
  }

  send(input){
    if(this.socket?.readyState!==WebSocket.OPEN||this.socket.bufferedAmount>4096)return;
    this.socket.send(JSON.stringify({type:"input",seq:++this.seq,mx:input.x,mz:input.z,
      ax:Math.sin(this.yaw),az:-Math.cos(this.yaw),pitch:this.pitch,fire:input.use,work:input.work||""}));
  }

  sample(game,now){
    if(!game)return [];
    const when=now-this.serverOffset-128;
    let a=this.samples[0],b=this.samples.at(-1);
    if(!a||!b)return game.actors;
    for(let i=1;i<this.samples.length;i++){
      if(this.samples[i].serverAt<when){a=this.samples[i];continue;}
      b=this.samples[i];break;
    }
    const ratio=a===b?1:clamp((when-a.serverAt)/(b.serverAt-a.serverAt),0,1);
    return game.actors.map(p=>{
      const previous=a.actors.find(q=>q.id===p.id),next=b.actors.find(q=>q.id===p.id);
      if(!previous||!next||previous.warp!==next.warp||next.warp!==p.warp)return p;
      const pose={...p,x:previous.x+(next.x-previous.x)*ratio,z:previous.z+(next.z-previous.z)*ratio};
      if(when>b.serverAt){
        advanceMotion(this.map,pose,{x:p.vx/this.map.speed,z:p.vz/this.map.speed},game.travel,
          clamp((when-b.serverAt)/1000,0,.068));
      }
      return pose;
    });
  }

  updateHUD(g,player,target){
    if(!g||!player)return;
    const set=(id,value)=>{
      const el=this.hudFields[id];
      if(el.textContent!==value)el.textContent=value;
    };
    for(const key of ["heat","hull","snow"])set(key,Math.round(g[key])+"%");
    this.hudFields.heat.parentElement.classList.toggle("is-low",g.heat<31);
    this.hudFields.hull.parentElement.classList.toggle("is-low",g.hull<45||g.fault);
    this.hudFields.snow.parentElement.classList.toggle("is-low",g.snow>59);
    const manifest=g.manifest;
    set("cargo",g.travel?g.loaded+"/"+manifest.stage:manifest.unloaded[g.leg]+"/"+manifest.stage);
    this.hudFields.cargo.parentElement.classList.toggle("is-complete",(g.travel?g.loaded:manifest.unloaded[g.leg])>=manifest.stage);
    const station=this.map.stations[g.leg];
    const critical=g.critical>0;
    set("destination",critical?"Авария · восстанови поезд":
      g.hazard?alerts[g.hazard]:g.travel?station:(g.stop_timer<7?"Вернись в вагон":"Стоянка · "+station));
    set("delivered",String(g.delivered)+"/"+manifest.total);
    this.hudFields.delivered.parentElement.hidden=g.travel&&g.leg===0;
    if(this.hud.dataset.leg!==String(g.leg))this.hud.dataset.leg=g.leg;
    const timer=this.hudFields.timer.parentElement;
    timer.hidden=!critical&&g.travel;
    timer.classList.toggle("is-low",critical);
    set("timer",String(Math.max(0,Math.ceil(critical?this.map.recovery-g.critical:g.stop_timer))));
    const ready=target&&player.actions.includes(target);
    this.prompt.classList.toggle("is-target",Boolean(target));
    this.prompt.classList.toggle("is-blocked",!ready);
    const button=this.useButton,icon=target==="station_signal"?"star":targetIcons[target]||"hand";
    button.classList.toggle("is-ready",Boolean(ready));
    if(button.dataset.icon!==icon){
      button.dataset.icon=icon;
      button.innerHTML=svg(icon);
    }
    const label=actionLabel(target,player);
    this.context.hidden=!ready;
    if(this.context.textContent!==label)this.context.textContent=label;
    if(button.getAttribute("aria-label")!==label)button.setAttribute("aria-label",label);
    const hand=this.hudFields.hand;
    if(hand.dataset.icon!==player.hand){
      hand.dataset.icon=player.hand||"";
      hand.hidden=!handIcons[player.hand];
      hand.innerHTML=hand.hidden?"":svg(handIcons[player.hand]);
    }
    const work=target&&player.progress&&player.target===target?
      clamp(player.progress/this.map.work[target][3],0,1):0;
    this.prompt.style.setProperty("--work",work*100+"%");
    this.prompt.classList.toggle("is-working",work>0);
  }

  frame(now){
    if(this.disposed)return;
    if(!document.hidden&&!this.guideOpen){
      const game=this.room?.game,player=this.me();
      const interval=game?.phase==="playing"?0:32;
      if(now-this.lastFrame>=interval){
        const dt=clamp((now-(this.lastFrame||now))/1000,0,.08);
        this.lastFrame=now;
        const start=performance.now();
        const input=this.control(dt);
        if(this.controlling()&&now>=this.nextSend){
          this.send(input);this.nextSend=now+34;
        }
        const last=this.samples.at(-1);
        const p=this.local=this.prediction.update(player,game,input,last,now,dt);
        const target=p?(input.work||focusAt(this.map,game,p,this.yaw)):"";
        const sampleAt=last?last.serverAt+this.serverOffset:now;
        const track=game?game.track+(game.travel?game.speed*clamp((now-sampleAt)/1000,0,.17):0):0;
        this.scene.drawJourney(game,{local:p,actors:this.sample(game,now),me:this.room?.me,track,
          yaw:this.yaw,pitch:this.pitch,target:target&&p.actions.includes(target)?target:"",
          firstPerson:game?.phase==="playing",progress:p?.progress},dt);
        if(p&&game?.phase==="playing"){
          const speed=Math.hypot(p.vx,p.vz);
          this.foot+=speed*dt;
          if(this.foot>1.02){
            this.foot=0;this.sfx.play(p.x>1.48?"foot":"trainStep",{level:.36});
          }
        }
        this.renderCost=(this.renderCost||0)*.95+(performance.now()-start)*.05;
        if(now>=this.nextUI){
          this.nextUI=now+72;
          this.updateHUD(game,p,target);
          this.root.dataset.renderMs=this.renderCost.toFixed(2);
          const active=game?.phase==="playing",trainSpeed=active?game.speed:0;
          this.sfx.ambient("rail",Math.min(.27,trainSpeed*.055),.66+trainSpeed*.075);
          this.sfx.ambient("boiler",active&&p&&p.z<-.8?.23:0,.86+(game?.heat||0)*.003);
          this.sfx.ambient("iceWind",active&&p?.x>1.48?.40:active?.098:0);
        }
      }
    }
    this.frameId=requestAnimationFrame(t=>this.frame(t));
  }

  visibility(hidden){
    this.stopInput();
    if(hidden)this.sfx.silence();
    else {this.lastFrame=0;this.prediction?.reset();}
  }

  destroy(){
    this.disposed=true;this.leave();
    cancelAnimationFrame(this.frameId);clearInterval(this.pingTimer);clearTimeout(this.toastTimer);
    this.observer?.disconnect();this.listeners.forEach(remove=>remove());
    this.scene?.dispose();this.sfx.dispose();
    if(this.oldViewport)this.viewport.setAttribute("content",this.oldViewport);
  }
}

const meter=(key,label,icon,hidden=false)=>'<span class="train-stat" aria-label="'+label+'"'+(hidden?' hidden':'')+'>'+svg(icon)+
  '<strong data-train="'+key+'">—</strong></span>';

export function openPolarExpress({registerCleanup}){
  const modal=window.kov.showModal(
    '<div class="train-screen" data-phase="loading"><canvas class="train-canvas" aria-label="Вид из вагона Полярного экспресса от первого лица"></canvas>'+
    '<header class="train-top"><button type="button" class="train-icon" data-action="back" aria-label="Назад">'+svg("back")+'</button>'+
    '<div class="train-brand">'+svg("train")+'<span>Полярный экспресс</span></div><span data-train="network" role="status"></span>'+
    '<button type="button" class="train-icon" data-action="help" aria-label="Как играть" hidden>'+svg("help")+'</button></header>'+
    '<div class="train-hud" hidden><div class="train-hud-row train-hud-left">'+meter("heat","Топка","heat")+meter("hull","Редуктор","tool")+'</div>'+
    '<div class="train-hud-center"><span class="train-destination" data-train="destination"></span><div class="train-legs" aria-label="Три этапа пути"><i></i><i></i><i></i></div>'+meter("timer","Секунд осталось","clock",true)+'</div>'+
    '<div class="train-hud-row train-hud-right">'+meter("snow","Плуг","snow")+meter("cargo","Груз для станции","gift")+meter("delivered","Всего доставлено","star",true)+'</div>'+
    '<div class="train-held" aria-label="Предмет в руках" data-train="hand" hidden></div></div>'+
    '<div class="train-prompt" hidden><div class="train-crosshair"></div><span class="train-context" hidden></span></div>'+
    '<div class="train-layer"></div><div class="train-notice" role="status"></div>'+
    '<div class="train-guide" role="dialog" aria-modal="true" aria-labelledby="train-guide-title" tabindex="-1" hidden></div>'+
    '<div class="train-controls" hidden><div class="train-move" aria-label="Движение"><i></i></div>'+
    '<button class="train-use" aria-label="Действие" data-icon="hand" type="button">'+svg("hand")+'</button></div></div>',
    {label:"Полярный экспресс"});
  modal.classList.add("train-modal");
  modal.parentElement.classList.add("train-overlay");
  return new PolarExpress(modal,registerCleanup);
}

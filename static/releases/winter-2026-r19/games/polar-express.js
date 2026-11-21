import {get,post} from "../api.js";
import {escapeText} from "../ui.js";
import {getSettings} from "../pages/settings.js";
import {GameAudio,spatialAudio} from "./game-audio.js";
import {stickInput} from "./ice-controls.js";
import {TrainScene} from "./train-scene.js";

const API="/api/arcade/train";
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const gear={coal:"Уголь",parts:"Деталь",parcel:"Неупакованный подарок",sealed:"Упакованный подарок"};
const names={bridge:"Ледяной мост",valley:"Тихая долина"};
const targetText={
  furnace:"Подбросить уголь",repair:"Починить редуктор",plow:"Сбросить снег",
  bridge:"Маршрут через мост",valley:"Маршрут через долину",seal:"Упаковать подарок",
  store:"Убрать в кладовую",cargo:"Погрузить подарок",dispatch:"Подать сигнал",
  coal:"Взять уголь",parts:"Взять деталь",parcel:"Взять подарок",lamp:"Зажечь фонарь",
  station_coal:"Взять уголь",station_parts:"Взять деталь",station_parcel:"Взять подарок",
  station_signal:"Принять почту",
};
const svgPaths={
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

function inRect(x,z,b){return x>=b[0]&&x<=b[1]&&z>=b[2]&&z<=b[3];}
function canWalk(map,x,z,travel){
  return (map.train.some(b=>inRect(x,z,b))||(!travel&&map.platform.some(b=>inRect(x,z,b))))&&
    !map.obstacles.some(b=>inRect(x,z,b));
}
function focusAt(map,game,me,yaw){
  let value=-Infinity,target="";
  const ax=Math.sin(yaw),az=-Math.cos(yaw);
  for(const [id,[x,z]] of Object.entries(map.work)){
    if(id.startsWith("station_")&&game.travel)continue;
    const dx=x-me.x,dz=z-me.z,d=Math.hypot(dx,dz),dot=(dx*ax+dz*az)/Math.max(.001,d);
    if(d>1.83||(d>.33&&dot<.52))continue;
    const score=dot*.64-.43*d;
    if(score>value){value=score;target=id;}
  }
  return target;
}

function actionStatus(g,p,id){
  if(id in g.stock||id.startsWith("station_")&&id!=="station_signal"){
    const stock=g.stock[id]??g.station_stock[id]??0;
    return p.hand?"Сначала освободи руки":!stock?"Запасы закончились":"";
  }
  switch(id){
    case "furnace":return p.hand!=="coal"?"Нужен уголь из служебного вагона":g.heat>=91?"Топка уже горячая":"";
    case "repair":return p.hand!=="parts"?"Нужна деталь из служебного вагона":g.hull>=94&&!g.fault?"Редуктор исправен":"";
    case "plow":return !g.travel?"Работает на ходу":g.snow<=13?"На плуге мало снега":"";
    case "bridge":case "valley":return !g.signal_open?"Стрелка доступна перед развилкой":g.route===id?"Маршрут выбран":"";
    case "seal":return p.hand!=="parcel"?"Возьми неупакованный подарок":"";
    case "store":return !(p.hand in g.stock)&&p.hand!=="sealed"?"Сюда кладут уголь, детали и подарки":"";
    case "cargo":return p.hand!=="sealed"?"Сначала упакуй подарок":g.loaded>=9?"Лоток заполнен":"";
    case "lamp":return g.lamp?"Фонарь уже горит":g.leg!==2&&g.snow<=35?"Пригодится в сильную метель":"";
    case "station_signal":return g.signals>g.leg?"Почта уже принята":"";
    case "dispatch":
      if(g.travel)return "Дождись остановки";
      if(g.stop_elapsed<11)return "Дай экипажу время собрать припасы";
      if(g.actors.some(a=>!a.bot&&a.connected&&a.x>1.48))return "Дождись экипажа на борту";
      return "";
    default:return "";
  }
}

function briefing(game,stations){
  if(game.critical>0)return "Аварийная остановка · "+Math.ceil(21-game.critical)+" с на ремонт";
  if(!game.travel)return stations[game.leg]+" · отправление через "+Math.ceil(game.stop_timer)+" с";
  if(game.fault)return "Редуктор заедает · принеси деталь в локомотив";
  if(game.heat<31)return "Топка остывает · принеси уголь";
  if(game.signal_open)return "Развилка · выбери маршрут рычагом в локомотиве";
  if(game.snow>59)return "Плуг забит · очисти его в локомотиве";
  if(game.hull<45)return "Поезду нужен ремонт";
  if(game.loaded<3&&game.stock.parcel>0)return "Подарки · взять в служебном, упаковать и загрузить в грузовом";
  return "Следующая станция · "+stations[game.leg];
}

class PolarExpress {
  constructor(modal, registerCleanup){
    this.modal=modal;
    this.root=modal.querySelector(".train-screen");
    this.canvas=this.root.querySelector("canvas");
    this.layer=this.root.querySelector(".train-layer");
    this.hud=this.root.querySelector(".train-hud");
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
      this.map=map;
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
      if(!e.repeat)this.action(this.overlay?"resume":"back");
      return;
    }
    if(!this.controlling())return;
    if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright","e"," "].includes(key)){
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
    if(!target){
      this.toast("Посмотри на предмет или рычаг");return;
    }
    const blocked=actionStatus(g,p,target);
    if(blocked){this.toast(blocked);this.sfx.play("miss",{level:.43});return;}
    this.sfx.unlock();
    this.useTarget=target;
    this.useUntil=performance.now()+Math.max(450,1000*this.map.work[target][3]+270);
    this.sfx.play("click",{level:.44});
  }

  stopInput(){
    this.keys.clear();this.joyId=null;this.lookPointer=null;this.knob.style.transform="";
    this.move={x:0,z:0};this.useUntil=0;this.useTarget="";
    if(document.pointerLockElement===this.canvas)document.exitPointerLock?.();
    if(this.socket?.readyState===WebSocket.OPEN&&this.phase==="playing")this.send({x:0,z:0,use:false});
  }

  menu(){
    this.room=null;this.local=null;this.samples=[];this.overlay=false;
    this.setPhase("menu");this.net.textContent="";
    this.layer.innerHTML=panel('<span class="train-eyebrow">СЕВЕРНАЯ ЖЕЛЕЗНАЯ ДОРОГА</span><h1>Полярный<br>экспресс</h1>'+
      '<p>Доведи поезд с подарками до Северного терминала. Поддерживай топку, выбирай маршрут и пополняй запасы на остановках.</p>'+
      btn("create","Собрать экипаж")+btn("practice","Рейс с помощниками","secondary")+
      '<form class="train-join"><label><span>Код комнаты</span><input name="code" minlength="6" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" required placeholder="••••••"></label><button type="submit">Войти</button></form>');
  }

  setPhase(phase){
    this.phase=phase;this.root.dataset.phase=phase;
    const active=phase==="playing"||phase==="countdown";
    this.hud.hidden=!active;this.controls.hidden=phase!=="playing";this.prompt.hidden=phase!=="playing";
    if(!active){
      this.stopInput();
      this.sfx.ambient("rail",0);this.sfx.ambient("boiler",0);this.sfx.ambient("iceWind",0);
    }
  }

  help(){
    this.overlay=true;this.stopInput();
    this.layer.innerHTML=panel('<h2>Обязанности экипажа</h2><ul>'+
      '<li><b>Движение:</b> стик или WASD. Обзор свайпом справа или мышью после клика по сцене.</li>'+
      '<li>Наведи прицел на предмет и нажми кнопку с ладонью. На клавиатуре удерживай E или пробел.</li>'+
      '<li><b>Локомотив:</b> уголь в топку, детали в редуктор. Очищай плуг, если снег замедляет поезд.</li>'+
      '<li><b>Грузовой:</b> упаковывай подарки на столе и клади в лоток. Кладовая принимает запасные припасы.</li>'+
      '<li><b>Служебный:</b> уголь, детали, подарки и фонарь.</li>'+
      '<li>На остановках двери грузового вагона открываются. Забери припасы на платформе и вернись до отправления.</li></ul>'+
      btn("resume","Понятно"));
  }

  error(message){
    this.overlay=true;this.setPhase("error");
    this.layer.innerHTML=panel('<h2>Рейс недоступен</h2><p>'+escapeText(message)+'</p>'+btn("exit","В Аркады","secondary"));
  }

  async action(action){
    if(this.disposed)return;
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
    if(this.busy||this.disposed)return;
    this.busy=true;
    this.root.setAttribute("aria-busy","true");
    try{
      const state=await post(API+path,body);
      if(this.disposed||this.leaving){
        if(join)await post(API+"/leave",{}).catch(()=>{});
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
    if(this.room&&!this.replaced)await post(API+"/leave",{}).catch(()=>{});
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
      this.local=null;
      this.eventId=0;this.countNumber=null;this.finishKey="";this.lobbyKey="";
      const me=this.me();
      if(me){this.yaw=Math.atan2(me.ax,-me.az);this.pitch=me.pitch;}
      this.overlay=false;this.foot=0;this.useUntil=0;
    }
    if(g){
      if(!old||g.tick!==old.tick||!this.samples.length){
        this.samples.push({at:performance.now(),actors:g.actors});
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
      this.layer.innerHTML=panel('<span class="train-eyebrow">УЧАСТНИКИ РЕЙСА</span><h2>Экипаж</h2>'+
        '<button type="button" class="train-code" data-action="copy"><small>Код комнаты · скопировать</small><strong>'+data.room+'</strong></button>'+
        '<ul class="train-roster">'+roster.join("")+'</ul>'+
        (data.owner?'<label class="train-bots"><span>Свободные места заполняют помощники</span><input type="checkbox" data-train="bots" '+(data.bots?"checked":"")+'></label>'+
        '<button type="button" class="train-primary" data-action="start" '+(data.members.some(m=>m.id===data.me&&m.connected)?"":"disabled")+'>Отправить поезд</button>':
        '<p>Рейс запустит создатель комнаты.</p>')+btn("leave","Выйти из комнаты","secondary"));
      return;
    }
    if(g.phase==="countdown"){
      const number=Math.ceil(g.countdown);
      if(number===this.countNumber&&!force)return;
      this.countNumber=number;this.sfx.play("countdown");
      this.layer.innerHTML='<div class="train-countdown"><strong>'+number+'</strong><span>Отправление</span></div>';
    }else if(g.phase==="finished"){
      const key=g.seed+":"+data.owner;
      if(key===this.finishKey&&!force)return;
      this.finishKey=key;
      const rows=g.actors.map(p=>'<li><b>'+escapeText(p.name)+'</b><small>'+'Действия '+p.jobs+' · Грузы '+p.deliveries+'</small></li>').join("");
      this.layer.innerHTML=panel('<span class="train-eyebrow">'+(names[g.route]||"Северный путь")+' · '+timed(g.time)+'</span>'+
        '<h2>'+(g.winner?"Поезд прибыл":"Рейс остановлен")+'</h2><p>'+escapeText(g.reason)+'</p>'+
        '<div class="train-summary"><span><strong>'+g.delivered+'</strong>доставлено</span><span><strong>'+Math.round(g.hull)+'%</strong>состояние</span></div>'+
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
      if(local){
        this.useUntil=0;
        const message=target==="bridge"||target==="valley"?names[target]:
          target==="seal"?"Подарок упакован":target==="cargo"?"Груз на борту":
          target==="station_signal"?"Почта принята":target==="furnace"?"Тепло возвращается":
          target==="repair"?"Редуктор отремонтирован":target==="plow"?"Плуг очищен":"";
        if(message)this.toast(message);
      }
    }else if(event.kind==="start"||event.kind==="depart"||event.kind==="arrive"){
      this.sfx.play("whistle",{level:.78});
      this.toast(event.kind==="arrive"?this.map.stations[event.station]+" · открыты двери":event.kind==="depart"?"Поезд отправился":"Рейс начался");
    }else if(event.kind==="hazard"){
      if(event.hazard==="snow")this.sfx.play("storm");
      else this.sfx.play("wrench",{level:.66});
      this.toast({snow:"Снег забил плуг",bearing:"Редуктор требует осмотра",frost:"Резко похолодало"}[event.hazard]);
    }else if(event.kind==="route"){
      this.toast("Выбран объезд через долину");
    }else if(event.kind==="recall"&&local){
      this.sfx.play("whistle",{level:.6});this.toast(event.lost?"Ты опоздал · припасы остались на платформе":"Дежурный вернул тебя в вагон");
    }else if(event.kind==="finish")this.sfx.play(g.winner?"finish":"fail");
  }

  toast(message){
    if(!message)return;
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
    const focused=focusAt(this.map,g,p,this.yaw);
    return {x:(x*cos-z*sin)/scale,z:(x*sin+z*cos)/scale,use:keys.has("e")||keys.has(" ")||
      (this.useUntil>performance.now()&&focused===this.useTarget)};
  }

  send(input){
    if(this.socket?.readyState!==WebSocket.OPEN)return;
    this.socket.send(JSON.stringify({type:"input",seq:++this.seq,mx:input.x,mz:input.z,
      ax:Math.sin(this.yaw),az:-Math.cos(this.yaw),pitch:this.pitch,fire:input.use}));
  }

  sample(game,now){
    if(!game)return [];
    const when=now-86;
    let a=this.samples[0],b=this.samples.at(-1);
    if(!a||!b)return game.actors;
    for(let i=1;i<this.samples.length;i++){
      if(this.samples[i].at<when){a=this.samples[i];continue;}
      b=this.samples[i];break;
    }
    const ratio=a===b?1:clamp((when-a.at)/(b.at-a.at),0,1);
    return game.actors.map(p=>{
      const previous=a.actors.find(q=>q.id===p.id),next=b.actors.find(q=>q.id===p.id);
      if(!previous||!next||Math.hypot(next.x-previous.x,next.z-previous.z)>2.2)return p;
      return {...p,x:previous.x+(next.x-previous.x)*ratio,z:previous.z+(next.z-previous.z)*ratio};
    });
  }

  predict(player,game,input,now,dt){
    if(!player){this.local=null;return null;}
    const latest=this.samples.at(-1);
    const ahead=clamp((now-(latest?.at||now)+36)/1000,0,.12);
    let x=player.x,z=player.z,vx=player.vx,vz=player.vz;
    for(let left=ahead;left>0;left-=.05){
      const step=Math.min(.05,left),traction=1-.33**(step/.05);
      vx+=(input.x*3.65-vx)*traction;vz+=(input.z*3.65-vz)*traction;
      if(canWalk(this.map,x+vx*step,z,game.travel))x+=vx*step;
      if(canWalk(this.map,x,z+vz*step,game.travel))z+=vz*step;
    }
    const f=this.local&&Math.hypot(this.local.x-x,this.local.z-z)<1.1?1-Math.exp(-dt*30):1;
    const old=this.local;
    this.local={...player,x:old?old.x+(x-old.x)*f:x,z:old?old.z+(z-old.z)*f:z,vx,vz};
    return this.local;
  }

  updateHUD(g,player,target){
    if(!g||!player)return;
    const set=(id,value)=>this.hud.querySelector('[data-train="'+id+'"]').textContent=value;
    for(const key of ["heat","hull","snow"]){
      set(key,Math.round(g[key])+"%");
      this.hud.querySelector('[data-meter="'+key+'"]').style.setProperty("--value",g[key]+"%");
    }
    set("hand",gear[player.hand]||"Руки свободны");
    set("zone",player.x>1.48?"Платформа":player.z<-.65?"Локомотив":player.z<8?"Грузовой вагон":"Служебный вагон");
    set("cargo",g.loaded+" на борту · "+g.delivered+" доставлено");
    set("leg",(g.leg+1)+"/3  "+this.map.stations[g.leg]);
    set("brief",briefing(g,this.map.stations));
    this.hud.querySelector(".train-route i").style.width=((g.leg+clamp(g.distance/g.length,0,1))/3*100)+"%";
    const status=target?actionStatus(g,player,target):"";
    this.prompt.classList.toggle("is-target",Boolean(target));
    this.prompt.classList.toggle("is-blocked",Boolean(status));
    const button=this.useButton;
    button.classList.toggle("is-ready",Boolean(target&&!status));
    button.setAttribute("aria-label",target?targetText[target]:"Действие");
    const work=player.progress&&player.target===target?clamp(player.progress/this.map.work[target][3],0,1):0;
    this.prompt.querySelector("i").style.width=(work*100)+"%";
    this.prompt.querySelector("strong").textContent=target?this.map.work[target][2]:"";
    this.prompt.querySelector("small").textContent=status||(target?targetText[target]:"");
    this.prompt.classList.toggle("is-working",work>0);
  }

  frame(now){
    if(this.disposed)return;
    if(!document.hidden){
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
        const p=this.predict(player,game,input,now,dt);
        const target=p?focusAt(this.map,game,p,this.yaw):"";
        const sampleAt=this.samples.at(-1)?.at||now;
        const track=game?game.track+(game.travel?game.speed*clamp((now-sampleAt)/1000,0,.13):0):0;
        this.scene.drawJourney(game,{local:p,actors:this.sample(game,now),me:this.room?.me,track,
          yaw:this.yaw,pitch:this.pitch,target,available:target&&!actionStatus(game,p,target),
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
          this.nextUI=now+115;
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
    else this.lastFrame=0;
  }

  destroy(){
    this.disposed=true;this.leave();
    cancelAnimationFrame(this.frameId);clearInterval(this.pingTimer);clearTimeout(this.toastTimer);
    this.observer?.disconnect();this.listeners.forEach(remove=>remove());
    this.scene?.dispose();this.sfx.dispose();
    if(this.oldViewport)this.viewport.setAttribute("content",this.oldViewport);
  }
}

const meter=(key,label,icon)=>'<div class="train-meter" data-meter="'+key+'">'+svg(icon)+'<span>'+label+
  '<strong data-train="'+key+'">—</strong></span><i></i></div>';

export function openPolarExpress({registerCleanup}){
  const modal=window.kov.showModal(
    '<div class="train-screen" data-phase="loading"><canvas class="train-canvas" aria-label="Вид из вагона Полярного экспресса от первого лица"></canvas>'+
    '<header class="train-top"><button type="button" class="train-icon" data-action="back" aria-label="Назад">'+svg("back")+'</button>'+
    '<div class="train-brand">'+svg("train")+'<span>Полярный экспресс</span></div><span data-train="network" role="status"></span>'+
    '<button type="button" class="train-icon" data-action="help" aria-label="Как играть">'+svg("help")+'</button></header>'+
    '<div class="train-hud" hidden><div class="train-route"><span data-train="leg"></span><b data-train="zone"></b><i></i></div>'+
    '<div class="train-meters">'+meter("heat","Топка","heat")+meter("hull","Поезд","tool")+meter("snow","Плуг","snow")+'</div>'+
    '<div class="train-brief" data-train="brief"></div><div class="train-inventory">'+svg("gift")+
    '<span data-train="cargo"></span><b data-train="hand"></b></div></div>'+
    '<div class="train-prompt" hidden><div class="train-crosshair"></div><div class="train-focus"><strong></strong><small></small><i></i></div></div>'+
    '<div class="train-layer"></div><div class="train-notice" role="status"></div>'+
    '<div class="train-controls" hidden><div class="train-move" aria-label="Движение"><i></i></div>'+
    '<button class="train-use" aria-label="Действие" type="button">'+svg("hand")+'<small>Действие</small></button></div></div>',
    {label:"Полярный экспресс"});
  modal.classList.add("train-modal");
  modal.parentElement.classList.add("train-overlay");
  return new PolarExpress(modal,registerCleanup);
}

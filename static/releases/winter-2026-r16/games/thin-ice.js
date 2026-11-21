import {get,post} from "../api.js";
import {escapeText} from "../ui.js";
import {getSettings} from "../pages/settings.js";
import {GameAudio,spatialAudio} from "./game-audio.js";
import {IceScene,tileCoords,jackets} from "./ice-scene.js";

const API = "/api/arcade/ice";
const icons = {
  back:"<path d='m14 5-7 7 7 7M7 12h13'/>",
  help:"<circle cx='12' cy='12' r='9'/><path d='M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2.5M12 17h.01'/>",
  jump:"<path d='M12 19V5m-5 5 5-5 5 5M5 19h14'/>",
  dash:"<path d='m11 13 2-9-7 11h7l-2 5 7-9h-7m-6 0h-3m5-4H3'/>",
  fire:"<circle cx='12' cy='12' r='3'/><circle cx='12' cy='12' r='8'/><path d='M12 2v2m0 16v2M2 12h2m16 0h2'/>",
  ice:"<path d='m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5m-8 4.5L4 7.5m8 4.5v9'/>",
};
const buttonNames={jump:"Прыжок",dash:"Рывок",fire:"Волна"};
const items={bridge:"Ледяной мост",anchor:"Кошки · устойчивость 6 с",charge:"Заряд · умения готовы"};
const svg=id=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">'+icons[id]+'</svg>';
const primary=(action, text)=>'<button type="button" class="ice-primary" data-action="'+action+'">'+text+'</button>';
const secondary=(action,text)=>'<button type="button" class="ice-secondary" data-action="'+action+'">'+text+'</button>';
const panel=body=>'<section class="ice-panel">'+body+'</section>';
const clock=seconds=>{
  const s=Math.ceil(seconds);
  return Math.floor(s/60)+":"+String(s%60).padStart(2,"0");
};

class ThinIceGame {
  constructor(modal, registerCleanup) {
    this.root=modal.querySelector(".ice-screen");
    this.canvas=this.root.querySelector("canvas");
    this.layer=this.root.querySelector(".ice-layer");
    this.hud=this.root.querySelector(".ice-hud");
    this.notice=this.root.querySelector(".ice-notice");
    this.timer=this.hud.querySelector("[data-ice=time]");
    this.alive=this.hud.querySelector("[data-ice=alive]");
    this.weather=this.hud.querySelector("[data-ice=storm]");
    this.network=this.root.querySelector(".ice-network");
    this.roster=this.root.querySelector(".ice-roster-strip");
    this.actions=this.root.querySelector(".ice-controls");
    this.stick=this.root.querySelector(".ice-joystick");
    this.knob=this.stick.querySelector("i");
    this.audio=new GameAudio();
    this.audio.unlock();
    this.keys=new Set();
    this.pulses=new Map();
    this.motion={x:0,z:0};
    this.samples=[];
    this.listeners=[];
    this.lastEvent=0;
    this.seq=0;
    this.phase="loading";
    this.lastPacket=0;
    this.nextSend=0;
    this.generation=0;
    this.lastFx=0;
    this.foot=0;
    this.preferences=getSettings();
    this.bind();
    this.pingTimer=setInterval(()=>this.ping(),3500);
    registerCleanup(()=>this.destroy(),hidden=>this.visibility(hidden));
    this.boot();
  }

  listen(el, type, callback, options) {
    el.addEventListener(type,callback,options);
    this.listeners.push(()=>el.removeEventListener(type,callback,options));
  }

  bind() {
    this.listen(this.root,"click",event=>{
      const b=event.target.closest("button[data-action]");
      if(b&&!b.disabled)this.action(b.dataset.action);
    });
    this.listen(this.root,"submit",event=>{
      if(!event.target.matches(".ice-join"))return;
      event.preventDefault();
      const code=event.target.elements.code.value.trim().toUpperCase();
      if(!/^[A-Z2-9]{6}$/.test(code)){this.notify("Введи шесть символов кода");return;}
      this.request("/join",{code},true);
    });
    this.listen(this.root,"change",event=>{
      if(event.target.matches("[data-ice=bots]"))this.request("/bots",{bots:event.target.checked});
    });
    const move=event=>{
      if(event.pointerId!==this.pointer)return;
      const length=Math.hypot(event.clientX-this.origin.x,event.clientY-this.origin.y);
      const scale=Math.max(32,length);
      this.motion={x:(event.clientX-this.origin.x)/scale,z:(event.clientY-this.origin.y)/scale};
      this.knob.style.transform="translate("+this.motion.x*29+"px,"+this.motion.z*29+"px)";
    };
    this.listen(this.stick,"pointerdown",event=>{
      if(!this.driving()||this.pointer!=null)return;
      event.preventDefault();
      this.audio.unlock();
      const rect=this.stick.getBoundingClientRect();
      this.pointer=event.pointerId;
      this.origin={x:rect.left+rect.width/2,y:rect.top+rect.height/2};
      this.stick.setPointerCapture(event.pointerId);
      move(event);
    },{passive:false});
    this.listen(this.stick,"pointermove",move);
    for(const type of ["pointerup","pointercancel","lostpointercapture"]){
      this.listen(this.stick,type,event=>{
        if(event.pointerId!==this.pointer)return;
        this.pointer=null;
        this.motion={x:0,z:0};
        this.knob.style.transform="";
      });
    }
    for(const b of this.actions.querySelectorAll("[data-ability]")){
      this.listen(b,"pointerdown",event=>{
        if(!this.driving()||event.button!==0)return;
        event.preventDefault();
        this.pulse(b.dataset.ability);
      },{passive:false});
      this.listen(b,"click",event=>{
        if(event.detail===0)this.pulse(b.dataset.ability);
      });
    }
    this.listen(document,"keydown",event=>{
      if(!this.root.isConnected||event.target.matches("input,textarea"))return;
      const k=event.key.toLowerCase();
      if(k==="escape"){
        event.preventDefault();
        event.stopPropagation();
        if(!event.repeat)this.action(this.overlay?"resume":"back");
        return;
      }
      if(!this.driving())return;
      if(["arrowup","arrowdown","arrowleft","arrowright","w","a","s","d"," ","shift","e"].includes(k)){
        event.preventDefault();
        this.keys.add(k);
        if(!event.repeat&&k===" ")this.pulse("jump");
        if(!event.repeat&&k==="shift")this.pulse("dash");
        if(!event.repeat&&k==="e")this.pulse("fire");
      }
    },true);
    this.listen(document,"keyup",event=>this.keys.delete(event.key.toLowerCase()));
    this.listen(window,"blur",()=>this.stopInput());
    this.listen(window,"resize",()=>{this.stopInput();this.scene?.resize();});
    this.listen(this.canvas,"arena-graphics-lost",()=>this.error("Браузер остановил 3D. Попробуй открыть игру снова."));
    if(window.ResizeObserver){
      this.observer=new ResizeObserver(()=>this.scene?.resize());
      this.observer.observe(this.canvas);
    }
  }

  async boot() {
    this.layer.innerHTML=panel('<h2>Готовим озеро</h2>');
    try {
      const status=await get(API+"/status",{cache:false});
      if(this.disposed)return;
      this.scene=new IceScene(this.canvas,this.preferences);
      this.raf=requestAnimationFrame(t=>this.frame(t));
      if(status.current){this.receive(status.current);this.connect();}
      else this.menu();
    }catch(error){if(!this.disposed)this.error(error.message);}
  }

  error(message) {
    this.phase="error";
    this.overlay=true;
    this.stopInput();
    this.root.dataset.phase=this.phase;
    this.layer.innerHTML=panel('<h2>Озеро недоступно</h2><p>'+escapeText(message)+'</p>'+secondary("exit","В Аркады"));
  }

  menu() {
    this.room=null;
    this.focus=null;
    this.overlay=false;
    this.phase="menu";
    this.root.dataset.phase="menu";
    this.network.textContent="";
    this.layer.innerHTML=panel('<span class="ice-kicker">ЗИМНИЕ АРКАДЫ · 3D</span><h1>Тонкий лёд</h1>'+
      '<p>Льдины трескаются под ногами. Перепрыгивай разломы и останься на озере последним.</p>'+
      primary("create","Создать комнату")+secondary("practice","Тренировка с ботами")+
      '<form class="ice-join"><label><span>Код комнаты</span><input name="code" type="text" minlength="6" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" required placeholder="••••••"></label><button type="submit">Войти</button></form>');
  }

  driving() {
    return this.phase==="playing"&&!this.overlay&&!document.hidden&&
      this.socket?.readyState===WebSocket.OPEN&&this.me()?.alive;
  }

  me() {
    return this.room?.game?.actors.find(p=>p.id===this.room.me);
  }

  pulse(ability) {
    if(!this.driving())return;
    this.audio.unlock();
    this.pulses.set(ability,performance.now()+95);
  }

  stopInput() {
    this.keys.clear();
    this.pulses.clear();
    this.motion={x:0,z:0};
    this.pointer=null;
    this.knob.style.transform="";
    if(this.socket?.readyState===WebSocket.OPEN&&this.phase==="playing"){
      this.socket.send(JSON.stringify({type:"input",seq:++this.seq,mx:0,mz:0}));
    }
  }

  help() {
    this.overlay=true;
    this.stopInput();
    this.layer.innerHTML=panel('<h2>Держись на льду</h2><ul>'+
      '<li><b>Движение</b> · стик, WASD или стрелки. На льду сохраняется инерция.</li>'+
      '<li><b>Прыжок</b> · пробел. Перепрыгивай разломы по одной льдине.</li>'+
      '<li><b>Рывок</b> · Shift. Разгоняет по земле, поэтому проверь путь.</li>'+
      '<li><b>Снежная волна</b> · E. Толкает ближайших соперников.</li>'+
      '<li>Мост восстанавливает до трёх льдин по ходу движения. Кошки помогают тормозить и сопротивляться волне. Заряд возвращает рывок и волну.</li>'+
      '<li>Метель постепенно ломает края озера. Если время вышло, из оставшихся выигрывает тот, кто расколол больше льдин.</li></ul>'+
      primary("resume","Понятно"));
  }

  async action(name) {
    if(this.disposed)return;
    this.audio.unlock();
    this.audio.play("click",{level:.48});
    switch(name){
      case "create":return this.request("/rooms",{bots:true},true);
      case "practice":this.practice=true;return this.request("/rooms",{bots:true},true);
      case "start":return this.request("/start");
      case "lobby":return this.request("/lobby");
      case "reconnect":this.retry=0;this.overlay=false;this.resuming=true;return this.connect();
      case "copy":
        try {await navigator.clipboard.writeText(this.room.room);this.notify("Код скопирован");}
        catch (_) {this.notify(this.room.room);}
        return;
      case "help":return this.help();
      case "resume":
        this.overlay=false;
        return this.room?this.show(this.room,true):this.menu();
      case "back":
        if(this.phase==="playing"||this.phase==="countdown"){
          this.overlay=true;
          this.stopInput();
          this.layer.innerHTML=panel("<h2>Покинуть раунд?</h2><p>Остальные продолжат игру.</p>"+
            primary("resume","Продолжить")+secondary("exit","Выйти в Аркады"));
          return;
        }
        window.closeModal();
        return;
      case "leave":await this.leave();if(!this.disposed)this.menu();return;
      case "exit":window.closeModal();return;
    }
  }

  async request(path, body={}, join=false) {
    if(this.busy||this.disposed)return;
    this.busy=true;
    this.root.setAttribute("aria-busy","true");
    try {
      const result=await post(API+path,body);
      if(this.disposed||this.leaving){
        if(join)await post(API+"/leave",{}).catch(()=>{});
        return;
      }
      this.receive(result);
      if(join)this.connect();
    }catch(error){
      if(!this.disposed){
        this.practice=false;
        this.notify(error.message);
        if(this.phase==="lobby")this.show(this.room,true);
      }
    }finally {
      this.busy=false;
      this.root.removeAttribute("aria-busy");
    }
  }

  async connect() {
    if(this.connecting||this.disposed||!this.room)return;
    this.connecting=true;
    const generation=++this.generation;
    this.network.textContent="Подключение…";
    try {
      const info=await post(API+"/ticket",{});
      if(this.disposed||generation!==this.generation)return;
      const endpoint=new URL(info.path,location.href);
      endpoint.protocol=location.protocol==="https:"?"wss:":"ws:";
      const socket=new WebSocket(endpoint);
      this.socket=socket;
      this.seq=0;
      socket.onopen=()=>{
        if(socket!==this.socket){socket.close();return;}
        socket.send(JSON.stringify({ticket:info.ticket}));
        this.lastPacket=performance.now();
      };
      socket.onmessage=message=>{
        if(socket!==this.socket||this.disposed)return;
        let data;
        try{data=JSON.parse(message.data);}catch(_){return;}
        this.lastPacket=performance.now();
        if(data.type==="left"){this.socket=null;socket.close();this.menu();return;}
        if(data.type!=="state")return;
        this.retry=0;
        this.replaced=false;
        this.network.textContent="В сети";
        this.receive(data);
        if(this.resuming){this.resuming=false;this.show(data,true);}
        if(this.practice&&!this.busy&&data.owner&&!data.game){
          this.practice=false;
          this.request("/start");
        }
      };
      socket.onclose=event=>{
        if(socket!==this.socket||this.disposed)return;
        this.socket=null;
        this.stopInput();
        if(event.code===4001){
          this.replaced=true;
          this.overlay=true;
          this.network.textContent="Другое окно";
          this.layer.innerHTML=panel('<h2>Матч открыт в другом окне</h2>'+primary("reconnect","Играть здесь")+secondary("exit","В Аркады"));
          return;
        }
        this.reconnect();
      };
    }catch(error){
      if(this.disposed||generation!==this.generation)return;
      if(error.status===404){this.menu();this.notify("Комната закрыта");}
      else this.reconnect();
    }finally{
      if(generation===this.generation)this.connecting=false;
    }
  }

  reconnect() {
    clearTimeout(this.reconnectTimer);
    this.retry=(this.retry||0)+1;
    this.network.textContent="Связь потеряна";
    if(this.retry<=7){
      this.reconnectTimer=setTimeout(()=>this.connect(),Math.min(4200,450*this.retry));
    }else{
      this.overlay=true;
      this.layer.innerHTML=panel('<h2>Соединение прервалось</h2>'+primary("reconnect","Переподключиться")+secondary("leave","К выбору игры"));
    }
  }

  async leave() {
    if(this.leaving)return;
    this.leaving=true;
    this.stopInput();
    ++this.generation;
    this.connecting=false;
    clearTimeout(this.reconnectTimer);
    const socket=this.socket;
    this.socket=null;
    socket?.close();
    if(this.room&&!this.replaced)await post(API+"/leave",{}).catch(()=>{});
    this.room=null;
    this.practice=false;
    this.leaving=false;
  }

  receive(data) {
    if(this.disposed||this.leaving||data.type!=="state")return;
    const old=this.room?.game;
    const game=data.game;
    // A REST response may be older than a snapshot that already arrived.
    if(game&&old&&game.seed===old.seed&&game.tick<old.tick)return;
    this.room=data;
    if(game&&game.seed!==old?.seed){
      this.samples=[];
      this.lastEvent=0;
      this.countdownNumber=null;
      this.lobbyKey="";
      this.finishKey="";
      this.scene.previousTiles="";
      this.scene.effects=[];
      this.foot=0;
    }
    if(game){
      if(!old||game.tick!==old.tick||!this.samples.length){
        this.samples.push({time:performance.now(),actors:game.actors});
        if(this.samples.length>5)this.samples.shift();
      }
      for(const e of game.events){
        if(e.id<=this.lastEvent)continue;
        this.lastEvent=e.id;
        if(game.tick-e.tick<=15)this.event(e,game);
      }
    }
    this.show(data);
  }

  show(data, force=false) {
    if(!data)return;
    const was=this.phase;
    const game=data.game;
    this.phase=game?.phase||"lobby";
    this.root.dataset.phase=this.phase;
    this.hud.hidden=!game||game.phase==="finished";
    this.actions.hidden=!["playing","countdown"].includes(game?.phase)||!this.me()?.alive;
    if(this.overlay&&!force)return;
    if(!game){
      const type=JSON.stringify([data.members,data.owner,data.bots]);
      if(type===this.lobbyKey&&!force&&was==="lobby")return;
      this.lobbyKey=type;
      const members=data.members.map((m,i)=>'<li><i style="--player:'+jackets[i]+'"></i><b>'+escapeText(m.name)+'</b><span>'+
        (m.id===data.me?"Ты":m.owner?"Хост":m.connected?"В сети":"Подключается")+'</span></li>');
      for(let i=members.length;i<4;i++)members.push('<li><i></i><b>'+(data.bots?"Снежный бот":"Свободное место")+'</b><span>'+(data.bots?"Бот":"—")+'</span></li>');
      this.layer.innerHTML=panel('<span class="ice-kicker">ДО ЧЕТЫРЁХ ИГРОКОВ</span><h2>Лобби</h2>'+
        '<button class="ice-code" type="button" data-action="copy"><small>Код комнаты · скопировать</small><strong>'+data.room+'</strong></button>'+
        '<ul class="ice-members">'+members.join("")+'</ul>'+
        (data.owner?'<label class="ice-switch"><span>Заполнить места ботами</span><input type="checkbox" data-ice="bots" '+(data.bots?"checked":"")+'></label>'+primary("start","На лёд"):
         '<p>Создатель комнаты запускает раунд.</p>')+secondary("leave","Выйти из комнаты"));
      return;
    }
    if(game.phase==="countdown"){
      const n=Math.ceil(game.countdown);
      if(n===this.countdownNumber&&!force)return;
      this.countdownNumber=n;
      this.audio.play("countdown");
      this.layer.innerHTML='<div class="ice-countdown"><strong>'+n+'</strong><span>Готовься к старту</span></div>';
    }else if(game.phase==="finished"){
      const key=game.seed+":"+data.owner;
      if(key===this.finishKey&&!force)return;
      this.finishKey=key;
      this.stopInput();
      const winner=game.actors.find(p=>p.id===game.winner);
      const title=game.winner===data.me?"Победа!":winner?escapeText(winner.name)+" на льду":"Ничья";
      const ranked=[...game.actors].sort((a,b)=>
        Number(b.id===game.winner)-Number(a.id===game.winner)|| (b.out??game.time)-(a.out??game.time)||b.tiles-a.tiles);
      const rows=ranked.map((p,i)=>'<tr><td>'+String(i+1)+'. '+escapeText(p.name)+'</td><td>'+clock(p.out??game.time)+'</td><td>'+p.tiles+'</td><td>'+p.shoves+'</td></tr>').join("");
      this.layer.innerHTML=panel('<span class="ice-kicker">РАУНД ЗАВЕРШЁН</span><h2>'+title+'</h2><p>'+escapeText(game.reason)+'</p>'+
        '<table><thead><tr><th>Игрок</th><th>Время</th><th>Лёд</th><th>Толчки</th></tr></thead><tbody>'+rows+'</tbody></table>'+
        (data.owner?primary("lobby","В лобби · ещё раунд"):'<p>Хост может запустить новый раунд.</p>')+secondary("leave","К выбору игры"));
    }else if(force||was!=="playing"){
      this.layer.innerHTML="";
    }
  }

  event(e,game) {
    this.scene.event(e);
    const me=this.me();
    const xy=e.tile!=null?tileCoords(e.tile):[e.x,e.z];
    const own=e.actor===this.room.me;
    const position=own?{level:.92}:spatialAudio(me,xy[0],xy[1],0,13);
    const play=(key,options=position)=>this.audio.play(key,options);
    switch(e.kind){
      case "start":play("start",{level:.86});break;
      case "jump":case "dash":case "land":case "pulse":case "fissure":case "crack":case "break":case "freeze":
        play(e.kind);break;
      case "drop":play("spawn",position);break;
      case "fall":
        play("splash");
        if(own)this.notify("Ты выбыл · наблюдение");
        break;
      case "slip":if(own)play("skate");break;
      case "pickup":
        play(e.item==="bridge"?"freeze":e.item==="anchor"?"shield":"weapon");
        if(own)this.notify(items[e.item]);
        break;
      case "storm":play("storm",{level:.85});this.notify("Метель · внешний ряд рушится");break;
      case "finish":play(game.winner===this.room.me?"finish":"fail",{level:.90});break;
    }
  }

  notify(message) {
    this.notice.textContent=message;
    this.notice.classList.add("is-visible");
    clearTimeout(this.noticeTimer);
    this.noticeTimer=setTimeout(()=>this.notice.classList.remove("is-visible"),2600);
  }

  interpolate(now,game) {
    const when=now-80;
    let a=this.samples[0],b=this.samples.at(-1);
    for(let i=1;i<this.samples.length;i++){
      if(when>this.samples[i].time){a=this.samples[i];continue;}
      b=this.samples[i];
      break;
    }
    if(!a||!b)return game?.actors||[];
    const portion=a===b?1:Math.max(0,Math.min(1,(when-a.time)/(b.time-a.time)));
    const recent=Math.max(0,Math.min(.07,(when-b.time)/1000));
    return game.actors.map((current,index)=>{
      const p=a.actors.find(p=>p.id===current.id),q=b.actors.find(p=>p.id===current.id);
      if(!p||!q)return {...current,colorIndex:index,fallTime:1};
      return {...current,colorIndex:index,
        x:p.x+(q.x-p.x)*portion+(current.alive?current.vx*recent:0),
        y:p.y+(q.y-p.y)*portion,
        z:p.z+(q.z-p.z)*portion+(current.alive?current.vz*recent:0),
        fallTime:current.out==null?1:Math.max(0,game.time-current.out)+recent,
      };
    });
  }

  send(now) {
    if(now<this.nextSend||this.socket?.readyState!==WebSocket.OPEN)return;
    this.nextSend=now+45;
    if(!this.driving())return;
    const key=(...keys)=>keys.some(k=>this.keys.has(k));
    let x=this.motion.x+Number(key("d","arrowright"))-Number(key("a","arrowleft"));
    let z=this.motion.z+Number(key("s","arrowdown"))-Number(key("w","arrowup"));
    const length=Math.max(1,Math.hypot(x,z));
    const data={type:"input",seq:++this.seq,mx:x/length,mz:z/length};
    for(const ability of Object.keys(buttonNames))data[ability]=(this.pulses.get(ability)||0)>now;
    this.socket.send(JSON.stringify(data));
  }

  updateHud(game,now) {
    if(!game)return;
    const live=game.actors.filter(p=>p.alive);
    this.timer.textContent=clock(game.remaining);
    this.alive.textContent=live.length+" / "+game.actors.length+" на льду";
    this.weather.textContent=game.storm?"Метель "+game.storm+" / 4":"Лёд трескается";
    const key=game.seed+":"+game.actors.map(p=>p.id+":"+p.alive).join();
    if(this.rosterKey!==key){
      this.rosterKey=key;
      this.roster.innerHTML=game.actors.map((p,i)=>'<span class="'+(!p.alive?"is-out":"")+'" style="--player:'+jackets[i]+'"><i></i>'+
        escapeText(p.id===this.room.me?"Ты":p.name)+'</span>').join("");
    }
    const me=this.me();
    for(const control of this.actions.querySelectorAll("[data-ability]")){
      const name=control.dataset.ability,wait=me?.[name==="fire"?"push":name]||0;
      control.classList.toggle("is-cooling",wait>.07);
      control.querySelector("small").textContent=wait>.07?wait.toFixed(1):buttonNames[name];
    }
    this.lastFx=now;
  }

  frame(now) {
    if(this.disposed)return;
    if(!document.hidden&&(this.phase==="playing"||now-(this.lastDraw||0)>33)){
      const dt=Math.min(.07,(now-(this.lastDraw||now))/1000);
      this.lastDraw=now;
      const game=this.room?.game;
      const actors=this.interpolate(now,game);
      this.scene.drawMatch(game,this.room?.me,actors,dt);
      this.send(now);
      const me=this.me(),active=game?.phase==="playing"&&this.socket?.readyState===WebSocket.OPEN;
      const speed=active&&me?.alive?Math.hypot(me.vx,me.vz):0;
      this.foot+=speed*dt;
      if(this.foot>.9&&me?.y<.14){
        this.foot=0;
        this.audio.play("skate",{level:.42});
      }
      if(now-this.lastFx>120){
        this.updateHud(game,now);
        this.audio.ambient("iceWind",active?.16+game.storm*.065:0);
        this.audio.ambient("runners",Math.min(.20,speed*.037),.86+speed*.045);
        this.lastFx=now;
      }
    }
    this.raf=requestAnimationFrame(t=>this.frame(t));
  }

  ping(){
    if(this.socket?.readyState!==WebSocket.OPEN)return;
    if(!document.hidden&&performance.now()-this.lastPacket>8000)this.socket.close();
    else this.socket.send('{"type":"ping"}');
  }

  visibility(hidden) {
    this.stopInput();
    if(hidden)this.audio.silence();
  }

  destroy() {
    this.disposed=true;
    this.leave();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.noticeTimer);
    clearInterval(this.pingTimer);
    this.observer?.disconnect();
    this.listeners.forEach(remove=>remove());
    this.scene?.dispose();
    this.audio.dispose();
  }
}

export function openThinIce({registerCleanup}){
  const modal=window.kov.showModal(
    '<div class="ice-screen" data-phase="loading"><canvas class="ice-canvas" aria-label="Трёхмерное замёрзшее озеро"></canvas>'+
    '<header class="ice-top"><button class="ice-icon" type="button" data-action="back" aria-label="Назад">'+svg("back")+'</button>'+
    '<div class="ice-brand">'+svg("ice")+'<span>Тонкий лёд<small>Северное озеро</small></span></div>'+
    '<span class="ice-network" role="status"></span><button class="ice-icon" type="button" data-action="help" aria-label="Как играть">'+svg("help")+'</button></header>'+
    '<div class="ice-hud" hidden><div class="ice-status"><strong data-ice="time">1:48</strong><span data-ice="alive"></span><small data-ice="storm"></small></div><div class="ice-roster-strip"></div></div>'+
    '<div class="ice-layer"></div><div class="ice-notice" role="status"></div>'+
    '<div class="ice-controls" hidden><div class="ice-joystick" aria-label="Движение"><i></i></div><div class="ice-abilities">'+
    Object.entries(buttonNames).map(([id,label])=>'<button type="button" data-ability="'+id+'" aria-label="'+label+'">'+svg(id)+'<small>'+label+'</small></button>').join("")+
    '</div></div></div>',{label:"Тонкий лёд"});
  modal.classList.add("ice-modal");
  modal.parentElement.classList.add("ice-overlay");
  return new ThinIceGame(modal,registerCleanup);
}

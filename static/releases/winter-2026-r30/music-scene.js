// One shared music element, one owner. No second background track can overlap.
export class MusicSceneManager {
  constructor(adapter){this.adapter=adapter;this.current=null;}
  sync(){
    const owner=this.current;
    if(!owner)return false;
    const preferences=this.adapter.preferences();
    if(owner.paused||preferences.musicPaused||this.adapter.hidden())this.adapter.pause();
    else this.adapter.play(owner.src,preferences.musicVolume * owner.level,owner.fade);
    return true;
  }
  acquire(src,paused=false){
    const snapshot=this.current?this.current.snapshot:this.adapter.capture();
    const owner={src,snapshot,paused,level:1,fade:0};this.current=owner;this.sync();
    const manager=this;
    return {
      setLevel(value, fade=.55){
        if(manager.current!==owner)return;
        owner.level=Math.max(0,Math.min(1,value));owner.fade=fade;manager.sync();
      },
      setPaused(value){if(manager.current!==owner)return;owner.paused=Boolean(value);manager.sync();},
      restart(){
        if(manager.current!==owner)return;
        owner.paused=false;manager.sync();manager.adapter.seek(owner.src,0);
      },
      release(){
        if(manager.current!==owner)return;
        manager.current=null;manager.adapter.restore(snapshot);
      },
    };
  }
}

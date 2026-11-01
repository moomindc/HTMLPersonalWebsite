/* Now section — loads now/index.json, then each now/<YYYY-MM>.json.
   The newest month is shown in full; the rest go in a collapsible archive.
   All text is inserted with textContent; styles are limited to a fixed list. */
(function(){
  'use strict';

  var DIR='now/';
  var ID_RE=/^\d{4}-(?:0[1-9]|1[0-2])$/;
  var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var STYLES={raw:'bd-raw',ink:'ni-ink',slate:'ni-slate bd-s',ochre:'ni-ochre bd-o',sage:'ni-sage bd-g'};

  function el(tag,cls,text){
    var e=document.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined)e.textContent=text;
    return e;
  }

  function isStr(v,max){return typeof v==='string'&&v.trim().length>0&&v.length<=max;}

  function monthLabel(id){var p=id.split('-');return MONTHS[parseInt(p[1],10)-1]+' '+p[0];}

  function validate(id,raw){
    if(!raw||typeof raw!=='object')throw new Error('not an object');
    if(raw.subtitle!==undefined&&!isStr(raw.subtitle,200))throw new Error('"subtitle" is invalid');
    if(!Array.isArray(raw.items)||!raw.items.length||raw.items.length>12)throw new Error('"items" must be a list of 1-12 entries');
    var items=raw.items.map(function(it,i){
      if(!it||!isStr(it.key,40))throw new Error('item '+(i+1)+': "key" is missing or invalid');
      var style=it.style===undefined?'raw':it.style;
      if(!Object.prototype.hasOwnProperty.call(STYLES,style))throw new Error('item '+(i+1)+': "style" must be one of '+Object.keys(STYLES).join(', '));
      var out={key:it.key,style:style};
      if(it.list!==undefined){
        if(!Array.isArray(it.list)||!it.list.length||it.list.length>10||!it.list.every(function(t){return isStr(t,200);}))
          throw new Error('item '+(i+1)+': "list" must be 1-10 strings');
        out.list=it.list;
      }else if(isStr(it.text,300)){
        out.text=it.text;
      }else throw new Error('item '+(i+1)+': needs "text" or "list"');
      return out;
    });
    return{id:id,subtitle:raw.subtitle||'',items:items};
  }

  function fetchJson(url){
    return fetch(url,{credentials:'omit'}).then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    });
  }

  function loadAll(){
    return fetchJson(DIR+'index.json').then(function(idx){
      var ids=(idx&&Array.isArray(idx.months)?idx.months:[]).filter(function(id){
        var ok=typeof id==='string'&&ID_RE.test(id);
        if(!ok)console.warn('now: ignored invalid month id in index.json');
        return ok;
      });
      return Promise.all(ids.map(function(id){
        return fetchJson(DIR+id+'.json').then(function(raw){return validate(id,raw);}).catch(function(err){
          console.warn('now: skipped '+id+'.json — '+err.message);
          return null;
        });
      }));
    }).then(function(list){
      return list.filter(Boolean).sort(function(a,b){return b.id.localeCompare(a.id);});
    });
  }

  function buildCards(items){
    var row=el('div','now-row');
    items.forEach(function(item){
      var wrap=el('div','now-item '+STYLES[item.style]);
      wrap.appendChild(el('div','now-k',item.key));
      var v=el('div','now-v');
      if(item.list){
        var ul=el('ul');
        item.list.forEach(function(t){ul.appendChild(el('li',null,t));});
        v.appendChild(ul);
      }else v.textContent=item.text;
      wrap.appendChild(v);
      row.appendChild(wrap);
    });
    return row;
  }

  function renderCurrent(box,data){
    box.replaceChildren(el('p','cell-label','Now — '+monthLabel(data.id)));
    if(data.subtitle)box.appendChild(el('h2',null,data.subtitle));
    box.appendChild(buildCards(data.items));
  }

  function renderArchive(box,entries){
    if(!entries.length)return;
    box.appendChild(el('div','sec-horiz','Previous months'));
    entries.forEach(function(data){
      var row=el('button','post now-toggle');
      row.type='button';
      row.setAttribute('aria-expanded','false');
      var tog=el('span','post-d','+ View');
      row.appendChild(el('span','post-t',monthLabel(data.id)));
      row.appendChild(tog);

      var panel=el('div','now-panel');
      panel.hidden=true;
      panel.appendChild(buildCards(data.items));

      row.addEventListener('click',function(){
        var open=panel.hidden;
        panel.hidden=!open;
        row.setAttribute('aria-expanded',open?'true':'false');
        tog.textContent=open?'− Close':'+ View';
      });
      box.appendChild(row);
      box.appendChild(panel);
    });
  }

  function init(){
    var cur=document.getElementById('now-current');
    var arc=document.getElementById('now-archive');
    if(!cur)return;
    loadAll().then(function(months){
      if(!months.length){cur.replaceChildren(el('p','now-msg','Nothing here yet.'));return;}
      renderCurrent(cur,months[0]);
      if(arc)renderArchive(arc,months.slice(1));
    }).catch(function(err){
      console.error('now:',err);
      cur.replaceChildren(el('p','now-msg','Could not load the Now section. If you opened this file directly, serve the folder over http instead (e.g. python -m http.server).'));
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();

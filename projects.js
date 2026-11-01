/* Project cards — loads projects/index.json, then each projects/<id>.json.
   All text is inserted with textContent; links are limited to http(s); images to images/projects/.
   Mount points: #grid (data-mode="all" | "featured"), optional #filter-bar, optional #proj-count. */
(function(){
  'use strict';

  var DIR='projects/';
  var IMG_DIR='images/projects/';
  var ID_RE=/^[a-z0-9][a-z0-9-]*$/;
  var FILE_RE=/^[A-Za-z0-9._-]+\.(?:png|jpe?g|gif|webp|svg)$/i;
  var LOCAL_RE=/^downloads\/[A-Za-z0-9._-]+$/;
  var PAGE_RE=/^[A-Za-z0-9_-]+\/index\.html$/;
  var DATE_RE=/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
  var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var STATUS={'complete':'Complete','in-progress':'In progress'};
  var COLOURS=['o','s','r','g'];
  var SVG_NS='http://www.w3.org/2000/svg';
  var SQUIGGLES=[
    {w:70,h:30,vb:'0 0 120 30',d:'M5 20 Q30 5 60 18 Q90 30 115 10'},
    {w:36,h:36,vb:'0 0 40 40',d:'M5 5 L35 35 M35 5 L5 35'},
    {w:54,h:30,vb:'0 0 60 40',d:'M5 35 Q30 0 55 35'},
    {w:44,h:44,vb:'0 0 50 50',d:'M7 25 A18 18 0 1 0 43 25 A18 18 0 1 0 7 25'},
    {w:60,h:36,vb:'0 0 80 40',d:'M5 30 Q15 5 25 30 T45 30 T65 30 T78 30'}
  ];

  function el(tag,cls,text){
    var e=document.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined)e.textContent=text;
    return e;
  }

  function isStr(v,max){return typeof v==='string'&&v.trim().length>0&&v.length<=max;}

  function safeUrl(u){
    if(!isStr(u,500))return null;
    try{
      var p=new URL(u);
      return(p.protocol==='https:'||p.protocol==='http:')?p.href:null;
    }catch(e){return null;}
  }

  /* Returns a cleaned project object, or throws with the reason. */
  function validate(id,raw){
    if(!raw||typeof raw!=='object')throw new Error('not an object');
    var langs=Array.isArray(raw.language)?raw.language:[raw.language];
    if(!langs.length||!langs.every(function(l){return isStr(l,30);}))throw new Error('"language" must be a string or list of strings');
    ['name','version'].forEach(function(k){if(!isStr(raw[k],80))throw new Error('"'+k+'" is missing or invalid');});
    if(!isStr(raw.description,2000))throw new Error('"description" is missing or too long');
    if(typeof raw.date!=='string'||!DATE_RE.test(raw.date))throw new Error('"date" must be YYYY, YYYY-MM or YYYY-MM-DD');
    if(!Object.prototype.hasOwnProperty.call(STATUS,raw.status))throw new Error('"status" must be "complete" or "in-progress"');

    var p={id:id,name:raw.name,description:raw.description,date:raw.date,version:raw.version,
           languages:langs.map(function(l){return l.trim();}),status:raw.status,links:[],featured:0,image:null};

    if(raw.featured!==undefined){
      if(!Number.isInteger(raw.featured)||raw.featured<1)throw new Error('"featured" must be a positive whole number');
      p.featured=raw.featured;
    }
    (Array.isArray(raw.links)?raw.links:[]).forEach(function(l){
      var href=l&&(LOCAL_RE.test(l.url)||PAGE_RE.test(l.url)?l.url:safeUrl(l.url));
      if(href&&isStr(l.label,40))p.links.push({label:l.label,href:href});
      else console.warn('projects: skipped an invalid link in '+id+'.json');
    });
    if(raw.image){
      var im=raw.image;
      if(typeof im.file==='string'&&FILE_RE.test(im.file)&&isStr(im.alt,200)){
        p.image={src:IMG_DIR+im.file,alt:im.alt,placement:im.placement==='behind'?'behind':'inline'};
      }else console.warn('projects: ignored an invalid image in '+id+'.json (needs "file" and "alt")');
    }
    return p;
  }

  function fetchJson(url){
    return fetch(url,{credentials:'omit'}).then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    });
  }

  function loadAll(){
    return fetchJson(DIR+'index.json').then(function(idx){
      var ids=(idx&&Array.isArray(idx.projects)?idx.projects:[]).filter(function(id){
        var ok=typeof id==='string'&&ID_RE.test(id);
        if(!ok)console.warn('projects: ignored invalid id in index.json');
        return ok;
      });
      return Promise.all(ids.map(function(id){
        return fetchJson(DIR+id+'.json').then(function(raw){return validate(id,raw);}).catch(function(err){
          console.warn('projects: skipped '+id+'.json — '+err.message);
          return null;
        });
      }));
    }).then(function(list){
      return list.filter(Boolean).map(function(p,i){p.order=i;return p;});
    });
  }

  function formatDate(d){
    var parts=d.split('-');
    return parts.length>1?MONTHS[parseInt(parts[1],10)-1]+' '+parts[0]:parts[0];
  }

  function pick(list,exclude){
    var pool=list.filter(function(x){return exclude.indexOf(x)===-1;});
    if(!pool.length)pool=list;
    return pool[Math.floor(Math.random()*pool.length)];
  }

  /* Random colour + squiggle per card; avoids repeating the card before it or the one above (2-column grid). */
  function assignStyles(projects,cols){
    var prevC=[],prevS=[];
    projects.forEach(function(p,i){
      p.colour=pick(COLOURS,[prevC[i-1],prevC[i-cols]]);
      p.squiggle=pick(SQUIGGLES,[prevS[i-1],prevS[i-cols]]);
      prevC[i]=p.colour;prevS[i]=p.squiggle;
    });
  }

  function squiggleSvg(s){
    var svg=document.createElementNS(SVG_NS,'svg');
    svg.setAttribute('class','proj-mark');
    svg.setAttribute('width',s.w);svg.setAttribute('height',s.h);
    svg.setAttribute('viewBox',s.vb);
    svg.setAttribute('aria-hidden','true');
    var path=document.createElementNS(SVG_NS,'path');
    path.setAttribute('d',s.d);
    path.setAttribute('fill','none');
    path.setAttribute('stroke','currentColor');
    path.setAttribute('stroke-width','5');
    path.setAttribute('stroke-linecap','round');
    svg.appendChild(path);
    return svg;
  }

  function linkBtn(label,href,external){
    var a=el('a','btn proj-btn',label+' →');
    a.href=href;
    if(LOCAL_RE.test(href))a.setAttribute('download','');
    else if(PAGE_RE.test(href)){}
    else if(external){a.target='_blank';a.rel='noopener noreferrer';}
    return a;
  }

  function buildCard(p,featured){
    var card=el('article','proj-card'+(p.image&&p.image.placement==='behind'?' has-bg':''));
    card.id='p-'+p.id;

    if(p.image&&p.image.placement==='behind'){
      var bg=el('img','proj-bg');
      bg.src=p.image.src;bg.alt='';bg.loading='lazy';bg.decoding='async';
      card.appendChild(bg);
    }
    card.appendChild(el('div','corner-tri bd-'+p.colour));
    card.appendChild(squiggleSvg(p.squiggle));

    var body=el('div','proj-body');
    var tags=el('div','proj-tags');
    p.languages.forEach(function(l){tags.appendChild(el('span','tag tag-'+p.colour,l));});
    body.appendChild(tags);

    var head=el('div','proj-head');
    if(p.image&&p.image.placement==='inline'){
      var ic=el('img','proj-icon');
      ic.src=p.image.src;ic.alt=p.image.alt;ic.loading='lazy';ic.decoding='async';
      head.appendChild(ic);
    }
    head.appendChild(el('h3',null,p.name));
    body.appendChild(head);

    body.appendChild(el('p','proj-desc',p.description));

    var foot=el('div','proj-footer');
    if(featured){
      foot.appendChild(linkBtn('View','projects.html#p-'+p.id,false));
    }else{
      p.links.forEach(function(l){foot.appendChild(linkBtn(l.label,l.href,true));});
    }
    foot.appendChild(el('span','mono proj-meta',STATUS[p.status]+' · '+formatDate(p.date)+' · v'+p.version.replace(/^v/i,'')));
    body.appendChild(foot);

    card.appendChild(body);
    return card;
  }

  function showMessage(grid,text){
    grid.replaceChildren(el('p','proj-empty',text));
  }

  function distinct(projects,valuesOf){
    var seen={},out=[];
    projects.forEach(function(p){
      valuesOf(p).forEach(function(v){
        var k=v.toLowerCase();
        if(!seen[k]){seen[k]=true;out.push({key:k,label:v});}
      });
    });
    return out.sort(function(a,b){return a.label.localeCompare(b.label);});
  }

  function mountFilters(bar,projects,cards,grid){
    var state={lang:'all',status:'all'};
    var groups=[
      {name:'lang',label:'Language',options:distinct(projects,function(p){return p.languages;})},
      {name:'status',label:'Status',options:Object.keys(STATUS).filter(function(k){
        return projects.some(function(p){return p.status===k;});
      }).map(function(k){return{key:k,label:STATUS[k]};})}
    ];

    function apply(){
      var shown=cards.filter(function(c){
        var p=c.project;
        var okL=state.lang==='all'||p.languages.some(function(l){return l.toLowerCase()===state.lang;});
        var okS=state.status==='all'||p.status===state.status;
        return okL&&okS;
      }).map(function(c){return c.el;});
      if(shown.length)grid.replaceChildren.apply(grid,shown);
      else showMessage(grid,'No projects match those filters.');
    }

    groups.forEach(function(g){
      bar.appendChild(el('span','filter-label',g.label));
      var buttons=[];
      [{key:'all',label:'All'}].concat(g.options).forEach(function(o){
        var b=el('button','fb'+(o.key==='all'?' on':''),o.label);
        b.type='button';
        b.setAttribute('aria-pressed',o.key==='all'?'true':'false');
        b.addEventListener('click',function(){
          state[g.name]=o.key;
          buttons.forEach(function(x){
            var on=x===b;
            x.classList.toggle('on',on);
            x.setAttribute('aria-pressed',on?'true':'false');
          });
          apply();
        });
        buttons.push(b);
        bar.appendChild(b);
      });
    });
  }

  function init(){
    var grid=document.getElementById('grid');
    if(!grid)return;
    var featuredMode=grid.getAttribute('data-mode')==='featured';
    var bar=document.getElementById('filter-bar');
    var count=document.getElementById('proj-count');

    loadAll().then(function(projects){
      if(count)count.textContent=projects.length+(projects.length===1?' PROJECT':' PROJECTS');
      var list;
      if(featuredMode){
        list=projects.filter(function(p){return p.featured;}).sort(function(a,b){return a.featured-b.featured||a.order-b.order;}).slice(0,3);
      }else{
        list=projects.slice().sort(function(a,b){return b.date.localeCompare(a.date)||a.order-b.order;});
      }
      if(!list.length){showMessage(grid,'No projects to show yet.');return;}

      assignStyles(list,featuredMode?3:2);
      var cards=list.map(function(p){return{project:p,el:buildCard(p,featuredMode)};});
      grid.replaceChildren.apply(grid,cards.map(function(c){return c.el;}));
      if(bar&&!featuredMode)mountFilters(bar,list,cards,grid);

      if(!featuredMode&&/^#p-[a-z0-9-]+$/.test(location.hash)){
        var target=document.getElementById(location.hash.slice(1));
        if(target)target.scrollIntoView();
      }
    }).catch(function(err){
      console.error('projects:',err);
      showMessage(grid,'Could not load the projects list. If you opened this file directly, serve the folder over http instead (e.g. python -m http.server).');
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();

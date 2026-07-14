/* console.js - 磁盘管理器: 数据 + 渲染 + 导航交互 */
(function(){
'use strict';

/* ===== 工具函数 ===== */
var KB=1024,MB=KB*1024,GB=MB*1024,TB=GB*1024;
function fmtBytes(n){
  if(!n||n<0) return '0 B';
  if(n<KB) return n+' B';
  if(n<MB) return (n/KB).toFixed(1)+' KB';
  if(n<GB) return (n/MB).toFixed(1)+' MB';
  if(n<TB) return (n/GB).toFixed(1)+' GB';
  return (n/TB).toFixed(2)+' TB';
}
function fmtTime(ts){
  var now=Date.now(),diff=now-ts,d=new Date(ts);
  var sameDay=d.toDateString()===new Date(now).toDateString();
  var hh=String(d.getHours()).padStart(2,'0'),mm=String(d.getMinutes()).padStart(2,'0');
  if(sameDay) return '今天 '+hh+':'+mm;
  if(d.toDateString()===new Date(now-86400000).toDateString()) return '昨天 '+hh+':'+mm;
  if(diff<7*86400000) return Math.floor(diff/86400000)+' 天前';
  return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0');
}
function esc(s){return String(s).replace(/[&<>"']/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
function pct(used,total){return total>0?Math.round(used/total*100):0}

/* SVG 图标 */
var SVG={
  folder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  file:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  image:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  video:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="1"/></svg>',
  audio:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  archive:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>',
  code:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg>',
  ssd:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="6" width="19" height="13" rx="1"/><line x1="2.5" y1="10" x2="21.5" y2="10"/><line x1="7" y1="14" x2="11" y2="14"/></svg>',
  hdd:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="6" width="19" height="13" rx="1"/><line x1="2.5" y1="10" x2="21.5" y2="10"/><circle cx="17" cy="14.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  external:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2L4 7v10l8 5 8-5V7z"/><path d="M4 7l8 5 8-5"/><line x1="12" y1="22" x2="12" y2="12"/></svg>',
  network:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
};

function extOf(name){var i=name.lastIndexOf('.');return i>0?name.slice(i+1).toLowerCase():''}
function fileIcon(name){
  var e=extOf(name),set={
    png:'i',jpg:'i',jpeg:'i',gif:'i',svg:'i',webp:'i',bmp:'i',ico:'i',
    mp4:'v',mov:'v',mkv:'v',avi:'v',webm:'v',
    mp3:'a',flac:'a',wav:'a',aac:'a',ogg:'a',m4a:'a',
    zip:'z',tar:'z',gz:'z',rar:'z','7z':'z',zst:'z',tgz:'z',dmg:'z',
    js:'c',ts:'c',tsx:'c',jsx:'c',py:'c',rs:'c',go:'c',java:'c',c:'c',cpp:'c',h:'c',rb:'c',php:'c',swift:'c',kt:'c',sh:'c',vue:'c',css:'c',scss:'c',html:'c',json:'c',yaml:'c',yml:'c',toml:'c',xml:'c',sql:'c',lock:'c',
    md:'d',pdf:'d',doc:'d',docx:'d',xls:'d',xlsx:'d',ppt:'d',pptx:'d',txt:'d',csv:'d',rtf:'d'
  };
  var k=set[e];
  return k==='i'?SVG.image:k==='v'?SVG.video:k==='a'?SVG.audio:k==='z'?SVG.archive:k==='c'?SVG.code:k==='d'?SVG.doc:SVG.file;
}
function fileType(name,isDir){
  if(isDir) return '文件夹';
  var e=extOf(name),m={
    png:'PNG 图片',jpg:'JPG 图片',jpeg:'JPG 图片',gif:'GIF 图片',svg:'SVG 图片',webp:'WebP 图片',
    mp4:'MP4 视频',mov:'MOV 视频',mkv:'MKV 视频',avi:'AVI 视频',webm:'WebM 视频',
    mp3:'MP3 音频',flac:'FLAC 音频',wav:'WAV 音频',aac:'AAC 音频',
    zip:'ZIP 压缩包',tar:'TAR 压缩包',gz:'GZ 压缩包','7z':'7Z 压缩包',zst:'ZST 压缩包',dmg:'DMG 镜像',
    js:'JavaScript',ts:'TypeScript',tsx:'TSX',jsx:'JSX',py:'Python',rs:'Rust',go:'Go',
    java:'Java',c:'C 语言',cpp:'C++',h:'C 头文件',rb:'Ruby',php:'PHP',swift:'Swift',kt:'Kotlin',
    sh:'Shell',vue:'Vue',css:'样式表',scss:'SCSS',html:'HTML',json:'JSON',yaml:'YAML',yml:'YAML',
    toml:'TOML',xml:'XML',sql:'SQL',lock:'锁定文件',
    md:'Markdown',pdf:'PDF 文档',doc:'Word',docx:'Word',xls:'Excel',xlsx:'Excel',ppt:'PPT',pptx:'PPT',
    txt:'文本文件',csv:'CSV 表格',rtf:'RTF'
  };
  return m[e]||(e?e.toUpperCase()+' 文件':'文件');
}

/* ===== 磁盘数据 ===== */
var disks=[
  {id:'mac',name:'Macintosh HD',fs:'APFS',type:'ssd',total:512e9,used:419e9,label:'系统盘'},
  {id:'data',name:'Data',fs:'APFS',type:'hdd',total:1024e9,used:453e9,label:'数据盘'},
  {id:'sandisk',name:'Sandisk Extreme',fs:'exFAT',type:'external',total:2048e9,used:1734e9,label:'外置盘'},
  {id:'nas',name:'nas-photos',fs:'SMB3',type:'network',total:3072e9,used:1041e9,label:'网络盘'}
];

/* ===== 文件树 ===== */
var MIN=60000,HOUR=3600000,DAY=86400000,now=Date.now();
var tree={
  '/':[
    {n:'Users',t:'d',m:now-2*DAY},{n:'Applications',t:'d',m:now-5*DAY},
    {n:'Library',t:'d',m:now-12*DAY},{n:'System',t:'d',m:now-40*DAY},
    {n:'private',t:'d',m:now-20*DAY},{n:'opt',t:'d',m:now-8*DAY}
  ],
  '/Users':[{n:'dev',t:'d',m:now-10*MIN},{n:'shared',t:'d',m:now-30*DAY}],
  '/Users/dev':[
    {n:'Developer',t:'d',m:now-5*MIN},{n:'Documents',t:'d',m:now-2*DAY},
    {n:'Downloads',t:'d',m:now-20*MIN},{n:'Desktop',t:'d',m:now-1*HOUR},
    {n:'Pictures',t:'d',m:now-7*DAY},{n:'Movies',t:'d',m:now-15*DAY},
    {n:'Music',t:'d',m:now-20*DAY},{n:'.config',t:'d',m:now-3*DAY}
  ],
  '/Users/dev/Developer':[{n:'easy_terminal',t:'d',m:now-3*MIN}],
  '/Users/dev/Developer/easy_terminal':[
    {n:'src',t:'d',m:now-3*MIN},{n:'src-tauri',t:'d',m:now-2*HOUR},
    {n:'demo',t:'d',m:now-10*MIN},{n:'node_modules',t:'d',m:now-1*DAY},
    {n:'docs',t:'d',m:now-5*DAY},{n:'.git',t:'d',m:now-30*MIN},
    {n:'target',t:'d',s:6.4e9,m:now-1*DAY},
    {n:'package.json',t:'f',s:1843,m:now-2*DAY},
    {n:'pnpm-lock.yaml',t:'f',s:145820,m:now-2*DAY},
    {n:'tsconfig.json',t:'f',s:812,m:now-2*DAY},
    {n:'vite.config.ts',t:'f',s:1204,m:now-2*DAY},
    {n:'README.md',t:'f',s:4521,m:now-4*DAY},
    {n:'AGENTS.md',t:'f',s:8234,m:now-6*HOUR},
    {n:'index.html',t:'f',s:921,m:now-2*DAY},
    {n:'.gitignore',t:'f',s:318,m:now-10*DAY}
  ],
  '/Users/dev/Developer/easy_terminal/src':[
    {n:'main.ts',t:'f',s:8421,m:now-3*MIN},{n:'canvas.ts',t:'f',s:12450,m:now-20*MIN},
    {n:'terminal-manager.ts',t:'f',s:15300,m:now-1*HOUR},{n:'terminal-window.ts',t:'f',s:9800,m:now-1*HOUR},
    {n:'command-intelligence.ts',t:'f',s:11200,m:now-2*HOUR},{n:'command-suggest.ts',t:'f',s:6700,m:now-2*HOUR},
    {n:'file-tree.ts',t:'f',s:18900,m:now-3*HOUR},{n:'ssh-panel.ts',t:'f',s:14500,m:now-5*HOUR},
    {n:'styles.css',t:'f',s:22100,m:now-4*HOUR},{n:'types.ts',t:'f',s:3400,m:now-6*HOUR},
    {n:'i18n.ts',t:'f',s:5600,m:now-1*DAY},{n:'settings.ts',t:'f',s:7800,m:now-2*DAY}
  ],
  '/Users/dev/Developer/easy_terminal/src-tauri':[
    {n:'src',t:'d',m:now-2*HOUR},{n:'target',t:'d',s:6.4e9,m:now-1*DAY},
    {n:'commands',t:'d',m:now-3*DAY},
    {n:'Cargo.toml',t:'f',s:2100,m:now-2*DAY},{n:'Cargo.lock',t:'f',s:45200,m:now-1*DAY},
    {n:'tauri.conf.json',t:'f',s:3400,m:now-3*DAY},{n:'build.rs',t:'f',s:850,m:now-5*DAY}
  ],
  '/Users/dev/Developer/easy_terminal/demo':[
    {n:'console',t:'d',m:now-5*MIN},
    {n:'disk-console.html',t:'f',s:4200,m:now-5*MIN},
    {n:'disk-dashboard.html',t:'f',s:34000,m:now-2*HOUR},
    {n:'disk-scanner.html',t:'f',s:27000,m:now-3*HOUR},
    {n:'disk-treemap.html',t:'f',s:32000,m:now-4*HOUR}
  ],
  '/Users/dev/Documents':[
    {n:'简历.pdf',t:'f',s:2100000,m:now-5*DAY},{n:'面试笔记.md',t:'f',s:8400,m:now-3*DAY},
    {n:'项目计划.xlsx',t:'f',s:45000,m:now-7*DAY},{n:'报销.docx',t:'f',s:120000,m:now-15*DAY},
    {n:'参考资料',t:'d',m:now-20*DAY}
  ],
  '/Users/dev/Downloads':[
    {n:'FlutterSDK.zip',t:'f',s:2.1e9,m:now-240*DAY},
    {n:'Xcode_15.dmg',t:'f',s:8.4e9,m:now-90*DAY},
    {n:'demo-capture.mov',t:'f',s:514e6,m:now-14*MIN},
    {n:'incremental.tar.zst',t:'f',s:882e6,m:now-14*MIN},
    {n:'screenshot-grid.png',t:'f',s:238e6,m:now-1*DAY},
    {n:'wallpaper.jpg',t:'f',s:8400000,m:now-12*DAY},
    {n:'node-v20.pkg',t:'f',s:42e6,m:now-30*DAY}
  ],
  '/Users/dev/Pictures':[
    {n:'IMG_2401.jpg',t:'f',s:4200000,m:now-2*DAY},{n:'IMG_2402.jpg',t:'f',s:3800000,m:now-2*DAY},
    {n:'screenshot.png',t:'f',s:1200000,m:now-1*DAY},{n:'图标素材',t:'d',m:now-10*DAY}
  ],
  '/Users/dev/Desktop':[
    {n:'TODO.md',t:'f',s:2300,m:now-1*HOUR},{n:'截图.png',t:'f',s:3400000,m:now-2*HOUR},
    {n:'临时',t:'d',m:now-3*HOUR}
  ],
  '/System':[{n:'Library',t:'d',m:now-40*DAY}],
  '/Applications':[{n:'Visual Studio Code.app',t:'d',m:now-3*DAY},{n:'Terminal.app',t:'d',m:now-60*DAY}]
};

/* 每个磁盘的默认根路径(保证有数据) */
var diskRoot={
  mac:'/Users/dev/Developer/easy_terminal',
  data:'/Users/dev/Downloads',
  sandisk:'/Users/dev/Pictures',
  nas:'/Users/dev/Documents'
};

/* ===== 状态 ===== */
var state={
  disk:'mac',
  path:'/Users/dev/Developer/easy_terminal',
  history:[],future:[],
  selected:new Set(),
  sortKey:'name',sortDir:'asc',
  search:''
};

/* ===== 数据访问 ===== */
function listDir(path){
  var items=tree[path];
  if(!items) return [];
  return items.map(function(it){
    return{name:it.n,isDir:it.t==='d',size:it.s||0,mtime:it.m,
      path:path==='/'?'/'+it.n:path+'/'+it.n};
  });
}
function parentPath(p){if(p==='/'||p.indexOf('/')<1)return'/';var i=p.lastIndexOf('/');return i<=0?'/':p.slice(0,i)}
function go(path){
  if(path===state.path) return;
  state.history.push(state.path);state.future=[];
  state.path=path;state.selected.clear();
  render();
}
function goDisk(id){
  state.disk=id;state.history=[];state.future=[];
  state.path=diskRoot[id]||'/';state.selected.clear();
  render();
}
function back(){if(state.history.length){state.future.push(state.path);state.path=state.history.pop();state.selected.clear();render()}}
function fwd(){if(state.future.length){state.history.push(state.path);state.path=state.future.pop();state.selected.clear();render()}}
function up(){var p=parentPath(state.path);if(p!==state.path)go(p)}

/* ===== 排序过滤 ===== */
function sorted(){
  var items=listDir(state.path);
  var q=state.search.trim().toLowerCase();
  if(q) items=items.filter(function(i){return i.name.toLowerCase().indexOf(q)>=0});
  var dirs=items.filter(function(i){return i.isDir});
  var files=items.filter(function(i){return!i.isDir});
  var k=state.sortKey,dir=state.sortDir==='asc'?1:-1;
  function cmp(a,b){
    if(k==='name') return a.name.localeCompare(b.name)*dir;
    if(k==='size') return((a.size||0)-(b.size||0))*dir;
    if(k==='date') return(a.mtime-b.mtime)*dir;
    if(k==='type') return fileType(a.name,a.isDir).localeCompare(fileType(b.name,b.isDir))*dir||a.name.localeCompare(b.name);
    return 0;
  }
  dirs.sort(cmp);files.sort(cmp);
  return dirs.concat(files);
}

/* ===== 渲染 ===== */
var $=function(id){return document.getElementById(id)};

function renderDisks(){
  var html=disks.map(function(d){
    var p=pct(d.used,d.total);
    var cls=p>=85?'full':p>=70?'warn':'normal';
    var active=d.id===state.disk?' active':'';
    return '<div class="disk-item'+active+'" data-disk="'+d.id+'">'
      +'<div class="disk-row">'
        +'<div class="disk-ico '+d.type+'">'+SVG[d.type]+'</div>'
        +'<div class="disk-info">'
          +'<div class="disk-name">'+esc(d.name)+'</div>'
          +'<div class="disk-meta">'+esc(d.fs)+' · '+p+'% 已用</div>'
        +'</div>'
      +'</div>'
      +'<div class="disk-bar-wrap">'
        +'<div class="disk-bar"><div class="disk-bar-fill '+cls+'" style="width:'+p+'%"></div></div>'
        +'<div class="disk-bar-text"><span class="used">'+fmtBytes(d.used)+'</span><span>'+fmtBytes(d.total)+'</span></div>'
      +'</div>'
    +'</div>';
  }).join('');
  $('disk-list').innerHTML=html;

  var tu=disks.reduce(function(s,d){return s+d.used},0);
  var tt=disks.reduce(function(s,d){return s+d.total},0);
  var tp=pct(tu,tt);
  $('sidebar-foot').innerHTML='<div class="foot-label">所有磁盘总容量</div>'
    +'<div class="foot-total">'+fmtBytes(tu)+' <span class="sub">/ '+fmtBytes(tt)+'</span></div>'
    +'<div class="foot-bar"><i style="width:'+tp+'%;background:'+(tp>=75?'var(--red)':'var(--accent)')+'"></i></div>';
}

function renderPath(){
  var parts=state.path.split('/').filter(Boolean);
  var disk=disks.find(function(d){return d.id===state.disk});
  var html='<span class="crumb current">'+esc(disk.name)+'</span>';
  var cur='';
  for(var i=0;i<parts.length;i++){
    cur+='/'+parts[i];
    html+='<span class="crumb-sep">›</span>';
    var last=i===parts.length-1;
    if(last) html+='<span class="crumb current">'+esc(parts[i])+'</span>';
    else html+='<span class="crumb" data-path="'+esc(cur)+'">'+esc(parts[i])+'</span>';
  }
  $('addrbar-path').innerHTML=html;
}

function renderList(){
  var items=sorted();
  if(!items.length){
    $('files-list').innerHTML='<div class="empty">'+SVG.folder+'<div class="empty-title">此文件夹为空</div></div>';
    $('status-items').textContent='0 项';
    $('status-size').textContent='';
    return;
  }
  var selSize=0;
  var html=items.map(function(it){
    var sel=state.selected.has(it.path)?' selected':'';
    var dir=it.isDir?' is-dir':'';
    var icon=it.isDir?'<span class="cell-icon folder">'+SVG.folder+'</span>':'<span class="cell-icon">'+fileIcon(it.name)+'</span>';
    if(state.selected.has(it.path)&&!it.isDir) selSize+=it.size;
    return '<div class="frow'+sel+dir+'" data-path="'+esc(it.path)+'" data-dir="'+it.isDir+'">'
      +'<div class="cell-name">'+icon+'<span class="cell-name-text">'+esc(it.name)+'</span></div>'
      +'<div class="cell-date">'+fmtTime(it.mtime)+'</div>'
      +'<div class="cell-type">'+fileType(it.name,it.isDir)+'</div>'
      +'<div class="cell-size">'+(it.isDir?'':fmtBytes(it.size))+'</div>'
    +'</div>';
  }).join('');
  $('files-list').innerHTML=html;
  var selCount=state.selected.size;
  $('status-items').textContent=items.length+' 项'+(selCount?' · 已选 '+selCount:'');
  $('status-size').textContent=selSize>0?'已选 '+fmtBytes(selSize):'';
}

function renderSort(){
  Array.prototype.forEach.call(document.querySelectorAll('.col'),function(c){
    c.classList.remove('sorted','asc','desc');
    if(c.dataset.sort===state.sortKey) c.classList.add('sorted',state.sortDir);
  });
}

function renderNav(){
  $('btn-back').disabled=state.history.length===0;
  $('btn-fwd').disabled=state.future.length===0;
  $('btn-up').disabled=state.path==='/'||state.path===parentPath(state.path);
  var disk=disks.find(function(d){return d.id===state.disk});
  $('status-disk').textContent=disk?disk.name+' · '+fmtBytes(disk.used)+'/'+fmtBytes(disk.total):'';
  Array.prototype.forEach.call(document.querySelectorAll('.nav-quick'),function(q){
    q.classList.toggle('active',q.dataset.diskId===state.disk&&q.dataset.path===state.path);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.disk-item'),function(d){
    d.classList.toggle('active',d.dataset.disk===state.disk);
  });
}

function render(){renderDisks();renderPath();renderList();renderSort();renderNav()}

/* ===== 事件 ===== */
function bind(){
  $('btn-back').onclick=back;
  $('btn-fwd').onclick=fwd;
  $('btn-up').onclick=up;
  $('btn-refresh').onclick=function(){render()};
  $('btn-theme').onclick=function(){
    var h=document.documentElement;
    h.setAttribute('data-theme',h.getAttribute('data-theme')==='craft-dark'?'craft-light':'craft-dark');
  };

  $('files-list').addEventListener('click',function(e){
    var row=e.target.closest('.frow');
    if(!row){state.selected.clear();renderList();return}
    var path=row.dataset.path;
    if(e.shiftKey||e.ctrlKey||e.metaKey){
      if(state.selected.has(path)) state.selected.delete(path);else state.selected.add(path);
    }else{state.selected.clear();state.selected.add(path)}
    renderList();renderNav();
  });
  $('files-list').addEventListener('dblclick',function(e){
    var row=e.target.closest('.frow');
    if(row&&row.dataset.dir==='true') go(row.dataset.path);
  });

  $('addrbar-path').addEventListener('click',function(e){
    if(e.target.classList.contains('crumb')&&!e.target.classList.contains('current')&&e.target.dataset.path){
      go(e.target.dataset.path);
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('.nav-quick'),function(q){
    q.onclick=function(){state.disk=q.dataset.diskId;go(q.dataset.path)};
  });

  $('disk-list').addEventListener('click',function(e){
    var item=e.target.closest('.disk-item');
    if(item) goDisk(item.dataset.disk);
  });

  $('files-header').addEventListener('click',function(e){
    var col=e.target.closest('.col');if(!col)return;
    var key=col.dataset.sort;
    if(state.sortKey===key) state.sortDir=state.sortDir==='asc'?'desc':'asc';
    else{state.sortKey=key;state.sortDir='asc'}
    render();
  });

  $('search').addEventListener('input',function(e){state.search=e.target.value;renderList()});

  document.addEventListener('keydown',function(e){
    var inField=e.target.tagName==='INPUT';
    if(e.altKey&&e.key==='ArrowLeft'){e.preventDefault();back();return}
    if(e.altKey&&e.key==='ArrowRight'){e.preventDefault();fwd();return}
    if(e.altKey&&e.key==='ArrowUp'){e.preventDefault();up();return}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a'&&!inField){
      e.preventDefault();sorted().forEach(function(it){state.selected.add(it.path)});renderList();return;
    }
    if(e.key==='Backspace'&&!inField){e.preventDefault();up();return}
    if(e.key==='F5'){e.preventDefault();render();return}
    if(e.key==='Escape'){state.selected.clear();state.search='';$('search').value='';renderList();return}
  });
}

bind();
render();

})();

const ruDays=['вс','пн','вт','ср','чт','пт','сб'];
const ruMonths=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const shows=[
  {name:'Чайка',dateOffset:2,time:'19:00',place:'Большая сцена',cast:['АС','МВ','ИК','ОЛ','+4'],conflict:1},
  {name:'Гроза',dateOffset:6,time:'18:30',place:'Камерная сцена',cast:['ДП','АС','ЕН','+3'],conflict:0},
  {name:'Три сестры',dateOffset:10,time:'19:00',place:'Большая сцена',cast:['КС','МВ','ОЛ','+6'],conflict:2}
];
const members=[
  {name:'Анна Смирнова',role:'Актриса',shows:['Чайка','Гроза'],week:['free','free','limited','busy','free','free','none']},
  {name:'Михаил Волков',role:'Актёр',shows:['Чайка','Три сестры'],week:['free','busy','free','free','limited','free','free']},
  {name:'Ирина Крылова',role:'Актриса',shows:['Чайка'],week:['free','free','free','busy','busy','free','none']},
  {name:'Денис Петров',role:'Актёр',shows:['Гроза'],week:['limited','free','free','free','free','busy','busy']},
  {name:'Ольга Левина',role:'Актриса',shows:['Чайка','Три сестры'],week:['free','free','busy','free','free','free','limited']}
];
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
const fmt=d=>`${d.getDate()} ${ruMonths[d.getMonth()]}`;
function dateAt(offset){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+offset);return d}
function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function niceDate(value){const d=new Date(value+'T12:00:00');return `${d.getDate()} ${ruMonths[d.getMonth()]}, ${ruDays[d.getDay()]}`}
function defaultSlots(){return[
  {id:'s1',title:'Сценическая репетиция',production:'Чайка',date:iso(dateAt(1)),from:'18:00',to:'21:00',place:'Большая сцена',responses:{'Анна Смирнова':'free','Михаил Волков':'free','Ирина Крылова':'free','Денис Петров':'none','Ольга Левина':'limited'}},
  {id:'s2',title:'Прогон первого акта',production:'Гроза',date:iso(dateAt(3)),from:'12:00',to:'15:00',place:'Зал №2',responses:{'Анна Смирнова':'busy','Михаил Волков':'free','Ирина Крылова':'none','Денис Петров':'free','Ольга Левина':'free'}},
  {id:'s3',title:'Общий прогон',production:'Три сестры',date:iso(dateAt(5)),from:'18:30',to:'22:00',place:'Большая сцена',responses:{'Анна Смирнова':'limited','Михаил Волков':'free','Ирина Крылова':'busy','Денис Петров':'free','Ольга Левина':'free'}},
  {id:'s4',title:'Читка и разбор',production:'Общее',date:iso(dateAt(8)),from:'11:00',to:'13:00',place:'Фойе',responses:{'Анна Смирнова':'free','Михаил Волков':'limited','Ирина Крылова':'free','Денис Петров':'free','Ольга Левина':'free'}}
]}
const state={
  user:JSON.parse(localStorage.getItem('sbor-user')||'null'),
  availability:JSON.parse(localStorage.getItem('sbor-availability')||'{}'),
  slots:JSON.parse(localStorage.getItem('sbor-slots-v2')||'null')||defaultSlots(),
  admin:false,selectedDate:null,selectedStatus:null,filter:'Все',slotFilter:'Все'
};
function persistAvailability(){localStorage.setItem('sbor-availability',JSON.stringify(state.availability))}
function persistSlots(){localStorage.setItem('sbor-slots-v2',JSON.stringify(state.slots))}
function initDefaults(){if(Object.keys(state.availability).length)return;['free','free','limited','busy','free','none','free','free','limited','free','busy','none','free','free'].forEach((s,i)=>{if(s!=='none')state.availability[iso(dateAt(i))]={status:s,...(s==='limited'?{from:'18:00',to:'22:00'}:{})}});persistAvailability()}
function toast(t='Сохранено'){const el=$('#toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1700)}
function currentName(){return state.user?.name||'Анна Смирнова'}
function login(user={name:'Анна Смирнова',role:'Актриса'}){state.user=user;localStorage.setItem('sbor-user',JSON.stringify(user));$('#authScreen').classList.add('hidden');$('#app').classList.remove('hidden');applyUser();renderAll()}
function applyUser(){const n=currentName();$('#profileName').textContent=n;$('#profileRole').textContent=state.user?.role||'Участник';$('#avatar').textContent=n.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}

function cycleDay(key){
  const order=[null,'free','limited','busy'];
  const current=state.availability[key]?.status||null;
  const next=order[(order.indexOf(current)+1)%order.length];
  if(!next)delete state.availability[key];
  else state.availability[key]={status:next,...(next==='limited'?{from:'18:00',to:'22:00'}:{})};
  persistAvailability();renderCalendar();
}
function renderCalendar(){
  const labels={free:'Свободен',limited:'Ограничения',busy:'Не могу'};
  $('#calendar').innerHTML='';
  for(let i=0;i<14;i++){
    const d=dateAt(i),key=iso(d),av=state.availability[key],daySlots=state.slots.filter(s=>s.date===key);
    const el=document.createElement('article');el.className=`day ${i===0?'today':''}`;el.dataset.date=key;el.dataset.status=av?.status||'none';
    const status=av?`<div class="status-pill status-${av.status}">${labels[av.status]}${av.from?`<small>${av.from}–${av.to}</small>`:''}</div>`:'<div class="status-pill status-none">+ отметить</div>';
    el.innerHTML=`<div class="day-head"><span class="weekday">${ruDays[d.getDay()]}</span><span class="date-num">${d.getDate()}</span></div><button class="day-edit" aria-label="Точно настроить ${fmt(d)}" title="Точное редактирование">✎</button>${daySlots.length?`<span class="slot-count">◴ ${daySlots.length} ${daySlots.length===1?'слот':'слота'}</span>`:''}${status}`;
    el.onclick=e=>{if(!e.target.closest('.day-edit'))cycleDay(key)};
    el.querySelector('.day-edit').onclick=()=>openDay(key);
    $('#calendar').appendChild(el);
  }
}
function openDay(key){
  state.selectedDate=key;const av=state.availability[key];state.selectedStatus=av?.status||null;
  $('#modalDate').textContent=niceDate(key);$$('[data-status]').forEach(b=>b.classList.toggle('selected',b.dataset.status===state.selectedStatus));
  $('#timeFields').classList.toggle('hidden',state.selectedStatus!=='limited');if(av?.from){$('#timeFrom').value=av.from;$('#timeTo').value=av.to}$('#dayModal').classList.remove('hidden');
}

function setSlotResponse(id,response){const slot=state.slots.find(s=>s.id===id);if(!slot)return;slot.responses[currentName()]=response;persistSlots();renderSlots();renderMatches();toast('Ответ сохранён')}
function renderSlotFilters(){const values=['Все',...new Set(state.slots.map(s=>s.production))];$('#slotFilters').innerHTML=values.map(v=>`<button class="filter ${state.slotFilter===v?'active':''}" data-slot-filter="${v}">${v}</button>`).join('');$$('[data-slot-filter]').forEach(b=>b.onclick=()=>{state.slotFilter=b.dataset.slotFilter;renderSlots()})}
function renderSlots(){
  renderSlotFilters();const slots=state.slots.filter(s=>state.slotFilter==='Все'||s.production===state.slotFilter).sort((a,b)=>(a.date+a.from).localeCompare(b.date+b.from));
  $('#slotBadge').textContent=state.slots.length;
  $('#slotList').innerHTML=slots.length?slots.map(s=>{
    const answer=s.responses[currentName()]||'none',values=Object.values(s.responses),free=values.filter(v=>v==='free').length,possible=values.filter(v=>v==='limited').length;
    const action=state.admin?`<div class="slot-admin-summary"><strong>${free + possible}/${members.length}</strong><span>${free} могут · ${possible} возможно</span><button class="small-action" data-delete-slot="${s.id}">Удалить</button></div>`:`<div class="slot-actions"><div class="response-buttons"><button data-slot="${s.id}" data-response="free" class="${answer==='free'?'chosen':''}" title="Могу">✓</button><button data-slot="${s.id}" data-response="limited" class="${answer==='limited'?'chosen':''}" title="Возможно">~</button><button data-slot="${s.id}" data-response="busy" class="${answer==='busy'?'chosen':''}" title="Не могу">×</button></div><div class="response-legend">могу · возможно · не могу</div></div>`;
    return `<article class="slot-card"><div class="slot-when"><strong>${s.from}</strong><span>${niceDate(s.date)}<br>до ${s.to}</span></div><div class="slot-info"><h3>${s.title}</h3><p>${s.place}</p><span class="slot-production">${s.production}</span></div>${action}</article>`
  }).join(''):'<div class="empty-state">В этой категории пока нет слотов.</div>';
  $$('[data-slot][data-response]').forEach(b=>b.onclick=()=>setSlotResponse(b.dataset.slot,b.dataset.response));
  $$('[data-delete-slot]').forEach(b=>b.onclick=()=>{state.slots=state.slots.filter(s=>s.id!==b.dataset.deleteSlot);persistSlots();renderAll();toast('Слот удалён')});
}
function renderMatches(){
  const ranked=[...state.slots].map(s=>{const values=members.map(m=>s.responses[m.name]||'none');return{slot:s,free:values.filter(v=>v==='free').length,limited:values.filter(v=>v==='limited').length,busy:values.filter(v=>v==='busy').length,none:values.filter(v=>v==='none').length}}).sort((a,b)=>(b.free+b.limited*.5)-(a.free+a.limited*.5));
  const best=ranked[0],full=ranked.filter(x=>x.busy===0&&x.none===0).length,answers=ranked.reduce((n,x)=>n+members.length-x.none,0),total=Math.max(1,ranked.length*members.length);
  $('#matchSummary').innerHTML=`<div class="summary-card"><strong>${best?best.free+best.limited:0}/${members.length}</strong><span>лучшее пересечение</span></div><div class="summary-card"><strong>${full}</strong><span>слотов без отказов</span></div><div class="summary-card"><strong>${Math.round(answers/total*100)}%</strong><span>ответов собрано</span></div>`;
  $('#matchList').innerHTML=ranked.map(({slot:s,free,limited})=>`<article class="match-card"><div class="match-head"><div><h3>${s.title}</h3><p>${niceDate(s.date)} · ${s.from}–${s.to} · ${s.production}</p></div><div class="match-score"><strong>${free+limited}/${members.length}</strong><span>доступны</span></div></div><div class="member-responses">${members.map(m=>{const r=s.responses[m.name]||'none',word={free:'может',limited:'возможно',busy:'не может',none:'нет ответа'}[r];return`<div class="member-chip ${r}">${m.name.split(' ')[0]} · ${word}</div>`}).join('')}</div></article>`).join('')}

function renderEvents(){
  $('#eventList').innerHTML=shows.map(s=>{const d=dateAt(s.dateOffset);return`<article class="event-card"><div class="event-date">${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}</div><div class="event-main"><strong>${s.name}</strong><span>${s.time} · ${s.place}</span></div><div class="event-meta">${s.conflict?`<span class="warning">${s.conflict} ${s.conflict===1?'участник не может':'участника не могут'}</span>`:'Весь состав свободен'}</div></article>`}).join('')
}
function renderShows(){$('#showGrid').innerHTML=shows.map((s,i)=>`<article class="show-card"><span class="show-card-number">0${i+1} / ${fmt(dateAt(s.dateOffset))}</span><h3>${s.name}</h3><p>${s.time} · ${s.place}</p><div class="cast-avatars">${s.cast.map(x=>`<span>${x}</span>`).join('')}</div><div class="show-status"><span>Состав: ${s.cast.length+3} человек</span><span class="${s.conflict?'warning':''}">${s.conflict?s.conflict+' не могут':'Все свободны'}</span></div></article>`).join('')}
function renderTeam(){
  const names=['Все',...shows.map(s=>s.name)];$('#filters').innerHTML=names.map(n=>`<button class="filter ${state.filter===n?'active':''}" data-filter="${n}">${n}</button>`).join('');$$('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;renderTeam()});
  const filtered=members.filter(m=>state.filter==='Все'||m.shows.includes(state.filter));$('#teamTable').innerHTML=filtered.map(m=>`<tr><td><div class="person"><span class="mini-avatar">${m.name.split(' ').map(x=>x[0]).join('')}</span><span><strong>${m.name}</strong><br><small>${m.role}</small></span></div></td><td>${m.shows.join(', ')}</td><td><div class="week-dots">${m.week.map(s=>`<i class="${s==='none'?'gray':s==='free'?'green':s==='limited'?'yellow':'red'}"></i>`).join('')}</div></td><td class="admin-only"><button class="small-action">Изменить состав</button></td></tr>`).join('')
}
function renderAll(){initDefaults();renderCalendar();renderSlots();renderMatches();renderEvents();renderShows();renderTeam();const now=new Date();$('#todayLabel').textContent=`${ruDays[now.getDay()]}, ${fmt(now)}`}

$$('.auth-tab').forEach(b=>b.onclick=()=>{$$('.auth-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#loginForm').classList.toggle('hidden',b.dataset.authTab!=='login');$('#registerForm').classList.toggle('hidden',b.dataset.authTab!=='register')});
$('#loginButton').onclick=()=>login();$('#demoButton').onclick=()=>login();
$('#registerButton').onclick=()=>{const name=$('#registerName').value.trim();if(!name||!$('#registerEmail').value.includes('@')||$('#registerPassword').value.length<8){toast('Заполните все поля');return}login({name,role:'Участник'})};
$('#logoutButton').onclick=()=>{localStorage.removeItem('sbor-user');location.reload()};
$$('.nav-link').forEach(b=>b.onclick=()=>{$$('.nav-link').forEach(x=>x.classList.remove('active'));b.classList.add('active');$$('.page').forEach(p=>p.classList.remove('active'));$(`#${b.dataset.page}Page`).classList.add('active');$('#pageTitle').textContent={schedule:'Доступность',slots:'Слоты',matches:'Пересечения',shows:'Спектакли',team:'Участники'}[b.dataset.page];$('.sidebar').classList.remove('open')});
$$('[data-go]').forEach(b=>b.onclick=()=>document.querySelector(`[data-page="${b.dataset.go}"]`).click());$('#mobileMenu').onclick=()=>$('.sidebar').classList.toggle('open');
$('#adminToggle').onclick=()=>{state.admin=!state.admin;$('#app').classList.toggle('admin-mode',state.admin);$('#adminToggle span:last-child').innerHTML=`<small>Режим</small>${state.admin?'Администратор':'Участник'}`;$('#profileRole').textContent=state.admin?'Администратор':state.user.role;renderSlots();toast(state.admin?'Режим администратора':'Режим участника')};
$$('[data-status]').forEach(b=>b.onclick=()=>{state.selectedStatus=b.dataset.status;$$('[data-status]').forEach(x=>x.classList.toggle('selected',x===b));$('#timeFields').classList.toggle('hidden',state.selectedStatus!=='limited')});
$('#saveDay').onclick=()=>{if(!state.selectedStatus){toast('Выберите статус');return}state.availability[state.selectedDate]={status:state.selectedStatus,...(state.selectedStatus==='limited'?{from:$('#timeFrom').value,to:$('#timeTo').value}:{})};persistAvailability();$('#dayModal').classList.add('hidden');renderCalendar();toast()};
$$('[data-close]').forEach(b=>b.onclick=()=>$('#dayModal').classList.add('hidden'));$('#dayModal').onclick=e=>{if(e.target.id==='dayModal')e.currentTarget.classList.add('hidden')};
$('#copyWeek').onclick=()=>{for(let i=0;i<7;i++){const a=state.availability[iso(dateAt(i))];if(a)state.availability[iso(dateAt(i+7))]={...a};else delete state.availability[iso(dateAt(i+7))]}persistAvailability();renderCalendar();toast('Неделя скопирована')};
$('#addSlot').onclick=()=>{$('#slotDate').value=iso(dateAt(1));$('#slotModal').classList.remove('hidden')};
$('#saveSlot').onclick=()=>{const title=$('#slotTitle').value.trim(),date=$('#slotDate').value;if(!title||!date){toast('Добавьте название и дату');return}state.slots.push({id:'s'+Date.now(),title,production:$('#slotProduction').value,date,from:$('#slotFrom').value,to:$('#slotTo').value,place:$('#slotPlace').value.trim()||'Место уточняется',responses:{}});persistSlots();$('#slotModal').classList.add('hidden');$('#slotTitle').value='';renderAll();toast('Слот создан')};
$$('[data-close-slot]').forEach(b=>b.onclick=()=>$('#slotModal').classList.add('hidden'));$('#slotModal').onclick=e=>{if(e.target.id==='slotModal')e.currentTarget.classList.add('hidden')};
$('#addShow').onclick=()=>toast('Добавление спектакля — следующий этап');
if(state.user)login(state.user);

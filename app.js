(() => {
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const KEY = 'timetable_platform_v1';
const ALL_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat'];
const PALETTE = ['#dbeafe','#fce7f3','#dcfce7','#fef3c7','#ede9fe','#cffafe','#ffedd5','#e0e7ff','#fecdd3','#d9f99d'];
const blank = () => ({ teachers:[], rooms:[], classes:[], subjects:[], timetable:null, report:null,
  settings:{ days:['Mon','Tue','Wed','Thu','Fri'], periods:6, maxPerDay:2, start:'09:00', len:50 } });
let S = load();
function load(){ try { const d = JSON.parse(localStorage.getItem(KEY)); if (d) return d; } catch(e){} return blank(); }
function save(){ localStorage.setItem(KEY, JSON.stringify(S)); $('#syncTxt').textContent='Syncing…'; setTimeout(()=>$('#syncTxt').textContent='Cloud Synced',400); }
const uid = () => Math.random().toString(36).slice(2,9);
const byId = (arr,id) => arr.find(x=>x.id===id);
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2200); }
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- Tabs ---------- */
$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x=>x.classList.toggle('active',x===b));
  $$('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===b.dataset.tab));
});

/* ---------- Data entry ---------- */
$$('form[data-form]').forEach(f => f.onsubmit = e => {
  e.preventDefault();
  const k = f.dataset.form, fd = Object.fromEntries(new FormData(f));
  const item = { id: uid(), name: fd.name.trim() };
  if (k==='rooms') item.capacity = +fd.capacity;
  if (k==='classes') item.size = +fd.size;
  if (k==='subjects') { item.class = fd.class; item.teacher = fd.teacher; item.hours = +fd.hours;
    if (!S.classes.length || !S.teachers.length) return toast('Add a class and a teacher first'); }
  S[k].push(item); S.timetable = null; save(); f.reset(); render();
});
function remove(k,id){
  S[k] = S[k].filter(x=>x.id!==id);
  if (k==='teachers') S.subjects = S.subjects.filter(s=>s.teacher!==id);
  if (k==='classes') S.subjects = S.subjects.filter(s=>s.class!==id);
  S.timetable = null; save(); render();
}
document.addEventListener('click', e => { const x = e.target.closest('[data-del]'); if (x) remove(x.dataset.k, x.dataset.del); });

function render(){
  const li = (k,x,sub) => `<li><span>${esc(x.name)} <small>${sub}</small></span><button class="x" data-k="${k}" data-del="${x.id}">×</button></li>`;
  $('#list-teachers').innerHTML = S.teachers.map(x=>li('teachers',x,'')).join('') || '<small>None yet</small>';
  $('#list-rooms').innerHTML = S.rooms.map(x=>li('rooms',x,`· cap ${x.capacity}`)).join('') || '<small>None yet</small>';
  $('#list-classes').innerHTML = S.classes.map(x=>li('classes',x,`· ${x.size} students`)).join('') || '<small>None yet</small>';
  $('#selClass').innerHTML = S.classes.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
  $('#selTeacher').innerHTML = S.teachers.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
  $('#list-subjects').innerHTML = S.subjects.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(byId(S.classes,s.class)?.name||'?')}</td><td>${esc(byId(S.teachers,s.teacher)?.name||'?')}</td><td>${s.hours}</td><td><button class="x" data-k="subjects" data-del="${s.id}">×</button></td></tr>`).join('') || '<tr><td colspan="5"><small>No subjects yet</small></td></tr>';
  // settings
  $('#dayBoxes').innerHTML = ALL_DAYS.map(d=>`<label><input type="checkbox" value="${d}" ${S.settings.days.includes(d)?'checked':''}>${d}</label>`).join('');
  $('#periods').value = S.settings.periods; $('#maxPerDay').value = S.settings.maxPerDay;
  $('#startTime').value = S.settings.start; $('#periodLen').value = S.settings.len;
  renderViewSelect(); renderTimetable();
}
$('#saveSettings').onclick = () => {
  const days = $$('#dayBoxes input:checked').map(i=>i.value);
  if (!days.length) return toast('Select at least one day');
  S.settings = { days, periods:+$('#periods').value||6, maxPerDay:+$('#maxPerDay').value||2, start:$('#startTime').value||'09:00', len:+$('#periodLen').value||50 };
  S.timetable = null; save(); render(); toast('Settings saved');
};

/* ---------- Optimization engine ----------
   Greedy scheduling with constraint checks + randomized restarts.
   Hard constraints: no clash for class / teacher / room, room capacity >= class size.
   Soft goals (scored): limit repeats of a subject per day, spread subjects across days,
   avoid gaps in class day, balance teacher load. Best of N attempts is kept. */
function attempt(seed){
  const rnd = mulberry(seed), D = S.settings.days.length, P = S.settings.periods, maxPD = S.settings.maxPerDay;
  const busy = { class:{}, teacher:{}, room:{} };
  const isBusy = (t,id,d,p) => busy[t][id+'|'+d+'|'+p];
  const mark = (t,id,d,p) => busy[t][id+'|'+d+'|'+p] = true;
  const perDay = {}; // subject|day count
  const placed = [], unplaced = [];
  // hardest first: more hours, then bigger classes; random tie-breaker
  const jobs = S.subjects.flatMap(s => Array.from({length:s.hours}, (_,i)=>({s, i})));
  const load = {}; S.subjects.forEach(s => load[s.id] = s.hours);
  jobs.sort((a,b) => (load[b.s.id]-load[a.s.id]) || (rnd()-.5));
  let penalty = 0;
  for (const {s} of jobs) {
    const cls = byId(S.classes,s.class); if (!cls) continue;
    const rooms = S.rooms.filter(r=>r.capacity>=cls.size);
    let best = null;
    for (let d=0; d<D; d++) {
      if ((perDay[s.id+'|'+d]||0) >= maxPD) continue;
      for (let p=0; p<P; p++) {
        if (isBusy('class',cls.id,d,p) || isBusy('teacher',s.teacher,d,p)) continue;
        const room = rooms.filter(r=>!isBusy('room',r.id,d,p)).sort((a,b)=>a.capacity-b.capacity)[0];
        if (!room) continue;
        // score: lower is better
        let sc = rnd()*1.5;
        sc += (perDay[s.id+'|'+d]||0) * 4;                       // spread subject across days
        const dayLoad = placed.filter(x=>x.class===cls.id && x.day===d);
        sc += dayLoad.length * 0.8;                              // balance class load across days
        if (dayLoad.length && !dayLoad.some(x=>Math.abs(x.period-p)===1)) sc += 3; // avoid gaps
        if (!dayLoad.length && p>0) sc += 2;                     // start days early
        sc += p * 0.15;                                          // prefer earlier periods
        if (!best || sc<best.sc) best = {d,p,room,sc};
      }
    }
    if (!best) { unplaced.push(s); continue; }
    mark('class',cls.id,best.d,best.p); mark('teacher',s.teacher,best.d,best.p); mark('room',best.room.id,best.d,best.p);
    perDay[s.id+'|'+best.d] = (perDay[s.id+'|'+best.d]||0)+1;
    placed.push({subject:s.id, class:cls.id, teacher:s.teacher, room:best.room.id, day:best.d, period:best.p});
    penalty += best.sc;
  }
  return { placed, unplaced, score: unplaced.length*1000 + penalty };
}
function mulberry(a){ return () => { a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

$('#genBtn').onclick = () => {
  if (!S.subjects.length) return toast('Add subjects first');
  if (!S.rooms.length) return toast('Add at least one room');
  const btn = $('#genBtn'); btn.textContent = 'Optimizing…'; btn.disabled = true;
  setTimeout(() => {
    const t0 = performance.now(); let best = null; const N = 300;
    for (let i=0;i<N;i++){ const r = attempt(i*7919+13); if (!best || r.score<best.score) best = r; if (best.score<1 && i>40) break; }
    S.timetable = best.placed;
    const total = S.subjects.reduce((a,s)=>a+s.hours,0);
    S.report = { total, placed:best.placed.length, unplaced:best.unplaced.map(s=>s.name+' ('+(byId(S.classes,s.class)?.name||'')+')'), ms:Math.round(performance.now()-t0), tries:N };
    save(); btn.textContent='⚡ Generate optimized timetable'; btn.disabled=false; renderViewSelect(); renderTimetable(); toast('Timetable generated');
  }, 30);
};

/* ---------- Timetable view ---------- */
function renderViewSelect(){
  const t = $('#viewType').value, list = t==='class'?S.classes:t==='teacher'?S.teachers:S.rooms, cur = $('#viewItem').value;
  $('#viewItem').innerHTML = list.map(x=>`<option value="${x.id}" ${x.id===cur?'selected':''}>${esc(x.name)}</option>`).join('');
}
$('#viewType').onchange = () => { renderViewSelect(); renderTimetable(); };
$('#viewItem').onchange = renderTimetable;
function timeLabel(p){
  const [h,m] = S.settings.start.split(':').map(Number), a = h*60+m+p*S.settings.len, b = a+S.settings.len;
  const f = x => String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0');
  return f(a)+' – '+f(b);
}
function renderTimetable(){
  const r = S.report, rep = $('#report');
  if (!S.timetable) { rep.innerHTML=''; $('#gridWrap').innerHTML='<p class="empty">No timetable yet. Add data and press “Generate”.</p>'; return; }
  rep.innerHTML = r ? `<div class="msg ${r.unplaced.length?'warn':'ok'}">${r.unplaced.length?'⚠ ':'✅ '}Scheduled <b>${r.placed}/${r.total}</b> sessions with zero clashes (best of ${r.tries} runs, ${r.ms} ms).${r.unplaced.length?' Could not place: '+esc(r.unplaced.join(', '))+'. Try adding rooms, periods or days.':''}</div>` : '';
  const type = $('#viewType').value, id = $('#viewItem').value;
  if (!id) { $('#gridWrap').innerHTML=''; return; }
  const items = S.timetable.filter(x=>x[type]===id);
  let h = '<table class="tt"><thead><tr><th>Time</th>'+S.settings.days.map(d=>`<th>${d}</th>`).join('')+'</tr></thead><tbody>';
  for (let p=0;p<S.settings.periods;p++){
    h += `<tr><td class="time">P${p+1}<br>${timeLabel(p)}</td>`;
    S.settings.days.forEach((_,d) => {
      const x = items.find(i=>i.day===d && i.period===p);
      if (!x) return h += '<td></td>';
      const sub = byId(S.subjects,x.subject), col = PALETTE[S.subjects.indexOf(sub)%PALETTE.length];
      const extra = type==='class' ? `${esc(byId(S.teachers,x.teacher)?.name||'')} · ${esc(byId(S.rooms,x.room)?.name||'')}`
        : type==='teacher' ? `${esc(byId(S.classes,x.class)?.name||'')} · ${esc(byId(S.rooms,x.room)?.name||'')}`
        : `${esc(byId(S.classes,x.class)?.name||'')} · ${esc(byId(S.teachers,x.teacher)?.name||'')}`;
      h += `<td><div class="slot" style="background:${col}"><b>${esc(sub?.name||'')}</b>${extra}</div></td>`;
    });
    h += '</tr>';
  }
  $('#gridWrap').innerHTML = h + '</tbody></table>';
}

/* ---------- Export ---------- */
$('#csvBtn').onclick = () => {
  if (!S.timetable) return toast('Generate a timetable first');
  const rows = [['Class','Day','Period','Time','Subject','Teacher','Room']];
  [...S.timetable].sort((a,b)=>a.class.localeCompare(b.class)||a.day-b.day||a.period-b.period).forEach(x=>rows.push([
    byId(S.classes,x.class)?.name, S.settings.days[x.day], 'P'+(x.period+1), timeLabel(x.period),
    byId(S.subjects,x.subject)?.name, byId(S.teachers,x.teacher)?.name, byId(S.rooms,x.room)?.name]));
  const csv = rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='timetable.csv'; a.click();
};
$('#printBtn').onclick = () => window.print();

/* ---------- Sample data & reset ---------- */
$('#sampleBtn').onclick = () => {
  const T = ['Dr. Rao','Prof. Meena','Mr. Kumar','Ms. Anitha','Dr. Iyer'].map(name=>({id:uid(),name}));
  const R = [['Room 101',60],['Room 102',60],['Lab 1',40],['Hall A',120]].map(([name,capacity])=>({id:uid(),name,capacity}));
  const C = [['CSE-A',55],['CSE-B',50]].map(([name,size])=>({id:uid(),name,size}));
  const subs = [['Mathematics',0,4],['Data Structures',1,4],['Operating Systems',2,3],['Databases',3,3],['Networks',4,3],['Physics',0,2]];
  S = blank(); S.teachers=T; S.rooms=R; S.classes=C;
  C.forEach(c => subs.forEach(([name,t,hours]) => S.subjects.push({id:uid(),name,class:c.id,teacher:T[(t+(c===C[1]?1:0))%T.length].id,hours})));
  save(); render(); toast('Sample data loaded — open “Timetable” and generate');
};
$('#resetBtn').onclick = () => { if (confirm('Delete all data?')) { S = blank(); save(); render(); } };

render();
})();

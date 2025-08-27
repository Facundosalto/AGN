// Utils
const $$  = (s, el=document) => el.querySelector(s);
const $$$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const supabase = window.sb;
function fmt(d){ return new Date(d).toISOString().slice(0,10); }
function toast(el, msg, ok=true){ el.textContent = msg; el.className = ok? 'text-emerald-600': 'text-red-600'; }

let sessionUser = null; // { id, email }
let profile     = null; // { id, full_name, role }

// ---------------- AUTH & BOOT ----------------
(async function init(){
  // Buttons Auth
  $$('#signInBtn')?.addEventListener('click', (e)=>auth(e,false));
  $$('#signUpBtn')?.addEventListener('click', (e)=>auth(e,true));
  $$('#logoutBtn')?.addEventListener('click', logout);

  // Tabs
  $$$('.tab').forEach(btn => btn.addEventListener('click', ()=> openTab(btn.dataset.tab)));

  // Forms Worker/Admin
  $$('#availForm')?.addEventListener('submit', saveAvailability);
  $$('#btnLoadPool')?.addEventListener('click', loadAdminPool);
  $$('#btnShowRules')?.addEventListener('click', ()=> alert('Editá reglas y feriados en tablas: vacancy_rules / holidays (solo admin).'));
  $$('#btnPropose')?.addEventListener('click', proposeAuto);
  $$('#btnConfirmAll')?.addEventListener('click', confirmAll);
  $$('#btnExport')?.addEventListener('click', exportCSV);

  // Dashboard
  $$('#btnDashLoad')?.addEventListener('click', loadDashboard);
  $$('#calPrev')?.addEventListener('click', ()=> moveMonth(-1));
  $$('#calNext')?.addEventListener('click', ()=> moveMonth(1));

  // Session
  const { data: { session } } = await supabase.auth.getSession();
  if(session?.user){ await onLogin(session.user); } else { showAuth(true); }

  supabase.auth.onAuthStateChange(async (_event, s)=>{
    if(s?.user) await onLogin(s.user);
    else onLogout();
  });
})();

async function auth(e, signup=false){
  e.preventDefault();
  const email = $$('#email').value.trim();
  const password = $$('#password').value.trim();
  const msg = $$('#authMsg');
  if(!email || !password) return toast(msg,'Completá email y contraseña', false);
  try {
    let res;
    if(signup){
      res = await supabase.auth.signUp({ email, password, options:{ data: { full_name: email.split('@')[0] } } });
    } else {
      res = await supabase.auth.signInWithPassword({ email, password });
    }
    if(res.error) throw res.error;
    toast(msg, signup? 'Cuenta creada. Revisá tu email si pide verificación.' : 'Ingreso correcto.');
  } catch(err){ toast(msg, err.message, false); }
}

async function onLogin(user){
  sessionUser = user;
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  profile = data || null;

  $$('#userBox').classList.remove('hidden');
  $$('#userName').textContent = `${user.email} — rol: ${profile?.role || 'worker'}`;
  await bootApp();
}

function onLogout(){ sessionUser = null; profile = null; showAuth(true); }
async function logout(){ await supabase.auth.signOut(); }

function showAuth(show){
  $$('#auth').classList.toggle('hidden', !show);
  $$('#app').classList.toggle('hidden', show);
}

async function bootApp(){
  showAuth(false);

  // Llenar ubicaciones en selects
  const { data: locs } = await supabase.from('locations').select('*').order('id');
  for (const selId of ['location','admLocation','dashLocation']) {
    const sel = $$('#' + selId);
    if (!sel) continue;
    sel.innerHTML = (selId==='location' ? '<option value="">Ubicación…</option>' : '');
    (locs||[]).forEach(l=>{
      const o = document.createElement('option'); o.value = l.id; o.textContent = `${l.id} — ${l.name}`;
      sel.appendChild(o);
    });
  }

  // Defaults de fechas
  const today = new Date();
  $$('#from').valueAsDate   = today;
  $$('#to').valueAsDate     = today;
  $$('#admDay').valueAsDate = today;

  // Dashboard default rango (mes actual)
  const dFrom = new Date(today.getFullYear(), today.getMonth(), 1);
  const dTo   = new Date(today.getFullYear(), today.getMonth()+1, 0);
  $$('#dashFrom').valueAsDate = dFrom;
  $$('#dashTo').valueAsDate   = dTo;

  // Mostrar tab admin si corresponde
  const isAdmin = profile?.role === 'admin';
  $$('#tabAdmin').classList.toggle('hidden', !isAdmin);

  // Abrir dashboard por defecto
  openTab('dashboard');

  // Cargar datos iniciales
  await loadMyAvail();
  await loadMyAssign();
  await loadDashboard();
}

function openTab(name){
  ['dashboard','worker','admin','myassign'].forEach(n=>{
    $$('#tab-'+n)?.classList.toggle('hidden', n!==name);
  });
}

// --------------- WORKER: Disponibilidad ---------------
async function saveAvailability(e){
  e.preventDefault();
  const location_id = parseInt($$('#location').value);
  const shift_label = $$('#shift').value;
  const d1 = new Date($$('#from').value);
  const d2 = new Date($$('#to').value);
  if(!location_id || !shift_label || isNaN(+d1) || isNaN(+d2) || d1>d2) return alert('Completá correctamente');

  const batch = [];
  for(let d=new Date(d1); d<=d2; d.setDate(d.getDate()+1)){
    batch.push({ user_id: sessionUser.id, location_id, shift_label, day: fmt(d) });
  }
  for(const row of batch){
    await supabase.from('availabilities').insert(row).then(({error})=>{/* ignorar duplicados */});
  }
  await loadMyAvail();
  alert(`Guardadas ${batch.length} disponibilidades.`);
}

async function loadMyAvail(){
  const { data } = await supabase
    .from('availabilities')
    .select('id, day, shift_label, locations(id,name)')
    .eq('user_id', sessionUser.id)
    .order('day');
  const tbody = $$('#myAvail'); tbody.innerHTML = '';
  (data||[]).forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="py-2">${r.day}</td><td>${r.locations?.id} — ${r.locations?.name||''}</td><td>${r.shift_label}</td>
      <td><button class="text-red-600" data-del="${r.id}">Eliminar</button></td>`;
    tbody.appendChild(tr);
  });
  $$$('#myAvail [data-del]').forEach(btn=> btn.addEventListener('click', async ()=>{
    await supabase.from('availabilities').delete().eq('id', btn.dataset.del);
    await loadMyAvail();
  }));
}

// --------------- WORKER: Mis asignaciones ---------------
async function loadMyAssign(){
  const { data } = await supabase
    .from('assignments')
    .select('id, day, shift_label, status, locations(id,name)')
    .eq('user_id', sessionUser.id)
    .order('day');
  const tbody = $$('#myAssign'); tbody.innerHTML = '';
  (data||[]).forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="py-2">${r.day}</td><td>${r.locations?.id} — ${r.locations?.name||''}</td><td>${r.shift_label}</td><td><span class="chip">${r.status}</span></td>`;
    tbody.appendChild(tr);
  });
}

// --------------- ADMIN PANEL ---------------
async function loadAdminPool(){
  const day = $$('#admDay').value; const location_id = parseInt($$('#admLocation').value); const shift_label = $$('#admShift').value;
  if(!day||!location_id||!shift_label) return alert('Completá los filtros');

  // Capacidad (usa la función definer para ver ocupación real)
  const { data: capRows, error: capErr } = await supabase.rpc('vacancy_status_range', {
    start_d: day, end_d: day, loc: location_id, shift: shift_label
  });
  if (capErr) console.error(capErr);
  const cap = (capRows && capRows[0]) || null;
  $$('#capacityBox').innerHTML = cap
    ? `<div class="chip">Cupos: ${cap.cupos} — Ocupados: ${cap.ocupados} — Disponibles: ${cap.disponibles}</div>`
    : '<div class="chip">Sin regla cargada para este caso</div>';

  // Pool de solicitudes
  const { data: pool } = await supabase
    .from('availabilities')
    .select('id, user_id, day, profiles(full_name)')
    .eq('day', day).eq('location_id', location_id).eq('shift_label', shift_label)
    .order('created_at');
  const poolBody = $$('#pool'); poolBody.innerHTML = '';
  (pool||[]).forEach(r=>{
    const tr = document.createElement('tr');
    const name = r.profiles?.full_name || '(Sin nombre)';
    tr.innerHTML = `<td class="py-2">${name}</td><td><button class="btn" data-add="${r.user_id}">Asignar</button></td>`;
    poolBody.appendChild(tr);
  });

  // Asignados actuales
  const { data: assigned } = await supabase
    .from('assignments')
    .select('id, status, user_id, profiles(full_name)')
    .eq('day', day).eq('location_id', location_id).eq('shift_label', shift_label)
    .order('created_at');
  const asBody = $$('#assigned'); asBody.innerHTML = '';
  (assigned||[]).forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="py-2">${r.profiles?.full_name||'(Sin nombre)'}</td><td><span class="chip">${r.status}</span></td>
    <td class="space-x-2">
      <button class="text-emerald-700" data-confirm="${r.id}">Confirmar</button>
      <button class="text-amber-700" data-prop="${r.id}">Proponer</button>
      <button class="text-red-700" data-del="${r.id}">Quitar</button>
    </td>`;
    asBody.appendChild(tr);
  });

  // Listeners
  $$$('#pool [data-add]').forEach(btn=> btn.addEventListener('click', ()=> addAssignment(btn.dataset.add, day, location_id, shift_label)));
  $$$('#assigned [data-confirm]').forEach(btn=> btn.addEventListener('click', ()=> updateAssignmentStatus(parseInt(btn.dataset.confirm), 'confirmado')));
  $$$('#assigned [data-prop]').forEach(btn=> btn.addEventListener('click', ()=> updateAssignmentStatus(parseInt(btn.dataset.prop), 'propuesto')));
  $$$('#assigned [data-del]').forEach(btn=> btn.addEventListener('click', ()=> deleteAssignment(parseInt(btn.dataset.del))));
}

async function addAssignment(user_id, day, location_id, shift_label){
  // Verificar cupo disponible real
  const { data: capRows } = await supabase.rpc('vacancy_status_range', {
    start_d: day, end_d: day, loc: location_id, shift: shift_label
  });
  const cap = (capRows && capRows[0]) || null;
  if(cap && cap.disponibles<=0){ alert('No hay cupos disponibles.'); return; }
  const { error } = await supabase.from('assignments').insert({ user_id, day, location_id, shift_label, status:'propuesto', created_by: sessionUser.id });
  if(error) alert(error.message); else loadAdminPool();
}

async function updateAssignmentStatus(id, status){
  const { error } = await supabase.from('assignments').update({ status }).eq('id', id);
  if(error) alert(error.message); else loadAdminPool();
}

async function deleteAssignment(id){
  const { error } = await supabase.from('assignments').delete().eq('id', id);
  if(error) alert(error.message); else loadAdminPool();
}

async function proposeAuto(){
  const day = $$('#admDay').value; const location_id = parseInt($$('#admLocation').value); const shift_label = $$('#admShift').value;
  const { data: capRows } = await supabase.rpc('vacancy_status_range', { start_d: day, end_d: day, loc: location_id, shift: shift_label });
  const cap = (capRows && capRows[0]) || null;
  if(!cap){ alert('Sin regla de cupos.'); return; }

  const { data: assigned } = await supabase.from('assignments')
    .select('user_id').eq('day',day).eq('location_id',location_id).eq('shift_label',shift_label)
    .in('status',['propuesto','confirmado']);
  const usados = new Set((assigned||[]).map(r=>r.user_id));

  const { data: pool } = await supabase.from('availabilities')
    .select('user_id').eq('day',day).eq('location_id',location_id).eq('shift_label',shift_label);
  const candidatos = Array.from(new Set((pool||[]).map(r=>r.user_id))).filter(u=>!usados.has(u));

  // Libre = cupos - asignados actuales
  const libres = Math.max(0, cap.disponibles);
  for(let i=0;i<Math.min(libres, candidatos.length);i++){
    await supabase.from('assignments').insert({ user_id: candidatos[i], day, location_id, shift_label, status:'propuesto', created_by: sessionUser.id });
  }
  await loadAdminPool();
}

async function confirmAll(){
  const day = $$('#admDay').value; const location_id = parseInt($$('#admLocation').value); const shift_label = $$('#admShift').value;
  await supabase.from('assignments').update({ status:'confirmado' }).eq('day',day).eq('location_id',location_id).eq('shift_label',shift_label);
  await loadAdminPool();
}

async function exportCSV(){
  const day = $$('#admDay').value; const location_id = parseInt($$('#admLocation').value); const shift_label = $$('#admShift').value;
  const { data } = await supabase.from('assignments')
    .select('day, shift_label, status, profiles(full_name), locations(name)')
    .eq('day',day).eq('location_id',location_id).eq('shift_label',shift_label)
    .order('status');
  const rows = [['Fecha','Ubicación','Turno','Nombre','Estado']].concat((data||[]).map(r=>[
    r.day, r.locations?.name||'', r.shift_label, r.profiles?.full_name||'', r.status
  ]));
  const csv = rows.map(r=>r.map(x=>`"${String(x||'').replaceAll('"','""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `asignaciones_${day}_${location_id}_${shift_label}.csv`; a.click();
  URL.revokeObjectURL(url);
}

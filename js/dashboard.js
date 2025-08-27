// Dashboard (usa función RPC para leer disponibilidad real con seguridad definer)
const supabase = window.sb;

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0..11

function monthTitle(y,m){
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${months[m]} ${y}`;
}
function firstDayOfCalendar(y,m){
  const first = new Date(y,m,1);
  const dow = first.getDay(); // 0-dom .. 6-sab
  const diff = (dow + 6) % 7; // convertir a ISO (1-lun..7-dom) -> 0..6
  const start = new Date(first);
  start.setDate(first.getDate() - diff);
  return start;
}

async function loadDashboard(){
  const loc = parseInt($$('#dashLocation').value || '0') || null;
  const shift = $$('#dashShift').value || null;
  const from = $$('#dashFrom').value || fmt(new Date());
  const to   = $$('#dashTo').value   || fmt(new Date());

  // KPIs del rango
  const { data: rows, error } = await supabase.rpc('vacancy_status_range', {
    start_d: from, end_d: to, loc, shift
  });
  if(error){ console.error(error); }

  const cupos = (rows||[]).reduce((a,r)=>a + (r.cupos||0), 0);
  const ocup  = (rows||[]).reduce((a,r)=>a + (r.ocupados||0), 0);
  const disp  = (rows||[]).reduce((a,r)=>a + (r.disponibles||0), 0);

  $$('#dashKpis').innerHTML = `
    <div class="card p-4"><div class="mut">Cupos (rango)</div><div class="text-2xl font-bold">${cupos}</div></div>
    <div class="card p-4"><div class="mut">Ocupados</div><div class="text-2xl font-bold">${ocup}</div></div>
    <div class="card p-4"><div class="mut">Disponibles</div><div class="text-2xl font-bold">${disp}</div></div>
  `;

  // Calendario del mes actual usando loc & shift
  renderCalendar();
}

function moveMonth(delta){
  calMonth += delta;
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  renderCalendar();
}

async function renderCalendar(){
  const loc = parseInt($$('#dashLocation').value || '0') || null;
  const shift = $$('#dashShift').value || null;
  const y = calYear, m = calMonth;

  $$('#calTitle').textContent = monthTitle(y,m);

  // Cabecera
  const cal = $$('#calendar');
  cal.innerHTML = '';
  ['L','M','M','J','V','S','D'].forEach(h=>{
    const div = document.createElement('div');
    div.className = 'cal-head';
    div.textContent = h;
    cal.appendChild(div);
  });

  // Si no hay loc seleccionada, solo dibujar celdas vacías
  if (!loc || !shift) {
    const start = firstDayOfCalendar(y,m);
    for (let i=0;i<42;i++){
      const d = new Date(start); d.setDate(start.getDate()+i);
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      cell.innerHTML = `<div class="d">${d.getDate()}</div>`;
      cal.appendChild(cell);
    }
    return;
  }

  // Rango del mes
  const from = new Date(y, m, 1);
  const to   = new Date(y, m+1, 0);
  const { data: rows, error } = await supabase.rpc('vacancy_status_range', {
    start_d: fmt(from), end_d: fmt(to), loc, shift
  });
  if(error){ console.error(error); }

  // Índice por fecha
  const map = {};
  (rows||[]).forEach(r => map[r.day] = r);

  const start = firstDayOfCalendar(y,m);
  for (let i=0;i<42;i++){
    const d = new Date(start); d.setDate(start.getDate()+i);
    const key = fmt(d);
    const info = map[key];
    const inMonth = d.getMonth() === m;

    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (inMonth ? '' : ' disabled');

    const disponibles = info?.disponibles ?? null;
    const badge = (disponibles == null)
      ? ''
      : (disponibles > 0
        ? `<span class="badge badge-ok">${disponibles} disp.</span>`
        : `<span class="badge badge-zero">0 disp.</span>`);

    cell.innerHTML = `<div class="d">${d.getDate()}</div><div>${badge}</div>`;

    if (inMonth && disponibles > 0) {
      cell.classList.add('clickable');
      cell.addEventListener('click', ()=>{
        // Precargar formulario de disponibilidad con ese día/loc/turno
        $$('#from').value = key;
        $$('#to').value   = key;
        $$('#location').value = String(loc);
        $$('#shift').value    = String(shift);
        openTab('worker');
      });
    }

    cal.appendChild(cell);
  }
}

window.loadDashboard = loadDashboard;
window.moveMonth = moveMonth;

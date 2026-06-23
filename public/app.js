const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const today = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const state = { token: localStorage.getItem('token'), user: null, route: location.hash.replace('#', '') || '/dashboard', toast: '' };

const typeMap = { strength: '重训', cardio: '有氧', core: '核心', recovery: '恢复', rest: '休息' };
const genderMap = { male: '男', female: '女', other: '其他' };

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || '请求失败');
  return body.data;
}

function setRoute(route) {
  state.route = route;
  location.hash = route;
  render();
}

function toast(message) {
  state.toast = message;
  render();
  setTimeout(() => { state.toast = ''; render(); }, 1800);
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  for (const key of Object.keys(data)) if (data[key] === '') data[key] = null;
  return data;
}

function fieldsData(root) {
  const data = {};
  root.querySelectorAll('input[name], select[name], textarea[name]').forEach((field) => {
    data[field.name] = field.value === '' ? null : field.value;
  });
  return data;
}

function num(v) {
  if (v === null || v === undefined || v === '') return '';
  return Number(v);
}

function bmi(weight, height) {
  const h = Number(height) / 100;
  return h && weight ? Math.round((Number(weight) / h / h) * 10) / 10 : '';
}

function shell(content) {
  if (!state.token) return content;
  return `<div class="app">
    <header class="topbar"><div><div class="brand">健康训练</div><div class="tiny">${state.user?.username || ''}</div></div><button class="secondary" data-route="/profile">我的</button></header>
    ${content}
    <nav class="bottom-nav">
      ${nav('/dashboard','首页')}${nav('/health','记录')}${nav('/plan','计划')}${nav('/checkin','打卡')}${nav('/history','历史')}
    </nav>
    ${state.toast ? `<div class="toast">${state.toast}</div>` : ''}
  </div>`;
}

function nav(route, label) {
  return `<button class="nav-btn ${state.route === route ? 'active' : ''}" data-route="${route}">${label}</button>`;
}

function authView(mode = 'login') {
  const isRegister = mode === 'register';
  return `<main class="auth">
    <div><h1>${isRegister ? '创建账号' : '登录'}</h1><p class="muted">记录体重、围度、目标和每天训练完成情况。</p></div>
    <form class="card stack" id="authForm">
      ${isRegister ? '<label>用户名<input name="username" required minlength="2" placeholder="例如：小明"></label>' : ''}
      ${isRegister ? '<label>手机号<input name="phone" placeholder="手机号"></label><label>邮箱<input name="email" type="email" placeholder="邮箱，可二选一"></label>' : '<label>手机号或邮箱<input name="account" required placeholder="请输入账号"></label>'}
      <label>密码<input name="password" type="password" required minlength="6" placeholder="至少 6 位"></label>
      <button>${isRegister ? '注册并登录' : '登录'}</button>
      <button type="button" class="secondary" data-route="${isRegister ? '/login' : '/register'}">${isRegister ? '已有账号，去登录' : '没有账号，去注册'}</button>
    </form>
    ${state.toast ? `<div class="toast">${state.toast}</div>` : ''}
  </main>`;
}

async function renderDashboard() {
  const d = await api('/api/dashboard');
  const h = d.latest_health;
  const g = d.latest_goal;
  return shell(`<main class="page">
    <section class="card stack">
      <div class="row"><h2 class="title">今日 ${d.today}</h2><span class="pill">${d.today_plan ? typeMap[d.today_plan.type] : '未安排'}</span></div>
      <div><b>${d.today_plan?.title || '今天还没有训练计划'}</b><p class="muted">${d.today_plan?.note || '可以先创建今日计划，或把今天设为休息日。'}</p></div>
      <div class="progress"><div class="bar" style="width:${d.today_completion_rate}%"></div></div>
      <div class="row"><span class="muted">今日完成率</span><b>${d.today_completion_rate}%</b></div>
      <div class="actions"><button data-route="/plan">编辑今日训练</button><button class="secondary" data-route="/checkin">去打卡</button></div>
    </section>
    <section class="grid">
      <div class="card metric"><span class="muted">当前体重</span><b>${h?.weight_kg ?? '--'} kg</b></div>
      <div class="card metric"><span class="muted">BMI</span><b>${h?.bmi ?? '--'}</b><span class="tiny">${h?.bmi_category || ''}</span></div>
      <div class="card metric"><span class="muted">目标体重</span><b>${g?.target_weight_kg ?? '--'} kg</b></div>
      <div class="card metric"><span class="muted">还差</span><b>${g?.summary?.weight_gap_kg ?? '--'} kg</b></div>
    </section>
    <section class="card"><h2 class="title">最近围度</h2><p class="muted">腰 ${h?.waist_cm ?? '--'} cm，臀 ${h?.hip_cm ?? '--'} cm，胸 ${h?.chest_cm ?? '--'} cm</p></section>
    <section class="card"><h2 class="title">最近 7 天训练</h2>${chart(d.recent_training)}</section>
    <section class="card actions"><button data-route="/health">记录体重</button><button class="secondary" data-route="/goal">设置目标</button><button class="secondary" data-route="/history">查看历史</button></section>
  </main>`);
}

function chart(rows) {
  if (!rows?.length) return '<div class="empty">暂无打卡记录</div>';
  return `<div class="chart">${rows.map(r => `<div><span style="height:${Math.max(8, r.completion_rate * .7)}px"></span><em>${r.completion_rate}%</em><small>${r.log_date.slice(5)}</small></div>`).join('')}</div>`;
}

async function renderHealth(editId = null) {
  const records = await api('/api/health-records');
  const edit = records.find(r => String(r.id) === String(editId)) || {};
  return shell(`<main class="page">
    <form class="card stack" id="healthForm" data-id="${edit.id || ''}">
      <h2 class="title">${edit.id ? '编辑健康记录' : '新增健康记录'}</h2>
      <div class="grid">
        ${input('height_cm','身高 cm', edit.height_cm, 'number')}${input('weight_kg','体重 kg', edit.weight_kg, 'number')}
        ${input('age','年龄', edit.age, 'number')}<label>性别<select name="gender"><option value="">未选择</option>${opts(genderMap, edit.gender)}</select></label>
        ${input('waist_cm','腰围 cm', edit.waist_cm, 'number')}${input('hip_cm','臀围 cm', edit.hip_cm, 'number')}
        ${input('chest_cm','胸围 cm', edit.chest_cm, 'number')}${input('upper_arm_cm','大臂围 cm', edit.upper_arm_cm, 'number')}
        ${input('thigh_cm','大腿围 cm', edit.thigh_cm, 'number')}${input('calf_cm','小腿围 cm', edit.calf_cm, 'number')}
        ${input('body_fat_percent','体脂率 %', edit.body_fat_percent, 'number')}${input('record_date','记录日期', edit.record_date || today(), 'date')}
      </div>
      <div class="card" style="box-shadow:none"><span class="muted">实时 BMI </span><b id="bmiPreview">${edit.bmi || '--'}</b></div>
      <label>备注<textarea name="note">${edit.note || ''}</textarea></label>
      <button>保存健康记录</button>
    </form>
    <section class="card"><div class="row"><h2 class="title">历史记录</h2><button class="ghost" data-route="/health-history">趋势</button></div>${healthList(records)}</section>
  </main>`);
}

function input(name, label, value = '', type = 'text') {
  return `<label>${label}<input name="${name}" type="${type}" value="${value ?? ''}" ${['height_cm','weight_kg','record_date'].includes(name) ? 'required' : ''} step="0.1"></label>`;
}

function opts(map, selected) {
  return Object.entries(map).map(([k, v]) => `<option value="${k}" ${selected === k ? 'selected' : ''}>${v}</option>`).join('');
}

function healthList(records) {
  if (!records.length) return '<div class="empty">暂无健康记录</div>';
  return `<div class="list">${records.slice(0, 8).map(r => `<article class="item">
    <div class="row"><b>${r.record_date}</b><span class="pill">BMI ${r.bmi} ${r.bmi_category}</span></div>
    <p class="muted">体重 ${r.weight_kg} kg，腰 ${r.waist_cm ?? '--'} cm，臀 ${r.hip_cm ?? '--'} cm</p>
    <div class="actions"><button class="secondary" data-edit-health="${r.id}">编辑</button><button class="danger" data-del-health="${r.id}">删除</button></div>
  </article>`).join('')}</div>`;
}

async function renderGoal() {
  const goals = await api('/api/goals');
  const g = goals[0] || {};
  return shell(`<main class="page">
    <form class="card stack" id="goalForm" data-id="${g.id || ''}">
      <h2 class="title">目标设置</h2>
      <div class="grid">
        ${input('target_weight_kg','目标体重 kg', g.target_weight_kg, 'number')}${input('target_loss_kg','目标减重 kg', g.target_loss_kg, 'number')}
        ${input('target_waist_cm','目标腰围 cm', g.target_waist_cm, 'number')}${input('target_hip_cm','目标臀围 cm', g.target_hip_cm, 'number')}
        ${input('target_chest_cm','目标胸围 cm', g.target_chest_cm, 'number')}${input('target_upper_arm_cm','目标大臂围 cm', g.target_upper_arm_cm, 'number')}
        ${input('target_thigh_cm','目标大腿围 cm', g.target_thigh_cm, 'number')}${input('target_date','目标日期', g.target_date, 'date')}
      </div>
      <label>目标备注<textarea name="note">${g.note || ''}</textarea></label>
      <button>保存目标</button>
    </form>
    <section class="card stack"><h2 class="title">目标进度</h2>
      <div class="progress"><div class="bar" style="width:${g.summary?.progress_percent || 0}%"></div></div>
      <p class="muted">体重差距 ${g.summary?.weight_gap_kg ?? '--'} kg，腰围差距 ${g.summary?.waist_gap_cm ?? '--'} cm，进度 ${g.summary?.progress_percent ?? '--'}%，剩余 ${g.summary?.days_left ?? '--'} 天</p>
    </section>
  </main>`);
}

async function renderPlan() {
  const plan = await api(`/api/workout-plans/date/${today()}`);
  return shell(`<main class="page">
    <form class="card stack" id="planForm" data-id="${plan?.id || ''}">
      <h2 class="title">每日训练计划</h2>
      <div class="grid">${input('plan_date','日期', plan?.plan_date || today(), 'date')}${input('title','训练标题', plan?.title || '', 'text')}</div>
      <label>训练类型<select name="type">${opts(typeMap, plan?.type || 'strength')}</select></label>
      <label>备注<textarea name="note">${plan?.note || ''}</textarea></label>
      <h3 class="section-title">训练动作</h3>
      <div id="exerciseList" class="list">${(plan?.exercises?.length ? plan.exercises : [blankExercise()]).map(exerciseRow).join('')}</div>
      <button type="button" class="secondary" id="addExercise">添加动作</button>
      <button>保存为当天计划</button>
    </form>
  </main>`);
}

function blankExercise() { return { name: '', target_sets: 3, reps_per_set: 10, rest_seconds: 60, time_unit: 'seconds' }; }

function exerciseRow(e = {}) {
  return `<article class="item exercise">
    <div class="row"><b>动作</b><button type="button" class="danger removeExercise">删除</button></div>
    <div class="grid">
      ${input('name','动作名称', e.name, 'text')}${input('target_sets','目标组数', e.target_sets, 'number')}
      ${input('reps_per_set','每组次数', e.reps_per_set, 'number')}${input('target_weight','目标重量', e.target_weight, 'number')}
      ${input('time_value','每组时间', e.time_value, 'number')}<label>时间单位<select name="time_unit">${opts({ seconds:'秒', minutes:'分钟' }, e.time_unit || 'seconds')}</select></label>
      ${input('rest_seconds','休息秒数', e.rest_seconds, 'number')}${input('sort_order','排序', e.sort_order ?? 0, 'number')}
    </div>
    <label>动作备注<input name="note" value="${e.note || ''}"></label>
  </article>`;
}

async function renderCheckin() {
  const plan = await api(`/api/workout-plans/date/${today()}`);
  if (!plan) return shell(`<main class="page"><section class="card empty">今天还没有训练计划</section><button data-route="/plan">创建今日计划</button></main>`);
  const log = await api(`/api/workout-logs/date/${today()}`);
  return shell(`<main class="page">
    <form class="card stack" id="logForm" data-plan="${plan.id}">
      <div class="row"><h2 class="title">${plan.title}</h2><span class="pill">${typeMap[plan.type]}</span></div>
      <div class="progress"><div class="bar" id="logBar" style="width:${log?.completion_rate || 0}%"></div></div>
      <div class="row"><span class="muted">组数完成率</span><b id="logRate">${log?.completion_rate || 0}%</b></div>
      ${plan.exercises.map(e => setEditor(e, log?.sets || [])).join('')}
      <div class="grid">${input('rpe','RPE 1-10', log?.rpe, 'number')}${input('actual_duration_minutes','实际时长 分钟', log?.actual_duration_minutes, 'number')}</div>
      <label>训练备注<textarea name="note">${log?.note || ''}</textarea></label>
      <button>保存打卡</button>
    </form>
  </main>`);
}

function setEditor(exercise, saved) {
  const rows = [];
  for (let i = 1; i <= exercise.target_sets; i++) {
    const s = saved.find(x => x.exercise_id === exercise.id && x.set_number === i) || {};
    rows.push(`<div class="set-row" data-exercise="${exercise.id}" data-set="${i}">
      <input type="checkbox" name="completed" ${s.completed ? 'checked' : ''}>
      <input name="actual_reps" type="number" placeholder="实际次数" value="${s.actual_reps ?? exercise.reps_per_set ?? ''}">
      <input name="actual_weight" type="number" step="0.1" placeholder="实际重量" value="${s.actual_weight ?? exercise.target_weight ?? ''}">
    </div>`);
  }
  return `<article class="item"><b>${exercise.name}</b><p class="tiny">${exercise.target_sets} 组 × ${exercise.reps_per_set ?? '--'} 次，休息 ${exercise.rest_seconds ?? '--'} 秒</p>${rows.join('')}</article>`;
}

async function renderHistory() {
  const [health, workouts] = await Promise.all([api('/api/health-records'), api('/api/history/workouts')]);
  return shell(`<main class="page">
    <section class="card"><h2 class="title">健康历史趋势</h2>${healthList(health)}</section>
    <section class="card"><h2 class="title">训练历史</h2>${workoutHistory(workouts)}</section>
  </main>`);
}

function workoutHistory(rows) {
  if (!rows.length) return '<div class="empty">暂无训练历史</div>';
  return `<div class="list">${rows.map(r => `<article class="item"><div class="row"><b>${r.plan_date} ${r.title}</b><span class="pill">${typeMap[r.type]}</span></div><p class="muted">完成率 ${r.completion_rate ?? 0}% RPE ${r.rpe ?? '--'} 时长 ${r.actual_duration_minutes ?? '--'} 分钟</p></article>`).join('')}</div>`;
}

async function renderProfile() {
  return shell(`<main class="page"><section class="card stack"><h2 class="title">个人中心</h2><p class="muted">账号：${state.user?.phone || state.user?.email || state.user?.username}</p><button data-route="/goal">目标设置</button><button class="secondary" data-route="/health-history">健康历史</button><button class="danger" id="logout">退出登录</button></section></main>`);
}

async function render() {
  try {
    if (!state.token && !['/login','/register'].includes(state.route)) state.route = '/login';
    if (state.token && !state.user) state.user = (await api('/api/auth/me')).user;
    if (state.route === '/login') app.innerHTML = authView('login');
    else if (state.route === '/register') app.innerHTML = authView('register');
    else if (state.route === '/dashboard') app.innerHTML = await renderDashboard();
    else if (state.route === '/health' || state.route.startsWith('/health/edit/')) app.innerHTML = await renderHealth(state.route.split('/').pop());
    else if (state.route === '/health-history' || state.route === '/history') app.innerHTML = await renderHistory();
    else if (state.route === '/goal') app.innerHTML = await renderGoal();
    else if (state.route === '/plan') app.innerHTML = await renderPlan();
    else if (state.route === '/checkin') app.innerHTML = await renderCheckin();
    else if (state.route === '/profile') app.innerHTML = await renderProfile();
    else app.innerHTML = await renderDashboard();
  } catch (e) {
    if (String(e.message).includes('登录')) { localStorage.removeItem('token'); state.token = null; state.user = null; state.route = '/login'; app.innerHTML = authView('login'); }
    toast(e.message);
  }
}

document.addEventListener('click', async (e) => {
  const route = e.target.closest('[data-route]')?.dataset.route;
  if (route) return setRoute(route);
  if (e.target.id === 'logout') { localStorage.removeItem('token'); state.token = null; state.user = null; return setRoute('/login'); }
  if (e.target.id === 'addExercise') { $('#exerciseList').insertAdjacentHTML('beforeend', exerciseRow(blankExercise())); }
  if (e.target.classList.contains('removeExercise')) e.target.closest('.exercise').remove();
  const editHealth = e.target.closest('[data-edit-health]')?.dataset.editHealth;
  if (editHealth) setRoute(`/health/edit/${editHealth}`);
  const delHealth = e.target.closest('[data-del-health]')?.dataset.delHealth;
  if (delHealth && confirm('确定删除这条健康记录吗？')) { await api(`/api/health-records/${delHealth}`, { method: 'DELETE' }); toast('已删除'); render(); }
});

document.addEventListener('input', (e) => {
  if (e.target.closest('#healthForm')) {
    $('#bmiPreview').textContent = bmi($('[name=weight_kg]').value, $('[name=height_cm]').value) || '--';
  }
  if (e.target.closest('#logForm')) updateLogRate();
});

document.addEventListener('change', (e) => {
  if (e.target.closest('#logForm')) updateLogRate();
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    if (form.id === 'authForm') {
      const isRegister = state.route === '/register';
      const data = await api(`/api/auth/${isRegister ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(formData(form)) });
      state.token = data.token; state.user = data.user; localStorage.setItem('token', data.token); setRoute('/dashboard'); return;
    }
    if (form.id === 'healthForm') {
      const id = form.dataset.id; const method = id ? 'PUT' : 'POST'; const path = id ? `/api/health-records/${id}` : '/api/health-records';
      await api(path, { method, body: JSON.stringify(formData(form)) }); toast('健康记录已保存'); setRoute('/health'); return;
    }
    if (form.id === 'goalForm') {
      const id = form.dataset.id; const method = id ? 'PUT' : 'POST'; const path = id ? `/api/goals/${id}` : '/api/goals';
      await api(path, { method, body: JSON.stringify(formData(form)) }); toast('目标已保存'); render(); return;
    }
    if (form.id === 'planForm') {
      const base = {
        plan_date: form.querySelector('input[name=plan_date]').value,
        title: form.querySelector('input[name=title]').value,
        type: form.querySelector('select[name=type]').value,
        note: form.querySelector(':scope > label textarea[name=note]')?.value || null
      };
      const exercises = [...form.querySelectorAll('.exercise')].map((el, i) => ({ ...fieldsData(el), sort_order: i })).filter(x => x.name);
      const id = form.dataset.id; const method = id ? 'PUT' : 'POST'; const path = id ? `/api/workout-plans/${id}` : '/api/workout-plans';
      await api(path, { method, body: JSON.stringify({ ...base, exercises }) }); toast('训练计划已保存'); render(); return;
    }
    if (form.id === 'logForm') {
      const base = formData(form);
      const sets = [...form.querySelectorAll('.set-row')].map(row => ({
        exercise_id: row.dataset.exercise,
        set_number: row.dataset.set,
        completed: $('[name=completed]', row).checked,
        actual_reps: $('[name=actual_reps]', row).value || null,
        actual_weight: $('[name=actual_weight]', row).value || null
      }));
      await api('/api/workout-logs', { method: 'POST', body: JSON.stringify({ ...base, plan_id: form.dataset.plan, log_date: today(), sets }) });
      toast('训练打卡已保存'); render(); return;
    }
  } catch (err) {
    toast(err.message);
  }
});

function updateLogRate() {
  const rows = [...document.querySelectorAll('.set-row')];
  const done = rows.filter(r => $('[name=completed]', r).checked).length;
  const rate = rows.length ? Math.round((done / rows.length) * 1000) / 10 : 0;
  $('#logBar').style.width = `${rate}%`;
  $('#logRate').textContent = `${rate}%`;
}

window.addEventListener('hashchange', () => { state.route = location.hash.replace('#', '') || '/dashboard'; render(); });
render();

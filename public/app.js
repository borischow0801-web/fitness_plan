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
const activeTypes = ['strength', 'cardio', 'core'];
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
      <div class="row"><h2 class="title">今日 ${d.today}</h2><span class="pill">${d.today_plans?.length || 0} 个计划</span></div>
      <div>${todayPlanSummary(d.today_plans || [])}</div>
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

function todayPlanSummary(plans) {
  if (!plans.length) return '<b>今天还没有训练计划</b><p class="muted">可以添加中午有氧、晚上力量等多个计划。</p>';
  return `<div class="list">${plans.map(plan => `<article class="item compact"><div class="row"><b>${plan.title}</b><span class="pill">${typeMap[plan.type]}</span></div><p class="tiny">${plan.exercises?.length || 0} 个项目 ${plan.note || ''}</p></article>`).join('')}</div>`;
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

function dateTextInput(name, label, value = '') {
  return `<div class="date-field">
    <span>${label}</span>
    <input name="${name}" type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" maxlength="10" placeholder="YYYY-MM-DD" value="${value ?? ''}" readonly required data-open-date>
  </div>`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function selectOptions(start, end, selected) {
  const options = [];
  for (let value = start; value <= end; value++) {
    options.push(`<option value="${value}" ${Number(selected) === value ? 'selected' : ''}>${value}</option>`);
  }
  return options.join('');
}

function openDatePicker(target) {
  const input = target.closest('input[name=plan_date]');
  if (!input) return;
  const [yearText, monthText, dayText] = (input.value || today()).split('-');
  const year = Number(yearText) || new Date().getFullYear();
  const month = Number(monthText) || 1;
  const day = Number(dayText) || 1;
  const minYear = year - 3;
  const maxYear = year + 3;
  const dayMax = daysInMonth(year, month);
  const modal = document.createElement('div');
  modal.className = 'date-modal';
  modal.innerHTML = `<div class="date-modal-panel">
    <div class="row"><b>选择日期</b><button type="button" class="ghost" data-date-close>取消</button></div>
    <div class="date-select-grid">
      <label>年<select data-date-year>${selectOptions(minYear, maxYear, year)}</select></label>
      <label>月<select data-date-month>${selectOptions(1, 12, month)}</select></label>
      <label>日<select data-date-day>${selectOptions(1, dayMax, Math.min(day, dayMax))}</select></label>
    </div>
    <button type="button" data-date-confirm>确定</button>
  </div>`;
  modal._targetInput = input;
  document.body.appendChild(modal);
}

function closeDatePicker(modal) {
  modal?.remove();
}

function refreshDatePickerDays(modal) {
  const year = Number($('[data-date-year]', modal).value);
  const month = Number($('[data-date-month]', modal).value);
  const daySelect = $('[data-date-day]', modal);
  const selected = Math.min(Number(daySelect.value), daysInMonth(year, month));
  daySelect.innerHTML = selectOptions(1, daysInMonth(year, month), selected);
}

function confirmDatePicker(modal) {
  const year = $('[data-date-year]', modal).value;
  const month = String($('[data-date-month]', modal).value).padStart(2, '0');
  const day = String($('[data-date-day]', modal).value).padStart(2, '0');
  modal._targetInput.value = `${year}-${month}-${day}`;
  closeDatePicker(modal);
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
  const editId = state.route.startsWith('/plan/edit/') ? state.route.split('/').pop() : null;
  const plans = await api(`/api/workout-plans/date/${today()}`);
  const edit = editId ? await api(`/api/workout-plans/${editId}`) : null;
  const formType = edit?.type || 'strength';
  return shell(`<main class="page">
    <section class="card stack">
      <div class="row"><h2 class="title">今日训练计划</h2><button class="secondary" data-route="/plan">新增计划</button></div>
      ${planList(plans)}
    </section>
    <form class="card stack" id="planForm" data-id="${edit?.id || ''}">
      <h2 class="title">${edit ? '编辑计划' : '新增计划'}</h2>
      <div class="plan-head">${dateTextInput('plan_date','日期', edit?.plan_date || today())}${input('title','训练标题', edit?.title || '', 'text')}</div>
      <label>训练类型<select name="type" id="planType">${opts(typeMap, formType)}</select></label>
      <label>备注<textarea name="note">${edit?.note || ''}</textarea></label>
      <h3 class="section-title">训练项目</h3>
      <div id="exerciseList" class="list">${exerciseRowsForPlan(edit, formType)}</div>
      <button type="button" class="secondary" id="addExercise" style="display:${activeTypes.includes(formType) ? '' : 'none'}">添加项目</button>
      <button>${edit ? '保存修改' : '保存计划'}</button>
    </form>
  </main>`);
}

function planList(plans) {
  if (!plans.length) return '<div class="empty">今天还没有训练计划</div>';
  return `<div class="list">${plans.map(plan => `<article class="item compact">
    <div class="row"><b>${plan.title}</b><span class="pill">${typeMap[plan.type]}</span></div>
    <p class="tiny">${plan.plan_date} · ${plan.exercises?.length || 0} 个项目</p>
    <div class="actions"><button class="secondary" data-edit-plan="${plan.id}">编辑</button><button class="danger" data-del-plan="${plan.id}">删除</button></div>
  </article>`).join('')}</div>`;
}

function exerciseRowsForPlan(plan, type) {
  if (!activeTypes.includes(type)) return '<div class="empty">休息或恢复日无需添加动作，可在备注里记录安排。</div>';
  const exercises = plan?.exercises?.length ? plan.exercises : [blankExercise(type)];
  return exercises.map(e => exerciseRow(e, type)).join('');
}

function blankExercise(type = 'strength') {
  if (type === 'cardio') return { name: '椭圆机', target_sets: 1, time_value: 30, time_unit: 'minutes', target_distance_km: '', target_calories: '', target_intensity: '中等' };
  if (type === 'core') return { name: '', target_sets: 3, reps_per_set: '', time_value: 45, time_unit: 'seconds', rest_seconds: 45 };
  return { name: '', target_sets: 3, reps_per_set: 10, rest_seconds: 60, time_unit: 'seconds' };
}

function exerciseRow(e = {}, type = 'strength') {
  if (type === 'cardio') {
    return `<article class="item exercise" data-kind="cardio">
      <div class="row"><b>有氧项目</b><button type="button" class="danger removeExercise">删除</button></div>
      <input type="hidden" name="target_sets" value="1"><input type="hidden" name="time_unit" value="minutes">
      <div class="grid">
        ${input('name','项目名称', e.name, 'text')}${input('time_value','目标时长 分钟', e.time_value, 'number')}
        ${input('target_distance_km','目标距离 km', e.target_distance_km, 'number')}${input('target_calories','目标消耗 kcal', e.target_calories, 'number')}
        ${input('target_intensity','目标强度', e.target_intensity, 'text')}${input('sort_order','排序', e.sort_order ?? 0, 'number')}
      </div>
      <label>项目备注<input name="note" value="${e.note || ''}"></label>
    </article>`;
  }
  return `<article class="item exercise" data-kind="${type}">
    <div class="row"><b>${type === 'core' ? '核心项目' : '力量动作'}</b><button type="button" class="danger removeExercise">删除</button></div>
    <div class="grid">
      ${input('name','动作名称', e.name, 'text')}${input('target_sets','目标组数', e.target_sets, 'number')}
      ${input('reps_per_set','每组次数', e.reps_per_set, 'number')}${input('target_weight','目标重量', e.target_weight, 'text')}
      ${input('time_value','每组时间', e.time_value, 'number')}<label>时间单位<select name="time_unit">${opts({ seconds:'秒', minutes:'分钟' }, e.time_unit || 'seconds')}</select></label>
      ${input('rest_seconds','休息秒数', e.rest_seconds, 'number')}${input('sort_order','排序', e.sort_order ?? 0, 'number')}
    </div>
    <label>动作备注<input name="note" value="${e.note || ''}"></label>
  </article>`;
}

async function renderCheckin() {
  const plans = await api(`/api/workout-plans/date/${today()}`);
  if (!plans.length) return shell(`<main class="page"><section class="card empty">今天还没有训练计划</section><button data-route="/plan">创建今日计划</button></main>`);
  const logs = await Promise.all(plans.map(plan => api(`/api/workout-logs/date/${today()}?plan_id=${plan.id}`)));
  return shell(`<main class="page">
    <section class="card stack"><h2 class="title">今日打卡</h2><p class="muted">每个计划单独保存，适合中午有氧、晚上力量分开记录。</p></section>
    ${plans.map((plan, index) => checkinForm(plan, logs[index])).join('')}
  </main>`);
}

function checkinForm(plan, log) {
  return `<form class="card stack logForm" data-plan="${plan.id}" data-type="${plan.type}">
    <div class="row"><h2 class="title">${plan.title}</h2><span class="pill">${typeMap[plan.type]}</span></div>
    <div class="progress"><div class="bar logBar" style="width:${log?.completion_rate || 0}%"></div></div>
    <div class="row"><span class="muted">完成率</span><b class="logRate">${log?.completion_rate || 0}%</b></div>
    ${plan.exercises.map(e => setEditor(plan, e, log?.sets || [])).join('') || '<div class="empty">这个计划没有训练项目</div>'}
    <div class="grid">${input('rpe','RPE 1-10', log?.rpe, 'number')}${input('actual_duration_minutes','总时长 分钟', log?.actual_duration_minutes, 'number')}</div>
    <label>训练备注<textarea name="note">${log?.note || ''}</textarea></label>
    <button>保存「${plan.title}」打卡</button>
  </form>`;
}

function setEditor(plan, exercise, saved) {
  if (plan.type === 'cardio') {
    const s = saved.find(x => x.exercise_id === exercise.id && x.set_number === 1) || {};
    return `<article class="item"><b>${exercise.name}</b><p class="tiny">目标 ${exercise.time_value ?? '--'} 分钟，${exercise.target_distance_km ?? '--'} km，${exercise.target_calories ?? '--'} kcal，强度 ${exercise.target_intensity ?? '--'}</p>
      <div class="cardio-row set-row" data-exercise="${exercise.id}" data-set="1">
        <input type="checkbox" name="completed" ${s.completed ? 'checked' : ''}>
        <label class="mini-field">分钟<input name="actual_duration_minutes" type="number" placeholder="分钟" value="${s.actual_duration_seconds ? Math.round(s.actual_duration_seconds / 60) : exercise.time_value ?? ''}"></label>
        <label class="mini-field">距离 km<input name="actual_distance_km" type="number" step="0.1" placeholder="km" value="${s.actual_distance_km ?? ''}"></label>
        <label class="mini-field">热量 kcal<input name="actual_calories" type="number" placeholder="kcal" value="${s.actual_calories ?? ''}"></label>
      </div>
    </article>`;
  }
  const rows = [];
  for (let i = 1; i <= exercise.target_sets; i++) {
    const s = saved.find(x => x.exercise_id === exercise.id && x.set_number === i) || {};
    rows.push(`<div class="set-row" data-exercise="${exercise.id}" data-set="${i}">
      <input type="checkbox" name="completed" ${s.completed ? 'checked' : ''}>
      <label class="mini-field">次数<input name="actual_reps" type="number" placeholder="次数" value="${s.actual_reps ?? exercise.reps_per_set ?? ''}"></label>
      <label class="mini-field">重量<input name="actual_weight" type="text" placeholder="重量" value="${s.actual_weight ?? exercise.target_weight ?? ''}"></label>
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
    else if (state.route === '/plan' || state.route.startsWith('/plan/edit/')) app.innerHTML = await renderPlan();
    else if (state.route === '/checkin') app.innerHTML = await renderCheckin();
    else if (state.route === '/profile') app.innerHTML = await renderProfile();
    else app.innerHTML = await renderDashboard();
  } catch (e) {
    if (String(e.message).includes('登录')) { localStorage.removeItem('token'); state.token = null; state.user = null; state.route = '/login'; app.innerHTML = authView('login'); }
    toast(e.message);
  }
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-open-date]')) { openDatePicker(e.target); return; }
  if (e.target.closest('[data-date-close]')) { closeDatePicker(e.target.closest('.date-modal')); return; }
  if (e.target.closest('[data-date-confirm]')) { confirmDatePicker(e.target.closest('.date-modal')); return; }
  const route = e.target.closest('[data-route]')?.dataset.route;
  if (route) return setRoute(route);
  if (e.target.id === 'logout') { localStorage.removeItem('token'); state.token = null; state.user = null; return setRoute('/login'); }
  if (e.target.id === 'addExercise') { const type = $('#planType')?.value || 'strength'; $('#exerciseList').insertAdjacentHTML('beforeend', exerciseRow(blankExercise(type), type)); }
  if (e.target.classList.contains('removeExercise')) e.target.closest('.exercise').remove();
  const editPlan = e.target.closest('[data-edit-plan]')?.dataset.editPlan;
  if (editPlan) return setRoute(`/plan/edit/${editPlan}`);
  const delPlan = e.target.closest('[data-del-plan]')?.dataset.delPlan;
  if (delPlan && confirm('确定删除这个训练计划吗？')) { await api(`/api/workout-plans/${delPlan}`, { method: 'DELETE' }); toast('已删除'); render(); return; }
  const editHealth = e.target.closest('[data-edit-health]')?.dataset.editHealth;
  if (editHealth) setRoute(`/health/edit/${editHealth}`);
  const delHealth = e.target.closest('[data-del-health]')?.dataset.delHealth;
  if (delHealth && confirm('确定删除这条健康记录吗？')) { await api(`/api/health-records/${delHealth}`, { method: 'DELETE' }); toast('已删除'); render(); }
});

document.addEventListener('input', (e) => {
  if (e.target.closest('#healthForm')) {
    $('#bmiPreview').textContent = bmi($('[name=weight_kg]').value, $('[name=height_cm]').value) || '--';
  }
  if (e.target.closest('.logForm')) updateLogRate(e.target.closest('.logForm'));
});

document.addEventListener('change', (e) => {
  if (e.target.closest('.date-modal') && (e.target.matches('[data-date-year]') || e.target.matches('[data-date-month]'))) {
    refreshDatePickerDays(e.target.closest('.date-modal'));
    return;
  }
  if (e.target.id === 'planType') {
    const list = $('#exerciseList');
    list.innerHTML = exerciseRowsForPlan(null, e.target.value);
    const addButton = $('#addExercise');
    if (addButton) addButton.style.display = activeTypes.includes(e.target.value) ? '' : 'none';
    return;
  }
  if (e.target.closest('.logForm')) updateLogRate(e.target.closest('.logForm'));
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
    if (form.classList.contains('logForm')) {
      const base = formData(form);
      const sets = [...form.querySelectorAll('.set-row')].map(row => {
        const actualMinutes = $('[name=actual_duration_minutes]', row)?.value;
        return {
          exercise_id: row.dataset.exercise,
          set_number: row.dataset.set,
          completed: $('[name=completed]', row).checked,
          actual_reps: $('[name=actual_reps]', row)?.value || null,
          actual_weight: $('[name=actual_weight]', row)?.value || null,
          actual_duration_seconds: actualMinutes ? Math.round(Number(actualMinutes) * 60) : null,
          actual_distance_km: $('[name=actual_distance_km]', row)?.value || null,
          actual_calories: $('[name=actual_calories]', row)?.value || null
        };
      });
      await api('/api/workout-logs', { method: 'POST', body: JSON.stringify({ ...base, plan_id: form.dataset.plan, log_date: today(), sets }) });
      toast('训练打卡已保存'); render(); return;
    }
  } catch (err) {
    toast(err.message);
  }
});

function updateLogRate(form = document) {
  const rows = [...form.querySelectorAll('.set-row')];
  const done = rows.filter(r => $('[name=completed]', r).checked).length;
  const rate = rows.length ? Math.round((done / rows.length) * 1000) / 10 : 0;
  const bar = $('.logBar', form);
  const label = $('.logRate', form);
  if (bar) bar.style.width = `${rate}%`;
  if (label) label.textContent = `${rate}%`;
}

window.addEventListener('hashchange', () => { state.route = location.hash.replace('#', '') || '/dashboard'; render(); });
render();

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const BOOTSTRAP_ADMIN_UID = 'gABqRTDUcDRd4VH0lxswMIJw7B83';

const ruDays = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const ruMonths = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const shows = [
  { name: 'Чайка', dateOffset: 2, time: '19:00', place: 'Большая сцена', cast: ['АС', 'МВ', 'ИК', 'ОЛ', '+4'], conflict: 1 },
  { name: 'Гроза', dateOffset: 6, time: '18:30', place: 'Камерная сцена', cast: ['ДП', 'АС', 'ЕН', '+3'], conflict: 0 },
  { name: 'Три сестры', dateOffset: 10, time: '19:00', place: 'Большая сцена', cast: ['КС', 'МВ', 'ОЛ', '+6'], conflict: 2 }
];

function fallbackProfiles(user) {
  return [
    { id: user.uid, name: user.displayName || user.email.split('@')[0], email: user.email, role: user.uid === BOOTSTRAP_ADMIN_UID ? 'admin' : 'member', shows: ['Чайка', 'Гроза'] },
    { id: 'demo-mikhail', name: 'Михаил Волков', role: 'member', shows: ['Чайка', 'Три сестры'] },
    { id: 'demo-irina', name: 'Ирина Крылова', role: 'member', shows: ['Чайка'] },
    { id: 'demo-denis', name: 'Денис Петров', role: 'member', shows: ['Гроза'] },
    { id: 'demo-olga', name: 'Ольга Левина', role: 'member', shows: ['Чайка', 'Три сестры'] }
  ];
}

function fallbackSlots() {
  return [
    { id: 's1', title: 'Сценическая репетиция', production: 'Чайка', date: iso(dateAt(1)), from: '18:00', to: '21:00', place: 'Большая сцена' },
    { id: 's2', title: 'Прогон первого акта', production: 'Гроза', date: iso(dateAt(3)), from: '12:00', to: '15:00', place: 'Зал №2' },
    { id: 's3', title: 'Общий прогон', production: 'Три сестры', date: iso(dateAt(5)), from: '18:30', to: '22:00', place: 'Большая сцена' },
    { id: 's4', title: 'Читка и разбор', production: 'Общее', date: iso(dateAt(8)), from: '11:00', to: '13:00', place: 'Фойе' }
  ];
}

const state = {
  firebaseUser: null,
  profile: null,
  profiles: [],
  availability: {},
  slots: [],
  responses: [],
  adminView: false,
  selectedDate: null,
  selectedStatus: null,
  filter: 'Все',
  slotFilter: 'Все',
  localMode: false,
  unsubscribers: []
};

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const fmt = date => `${date.getDate()} ${ruMonths[date.getMonth()]}`;

function dateAt(offset) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function niceDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return `${date.getDate()} ${ruMonths[date.getMonth()]}, ${ruDays[date.getDay()]}`;
}

function toast(message = 'Сохранено') {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2200);
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.dataset.originalText ||= button.textContent;
  button.textContent = busy ? 'Подождите…' : button.dataset.originalText;
}

function readableError(error) {
  const messages = {
    'auth/email-already-in-use': 'Эта почта уже зарегистрирована',
    'auth/invalid-credential': 'Неверная почта или пароль',
    'auth/invalid-email': 'Проверьте адрес почты',
    'auth/weak-password': 'Пароль должен содержать минимум 6 символов',
    'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже',
    'auth/operation-not-allowed': 'В Firebase ещё не включён вход по почте',
    'permission-denied': 'Firestore отклонил запрос. Проверьте правила доступа'
  };
  return messages[error?.code] || error?.message || 'Не удалось выполнить действие';
}

function currentName() {
  return state.profile?.name || state.firebaseUser?.displayName || state.firebaseUser?.email || 'Участник';
}

function isAdmin() {
  return state.profile?.role === 'admin';
}

function clearSubscriptions() {
  state.unsubscribers.forEach(unsubscribe => unsubscribe());
  state.unsubscribers = [];
}

function loadLocalFallback(user) {
  state.localMode = true;
  state.profiles = fallbackProfiles(user);
  state.profile = state.profiles[0];
  state.availability = JSON.parse(localStorage.getItem('sbor-availability') || '{}');
  state.slots = JSON.parse(localStorage.getItem('sbor-slots-v2') || 'null') || fallbackSlots();
  state.responses = JSON.parse(localStorage.getItem('sbor-responses-v3') || 'null') || [
    { id: 's1_self', slotId: 's1', userId: user.uid, name: state.profile.name, status: 'free' },
    { id: 's1_mikhail', slotId: 's1', userId: 'demo-mikhail', name: 'Михаил Волков', status: 'free' },
    { id: 's1_irina', slotId: 's1', userId: 'demo-irina', name: 'Ирина Крылова', status: 'free' },
    { id: 's1_olga', slotId: 's1', userId: 'demo-olga', name: 'Ольга Левина', status: 'limited' },
    { id: 's4_self', slotId: 's4', userId: user.uid, name: state.profile.name, status: 'free' },
    { id: 's4_mikhail', slotId: 's4', userId: 'demo-mikhail', name: 'Михаил Волков', status: 'limited' },
    { id: 's4_irina', slotId: 's4', userId: 'demo-irina', name: 'Ирина Крылова', status: 'free' },
    { id: 's4_denis', slotId: 's4', userId: 'demo-denis', name: 'Денис Петров', status: 'free' },
    { id: 's4_olga', slotId: 's4', userId: 'demo-olga', name: 'Ольга Левина', status: 'free' }
  ];
}

function persistLocalFallback() {
  localStorage.setItem('sbor-availability', JSON.stringify(state.availability));
  localStorage.setItem('sbor-slots-v2', JSON.stringify(state.slots));
  localStorage.setItem('sbor-responses-v3', JSON.stringify(state.responses));
}

async function ensureProfile(user) {
  const profileRef = doc(db, 'profiles', user.uid);
  const profileSnapshot = await getDoc(profileRef);
  if (!profileSnapshot.exists()) {
    const profile = {
      name: user.displayName || user.email.split('@')[0],
      email: user.email,
      role: 'member',
      shows: [],
      createdAt: serverTimestamp()
    };
    await setDoc(profileRef, profile);
    return { id: user.uid, ...profile, createdAt: null };
  }
  return { id: profileSnapshot.id, ...profileSnapshot.data() };
}

function subscribeToData() {
  clearSubscriptions();
  const uid = state.firebaseUser.uid;

  state.unsubscribers.push(onSnapshot(collection(db, 'profiles'), snapshot => {
    state.profiles = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const ownProfile = state.profiles.find(profile => profile.id === uid);
    if (ownProfile) state.profile = ownProfile;
    applyUser();
    renderTeam();
    renderMatches();
  }, error => toast(readableError(error))));

  state.unsubscribers.push(onSnapshot(
    query(collection(db, 'availability'), where('userId', '==', uid)),
    snapshot => {
      state.availability = Object.fromEntries(snapshot.docs.map(item => [item.data().date, { id: item.id, ...item.data() }]));
      renderCalendar();
    },
    error => toast(readableError(error))
  ));

  state.unsubscribers.push(onSnapshot(collection(db, 'slots'), snapshot => {
    state.slots = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderCalendar();
    renderSlots();
    renderMatches();
  }, error => toast(readableError(error))));

  state.unsubscribers.push(onSnapshot(collection(db, 'responses'), snapshot => {
    state.responses = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderSlots();
    renderMatches();
  }, error => toast(readableError(error))));
}

function showApp() {
  $('#authScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  applyUser();
  renderAll();
}

function showAuth() {
  $('#app').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
}

function applyUser() {
  if (!state.profile && !state.firebaseUser) return;
  const name = currentName();
  $('#profileName').textContent = name;
  $('#profileRole').textContent = isAdmin() ? 'Администратор' : 'Участник';
  $('#avatar').textContent = name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
  $('#adminToggle').classList.toggle('hidden', !isAdmin());
  if (!isAdmin()) {
    state.adminView = false;
    $('#app').classList.remove('admin-mode');
  }
}

async function saveAvailability(date, value) {
  if (state.localMode) {
    if (value) state.availability[date] = value;
    else delete state.availability[date];
    persistLocalFallback();
    return;
  }
  const ref = doc(db, 'availability', `${state.firebaseUser.uid}_${date}`);
  if (!value) {
    await deleteDoc(ref);
    return;
  }
  await setDoc(ref, {
    userId: state.firebaseUser.uid,
    date,
    status: value.status,
    from: value.from || null,
    to: value.to || null,
    updatedAt: serverTimestamp()
  });
}

async function cycleDay(date) {
  const order = [null, 'free', 'limited', 'busy'];
  const current = state.availability[date]?.status || null;
  const next = order[(order.indexOf(current) + 1) % order.length];
  const previous = state.availability[date];
  if (!next) delete state.availability[date];
  else state.availability[date] = { status: next, ...(next === 'limited' ? { from: '18:00', to: '22:00' } : {}) };
  renderCalendar();
  try {
    await saveAvailability(date, state.availability[date] || null);
  } catch (error) {
    if (previous) state.availability[date] = previous;
    else delete state.availability[date];
    renderCalendar();
    toast(readableError(error));
  }
}

function renderCalendar() {
  const calendar = $('#calendar');
  if (!calendar) return;
  const labels = { free: 'Свободен', limited: 'Ограничения', busy: 'Не могу' };
  calendar.innerHTML = '';
  for (let index = 0; index < 14; index += 1) {
    const date = dateAt(index);
    const key = iso(date);
    const availability = state.availability[key];
    const daySlots = state.slots.filter(slot => slot.date === key);
    const element = document.createElement('article');
    element.className = `day ${index === 0 ? 'today' : ''}`;
    element.dataset.date = key;
    element.dataset.status = availability?.status || 'none';
    const status = availability
      ? `<div class="status-pill status-${availability.status}">${labels[availability.status]}${availability.from ? `<small>${availability.from}–${availability.to}</small>` : ''}</div>`
      : '<div class="status-pill status-none">+ отметить</div>';
    element.innerHTML = `<div class="day-head"><span class="weekday">${ruDays[date.getDay()]}</span><span class="date-num">${date.getDate()}</span></div><button class="day-edit" aria-label="Точно настроить ${fmt(date)}" title="Точное редактирование">✎</button>${daySlots.length ? `<span class="slot-count">◴ ${daySlots.length} ${daySlots.length === 1 ? 'слот' : 'слота'}</span>` : ''}${status}`;
    element.onclick = event => {
      if (!event.target.closest('.day-edit')) cycleDay(key);
    };
    element.querySelector('.day-edit').onclick = () => openDay(key);
    calendar.appendChild(element);
  }
}

function openDay(date) {
  state.selectedDate = date;
  const availability = state.availability[date];
  state.selectedStatus = availability?.status || null;
  $('#modalDate').textContent = niceDate(date);
  $$('[data-status]').forEach(button => button.classList.toggle('selected', button.dataset.status === state.selectedStatus));
  $('#timeFields').classList.toggle('hidden', state.selectedStatus !== 'limited');
  if (availability?.from) {
    $('#timeFrom').value = availability.from;
    $('#timeTo').value = availability.to;
  }
  $('#dayModal').classList.remove('hidden');
}

function responseFor(slotId, userId) {
  return state.responses.find(response => response.slotId === slotId && response.userId === userId);
}

async function setSlotResponse(slotId, status) {
  const id = `${slotId}_${state.firebaseUser.uid}`;
  if (state.localMode) {
    state.responses = state.responses.filter(response => response.id !== id);
    state.responses.push({ id, slotId, userId: state.firebaseUser.uid, name: currentName(), status });
    persistLocalFallback();
    renderSlots();
    renderMatches();
    toast('Ответ сохранён на этом устройстве');
    return;
  }
  try {
    await setDoc(doc(db, 'responses', id), {
      slotId,
      userId: state.firebaseUser.uid,
      name: currentName(),
      status,
      updatedAt: serverTimestamp()
    });
    toast('Ответ сохранён');
  } catch (error) {
    toast(readableError(error));
  }
}

function renderSlotFilters() {
  const values = ['Все', ...new Set(state.slots.map(slot => slot.production))];
  $('#slotFilters').innerHTML = values.map(value => `<button class="filter ${state.slotFilter === value ? 'active' : ''}" data-slot-filter="${value}">${value}</button>`).join('');
  $$('[data-slot-filter]').forEach(button => {
    button.onclick = () => {
      state.slotFilter = button.dataset.slotFilter;
      renderSlots();
    };
  });
}

function renderSlots() {
  if (!$('#slotList')) return;
  renderSlotFilters();
  const slots = state.slots
    .filter(slot => state.slotFilter === 'Все' || slot.production === state.slotFilter)
    .sort((left, right) => `${left.date}${left.from}`.localeCompare(`${right.date}${right.from}`));
  $('#slotBadge').textContent = state.slots.length;
  $('#slotList').innerHTML = slots.length ? slots.map(slot => {
    const responses = state.responses.filter(response => response.slotId === slot.id);
    const ownAnswer = responseFor(slot.id, state.firebaseUser?.uid)?.status || 'none';
    const free = responses.filter(response => response.status === 'free').length;
    const possible = responses.filter(response => response.status === 'limited').length;
    const action = state.adminView
      ? `<div class="slot-admin-summary"><strong>${free + possible}/${state.profiles.length}</strong><span>${free} могут · ${possible} возможно</span><button class="small-action" data-delete-slot="${slot.id}">Удалить</button></div>`
      : `<div class="slot-actions"><div class="response-buttons"><button data-slot="${slot.id}" data-response="free" class="${ownAnswer === 'free' ? 'chosen' : ''}" title="Могу">✓</button><button data-slot="${slot.id}" data-response="limited" class="${ownAnswer === 'limited' ? 'chosen' : ''}" title="Возможно">~</button><button data-slot="${slot.id}" data-response="busy" class="${ownAnswer === 'busy' ? 'chosen' : ''}" title="Не могу">×</button></div><div class="response-legend">могу · возможно · не могу</div></div>`;
    return `<article class="slot-card"><div class="slot-when"><strong>${slot.from}</strong><span>${niceDate(slot.date)}<br>до ${slot.to}</span></div><div class="slot-info"><h3>${slot.title}</h3><p>${slot.place}</p><span class="slot-production">${slot.production}</span></div>${action}</article>`;
  }).join('') : '<div class="empty-state">Слотов пока нет. Администратор может создать первый.</div>';

  $$('[data-slot][data-response]').forEach(button => {
    button.onclick = () => setSlotResponse(button.dataset.slot, button.dataset.response);
  });
  $$('[data-delete-slot]').forEach(button => {
    button.onclick = async () => {
      try {
        if (state.localMode) {
          state.slots = state.slots.filter(slot => slot.id !== button.dataset.deleteSlot);
          state.responses = state.responses.filter(response => response.slotId !== button.dataset.deleteSlot);
          persistLocalFallback();
          renderAll();
        } else {
          await deleteDoc(doc(db, 'slots', button.dataset.deleteSlot));
        }
        toast('Слот удалён');
      } catch (error) {
        toast(readableError(error));
      }
    };
  });
}

function renderMatches() {
  if (!$('#matchList')) return;
  const participantCount = state.profiles.length;
  const ranked = state.slots.map(slot => {
    const responses = state.responses.filter(response => response.slotId === slot.id);
    return {
      slot,
      responses,
      free: responses.filter(response => response.status === 'free').length,
      limited: responses.filter(response => response.status === 'limited').length,
      busy: responses.filter(response => response.status === 'busy').length
    };
  }).sort((left, right) => (right.free + right.limited * 0.5) - (left.free + left.limited * 0.5));
  const best = ranked[0];
  const full = ranked.filter(item => item.busy === 0 && item.responses.length === participantCount && participantCount > 0).length;
  const answerCount = ranked.reduce((sum, item) => sum + item.responses.length, 0);
  const total = Math.max(1, ranked.length * participantCount);
  $('#matchSummary').innerHTML = `<div class="summary-card"><strong>${best ? best.free + best.limited : 0}/${participantCount}</strong><span>лучшее пересечение</span></div><div class="summary-card"><strong>${full}</strong><span>слотов без отказов</span></div><div class="summary-card"><strong>${Math.round(answerCount / total * 100)}%</strong><span>ответов собрано</span></div>`;
  $('#matchList').innerHTML = ranked.length ? ranked.map(({ slot, responses, free, limited }) => `<article class="match-card"><div class="match-head"><div><h3>${slot.title}</h3><p>${niceDate(slot.date)} · ${slot.from}–${slot.to} · ${slot.production}</p></div><div class="match-score"><strong>${free + limited}/${participantCount}</strong><span>доступны</span></div></div><div class="member-responses">${state.profiles.map(profile => {
    const status = responses.find(response => response.userId === profile.id)?.status || 'none';
    const word = { free: 'может', limited: 'возможно', busy: 'не может', none: 'нет ответа' }[status];
    return `<div class="member-chip ${status}">${profile.name.split(' ')[0]} · ${word}</div>`;
  }).join('')}</div></article>`).join('') : '<div class="empty-state">Пересечения появятся после создания слотов.</div>';
}

function renderEvents() {
  $('#eventList').innerHTML = shows.map(show => {
    const date = dateAt(show.dateOffset);
    return `<article class="event-card"><div class="event-date">${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}</div><div class="event-main"><strong>${show.name}</strong><span>${show.time} · ${show.place}</span></div><div class="event-meta">${show.conflict ? `<span class="warning">${show.conflict} ${show.conflict === 1 ? 'участник не может' : 'участника не могут'}</span>` : 'Весь состав свободен'}</div></article>`;
  }).join('');
}

function renderShows() {
  $('#showGrid').innerHTML = shows.map((show, index) => `<article class="show-card"><span class="show-card-number">0${index + 1} / ${fmt(dateAt(show.dateOffset))}</span><h3>${show.name}</h3><p>${show.time} · ${show.place}</p><div class="cast-avatars">${show.cast.map(person => `<span>${person}</span>`).join('')}</div><div class="show-status"><span>Состав: ${show.cast.length + 3} человек</span><span class="${show.conflict ? 'warning' : ''}">${show.conflict ? `${show.conflict} не могут` : 'Все свободны'}</span></div></article>`).join('');
}

function renderTeam() {
  if (!$('#teamTable')) return;
  const filters = ['Все', ...shows.map(show => show.name)];
  $('#filters').innerHTML = filters.map(name => `<button class="filter ${state.filter === name ? 'active' : ''}" data-filter="${name}">${name}</button>`).join('');
  $$('[data-filter]').forEach(button => {
    button.onclick = () => {
      state.filter = button.dataset.filter;
      renderTeam();
    };
  });
  const profiles = state.profiles.filter(profile => state.filter === 'Все' || (profile.shows || []).includes(state.filter));
  $('#teamTable').innerHTML = profiles.map(profile => {
    const initials = profile.name.split(' ').map(part => part[0]).slice(0, 2).join('');
    return `<tr><td><div class="person"><span class="mini-avatar">${initials}</span><span><strong>${profile.name}</strong><br><small>${profile.role === 'admin' ? 'Администратор' : 'Участник'}</small></span></div></td><td>${(profile.shows || []).join(', ') || 'Пока не назначен'}</td><td><span class="gray">Данные доступны администратору</span></td><td class="admin-only"><button class="small-action">Изменить состав</button></td></tr>`;
  }).join('');
}

function renderAll() {
  renderCalendar();
  renderSlots();
  renderMatches();
  renderEvents();
  renderShows();
  renderTeam();
  const now = new Date();
  $('#todayLabel').textContent = `${ruDays[now.getDay()]}, ${fmt(now)}`;
}

$$('.auth-tab').forEach(button => {
  button.onclick = () => {
    $$('.auth-tab').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    $('#loginForm').classList.toggle('hidden', button.dataset.authTab !== 'login');
    $('#registerForm').classList.toggle('hidden', button.dataset.authTab !== 'register');
  };
});

$('#loginButton').onclick = async () => {
  const button = $('#loginButton');
  setBusy(button, true);
  try {
    await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
  } catch (error) {
    toast(readableError(error));
  } finally {
    setBusy(button, false);
  }
};

$('#registerButton').onclick = async () => {
  const name = $('#registerName').value.trim();
  const email = $('#registerEmail').value.trim();
  const password = $('#registerPassword').value;
  if (!name || !email.includes('@') || password.length < 6) {
    toast('Заполните имя, почту и пароль от 6 символов');
    return;
  }
  const button = $('#registerButton');
  setBusy(button, true);
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    try {
      await setDoc(doc(db, 'profiles', credential.user.uid), {
        name,
        email,
        role: 'member',
        shows: [],
        createdAt: serverTimestamp()
      });
    } catch (firestoreError) {
      // Authentication already succeeded. Closed Firestore rules are handled
      // by the automatic local fallback in onAuthStateChanged.
    }
  } catch (error) {
    toast(readableError(error));
  } finally {
    setBusy(button, false);
  }
};

$('#logoutButton').onclick = async () => {
  await signOut(auth);
};

$$('.nav-link').forEach(button => {
  button.onclick = () => {
    $$('.nav-link').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    $$('.page').forEach(page => page.classList.remove('active'));
    $(`#${button.dataset.page}Page`).classList.add('active');
    $('#pageTitle').textContent = { schedule: 'Доступность', slots: 'Слоты', matches: 'Пересечения', shows: 'Спектакли', team: 'Участники' }[button.dataset.page];
    $('.sidebar').classList.remove('open');
  };
});

$$('[data-go]').forEach(button => {
  button.onclick = () => document.querySelector(`[data-page="${button.dataset.go}"]`).click();
});

$('#mobileMenu').onclick = () => $('.sidebar').classList.toggle('open');

$('#adminToggle').onclick = () => {
  if (!isAdmin()) return;
  state.adminView = !state.adminView;
  $('#app').classList.toggle('admin-mode', state.adminView);
  $('#adminToggle span:last-child').innerHTML = `<small>Режим</small>${state.adminView ? 'Администратор' : 'Участник'}`;
  renderSlots();
  toast(state.adminView ? 'Режим администратора' : 'Режим участника');
};

$$('[data-status]').forEach(button => {
  button.onclick = () => {
    state.selectedStatus = button.dataset.status;
    $$('[data-status]').forEach(item => item.classList.toggle('selected', item === button));
    $('#timeFields').classList.toggle('hidden', state.selectedStatus !== 'limited');
  };
});

$('#saveDay').onclick = async () => {
  if (!state.selectedStatus) {
    toast('Выберите статус');
    return;
  }
  const value = {
    status: state.selectedStatus,
    ...(state.selectedStatus === 'limited' ? { from: $('#timeFrom').value, to: $('#timeTo').value } : {})
  };
  try {
    await saveAvailability(state.selectedDate, value);
    if (state.localMode) renderCalendar();
    $('#dayModal').classList.add('hidden');
    toast();
  } catch (error) {
    toast(readableError(error));
  }
};

$$('[data-close]').forEach(button => {
  button.onclick = () => $('#dayModal').classList.add('hidden');
});
$('#dayModal').onclick = event => {
  if (event.target.id === 'dayModal') event.currentTarget.classList.add('hidden');
};

$('#copyWeek').onclick = async () => {
  if (state.localMode) {
    for (let index = 0; index < 7; index += 1) {
      const source = state.availability[iso(dateAt(index))];
      const targetDate = iso(dateAt(index + 7));
      if (source) state.availability[targetDate] = { ...source };
      else delete state.availability[targetDate];
    }
    persistLocalFallback();
    renderCalendar();
    toast('Неделя скопирована');
    return;
  }
  const batch = writeBatch(db);
  for (let index = 0; index < 7; index += 1) {
    const source = state.availability[iso(dateAt(index))];
    const targetDate = iso(dateAt(index + 7));
    const targetRef = doc(db, 'availability', `${state.firebaseUser.uid}_${targetDate}`);
    if (source) {
      batch.set(targetRef, {
        userId: state.firebaseUser.uid,
        date: targetDate,
        status: source.status,
        from: source.from || null,
        to: source.to || null,
        updatedAt: serverTimestamp()
      });
    } else {
      batch.delete(targetRef);
    }
  }
  try {
    await batch.commit();
    toast('Неделя скопирована');
  } catch (error) {
    toast(readableError(error));
  }
};

$('#addSlot').onclick = () => {
  if (!isAdmin()) return;
  $('#slotDate').value = iso(dateAt(1));
  $('#slotModal').classList.remove('hidden');
};

$('#saveSlot').onclick = async () => {
  const title = $('#slotTitle').value.trim();
  const date = $('#slotDate').value;
  if (!title || !date) {
    toast('Добавьте название и дату');
    return;
  }
  try {
    const slotData = {
      title,
      production: $('#slotProduction').value,
      date,
      from: $('#slotFrom').value,
      to: $('#slotTo').value,
      place: $('#slotPlace').value.trim() || 'Место уточняется',
      createdBy: state.firebaseUser.uid,
      createdAt: serverTimestamp()
    };
    if (state.localMode) {
      state.slots.push({ ...slotData, id: `local-${Date.now()}`, createdAt: null });
      persistLocalFallback();
      renderAll();
    } else {
      await addDoc(collection(db, 'slots'), slotData);
    }
    $('#slotModal').classList.add('hidden');
    $('#slotTitle').value = '';
    toast('Слот создан');
  } catch (error) {
    toast(readableError(error));
  }
};

$$('[data-close-slot]').forEach(button => {
  button.onclick = () => $('#slotModal').classList.add('hidden');
});
$('#slotModal').onclick = event => {
  if (event.target.id === 'slotModal') event.currentTarget.classList.add('hidden');
};

$('#addShow').onclick = () => toast('Управление спектаклями подключим следующим этапом');

onAuthStateChanged(auth, async user => {
  clearSubscriptions();
  state.firebaseUser = user;
  state.profile = null;
  state.profiles = [];
  state.availability = {};
  state.slots = [];
  state.responses = [];
  state.localMode = false;
  if (!user) {
    showAuth();
    return;
  }
  try {
    state.profile = await ensureProfile(user);
    showApp();
    subscribeToData();
  } catch (error) {
    loadLocalFallback(user);
    showApp();
    renderAll();
    toast('Облачная база закрыта — работает локальный режим');
  }
});

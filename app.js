import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
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
const defaultShows = [
  { id: 'show-maiden-death', name: 'Дева и Смерть', dateOffset: 2, time: '19:00', place: 'Место уточняется', cast: ['Р', 'НК'], conflict: 0 },
  { id: 'show-sunday', name: 'Воскресенье', dateOffset: 6, time: '19:00', place: 'Место уточняется', cast: ['Р', 'В'], conflict: 0 },
  { id: 'show-shakespeare-storm', name: 'Шекспир «Гроза»', dateOffset: 10, time: '19:00', place: 'Место уточняется', cast: ['С', 'НК'], conflict: 0 },
  { id: 'show-medusas', name: 'Медузы', dateOffset: 14, time: '19:00', place: 'Место уточняется', cast: ['М', 'Д', 'П', 'Д', 'В'], conflict: 0 }
];
let shows = [...defaultShows];
const obsoleteShowIds = new Set(['show-seagull', 'show-storm', 'show-three-sisters']);

function fallbackProfiles(user) {
  const defaultProfiles = [
    { id: user.uid, name: user.displayName || user.email.split('@')[0], email: user.email, role: user.uid === BOOTSTRAP_ADMIN_UID ? 'admin' : 'member', shows: ['Чайка', 'Гроза'] },
    ...[
      ['bogdan', 'Богдан'], ['vanya', 'Ваня'], ['ksusha-h', 'Ксюша Х.'], ['kirill', 'Кирилл'],
      ['nikita-k', 'Никита К.'], ['danya-ml', 'Даня мл.'], ['murat', 'Мурат'], ['pasha', 'Паша'],
      ['ulyana', 'Ульяна'], ['ksusha-l', 'Ксюша Л.'], ['taya', 'Тая'], ['arina', 'Арина'],
      ['alyona', 'Алёна'], ['masha', 'Маша'], ['ruslan', 'Руслан'], ['rita', 'Рита'],
      ['vitalya', 'Виталя'], ['svyat', 'Свят'], ['miya', 'Мия'], ['mila', 'Мила'], ['darya', 'Даря']
    ].map(([id, name]) => ({ id: `demo-${id}`, name, role: 'member', shows: [] }))
  ];
  const savedProfiles = JSON.parse(localStorage.getItem('sbor-profiles-v3') || '[]');
  return defaultProfiles.map(profile => ({ ...profile, ...(savedProfiles.find(saved => saved.id === profile.id) || {}) }));
}

function defaultPresets() {
  return [
    { id: 'preset-individuals', name: 'Все с индивидуалками', duration: 60, place: 'Зал', production: 'Общее', participantIds: ['demo-kirill', 'demo-ulyana', 'demo-vanya', 'demo-ksusha-h'] },
    { id: 'preset-shakespeare', name: 'Репетиция Шекспира', duration: 60, place: 'Большой зал', production: 'Шекспир «Гроза»', participantIds: ['demo-svyat', 'demo-nikita-k'] },
    { id: 'preset-medusas', name: 'Репетиция медуз', duration: 60, place: 'Зал', production: 'Медузы', participantIds: ['demo-mila', 'demo-danya-ml', 'demo-pasha', 'demo-darya', 'demo-vitalya'] },
    { id: 'preset-maiden-death', name: 'Репетиция «Дева и Смерть»', duration: 60, place: 'Зал', production: 'Дева и Смерть', participantIds: ['demo-rita', 'demo-nikita-k'] },
    { id: 'preset-sunday', name: 'Репетиция «Воскресенье»', duration: 60, place: 'Зал', production: 'Воскресенье', participantIds: ['demo-rita', 'demo-vitalya'] },
    { id: 'preset-speech', name: 'Сценическая речь', duration: 60, place: 'Зал', production: 'Общее', participantIds: [] },
    { id: 'preset-theatre', name: 'Театральная мастерская', duration: 90, place: 'Зал', production: 'Общее', participantIds: [] },
    { id: 'preset-psychology', name: 'Психологическая мастерская', duration: 90, place: 'Зал', production: 'Общее', participantIds: [] },
    { id: 'preset-vanya-bogdan', name: 'Богдан и Ваня', duration: 30, place: 'Зал', production: 'Общее', participantIds: ['demo-bogdan', 'demo-vanya'] },
    { id: 'preset-taya-arina-alyona', name: 'Тая, Арина, Алёна', duration: 30, place: 'Зал', production: 'Общее', participantIds: ['demo-taya', 'demo-arina', 'demo-alyona'] }
  ];
}

const draftParticipants = [
  ['bogdan', 'Богдан'], ['vanya', 'Ваня'], ['ksusha-h', 'Ксюша Х.'], ['kirill', 'Кирилл'], ['nikita-k', 'Никита К.'], ['danya-ml', 'Даня мл.'], ['murat', 'Мурат'], ['pasha', 'Паша'], ['ulyana', 'Ульяна'], ['ksusha-l', 'Ксюша Л.'], ['taya', 'Тая'], ['arina', 'Арина'], ['alyona', 'Алёна'], ['masha', 'Маша'], ['ruslan', 'Руслан'], ['rita', 'Рита'], ['vitalya', 'Виталя'], ['svyat', 'Свят'], ['miya', 'Мия'], ['mila', 'Мила'], ['darya', 'Даря']
].map(([id, name]) => ({
  id: `demo-${id}`,
  name,
  shows: {
    'rita': ['Дева и Смерть', 'Воскресенье'], 'nikita-k': ['Дева и Смерть', 'Шекспир «Гроза»'], 'vitalya': ['Воскресенье', 'Медузы'], 'svyat': ['Шекспир «Гроза»'], 'mila': ['Медузы'], 'danya-ml': ['Медузы'], 'pasha': ['Медузы'], 'darya': ['Медузы']
  }[id] || []
}));
];

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
  presets: defaultPresets(),
  adminView: false,
  selectedDate: null,
  selectedStatus: null,
  filter: 'Все',
  slotFilter: 'Все',
  builderWeekOffset: 0,
  builderDate: null,
  localMode: false,
  seedingPresets: false,
  seedingShows: false,
  seedingDrafts: false,
  cloudMigrationStarted: false,
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
    'auth/network-request-failed': 'Нет соединения с Firebase. Проверьте интернет и попробуйте ещё раз',
    'auth/unauthorized-domain': 'Этот адрес сайта ещё не разрешён в настройках Firebase',
    'auth/internal-error': 'Firebase временно не ответил. Попробуйте ещё раз',
    'permission-denied': 'Firestore отклонил запрос. Проверьте правила доступа'
  };
  return messages[error?.code] || error?.message || 'Не удалось выполнить действие';
}

function setAuthMessage(form, message = '', success = false) {
  const element = $(`#${form}Message`);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('success', success);
}

function currentName() {
  return state.profile?.name || state.firebaseUser?.displayName || state.firebaseUser?.email || 'Участник';
}

function isAdmin() {
  return state.firebaseUser?.uid === BOOTSTRAP_ADMIN_UID || state.profile?.role === 'admin';
}

function profileById(userId) {
  return state.profiles.find(profile => profile.id === userId);
}

async function saveManagedProfile(userId, changes) {
  const profile = profileById(userId);
  if (!profile || !isAdmin()) return;
  if (state.localMode) {
    state.profiles = state.profiles.map(item => item.id === userId ? { ...item, ...changes } : item);
    if (state.profile?.id === userId) state.profile = { ...state.profile, ...changes };
    persistLocalFallback();
    applyUser();
    renderTeam();
    renderMatches();
    return;
  }
  await setDoc(doc(db, 'profiles', userId), changes, { merge: true });
}

function openUserModal(userId) {
  const profile = profileById(userId);
  if (!profile || !isAdmin()) return;
  $('#userModal').dataset.userId = userId;
  $('#userModalName').textContent = profile.name;
  $('#userModalEmail').textContent = profile.email || 'Почта скрыта или ещё не указана';
  $('#userShowsEditor').innerHTML = shows.map(show => `<label><input type="checkbox" value="${show.name}" ${(profile.shows || []).includes(show.name) ? 'checked' : ''}> ${show.name}</label>`).join('');
  const drafts = state.profiles.filter(item => item.pending && !item.disabled);
  $('#linkDraftBlock').classList.toggle('hidden', profile.pending || !drafts.length);
  $('#linkDraftSelect').innerHTML = drafts.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
  $('#toggleUserAccess').textContent = profile.disabled ? 'Вернуть доступ' : 'Отключить доступ к сайту';
  $('#toggleUserAccess').dataset.disabled = String(Boolean(profile.disabled));
  $('#userModal').classList.remove('hidden');
}

async function seedDraftParticipants() {
  if (!isAdmin() || state.seedingDrafts) return;
  const missing = draftParticipants.filter(draft => !state.profiles.some(profile => profile.id === draft.id));
  if (!missing.length) return;
  state.seedingDrafts = true;
  try {
    const batch = writeBatch(db);
    missing.forEach(draft => batch.set(doc(db, 'profiles', draft.id), { ...draft, role: 'member', pending: true, disabled: false }));
    await batch.commit();
  } catch (error) {
    state.seedingDrafts = false;
    toast(readableError(error));
  }
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
  const savedShows = JSON.parse(localStorage.getItem('sbor-shows-v3') || 'null');
  if (Array.isArray(savedShows) && savedShows.length) shows = savedShows;
  state.presets = JSON.parse(localStorage.getItem('sbor-presets-v1') || 'null') || defaultPresets();
}

function persistLocalFallback() {
  localStorage.setItem('sbor-availability', JSON.stringify(state.availability));
  localStorage.setItem('sbor-slots-v2', JSON.stringify(state.slots));
  localStorage.setItem('sbor-responses-v3', JSON.stringify(state.responses));
  localStorage.setItem('sbor-profiles-v3', JSON.stringify(state.profiles));
  localStorage.setItem('sbor-shows-v3', JSON.stringify(shows));
  localStorage.setItem('sbor-presets-v1', JSON.stringify(state.presets));
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
    if (user.uid === BOOTSTRAP_ADMIN_UID) {
      await setDoc(profileRef, { role: 'admin' }, { merge: true });
      profile.role = 'admin';
    }
    return { id: user.uid, ...profile, createdAt: null };
  }
  const profile = { id: profileSnapshot.id, ...profileSnapshot.data() };
  if (user.uid === BOOTSTRAP_ADMIN_UID && profile.role !== 'admin') {
    await setDoc(profileRef, { role: 'admin' }, { merge: true });
    profile.role = 'admin';
  }
  return profile;
}

async function seedCloudCollection(name, items) {
  if (!items.length) return;
  const batch = writeBatch(db);
  items.forEach((item, index) => {
    const id = item.id || `${name.slice(0, -1)}-${Date.now()}-${index}`;
    batch.set(doc(db, name, id), { ...item, id });
  });
  await batch.commit();
}

async function migrateLocalAdminData() {
  if (!isAdmin() || state.cloudMigrationStarted || localStorage.getItem('sbor-cloud-migrated-v1')) return;
  state.cloudMigrationStarted = true;
  const localSlots = (JSON.parse(localStorage.getItem('sbor-slots-v2') || '[]') || []).filter(slot => String(slot.id).startsWith('local-'));
  const localResponses = JSON.parse(localStorage.getItem('sbor-responses-v3') || '[]') || [];
  const localAvailability = JSON.parse(localStorage.getItem('sbor-availability') || '{}') || {};
  const batch = writeBatch(db);
  let writeCount = 0;
  localSlots.forEach(slot => {
    batch.set(doc(db, 'slots', slot.id), { ...slot, createdBy: state.firebaseUser.uid, createdAt: serverTimestamp() }, { merge: true });
    writeCount += 1;
  });
  localResponses.filter(response => response.userId === state.firebaseUser.uid && localSlots.some(slot => slot.id === response.slotId)).forEach(response => {
    batch.set(doc(db, 'responses', response.id), { ...response, updatedAt: serverTimestamp() }, { merge: true });
    writeCount += 1;
  });
  Object.entries(localAvailability).forEach(([date, value]) => {
    batch.set(doc(db, 'availability', `${state.firebaseUser.uid}_${date}`), { userId: state.firebaseUser.uid, date, status: value.status, from: value.from || null, to: value.to || null, updatedAt: serverTimestamp() }, { merge: true });
    writeCount += 1;
  });
  if (writeCount) await batch.commit();
  localStorage.setItem('sbor-cloud-migrated-v1', new Date().toISOString());
}

function subscribeToData() {
  clearSubscriptions();
  const uid = state.firebaseUser.uid;

  state.unsubscribers.push(onSnapshot(collection(db, 'profiles'), snapshot => {
    state.profiles = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const ownProfile = state.profiles.find(profile => profile.id === uid);
    if (ownProfile) state.profile = ownProfile;
    if (state.profile?.disabled) {
      toast('Доступ к сайту отключён администратором');
      signOut(auth);
      return;
    }
    applyUser();
    seedDraftParticipants();
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
    renderWeekBuilder();
  }, error => toast(readableError(error))));

  state.unsubscribers.push(onSnapshot(collection(db, 'responses'), snapshot => {
    state.responses = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderSlots();
    renderMatches();
  }, error => toast(readableError(error))));

  state.unsubscribers.push(onSnapshot(collection(db, 'presets'), async snapshot => {
    if (snapshot.empty && isAdmin() && !state.seedingPresets) {
      state.seedingPresets = true;
      try {
        const localPresets = JSON.parse(localStorage.getItem('sbor-presets-v1') || 'null') || defaultPresets();
        await seedCloudCollection('presets', localPresets);
      } catch (error) {
        state.seedingPresets = false;
        toast(readableError(error));
      }
      return;
    }
    state.presets = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderWeekBuilder();
  }, error => toast(readableError(error))));

  state.unsubscribers.push(onSnapshot(collection(db, 'shows'), async snapshot => {
    const cloudShows = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const obsoleteShows = cloudShows.filter(show => obsoleteShowIds.has(show.id));
    if (isAdmin() && obsoleteShows.length) {
      const batch = writeBatch(db);
      obsoleteShows.forEach(show => batch.delete(doc(db, 'shows', show.id)));
      await batch.commit();
      return;
    }
    const missingShows = defaultShows.filter(defaultShow => !cloudShows.some(show => show.name === defaultShow.name));
    if (isAdmin() && missingShows.length && !state.seedingShows) {
      state.seedingShows = true;
      try {
        const savedShows = JSON.parse(localStorage.getItem('sbor-shows-v3') || 'null') || [];
        const customShows = snapshot.empty ? savedShows.filter(savedShow => !defaultShows.some(defaultShow => defaultShow.name === savedShow.name)) : [];
        await seedCloudCollection('shows', [...customShows, ...missingShows]);
      } catch (error) {
        state.seedingShows = false;
        toast(readableError(error));
      }
      return;
    }
    shows = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderEvents();
    renderShows();
    renderTeam();
    renderWeekBuilder();
  }, error => toast(readableError(error))));

  migrateLocalAdminData().catch(error => toast(readableError(error)));
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
  const admin = isAdmin();
  $('#app').classList.toggle('admin-account', admin);
  $('#adminToggle').classList.toggle('hidden', !admin);
  if (admin) {
    state.adminView = true;
    $('#app').classList.add('admin-mode');
    if ($('#schedulePage').classList.contains('active')) {
      $$('.page').forEach(page => page.classList.remove('active'));
      $('#slotsPage').classList.add('active');
      $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.page === 'slots'));
      $('#pageTitle').textContent = 'Сетка недели';
    }
  } else {
    state.adminView = false;
    $('#app').classList.remove('admin-mode', 'admin-account');
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

function renderStorageState() {
  const label = $('#storageMode');
  const hint = $('#storageModeHint');
  if (!label || !hint) return;
  if (state.localMode) {
    label.textContent = 'Локальный режим';
    hint.textContent = 'Данные сохраняются только в этом браузере. Общий сервер подключим позже.';
  } else {
    label.textContent = 'Общий режим';
    hint.textContent = 'Данные синхронизируются между участниками.';
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

function slotParticipants(slot) {
  if (Array.isArray(slot.participantIds)) return state.profiles.filter(profile => !profile.disabled && slot.participantIds.includes(profile.id));
  return [];
}

function builderWeekStart() {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1 + state.builderWeekOffset * 7);
  return date;
}

function builderWeekDates() {
  const start = builderWeekStart();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function addMinutes(time, minutes) {
  const [hours, mins] = time.split(':').map(Number);
  const total = hours * 60 + mins + Number(minutes);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function currentBuilderWeekKeys() {
  return builderWeekDates().map(date => iso(date));
}

function nextBuilderTime(date) {
  const lastSlot = state.slots
    .filter(slot => slot.date === date && slot.to)
    .sort((left, right) => right.to.localeCompare(left.to))[0];
  return lastSlot?.to || '14:00';
}

async function createSlotFromPreset(preset) {
  if (!state.builderDate) state.builderDate = iso(builderWeekDates()[0]);
  const from = $('#builderTime').value || '14:00';
  const slotData = {
    title: preset.name,
    production: preset.production || 'Общее',
    date: state.builderDate,
    from,
    to: addMinutes(from, preset.duration || 60),
    place: preset.place || 'Место уточняется',
    participantIds: preset.participantIds || [],
    presetId: preset.id,
    createdBy: state.firebaseUser.uid,
    createdAt: serverTimestamp()
  };
  try {
    if (state.localMode) {
      state.slots.push({ ...slotData, id: `local-${Date.now()}`, createdAt: null });
      persistLocalFallback();
      renderAll();
    } else {
      await addDoc(collection(db, 'slots'), slotData);
    }
    $('#builderTime').value = slotData.to;
    toast(`${preset.name} добавлен на ${from}`);
  } catch (error) {
    toast(readableError(error));
  }
}

function renderWeekBuilder() {
  if (!isAdmin() || !$('#weekBuilder')) return;
  const dates = builderWeekDates();
  if (!state.builderDate || !dates.some(date => iso(date) === state.builderDate)) {
    state.builderDate = iso(dates[0]);
    $('#builderTime').value = nextBuilderTime(state.builderDate);
  }
  $('#builderWeekLabel').textContent = `${fmt(dates[0])} — ${fmt(dates[6])}`;
  $('#builderDays').innerHTML = dates.map(date => {
    const key = iso(date);
    const count = state.slots.filter(slot => slot.date === key).length;
    return `<button class="builder-day ${state.builderDate === key ? 'active' : ''}" data-builder-date="${key}"><span>${ruDays[date.getDay()]}</span><strong>${date.getDate()}</strong><b>${count ? `${count} блок.` : 'пусто'}</b></button>`;
  }).join('');
  $$('[data-builder-date]').forEach(button => {
    button.onclick = () => {
      state.builderDate = button.dataset.builderDate;
      $('#builderTime').value = nextBuilderTime(state.builderDate);
      renderWeekBuilder();
    };
  });

  const weekKeys = currentBuilderWeekKeys();
  const usedIds = new Set(state.slots.filter(slot => weekKeys.includes(slot.date)).map(slot => slot.presetId).filter(Boolean));
  const unused = state.presets.filter(preset => !usedIds.has(preset.id));
  const used = state.presets.filter(preset => usedIds.has(preset.id));
  const presetCard = preset => `<article class="preset-card ${usedIds.has(preset.id) ? 'used' : ''}" data-use-preset="${preset.id}"><button class="preset-edit" data-edit-preset="${preset.id}" aria-label="Редактировать ${preset.name}">✎</button><strong>${preset.name}</strong><span>${preset.duration} мин · ${(preset.participantIds || []).length} чел.</span><span>${preset.place || 'Место не задано'}</span></article>`;
  $('#presetShelf').innerHTML = `${unused.map(presetCard).join('')}${used.length ? `<div class="preset-divider">Уже использованы на этой неделе</div>${used.map(presetCard).join('')}` : ''}`;
  $$('[data-use-preset]').forEach(card => {
    card.onclick = event => {
      if (!event.target.closest('[data-edit-preset]')) createSlotFromPreset(state.presets.find(preset => preset.id === card.dataset.usePreset));
    };
  });
  $$('[data-edit-preset]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      openPresetModal(button.dataset.editPreset);
    };
  });

  const selectedDate = new Date(`${state.builderDate}T12:00:00`);
  const daySlots = state.slots.filter(slot => slot.date === state.builderDate).sort((a, b) => a.from.localeCompare(b.from));
  $('#builderDayTitle').textContent = `${ruDays[selectedDate.getDay()]}, ${fmt(selectedDate)}`;
  $('#builderDayCount').textContent = `${daySlots.length} блоков`;
  $('#builderDaySchedule').innerHTML = daySlots.length ? daySlots.map(slot => `<article class="builder-slot"><strong>${slot.from}</strong><div class="builder-slot-info"><strong>${slot.title}</strong><span>${slot.to} · ${slotParticipants(slot).map(profile => profile.name).join(', ') || 'без участников'}</span></div><div class="builder-slot-actions"><button data-builder-edit="${slot.id}">изменить</button><button data-builder-delete="${slot.id}">убрать</button></div></article>`).join('') : '<div class="empty-state">Тапните пресет — блок сразу появится здесь.</div>';
  $$('[data-builder-edit]').forEach(button => button.onclick = () => openSlotModal(button.dataset.builderEdit));
  $$('[data-builder-delete]').forEach(button => button.onclick = () => deleteSlotById(button.dataset.builderDelete));
}

function renderPresetPeopleCount() {
  const count = $('#presetPeople').querySelectorAll('input:checked').length;
  $('#presetPeopleCount').textContent = `${count} выбрано`;
}

function openPresetModal(presetId = null) {
  const preset = state.presets.find(item => item.id === presetId);
  $('#presetModal').dataset.presetId = presetId || '';
  $('#presetModalTitle').textContent = preset ? 'Изменить пресет' : 'Новый пресет';
  $('#presetName').value = preset?.name || '';
  $('#presetDuration').value = String(preset?.duration || 60);
  $('#presetPlace').value = preset?.place || '';
  $('#presetProduction').innerHTML = ['Общее', ...shows.map(show => show.name)].map(name => `<option>${name}</option>`).join('');
  $('#presetProduction').value = preset?.production || 'Общее';
  $('#presetPeople').innerHTML = state.profiles.filter(profile => profile.role !== 'admin' && !profile.disabled).map(profile => `<label><input type="checkbox" value="${profile.id}" ${(preset?.participantIds || []).includes(profile.id) ? 'checked' : ''}> ${profile.name}</label>`).join('');
  $('#presetPeople').querySelectorAll('input').forEach(input => input.onchange = renderPresetPeopleCount);
  $('#deletePreset').classList.toggle('hidden', !preset);
  renderPresetPeopleCount();
  $('#presetModal').classList.remove('hidden');
}

async function deleteSlotById(slotId) {
  try {
    if (state.localMode) {
      state.slots = state.slots.filter(slot => slot.id !== slotId);
      state.responses = state.responses.filter(response => response.slotId !== slotId);
      persistLocalFallback();
      renderAll();
    } else {
      await deleteDoc(doc(db, 'slots', slotId));
    }
    toast('Блок убран из расписания');
  } catch (error) {
    toast(readableError(error));
  }
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
  const values = ['Все', 'Мои', ...new Set(state.slots.map(slot => slot.production))];
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
    .filter(slot => state.slotFilter === 'Все' || (state.slotFilter === 'Мои' ? slotParticipants(slot).some(profile => profile.id === state.firebaseUser?.uid) : slot.production === state.slotFilter))
    .sort((left, right) => `${left.date}${left.from}`.localeCompare(`${right.date}${right.from}`));
  updateSlotBadge();
  $('#slotList').innerHTML = slots.length ? slots.map(slot => {
    const participants = slotParticipants(slot);
    const responses = state.responses.filter(response => response.slotId === slot.id && participants.some(profile => profile.id === response.userId));
    const ownAnswer = responseFor(slot.id, state.firebaseUser?.uid)?.status || 'none';
    const free = responses.filter(response => response.status === 'free').length;
    const possible = responses.filter(response => response.status === 'limited').length;
    const action = state.adminView
      ? `<div class="slot-admin-summary"><strong>${free + possible}/${participants.length}</strong><span>${free} могут · ${possible} возможно</span><button class="small-action" data-edit-slot="${slot.id}">Изменить</button><button class="small-action" data-delete-slot="${slot.id}">Удалить</button></div>`
      : `<div class="slot-actions"><div class="response-buttons"><button data-slot="${slot.id}" data-response="free" class="${ownAnswer === 'free' ? 'chosen' : ''}" title="Могу">✓</button><button data-slot="${slot.id}" data-response="limited" class="${ownAnswer === 'limited' ? 'chosen' : ''}" title="Возможно">~</button><button data-slot="${slot.id}" data-response="busy" class="${ownAnswer === 'busy' ? 'chosen' : ''}" title="Не могу">×</button></div><div class="response-legend">могу · возможно · не могу</div></div>`;
    const dayStatus = state.availability[slot.date]?.status;
    const dayHint = dayStatus === 'busy' ? '<span class="slot-warning">В календаре отмечено: не могу</span>' : dayStatus === 'limited' ? '<span class="slot-warning">В календаре есть ограничения</span>' : '';
    return `<article class="slot-card"><div class="slot-when"><strong>${slot.from}</strong><span>${niceDate(slot.date)}<br>до ${slot.to}</span></div><div class="slot-info"><h3>${slot.title}</h3><p>${slot.place}</p><span class="slot-production">${slot.production}</span>${dayHint}</div>${action}</article>`;
  }).join('') : '<div class="empty-state">Слотов пока нет. Администратор может создать первый.</div>';

  $$('[data-slot][data-response]').forEach(button => {
    button.onclick = () => setSlotResponse(button.dataset.slot, button.dataset.response);
  });
  $$('[data-edit-slot]').forEach(button => {
    button.onclick = () => openSlotModal(button.dataset.editSlot);
  });
  $$('[data-delete-slot]').forEach(button => {
    button.onclick = () => deleteSlotById(button.dataset.deleteSlot);
  });
}

function updateSlotBadge() {
  const pending = state.slots.filter(slot => slotParticipants(slot).some(profile => profile.id === state.firebaseUser?.uid) && !responseFor(slot.id, state.firebaseUser?.uid)).length;
  $('#slotBadge').textContent = pending || state.slots.length;
  $('#slotBadge').title = pending ? `Неотвеченных слотов: ${pending}` : 'Все слоты отвечены';
}

function renderMatches() {
  if (!$('#matchList')) return;
  const ranked = state.slots.map(slot => {
    const participants = slotParticipants(slot);
    const responses = state.responses.filter(response => response.slotId === slot.id && participants.some(profile => profile.id === response.userId));
    return {
      slot,
      participants,
      responses,
      free: responses.filter(response => response.status === 'free').length,
      limited: responses.filter(response => response.status === 'limited').length,
      busy: responses.filter(response => response.status === 'busy').length
    };
  }).sort((left, right) => (right.free + right.limited * 0.5) - (left.free + left.limited * 0.5));
  const best = ranked[0];
  const full = ranked.filter(item => item.busy === 0 && item.responses.length === item.participants.length && item.participants.length > 0).length;
  const answerCount = ranked.reduce((sum, item) => sum + item.responses.length, 0);
  const total = Math.max(1, ranked.reduce((sum, item) => sum + item.participants.length, 0));
  $('#matchSummary').innerHTML = `<div class="summary-card"><strong>${best ? best.free + best.limited : 0}/${best?.participants.length || 0}</strong><span>лучшее пересечение</span></div><div class="summary-card"><strong>${full}</strong><span>слотов без отказов</span></div><div class="summary-card"><strong>${Math.round(answerCount / total * 100)}%</strong><span>ответов собрано</span></div>`;
  $('#matchList').innerHTML = ranked.length ? ranked.map(({ slot, participants, responses, free, limited }) => `<article class="match-card"><div class="match-head"><div><h3>${slot.title}</h3><p>${niceDate(slot.date)} · ${slot.from}–${slot.to} · ${slot.production}</p></div><div class="match-score"><strong>${free + limited}/${participants.length}</strong><span>доступны</span></div></div><div class="member-responses">${participants.map(profile => {
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
  $('#showGrid').innerHTML = shows.map((show, index) => {
    const cast = state.profiles.filter(profile => (profile.shows || []).includes(show.name));
    const showSlots = state.slots.filter(slot => slot.production === show.name);
    const displayDate = show.date ? niceDate(show.date) : fmt(dateAt(show.dateOffset || 0));
    const avatars = cast.length ? cast.map(profile => profile.name.split(' ').map(part => part[0]).slice(0, 2).join('')) : show.cast || [];
    return `<article class="show-card"><span class="show-card-number">${String(index + 1).padStart(2, '0')} / ${displayDate}</span><h3>${show.name}</h3><p>${show.time} · ${show.place}</p><div class="cast-avatars">${avatars.map(person => `<span>${person}</span>`).join('') || '<span>—</span>'}</div><div class="show-status"><span>Состав: ${cast.length || 0} человек</span><span>${showSlots.length} слотов</span></div>${state.adminView ? `<button class="small-action" data-edit-show="${show.name}">Изменить спектакль</button>` : ''}</article>`;
  }).join('');
  $$('[data-edit-show]').forEach(button => {
    button.onclick = () => openShowModal(button.dataset.editShow);
  });
}

function fillProductionSelect() {
  const select = $('#slotProduction');
  select.innerHTML = [...shows.map(show => show.name), 'Общее'].map(name => `<option>${name}</option>`).join('');
}

function openShowModal(showName = null) {
  const show = shows.find(item => item.name === showName);
  $('#showModal').dataset.showName = showName || '';
  $('#showModalTitle').textContent = show ? 'Изменить спектакль' : 'Новый спектакль';
  $('#saveShow').textContent = show ? 'Сохранить спектакль' : 'Создать спектакль';
  $('#showName').value = show?.name || '';
  $('#showPlace').value = show?.place || '';
  $('#showDate').value = show?.date || iso(dateAt(show?.dateOffset || 7));
  $('#showTime').value = show?.time || '19:00';
  $('#showModal').classList.remove('hidden');
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
  const profiles = state.profiles.filter(profile => !profile.claimedBy && (state.filter === 'Все' || (profile.shows || []).includes(state.filter)));
  $('#teamTable').innerHTML = profiles.map(profile => {
    const initials = profile.name.split(' ').map(part => part[0]).slice(0, 2).join('');
    const actions = state.adminView && profile.id !== state.profile?.id ? `<div class="member-actions"><button class="small-action" data-manage-user="${profile.id}">Управлять</button>${profile.disabled ? '<span class="access-status">Отключён</span>' : ''}</div>` : '';
    return `<tr class="${profile.disabled ? 'access-disabled' : ''}"><td><div class="person"><span class="mini-avatar">${initials}</span><span><strong>${profile.name}</strong><br><small>${profile.role === 'admin' ? 'Администратор' : 'Участник'}</small></span></div></td><td>${(profile.shows || []).join(', ') || 'Пока не назначен'}</td><td><span class="gray">Данные доступны администратору</span></td><td class="admin-only">${actions}</td></tr>`;
  }).join('');
  $$('[data-manage-user]').forEach(button => {
    button.onclick = () => openUserModal(button.dataset.manageUser);
  });
}

function renderAll() {
  renderStorageState();
  renderCalendar();
  renderSlots();
  renderMatches();
  renderEvents();
  renderShows();
  renderTeam();
  renderWeekBuilder();
  const now = new Date();
  $('#todayLabel').textContent = `${ruDays[now.getDay()]}, ${fmt(now)}`;
}

$('#loginForm').onsubmit = async event => {
  event.preventDefault();
  const button = $('#loginButton');
  setAuthMessage('login');
  setBusy(button, true);
  try {
    await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
  } catch (error) {
    setAuthMessage('login', readableError(error));
  } finally {
    setBusy(button, false);
  }
};

$('#resetPasswordButton').onclick = async () => {
  const email = $('#loginEmail').value.trim();
  if (!email.includes('@')) {
    toast('Введите почту в поле выше');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    toast('Письмо для восстановления отправлено');
  } catch (error) {
    toast(readableError(error));
  }
};

$('#registerForm').onsubmit = async event => {
  event.preventDefault();
  const name = $('#registerName').value.trim();
  const email = $('#registerEmail').value.trim();
  const password = $('#registerPassword').value;
  if (!name || !email.includes('@') || password.length < 6) {
    setAuthMessage('register', 'Заполните имя, почту и пароль от 6 символов');
    return;
  }
  const button = $('#registerButton');
  setAuthMessage('register');
  setBusy(button, true);
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    await setDoc(doc(db, 'profiles', credential.user.uid), {
      name,
      email,
      role: 'member',
      shows: [],
      createdAt: serverTimestamp()
    }, { merge: true });
    setAuthMessage('register', 'Аккаунт создан. Открываем расписание…', true);
  } catch (error) {
    setAuthMessage('register', readableError(error));
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
    $('#pageTitle').textContent = { schedule: 'Доступность', slots: isAdmin() ? 'Сетка недели' : 'Слоты', matches: 'Ответы участников', shows: 'Спектакли', team: 'Участники' }[button.dataset.page];
    $('.sidebar').classList.remove('open');
  };
});

$$('[data-go]').forEach(button => {
  button.onclick = () => document.querySelector(`[data-page="${button.dataset.go}"]`).click();
});

$('#mobileMenu').onclick = () => $('.sidebar').classList.toggle('open');

$('#previousWeek').onclick = () => {
  state.builderWeekOffset -= 1;
  state.builderDate = null;
  renderWeekBuilder();
};

$('#nextWeek').onclick = () => {
  state.builderWeekOffset += 1;
  state.builderDate = null;
  renderWeekBuilder();
};

$('#addPreset').onclick = () => openPresetModal();

$('#savePreset').onclick = async () => {
  const presetId = $('#presetModal').dataset.presetId;
  const name = $('#presetName').value.trim();
  if (!name) {
    toast('Введите название пресета');
    return;
  }
  const presetData = {
    name,
    duration: Number($('#presetDuration').value),
    place: $('#presetPlace').value.trim() || 'Место уточняется',
    production: $('#presetProduction').value,
    participantIds: [...$('#presetPeople').querySelectorAll('input:checked')].map(input => input.value)
  };
  try {
    const id = presetId || `preset-${Date.now()}`;
    if (state.localMode) {
      if (presetId) state.presets = state.presets.map(preset => preset.id === presetId ? { ...preset, ...presetData } : preset);
      else state.presets.push({ id, ...presetData });
      persistLocalFallback();
      renderWeekBuilder();
    } else {
      await setDoc(doc(db, 'presets', id), { id, ...presetData }, { merge: true });
    }
    $('#presetModal').classList.add('hidden');
    toast(presetId ? 'Пресет обновлён' : 'Пресет создан');
  } catch (error) {
    toast(readableError(error));
  }
};

$('#deletePreset').onclick = async () => {
  const presetId = $('#presetModal').dataset.presetId;
  if (!presetId) return;
  try {
    if (state.localMode) {
      state.presets = state.presets.filter(preset => preset.id !== presetId);
      persistLocalFallback();
      renderWeekBuilder();
    } else {
      await deleteDoc(doc(db, 'presets', presetId));
    }
    $('#presetModal').classList.add('hidden');
    toast('Пресет удалён. Уже созданные блоки остались в расписании');
  } catch (error) {
    toast(readableError(error));
  }
};

$$('[data-close-preset]').forEach(button => button.onclick = () => $('#presetModal').classList.add('hidden'));
$('#presetModal').onclick = event => {
  if (event.target.id === 'presetModal') event.currentTarget.classList.add('hidden');
};

$('#adminToggle').onclick = () => {
  if (!isAdmin()) return;
  state.adminView = !state.adminView;
  $('#app').classList.toggle('admin-mode', state.adminView);
  $('#adminToggle span:last-child').innerHTML = `<small>Режим</small>${state.adminView ? 'Администратор' : 'Участник'}`;
  renderSlots();
  renderTeam();
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
  openSlotModal();
};

function openSlotModal(slotId = null) {
  const slot = state.slots.find(item => item.id === slotId);
  fillProductionSelect();
  $('#slotModal').dataset.slotId = slotId || '';
  $('#slotModalEyebrow').textContent = slot ? 'РЕДАКТИРОВАНИЕ СЛОТА' : 'НОВЫЙ СЛОТ';
  $('#slotModalTitle').textContent = slot ? 'Изменить слот' : 'Создать слот';
  $('#saveSlot').textContent = slot ? 'Сохранить слот' : 'Создать слот';
  $('#slotTitle').value = slot?.title || '';
  $('#slotProduction').value = slot?.production || shows[0]?.name || 'Общее';
  $('#slotDate').value = slot?.date || state.builderDate || iso(dateAt(1));
  $('#slotFrom').value = slot?.from || $('#builderTime').value || '14:00';
  $('#slotTo').value = slot?.to || addMinutes($('#slotFrom').value, 60);
  $('#slotPlace').value = slot?.place || '';
  const selectedPeople = Array.isArray(slot?.participantIds) ? slot.participantIds : [];
  $('#slotPeople').innerHTML = state.profiles
    .filter(profile => profile.role !== 'admin' && !profile.disabled)
    .map(profile => `<label><input type="checkbox" value="${profile.id}" ${selectedPeople.includes(profile.id) ? 'checked' : ''}> ${profile.name}</label>`)
    .join('');
  $('#slotPeople').querySelectorAll('input').forEach(input => input.onchange = renderSlotPeopleCount);
  renderSlotPeopleCount();
  $('#slotModal').classList.remove('hidden');
}

function renderSlotPeopleCount() {
  const count = $('#slotPeople').querySelectorAll('input:checked').length;
  $('#slotPeopleCount').textContent = `${count} выбрано`;
}

$('#selectAllSlotPeople').onclick = () => {
  $('#slotPeople').querySelectorAll('input').forEach(input => { input.checked = true; });
  renderSlotPeopleCount();
};

$('#clearSlotPeople').onclick = () => {
  $('#slotPeople').querySelectorAll('input').forEach(input => { input.checked = false; });
  renderSlotPeopleCount();
};

$('#saveSlot').onclick = async () => {
  const existingId = $('#slotModal').dataset.slotId;
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
      participantIds: [...$('#slotPeople').querySelectorAll('input:checked')].map(input => input.value),
      createdBy: state.firebaseUser.uid,
      createdAt: serverTimestamp()
    };
    if (state.localMode) {
      if (existingId) state.slots = state.slots.map(slot => slot.id === existingId ? { ...slot, ...slotData, createdAt: null } : slot);
      else state.slots.push({ ...slotData, id: `local-${Date.now()}`, createdAt: null });
      persistLocalFallback();
      renderAll();
    } else {
      if (existingId) await setDoc(doc(db, 'slots', existingId), slotData, { merge: true });
      else await addDoc(collection(db, 'slots'), slotData);
    }
    state.builderDate = date;
    $('#builderTime').value = slotData.to;
    renderWeekBuilder();
    $('#slotModal').classList.add('hidden');
    $('#slotTitle').value = '';
    toast(existingId ? 'Слот обновлён' : 'Слот создан');
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

$('#addShow').onclick = () => {
  if (!isAdmin()) return;
  openShowModal();
};

$('#saveShow').onclick = async () => {
  const oldName = $('#showModal').dataset.showName;
  const name = $('#showName').value.trim();
  const place = $('#showPlace').value.trim();
  const date = $('#showDate').value;
  const time = $('#showTime').value;
  if (!name || !place || !date || !time) {
    toast('Заполните название, площадку, дату и время');
    return;
  }
  const duplicate = shows.some(show => show.name === name && show.name !== oldName);
  if (duplicate) {
    toast('Спектакль с таким названием уже есть');
    return;
  }
  const existing = shows.find(show => show.name === oldName);
  const id = existing?.id || `show-${Date.now()}`;
  const showData = { id, name, place, date, time, cast: existing?.cast || [] };
  try {
    if (state.localMode) {
      if (oldName) {
        shows = shows.map(show => show.name === oldName ? { ...show, ...showData } : show);
        state.profiles = state.profiles.map(profile => ({ ...profile, shows: (profile.shows || []).map(item => item === oldName ? name : item) }));
        state.slots = state.slots.map(slot => slot.production === oldName ? { ...slot, production: name } : slot);
      } else {
        shows.push(showData);
      }
      persistLocalFallback();
      renderAll();
    } else {
      const batch = writeBatch(db);
      batch.set(doc(db, 'shows', id), showData, { merge: true });
      if (oldName && oldName !== name) {
        state.profiles.filter(profile => (profile.shows || []).includes(oldName)).forEach(profile => batch.set(doc(db, 'profiles', profile.id), { shows: profile.shows.map(item => item === oldName ? name : item) }, { merge: true }));
        state.slots.filter(slot => slot.production === oldName).forEach(slot => batch.set(doc(db, 'slots', slot.id), { production: name }, { merge: true }));
      }
      await batch.commit();
    }
    $('#showModal').classList.add('hidden');
    toast(oldName ? 'Спектакль обновлён' : 'Спектакль создан');
  } catch (error) {
    toast(readableError(error));
  }
};

$$('[data-close-show]').forEach(button => {
  button.onclick = () => $('#showModal').classList.add('hidden');
});
$('#showModal').onclick = event => {
  if (event.target.id === 'showModal') event.currentTarget.classList.add('hidden');
};

$('#linkDraftProfile').onclick = async () => {
  const userId = $('#userModal').dataset.userId;
  const draftId = $('#linkDraftSelect').value;
  const user = profileById(userId);
  const draft = profileById(draftId);
  if (!user || !draft || user.pending || !isAdmin()) return;
  const showsForUser = [...new Set([...(user.shows || []), ...(draft.shows || [])])];
  try {
    if (state.localMode) {
      state.profiles = state.profiles.map(profile => {
        if (profile.id === userId) return { ...profile, shows: showsForUser, pending: false };
        if (profile.id === draftId) return { ...profile, pending: false, disabled: true, claimedBy: userId };
        return profile;
      });
      state.slots = state.slots.map(slot => ({ ...slot, participantIds: (slot.participantIds || []).map(id => id === draftId ? userId : id) }));
      state.presets = state.presets.map(preset => ({ ...preset, participantIds: (preset.participantIds || []).map(id => id === draftId ? userId : id) }));
      persistLocalFallback();
      renderAll();
    } else {
      const batch = writeBatch(db);
      batch.set(doc(db, 'profiles', userId), { shows: showsForUser, pending: false }, { merge: true });
      state.slots.filter(slot => (slot.participantIds || []).includes(draftId)).forEach(slot => batch.set(doc(db, 'slots', slot.id), { participantIds: slot.participantIds.map(id => id === draftId ? userId : id) }, { merge: true }));
      state.presets.filter(preset => (preset.participantIds || []).includes(draftId)).forEach(preset => batch.set(doc(db, 'presets', preset.id), { participantIds: preset.participantIds.map(id => id === draftId ? userId : id) }, { merge: true }));
      batch.set(doc(db, 'profiles', draftId), { pending: false, disabled: true, claimedBy: userId }, { merge: true });
      await batch.commit();
    }
    $('#userModal').classList.add('hidden');
    toast(`${draft.name} связан с аккаунтом ${user.name}`);
  } catch (error) {
    toast(readableError(error));
  }
};

$('#saveUserShows').onclick = async () => {
  const userId = $('#userModal').dataset.userId;
  const showsForUser = [...$('#userShowsEditor').querySelectorAll('input:checked')].map(input => input.value);
  try {
    await saveManagedProfile(userId, { shows: showsForUser });
    $('#userModal').classList.add('hidden');
    toast('Составы участника сохранены');
  } catch (error) {
    toast(readableError(error));
  }
};

$('#toggleUserAccess').onclick = async () => {
  const userId = $('#userModal').dataset.userId;
  const currentlyDisabled = $('#toggleUserAccess').dataset.disabled === 'true';
  try {
    await saveManagedProfile(userId, { disabled: !currentlyDisabled });
    $('#userModal').classList.add('hidden');
    toast(currentlyDisabled ? 'Доступ возвращён' : 'Доступ к сайту отключён');
  } catch (error) {
    toast(readableError(error));
  }
};

$$('[data-close-user]').forEach(button => {
  button.onclick = () => $('#userModal').classList.add('hidden');
});
$('#userModal').onclick = event => {
  if (event.target.id === 'userModal') event.currentTarget.classList.add('hidden');
};

onAuthStateChanged(auth, async user => {
  clearSubscriptions();
  state.firebaseUser = user;
  state.profile = null;
  state.profiles = [];
  state.availability = {};
  state.slots = [];
  state.responses = [];
  state.localMode = false;
  state.seedingPresets = false;
  state.seedingShows = false;
  state.seedingDrafts = false;
  state.cloudMigrationStarted = false;
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

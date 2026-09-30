import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
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
const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch(error => {
  console.warn('Не удалось включить постоянную сессию Firebase', error);
});
const BOOTSTRAP_ADMIN_UID = 'gABqRTDUcDRd4VH0lxswMIJw7B83';

const ruDays = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const ruMonths = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const defaultShows = [
  { id: 'show-maiden-death', name: 'Дева и Смерть', date: '', time: '', place: '', participantIds: [] },
  { id: 'show-sunday', name: 'Воскресенье', date: '', time: '', place: '', participantIds: [] },
  { id: 'show-shakespeare-storm', name: 'Шекспир «Гроза»', date: '', time: '', place: '', participantIds: [] },
  { id: 'show-medusas', name: 'Медузы', date: '', time: '', place: '', participantIds: [] }
];
let shows = [...defaultShows];
const obsoleteShowIds = new Set(['show-seagull', 'show-three-sisters']);

function readLocalJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (error) {
    console.warn(`Повреждённые локальные данные ${key} пропущены`, error);
    return fallback;
  }
}

function availabilityIntervals(value) {
  const prepared = Array.isArray(value?.intervals)
    ? value.intervals.map(interval => ({ from: interval?.from || '', to: interval?.to || '' })).filter(interval => interval.from || interval.to).slice(0, 2)
    : [];
  if (prepared.length) return prepared;
  return value?.from || value?.to ? [{ from: value.from || '', to: value.to || '' }] : [];
}

function formatIntervals(value) {
  return availabilityIntervals(value).map(interval => [interval.from, interval.to].filter(Boolean).join('–')).filter(Boolean).join(' · ');
}

function limitedRange() {
  const saved = readLocalJson('sbor-limited-range-v1', null);
  const intervals = availabilityIntervals(saved);
  const normalized = intervals.length ? intervals : [{ from: '18:00', to: '' }];
  return { from: normalized[0].from, to: normalized[0].to, intervals: normalized };
}

function rememberLimitedRange(intervals) {
  const prepared = availabilityIntervals({ intervals });
  if (!prepared.length) return;
  try {
    localStorage.setItem('sbor-limited-range-v1', JSON.stringify({ from: prepared[0].from, to: prepared[0].to, intervals: prepared }));
  } catch (error) {
    console.warn('Не удалось запомнить диапазон времени', error);
  }
}

function fallbackProfiles(user) {
  const defaultProfiles = [{ id: user.uid, name: user.displayName || user.email.split('@')[0], email: user.email, role: user.uid === BOOTSTRAP_ADMIN_UID ? 'admin' : 'member', shows: [] }];
  const savedProfiles = readLocalJson('sbor-profiles-v3', []);
  return defaultProfiles.map(profile => ({ ...profile, ...(savedProfiles.find(saved => saved.id === profile.id) || {}) }));
}

function defaultPresets() {
  return [];
}

const draftParticipants = [];

function fallbackSlots() {
  return [];
}

const state = {
  firebaseUser: null,
  profile: null,
  profiles: [],
  availability: {},
  allAvailability: [],
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
  notificationSnapshots: { slots: false, availability: false, responses: false },
  reminderTimer: null,
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

let toastTimer = null;
let lastToastMessage = '';
let lastToastAt = 0;

function toast(message = 'Сохранено') {
  const now = Date.now();
  const isRepeatedError = message === lastToastMessage
    && (message.includes('Firestore') || message.includes('облачн'))
    && now - lastToastAt < 60000;
  if (isRepeatedError) return;
  lastToastMessage = message;
  lastToastAt = now;
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
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
    'permission-denied': 'Часть облачных данных временно недоступна'
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

function isParticipant(profile) {
  return profile?.role !== 'admin' && profile?.id !== BOOTSTRAP_ADMIN_UID && !profile?.claimedBy;
}

function notificationStorageKey() {
  return `sbor-notifications-v1-${state.firebaseUser?.uid || 'guest'}`;
}

function notificationSettings() {
  return { slotChanges: false, reminders: false, reminderLead: 24, adminActivity: false, ...readLocalJson(notificationStorageKey(), {}) };
}

function saveNotificationSettings(settings) {
  try {
    localStorage.setItem(notificationStorageKey(), JSON.stringify(settings));
    return true;
  } catch (error) {
    console.warn('Не удалось сохранить настройки уведомлений', error);
    return false;
  }
}

function notificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

async function notificationRegistration() {
  if (!notificationsSupported()) return null;
  try {
    return await navigator.serviceWorker.register('./sw.js');
  } catch (error) {
    console.warn('Service worker не зарегистрирован', error);
    return null;
  }
}

async function browserNotification(title, body, tag) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const registration = await notificationRegistration();
  if (!registration) return;
  try {
    await registration.showNotification(title, { body, tag, icon: './icon.svg', badge: './icon.svg' });
  } catch (error) {
    console.warn('Не удалось показать уведомление', error);
  }
}

function rawSlotParticipantIds(slot) {
  const directIds = Array.isArray(slot?.participantIds) ? slot.participantIds : [];
  const presetIds = !slot?.participantIdsOverridden && slot?.presetId
    ? (state.presets.find(preset => preset.id === slot.presetId)?.participantIds || [])
    : [];
  return directIds.length ? directIds : presetIds;
}

function notifySlotSnapshot(snapshot, previousSlots) {
  if (!state.notificationSnapshots.slots) {
    state.notificationSnapshots.slots = true;
    return;
  }
  const settings = notificationSettings();
  if (!notificationsSupported() || isAdmin() || !settings.slotChanges || Notification.permission !== 'granted') return;
  const uid = state.firebaseUser?.uid;
  snapshot.docChanges().forEach(change => {
    const current = change.doc.data();
    const previous = previousSlots.find(slot => slot.id === change.doc.id);
    const relevant = rawSlotParticipantIds(current).includes(uid) || rawSlotParticipantIds(previous).includes(uid);
    if (!relevant) return;
    const action = change.type === 'added' ? 'Новая репетиция' : change.type === 'removed' ? 'Репетиция отменена' : 'Репетиция изменена';
    browserNotification(action, `${current.title || previous?.title || 'Слот'} · ${niceDate(current.date || previous?.date)} · ${current.from || previous?.from || 'время уточняется'}`, `slot-${change.doc.id}`);
  });
}

function notifyAdminSnapshot(kind, snapshot) {
  const ready = state.notificationSnapshots[kind];
  state.notificationSnapshots[kind] = true;
  const settings = notificationSettings();
  if (!notificationsSupported() || !ready || !isAdmin() || !settings.adminActivity || Notification.permission !== 'granted') return;
  const changes = snapshot.docChanges().filter(change => change.type !== 'removed' && change.doc.data().userId !== state.firebaseUser?.uid);
  if (!changes.length) return;
  const latest = changes[changes.length - 1].doc.data();
  const person = profileById(latest.userId)?.name || 'Участник';
  const body = kind === 'availability'
    ? `${person} обновил доступность на ${niceDate(latest.date)}`
    : `${person} ответил на слот расписания`;
  browserNotification('Новый ответ для Даши', changes.length > 1 ? `${body} · ещё изменений: ${changes.length - 1}` : body, `admin-${kind}-${Date.now()}`);
}

function checkSlotReminders() {
  const settings = notificationSettings();
  if (!notificationsSupported() || !settings.reminders || Notification.permission !== 'granted' || isAdmin()) return;
  const uid = state.firebaseUser?.uid;
  const now = Date.now();
  const leadMs = Number(settings.reminderLead || 24) * 60 * 60 * 1000;
  state.slots.filter(slot => rawSlotParticipantIds(slot).includes(uid)).forEach(slot => {
    const start = new Date(`${slot.date}T${slot.from || '00:00'}:00`).getTime();
    if (!Number.isFinite(start) || start <= now || start - now > leadMs) return;
    const marker = `sbor-reminder-v1-${uid}-${slot.id}-${slot.date}-${slot.from}-${settings.reminderLead}`;
    if (localStorage.getItem(marker)) return;
    localStorage.setItem(marker, String(Date.now()));
    browserNotification('Скоро репетиция', `${slot.title || 'Репетиция'} · ${niceDate(slot.date)} в ${slot.from || 'уточняется'}`, `reminder-${slot.id}`);
  });
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
  state.availability = readLocalJson('sbor-availability', {});
  state.allAvailability = Object.entries(state.availability).map(([date, value]) => ({ ...value, date, userId: user.uid }));
  state.slots = readLocalJson('sbor-slots-v2', null) || fallbackSlots();
  state.responses = readLocalJson('sbor-responses-v3', null) || [];
  const savedShows = readLocalJson('sbor-shows-v3', null);
  if (Array.isArray(savedShows) && savedShows.length) shows = savedShows;
  state.presets = readLocalJson('sbor-presets-v1', null) || defaultPresets();
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
      disabled: false,
      setupComplete: false,
      createdAt: serverTimestamp()
    };
    await setDoc(profileRef, profile);
    if (user.uid === BOOTSTRAP_ADMIN_UID) {
      await setDoc(profileRef, { name: 'Дашуля', role: 'admin' }, { merge: true });
      profile.name = 'Дашуля';
      profile.role = 'admin';
    }
    return { id: user.uid, ...profile, createdAt: null };
  }
  const profile = { id: profileSnapshot.id, ...profileSnapshot.data() };
  if (user.uid === BOOTSTRAP_ADMIN_UID && (profile.role !== 'admin' || !profile.name || profile.name === '????')) {
    const adminChanges = { role: 'admin', ...((!profile.name || profile.name === '????') ? { name: 'Дашуля' } : {}) };
    await setDoc(profileRef, adminChanges, { merge: true });
    if (adminChanges.name) profile.name = adminChanges.name;
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
  const localSlots = (readLocalJson('sbor-slots-v2', []) || []).filter(slot => String(slot.id).startsWith('local-'));
  const localResponses = readLocalJson('sbor-responses-v3', []) || [];
  const localAvailability = readLocalJson('sbor-availability', {}) || {};
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
    batch.set(doc(db, 'availability', `${state.firebaseUser.uid}_${date}`), { userId: state.firebaseUser.uid, date, status: value.status, from: value.from || null, to: value.to || null, intervals: availabilityIntervals(value), updatedAt: serverTimestamp() }, { merge: true });
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
    renderAdminAvailabilityBoard();
    renderShows();
    renderEvents();
  }, error => toast(readableError(error))));

  const availabilitySource = isAdmin()
    ? collection(db, 'availability')
    : query(collection(db, 'availability'), where('userId', '==', uid));
  state.unsubscribers.push(onSnapshot(
    availabilitySource,
    snapshot => {
      notifyAdminSnapshot('availability', snapshot);
      state.allAvailability = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      state.availability = Object.fromEntries(state.allAvailability.filter(item => item.userId === uid).map(item => [item.date, item]));
      renderCalendar();
      renderTeam();
      renderEvents();
      renderAdminAvailabilityBoard();
      renderSlots();
      renderMatches();
    },
    error => toast(readableError(error))
  ));

  state.unsubscribers.push(onSnapshot(collection(db, 'slots'), snapshot => {
    const previousSlots = state.slots;
    state.slots = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    notifySlotSnapshot(snapshot, previousSlots);
    renderCalendar();
    renderSlots();
    renderMatches();
    renderWeekBuilder();
    checkSlotReminders();
  }, error => toast(readableError(error))));

  const responsesSource = isAdmin()
    ? collection(db, 'responses')
    : query(collection(db, 'responses'), where('userId', '==', uid));
  state.unsubscribers.push(onSnapshot(responsesSource, snapshot => {
    notifyAdminSnapshot('responses', snapshot);
    state.responses = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderSlots();
    renderMatches();
  }, error => toast(readableError(error))));

  state.unsubscribers.push(onSnapshot(collection(db, 'presets'), async snapshot => {
    if (snapshot.empty && isAdmin() && !state.seedingPresets) {
      state.seedingPresets = true;
      try {
        const localPresets = readLocalJson('sbor-presets-v1', null) || defaultPresets();
        await seedCloudCollection('presets', localPresets);
      } catch (error) {
        state.seedingPresets = false;
        toast(readableError(error));
      }
      return;
    }
    state.presets = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderWeekBuilder();
    renderSlots();
    renderMatches();
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
        const savedShows = readLocalJson('sbor-shows-v3', null) || [];
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
    renderEvents();
    renderTeam();
    renderAdminAvailabilityBoard();
    renderWeekBuilder();
  }, error => toast(readableError(error))));

  // Старые локальные наброски больше не переносим в облако.
}

function showApp() {
  $('#authScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  applyUser();
  renderAll();
  try {
    if (sessionStorage.getItem('sbor-show-guide') === '1') {
      sessionStorage.removeItem('sbor-show-guide');
      setTimeout(openGuide, 150);
    }
  } catch (error) {
    // Some private browser modes can disable session storage.
  }
}

function showAuth() {
  $('#app').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
}

function openGuide() {
  $('#guideModal').classList.remove('hidden');
}

function closeGuide() {
  $('#guideModal').classList.add('hidden');
}

function openNotificationSettings() {
  const settings = notificationSettings();
  const supported = notificationsSupported();
  $('#notifySlotChanges').checked = settings.slotChanges;
  $('#notifyReminders').checked = settings.reminders;
  $('#notificationLead').value = String(settings.reminderLead || 24);
  $('#notifyAdminActivity').checked = settings.adminActivity;
  $('#adminNotificationOption').classList.toggle('hidden', !isAdmin());
  $('#reminderLeadRow').classList.toggle('hidden', !settings.reminders);
  $('#notificationSupport').textContent = !supported
    ? 'Этот браузер не поддерживает уведомления сайта.'
    : Notification.permission === 'granted' ? 'Уведомления разрешены на этом устройстве.'
      : Notification.permission === 'denied' ? 'Уведомления запрещены в настройках браузера.'
        : 'Сначала разрешите уведомления для этого сайта.';
  $('#enableNotifications').classList.toggle('hidden', !supported || Notification.permission === 'granted');
  $('#notificationModal').classList.remove('hidden');
}

function applyUser() {
  if (!state.profile && !state.firebaseUser) return;
  const name = currentName();
  $('#profileName').textContent = name;
  $('#profileRole').textContent = isAdmin() ? 'Администратор' : 'Участник';
  $('#avatar').textContent = isAdmin() ? '🐱' : name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
  $('#avatar').classList.toggle('cat-avatar', isAdmin());
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
    intervals: availabilityIntervals(value),
    updatedAt: serverTimestamp()
  });
}

async function cycleDay(date) {
  const order = [null, 'free', 'limited', 'busy'];
  const current = state.availability[date]?.status || null;
  const next = order[(order.indexOf(current) + 1) % order.length];
  const previous = state.availability[date];
  if (!next) delete state.availability[date];
  else state.availability[date] = { status: next, ...(next === 'limited' ? limitedRange() : {}) };
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
    const rangeLabel = formatIntervals(availability);
    const status = availability
      ? `<div class="status-pill status-${availability.status}">${labels[availability.status]}${rangeLabel ? `<small>${rangeLabel}</small>` : ''}</div>`
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
  const range = availability && availabilityIntervals(availability).length ? availability : limitedRange();
  const intervals = availabilityIntervals(range);
  $('#timeFrom').value = intervals[0]?.from || '';
  $('#timeTo').value = intervals[0]?.to || '';
  $('#timeFrom2').value = intervals[1]?.from || '';
  $('#timeTo2').value = intervals[1]?.to || '';
  $('#secondTimeFields').classList.toggle('hidden', !intervals[1]);
  $('#addSecondInterval').classList.toggle('hidden', Boolean(intervals[1]));
  $('#dayModal').classList.remove('hidden');
}

function responseFor(slotId, userId) {
  return state.responses.find(response => response.slotId === slotId && response.userId === userId);
}

function minutesFromTime(value) {
  if (!value) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

function effectiveSlotAnswer(slot, userId) {
  const explicit = responseFor(slot.id, userId);
  if (explicit) return { ...explicit, source: 'slot' };
  const availability = state.allAvailability.find(item => item.userId === userId && item.date === slot.date);
  if (!availability) return { userId, slotId: slot.id, status: 'none', source: 'none' };
  if (availability.status === 'free' || availability.status === 'busy') return { userId, slotId: slot.id, status: availability.status, source: 'calendar' };
  if (availability.status !== 'limited') return { userId, slotId: slot.id, status: 'none', source: 'none' };
  const slotStart = minutesFromTime(slot.from);
  const slotEnd = minutesFromTime(slot.to);
  const intervals = availabilityIntervals(availability).map(interval => ({
    start: minutesFromTime(interval.from) ?? 0,
    end: minutesFromTime(interval.to) ?? 24 * 60
  })).filter(interval => interval.start < interval.end);
  if (slotStart === null || slotEnd === null || !intervals.length) return { userId, slotId: slot.id, status: 'limited', source: 'calendar' };
  if (intervals.some(interval => slotStart >= interval.start && slotEnd <= interval.end)) return { userId, slotId: slot.id, status: 'free', source: 'calendar' };
  if (!intervals.some(interval => slotStart < interval.end && slotEnd > interval.start)) return { userId, slotId: slot.id, status: 'busy', source: 'calendar' };
  return { userId, slotId: slot.id, status: 'limited', source: 'calendar' };
}

function slotParticipants(slot) {
  const directIds = Array.isArray(slot.participantIds) ? slot.participantIds : [];
  const presetIds = !slot.participantIdsOverridden && slot.presetId
    ? (state.presets.find(preset => preset.id === slot.presetId)?.participantIds || [])
    : [];
  const participantIds = directIds.length ? directIds : presetIds;
  if (participantIds.length) return state.profiles.filter(profile => isParticipant(profile) && !profile.disabled && participantIds.includes(profile.id));
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

function exportedWeekText() {
  const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const lines = ['Всем привет! @all наше расписание на неделю:', ''];
  builderWeekDates().forEach(date => {
    const dateKey = iso(date);
    const daySlots = state.slots.filter(slot => slot.date === dateKey).sort((left, right) => left.from.localeCompare(right.from));
    if (!daySlots.length) return;
    lines.push(`${dayNames[date.getDay()]} (${date.getDate()} ${ruMonths[date.getMonth()]}):`);
    daySlots.forEach(slot => {
      const people = slotParticipants(slot).map(profile => profile.name).join(', ');
      const descriptiveTitle = /репетиц|мастер|занят|сбор|прогон|показ/i.test(slot.title || '');
      const description = descriptiveTitle ? `${slot.title}${people ? ` — ${people}` : ''}` : people || slot.title;
      lines.push(`${String(slot.from || '').replace(':', '.')} - ${description};`);
    });
    lines.push('');
  });
  return lines.join('\n').trim();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Буфер обмена недоступен');
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
    participantIds: [...(preset.participantIds || [])],
    participantIdsOverridden: false,
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

function selectProductionCast(containerSelector, production, onChange) {
  const castIds = new Set(state.profiles.filter(profile => isParticipant(profile) && (profile.shows || []).includes(production)).map(profile => profile.id));
  document.querySelectorAll(`${containerSelector} input`).forEach(input => { input.checked = castIds.has(input.value); });
  onChange();
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
  $('#presetProduction').onchange = () => {
    if (!preset) selectProductionCast('#presetPeople', $('#presetProduction').value, renderPresetPeopleCount);
  };
  if (!preset && $('#presetProduction').value !== 'Общее') selectProductionCast('#presetPeople', $('#presetProduction').value, renderPresetPeopleCount);
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
  const uid = state.firebaseUser?.uid;
  const isOwnSlot = slot => slotParticipants(slot).some(profile => profile.id === uid);
  const slots = state.slots
    .filter(slot => state.slotFilter === 'Все' || (state.slotFilter === 'Мои' ? slotParticipants(slot).some(profile => profile.id === state.firebaseUser?.uid) : slot.production === state.slotFilter))
    .sort((left, right) => {
      if (!state.adminView && isOwnSlot(left) !== isOwnSlot(right)) return isOwnSlot(left) ? -1 : 1;
      return `${left.date}${left.from}`.localeCompare(`${right.date}${right.from}`);
    });
  updateSlotBadge();
  $('#slotList').innerHTML = slots.length ? slots.map(slot => {
    const participants = slotParticipants(slot);
    const responses = participants.map(profile => effectiveSlotAnswer(slot, profile.id)).filter(response => response.status !== 'none');
    const ownAnswer = effectiveSlotAnswer(slot, state.firebaseUser?.uid);
    const free = responses.filter(response => response.status === 'free').length;
    const possible = responses.filter(response => response.status === 'limited').length;
    const inferred = responses.filter(response => response.source === 'calendar').length;
    const ownSlot = isOwnSlot(slot);
    const action = state.adminView
      ? `<div class="slot-admin-summary"><strong>${free + possible}/${participants.length}</strong><span>${free} могут · ${possible} возможно${inferred ? ` · ${inferred} по календарю` : ''}</span><button class="small-action" data-edit-slot="${slot.id}">Изменить</button><button class="small-action" data-delete-slot="${slot.id}">Удалить</button></div>`
      : ownSlot
        ? `<div class="slot-actions"><div class="response-buttons"><button data-slot="${slot.id}" data-response="free" class="${ownAnswer.status === 'free' ? `chosen ${ownAnswer.source === 'calendar' ? 'inferred' : ''}` : ''}" title="Могу">✓</button><button data-slot="${slot.id}" data-response="limited" class="${ownAnswer.status === 'limited' ? `chosen ${ownAnswer.source === 'calendar' ? 'inferred' : ''}` : ''}" title="Возможно">~</button><button data-slot="${slot.id}" data-response="busy" class="${ownAnswer.status === 'busy' ? `chosen ${ownAnswer.source === 'calendar' ? 'inferred' : ''}` : ''}" title="Не могу">×</button></div><div class="response-legend">${ownAnswer.source === 'calendar' ? 'подтянуто из календаря · можно изменить' : 'могу · возможно · не могу'}</div></div>`
        : '<div class="slot-observer-note">Не ваш слот</div>';
    const dayStatus = state.availability[slot.date]?.status;
    const dayHint = ownSlot && dayStatus === 'busy' ? '<span class="slot-warning">В календаре отмечено: не могу</span>' : ownSlot && dayStatus === 'limited' ? '<span class="slot-warning">В календаре есть ограничения</span>' : '';
    return `<article class="slot-card ${!state.adminView && !ownSlot ? 'slot-card-foreign' : ''}"><div class="slot-when"><strong>${slot.from}</strong><span>${niceDate(slot.date)}<br>до ${slot.to}</span></div><div class="slot-info"><h3>${slot.title}</h3><p>${slot.place}</p><span class="slot-production">${slot.production}</span>${dayHint}</div>${action}</article>`;
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
  const pending = state.slots.filter(slot => slotParticipants(slot).some(profile => profile.id === state.firebaseUser?.uid) && effectiveSlotAnswer(slot, state.firebaseUser?.uid).status === 'none').length;
  $('#slotBadge').textContent = pending || state.slots.length;
  $('#slotBadge').title = pending ? `Неотвеченных слотов: ${pending}` : 'Все слоты отвечены';
}

function renderMatches() {
  if (!$('#matchList')) return;
  const ranked = state.slots.map(slot => {
    const participants = slotParticipants(slot);
    const responses = participants.map(profile => effectiveSlotAnswer(slot, profile.id)).filter(response => response.status !== 'none');
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
    const answer = effectiveSlotAnswer(slot, profile.id);
    const status = answer.status;
    const word = { free: 'может', limited: 'возможно', busy: 'не может', none: 'нет ответа' }[status];
    return `<div class="member-chip ${status}">${profile.name.split(' ')[0]} · ${word}${answer.source === 'calendar' ? ' · по дню' : ''}</div>`;
  }).join('')}</div></article>`).join('') : '<div class="empty-state">Пересечения появятся после создания слотов.</div>';
}

function renderAdminAvailabilityBoard() {
  const board = $('#adminAvailabilityBoard');
  const hints = $('#castFreeHints');
  if (!board || !hints || !isAdmin()) return;
  const dates = Array.from({ length: 14 }, (_, index) => iso(dateAt(index)));
  const participants = state.profiles.filter(profile => isParticipant(profile) && !profile.disabled);
  const statusFor = (userId, date) => state.allAvailability.find(item => item.userId === userId && item.date === date);
  const symbols = { free: '✓', limited: '~', busy: '×', none: '·' };
  const words = { free: 'свободен', limited: 'частично', busy: 'занят', none: 'не отмечено' };
  const timeToMinutes = value => {
    if (!value) return null;
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const minutesToTime = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const commonWindow = (group, date) => {
    let windows = [{ start: 0, end: 24 * 60 }];
    for (const profile of group) {
      const value = statusFor(profile.id, date);
      if (!value || value.status === 'busy' || value.status === 'none') return [];
      const personWindows = value.status === 'free'
        ? [{ start: 0, end: 24 * 60 }]
        : availabilityIntervals(value).map(interval => ({ start: timeToMinutes(interval.from) ?? 0, end: timeToMinutes(interval.to) ?? 24 * 60 })).filter(interval => interval.start < interval.end);
      if (!personWindows.length) return [];
      windows = windows.flatMap(window => personWindows.map(personWindow => ({
        start: Math.max(window.start, personWindow.start),
        end: Math.min(window.end, personWindow.end)
      })).filter(intersection => intersection.start < intersection.end));
      if (!windows.length) return [];
    }
    return windows;
  };
  const groups = [
    ...shows.map(show => ({ name: show.name, people: participants.filter(profile => (profile.shows || []).includes(show.name)) })),
    ...state.presets.map(preset => ({ name: preset.name, people: participants.filter(profile => (preset.participantIds || []).includes(profile.id)) }))
  ].filter(group => group.people.length);
  const intersections = [];
  groups.forEach(group => dates.forEach(date => {
    const windows = commonWindow(group.people, date);
    if (windows.length) intersections.push({ ...group, date, windows });
  }));
  hints.innerHTML = intersections.length ? intersections.map(item => {
    const fullDay = item.windows.length === 1 && item.windows[0].start === 0 && item.windows[0].end === 24 * 60;
    const range = fullDay ? 'весь день' : item.windows.map(window => `${minutesToTime(window.start)}–${minutesToTime(window.end)}`).join(' · ');
    return `<span class="${fullDay ? '' : 'time-overlap'}">✓ «${item.name}»: ${niceDate(item.date)}, ${range}</span>`;
  }).join('') : '<small>Подсказки появятся, когда у всего состава спектакля или пресета найдётся общее свободное время.</small>';
  board.innerHTML = participants.length ? `<table class="availability-board"><thead><tr><th>Участник</th>${dates.map(date => `<th>${ruDays[new Date(`${date}T12:00:00`).getDay()]}<b>${new Date(`${date}T12:00:00`).getDate()}</b></th>`).join('')}</tr></thead><tbody>${participants.map(profile => `<tr><th>${profile.name}</th>${dates.map(date => { const value = statusFor(profile.id, date); const status = value?.status || 'none'; const range = formatIntervals(value); return `<td class="board-${status}" title="${profile.name}: ${words[status]}${range ? `, ${range}` : ''}"><b>${symbols[status]}</b>${range ? `<small>${range}</small>` : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty-state">Зарегистрированных участников пока нет.</div>';
}

function renderEvents() {
  const orderedShows = [...shows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  $('#eventList').innerHTML = orderedShows.map(show => {
    const date = show.date ? new Date(`${show.date}T12:00:00`) : null;
    const cast = state.profiles.filter(profile => isParticipant(profile) && !profile.disabled && (profile.shows || []).includes(show.name));
    const statuses = date ? cast.map(profile => state.allAvailability.find(item => item.userId === profile.id && item.date === iso(date))?.status || 'none') : [];
    const unavailable = statuses.filter(status => status === 'busy').length;
    const marked = statuses.filter(status => status !== 'none').length;
    const availabilityText = unavailable
      ? `<span class="warning">${unavailable} ${unavailable === 1 ? 'участник не может' : 'участника не могут'}</span>`
      : cast.length ? `${marked}/${cast.length} отметили доступность` : 'Состав не назначен';
    const dateText = date ? `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}` : '—';
    const details = [show.time, show.place].filter(Boolean).join(' · ') || 'Дата и место не назначены';
    return `<article class="event-card"><div class="event-date">${dateText}</div><div class="event-main"><strong>${show.name}</strong><span>${details}</span></div><div class="event-meta">${availabilityText}</div></article>`;
  }).join('');
}

function renderShows() {
  const orderedShows = [...shows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  $('#showGrid').innerHTML = orderedShows.map((show, index) => {
    const cast = state.profiles.filter(profile => isParticipant(profile) && !profile.disabled && (profile.shows || []).includes(show.name));
    const showSlots = state.slots.filter(slot => slot.production === show.name);
    const displayDate = show.date ? niceDate(show.date) : 'дата не назначена';
    const avatars = cast.length ? cast.map(profile => profile.name.split(' ').map(part => part[0]).slice(0, 2).join('')) : show.cast || [];
    const castNames = cast.map(profile => profile.name).join(', ') || 'Состав пока не назначен';
    const details = [show.time, show.place].filter(Boolean).join(' · ') || 'Время и место не назначены';
    return `<article class="show-card"><span class="show-card-number">${String(index + 1).padStart(2, '0')} / ${displayDate}</span><h3>${show.name}</h3><p>${details}</p><div class="cast-avatars">${avatars.slice(0, 8).map(person => `<span>${person}</span>`).join('') || '<span>—</span>'}</div><p class="show-cast-names">${castNames}</p><div class="show-status"><span>Состав: ${cast.length || 0} человек</span><span>${showSlots.length} слотов</span></div>${state.adminView ? `<button class="secondary wide show-edit-action" data-edit-show="${show.name}">Состав и настройки</button>` : ''}</article>`;
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
  const castIds = new Set(state.profiles.filter(profile => isParticipant(profile) && (profile.shows || []).includes(showName)).map(profile => profile.id));
  const availableProfiles = state.profiles.filter(profile => profile.role !== 'admin' && !profile.claimedBy && !profile.disabled);
  $('#showCastEditor').innerHTML = availableProfiles.map(profile => `<label><input type="checkbox" value="${profile.id}" ${castIds.has(profile.id) ? 'checked' : ''}> <span>${profile.name}${profile.pending ? ' · заготовка' : ''}</span></label>`).join('') || '<div class="empty-state">Сначала добавьте участников.</div>';
  $('#showCastEditor').querySelectorAll('input').forEach(input => input.onchange = renderShowCastCount);
  $('#deleteShow').classList.toggle('hidden', !show);
  renderShowCastCount();
  $('#showModal').classList.remove('hidden');
}

function renderShowCastCount() {
  const count = $('#showCastEditor').querySelectorAll('input:checked').length;
  $('#showCastCount').textContent = `${count} выбрано`;
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
  const profiles = state.profiles.filter(profile => isParticipant(profile) && (state.filter === 'Все' || (profile.shows || []).includes(state.filter)));
  const newProfiles = state.profiles.filter(profile => profile.email && profile.role !== 'admin' && !profile.disabled && profile.setupComplete !== true && !(profile.shows || []).length);
  $('#newAccounts').classList.toggle('hidden', !newProfiles.length);
  $('#newAccounts').innerHTML = newProfiles.length ? `<div><strong>Новые аккаунты</strong><span>${newProfiles.length} ждут настройки</span></div><div class="new-account-list">${newProfiles.map(profile => `<button data-manage-user="${profile.id}"><b>${profile.name}</b><span>Назначить составы →</span></button>`).join('')}</div>` : '';
  $('#teamTable').innerHTML = profiles.map(profile => {
    const initials = profile.name.split(' ').map(part => part[0]).slice(0, 2).join('');
    const actions = state.adminView && profile.id !== state.profile?.id ? `<div class="member-actions"><button class="small-action" data-manage-user="${profile.id}">Управлять</button>${profile.disabled ? '<span class="access-status">Отключён</span>' : ''}</div>` : '';
    const days = Array.from({ length: 14 }, (_, index) => iso(dateAt(index)));
    const statuses = days.map(date => state.allAvailability.find(item => item.userId === profile.id && item.date === date)?.status || 'none');
    const marked = statuses.filter(status => status !== 'none').length;
    const busy = statuses.filter(status => status === 'busy').length;
    const availability = `<div class="availability-strip" title="Отмечено ${marked} из 14 дней">${statuses.map((status, index) => `<i class="${status}" title="${niceDate(days[index])}: ${{ free: 'свободен', limited: 'ограничения', busy: 'не может', none: 'нет ответа' }[status]}"></i>`).join('')}</div><small class="availability-caption">${marked}/14 отмечено${busy ? ` · ${busy} не может` : ''}</small>`;
    return `<tr class="${profile.disabled ? 'access-disabled' : ''}"><td><div class="person"><span class="mini-avatar">${initials}</span><span><strong>${profile.name}</strong><br><small>${profile.pending ? 'Заготовка' : profile.role === 'admin' ? 'Администратор' : 'Участник'}</small></span></div></td><td>${(profile.shows || []).join(', ') || 'Пока не назначен'}</td><td>${availability}</td><td class="admin-only">${actions}</td></tr>`;
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
  renderAdminAvailabilityBoard();
  renderEvents();
  renderShows();
  renderTeam();
  renderWeekBuilder();
  const now = new Date();
  $('#todayLabel').textContent = `${ruDays[now.getDay()]}, ${fmt(now)}`;
}

$('#loginButton').onclick = async () => {
  const button = $('#loginButton');
  setAuthMessage('login');
  setBusy(button, true);
  try {
    await authPersistenceReady;
    await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
  } catch (error) {
    setAuthMessage('login', readableError(error));
  } finally {
    setBusy(button, false);
  }
};

$('#loginPassword').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || $('#loginButton').disabled) return;
  event.preventDefault();
  $('#loginButton').click();
});

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

$('#registerButton').onclick = async () => {
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
  try { sessionStorage.setItem('sbor-show-guide', '1'); } catch (error) {}
  try {
    await authPersistenceReady;
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    await setDoc(doc(db, 'profiles', credential.user.uid), {
      name,
      email,
      role: 'member',
      shows: [],
      setupComplete: false,
      createdAt: serverTimestamp()
    }, { merge: true });
    setAuthMessage('register', 'Аккаунт создан. Открываем расписание…', true);
  } catch (error) {
    if (!auth.currentUser) {
      try { sessionStorage.removeItem('sbor-show-guide'); } catch (storageError) {}
    }
    setAuthMessage('register', readableError(error));
  } finally {
    setBusy(button, false);
  }
};

$('#registerPassword').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || $('#registerButton').disabled) return;
  event.preventDefault();
  $('#registerButton').click();
});

$('#logoutButton').onclick = async () => {
  await signOut(auth);
};

$('#openGuide').onclick = openGuide;
$('#closeGuide').onclick = closeGuide;
$$('[data-close-guide]').forEach(button => { button.onclick = closeGuide; });
$('#guideModal').onclick = event => {
  if (event.target.id === 'guideModal') closeGuide();
};

$('#openNotifications').onclick = openNotificationSettings;
$('#notifyReminders').onchange = () => $('#reminderLeadRow').classList.toggle('hidden', !$('#notifyReminders').checked);
$('#enableNotifications').onclick = async () => {
  if (!notificationsSupported()) return toast('Уведомления не поддерживаются этим браузером');
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    await notificationRegistration();
    browserNotification('Уведомления включены', '«Сбор» сообщит об изменениях расписания.', 'notifications-enabled');
  }
  openNotificationSettings();
};
$('#saveNotifications').onclick = () => {
  const saved = saveNotificationSettings({
    slotChanges: $('#notifySlotChanges').checked,
    reminders: $('#notifyReminders').checked,
    reminderLead: Number($('#notificationLead').value),
    adminActivity: isAdmin() && $('#notifyAdminActivity').checked
  });
  if (!saved) return toast('Браузер не разрешил сохранить настройки');
  $('#notificationModal').classList.add('hidden');
  checkSlotReminders();
  toast('Настройки уведомлений сохранены');
};
$$('[data-close-notifications]').forEach(button => { button.onclick = () => $('#notificationModal').classList.add('hidden'); });
$('#notificationModal').onclick = event => { if (event.target.id === 'notificationModal') event.currentTarget.classList.add('hidden'); };

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

$('#addSecondInterval').onclick = () => {
  $('#secondTimeFields').classList.remove('hidden');
  $('#addSecondInterval').classList.add('hidden');
  $('#timeFrom2').focus();
};

$('#removeSecondInterval').onclick = () => {
  $('#timeFrom2').value = '';
  $('#timeTo2').value = '';
  $('#secondTimeFields').classList.add('hidden');
  $('#addSecondInterval').classList.remove('hidden');
};

$('#saveDay').onclick = async () => {
  if (!state.selectedStatus) {
    toast('Выберите статус');
    return;
  }
  const intervals = state.selectedStatus === 'limited'
    ? [{ from: $('#timeFrom').value, to: $('#timeTo').value }, ...($('#secondTimeFields').classList.contains('hidden') ? [] : [{ from: $('#timeFrom2').value, to: $('#timeTo2').value }])].filter(interval => interval.from || interval.to)
    : [];
  const value = {
    status: state.selectedStatus,
    ...(state.selectedStatus === 'limited' ? { from: intervals[0]?.from || '', to: intervals[0]?.to || '', intervals } : {})
  };
  try {
    await saveAvailability(state.selectedDate, value);
    if (state.selectedStatus === 'limited') rememberLimitedRange(intervals);
    if (state.localMode) renderCalendar();
    $('#dayModal').classList.add('hidden');
    toast();
  } catch (error) {
    toast(readableError(error));
  }
};

$('#openProfile').onclick = () => {
  $('#profileNameInput').value = currentName();
  $('#profileModal').classList.remove('hidden');
  setTimeout(() => $('#profileNameInput').focus(), 50);
};

$('#saveProfileName').onclick = async () => {
  const name = $('#profileNameInput').value.trim();
  if (name.length < 2) return toast('Никнейм должен быть не короче двух символов');
  try {
    if (state.localMode) {
      state.profile.name = name;
      state.profiles = state.profiles.map(profile => profile.id === state.profile.id ? { ...profile, name } : profile);
      persistLocalFallback();
    } else {
      await setDoc(doc(db, 'profiles', state.firebaseUser.uid), { name }, { merge: true });
    }
    state.profile.name = name;
    applyUser();
    $('#profileModal').classList.add('hidden');
    toast('Никнейм сохранён');
  } catch (error) { toast(readableError(error)); }
};

$$('[data-close-profile]').forEach(button => button.onclick = () => $('#profileModal').classList.add('hidden'));
$('#profileModal').onclick = event => { if (event.target.id === 'profileModal') event.currentTarget.classList.add('hidden'); };

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
        intervals: availabilityIntervals(source),
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

$('#exportWeek').onclick = async () => {
  if (!state.slots.some(slot => currentBuilderWeekKeys().includes(slot.date))) {
    toast('На выбранной неделе пока нет блоков');
    return;
  }
  try {
    await copyText(exportedWeekText());
    toast('Расписание недели скопировано');
  } catch (error) {
    toast('Не удалось скопировать — попробуйте ещё раз');
  }
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
  const selectedPeople = slot ? slotParticipants(slot).map(profile => profile.id) : [];
  $('#slotPeople').innerHTML = state.profiles
    .filter(profile => profile.role !== 'admin' && !profile.disabled)
    .map(profile => `<label><input type="checkbox" value="${profile.id}" ${selectedPeople.includes(profile.id) ? 'checked' : ''}> ${profile.name}</label>`)
    .join('');
  $('#slotPeople').querySelectorAll('input').forEach(input => input.onchange = renderSlotPeopleCount);
  $('#slotProduction').onchange = () => {
    if (!slot) selectProductionCast('#slotPeople', $('#slotProduction').value, renderSlotPeopleCount);
  };
  if (!slot && $('#slotProduction').value !== 'Общее') selectProductionCast('#slotPeople', $('#slotProduction').value, renderSlotPeopleCount);
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
      participantIdsOverridden: true,
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
  const selectedCastIds = new Set([...$('#showCastEditor').querySelectorAll('input:checked')].map(input => input.value));
  const managedProfiles = state.profiles.filter(profile => profile.role !== 'admin' && !profile.claimedBy);
  const updatedShows = profile => {
    const withoutCurrent = (profile.shows || []).filter(item => item !== oldName && item !== name);
    return selectedCastIds.has(profile.id) ? [...withoutCurrent, name] : withoutCurrent;
  };
  try {
    if (state.localMode) {
      if (oldName) {
        shows = shows.map(show => show.name === oldName ? { ...show, ...showData } : show);
        state.profiles = state.profiles.map(profile => ({ ...profile, shows: (profile.shows || []).map(item => item === oldName ? name : item) }));
        state.slots = state.slots.map(slot => slot.production === oldName ? { ...slot, production: name } : slot);
      } else {
        shows.push(showData);
      }
      state.profiles = state.profiles.map(profile => managedProfiles.some(item => item.id === profile.id) ? { ...profile, shows: updatedShows(profile), ...(profile.email ? { setupComplete: true } : {}) } : profile);
      persistLocalFallback();
      renderAll();
    } else {
      const batch = writeBatch(db);
      batch.set(doc(db, 'shows', id), showData, { merge: true });
      managedProfiles.forEach(profile => {
        const nextShows = updatedShows(profile);
        if (JSON.stringify(nextShows) !== JSON.stringify(profile.shows || [])) {
          batch.set(doc(db, 'profiles', profile.id), { shows: nextShows, ...(profile.email ? { setupComplete: true } : {}) }, { merge: true });
        }
      });
      if (oldName && oldName !== name) {
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

$('#selectAllShowCast').onclick = () => {
  $('#showCastEditor').querySelectorAll('input').forEach(input => { input.checked = true; });
  renderShowCastCount();
};

$('#clearShowCast').onclick = () => {
  $('#showCastEditor').querySelectorAll('input').forEach(input => { input.checked = false; });
  renderShowCastCount();
};

$('#deleteShow').onclick = async () => {
  const showName = $('#showModal').dataset.showName;
  const show = shows.find(item => item.name === showName);
  if (!show || !confirm(`Удалить спектакль «${showName}»? Его слоты останутся как общие.`)) return;
  try {
    if (state.localMode) {
      shows = shows.filter(item => item.id !== show.id);
      state.profiles = state.profiles.map(profile => ({ ...profile, shows: (profile.shows || []).filter(item => item !== showName) }));
      state.slots = state.slots.map(slot => slot.production === showName ? { ...slot, production: 'Общее' } : slot);
      persistLocalFallback();
      renderAll();
    } else {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'shows', show.id));
      state.profiles.filter(profile => (profile.shows || []).includes(showName)).forEach(profile => batch.set(doc(db, 'profiles', profile.id), { shows: profile.shows.filter(item => item !== showName) }, { merge: true }));
      state.slots.filter(slot => slot.production === showName).forEach(slot => batch.set(doc(db, 'slots', slot.id), { production: 'Общее' }, { merge: true }));
      await batch.commit();
    }
    $('#showModal').classList.add('hidden');
    toast('Спектакль удалён');
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
        if (profile.id === userId) return { ...profile, shows: showsForUser, pending: false, setupComplete: true, linkedDraftId: draftId };
        if (profile.id === draftId) return { ...profile, pending: false, disabled: true, claimedBy: userId };
        return profile;
      });
      state.slots = state.slots.map(slot => ({ ...slot, participantIds: (slot.participantIds || []).map(id => id === draftId ? userId : id) }));
      state.presets = state.presets.map(preset => ({ ...preset, participantIds: (preset.participantIds || []).map(id => id === draftId ? userId : id) }));
      persistLocalFallback();
      renderAll();
    } else {
      const batch = writeBatch(db);
      batch.set(doc(db, 'profiles', userId), { shows: showsForUser, pending: false, setupComplete: true, linkedDraftId: draftId }, { merge: true });
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
    await saveManagedProfile(userId, { shows: showsForUser, setupComplete: true });
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
  clearInterval(state.reminderTimer);
  state.reminderTimer = null;
  state.firebaseUser = user;
  state.profile = null;
  state.profiles = [];
  state.availability = {};
  state.allAvailability = [];
  state.slots = [];
  state.responses = [];
  state.localMode = false;
  state.seedingPresets = false;
  state.seedingShows = false;
  state.seedingDrafts = false;
  state.cloudMigrationStarted = false;
  state.notificationSnapshots = { slots: false, availability: false, responses: false };
  if (!user) {
    showAuth();
    return;
  }
  try {
    state.profile = await ensureProfile(user);
    if (state.profile.disabled) {
      toast('Доступ к сайту отключён администратором');
      await signOut(auth);
      return;
    }
    showApp();
    subscribeToData();
    state.reminderTimer = setInterval(checkSlotReminders, 5 * 60 * 1000);
  } catch (error) {
    loadLocalFallback(user);
    showApp();
    renderAll();
    toast('Облачная база закрыта — работает локальный режим');
  }
});

notificationRegistration();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.firebaseUser) checkSlotReminders();
});

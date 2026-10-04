/* =========================================================
   Słoik – synchronizacja wspólnego słoika przez Firebase.
   Ładowany tylko wtedy, gdy włączysz tryb „Razem”.
   Struktura w bazie:
     rooms/{kod}/members/{osoba}  -> { name, joinedAt }
     rooms/{kod}/balls/{kulka}    -> { id, date, ts, color, note, who }
   ========================================================= */
import {
  initializeApp, getAuth, signInAnonymously, onAuthStateChanged,
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  collection, doc, setDoc, deleteDoc, writeBatch, query, where, onSnapshot, getDocs,
} from './vendor/firebase.js';
import config from './firebase-config.js';

let app = null, db = null, auth = null, readyPromise = null;
let reportError = () => {};

export function isConfigured() {
  return !!(config && config.apiKey && config.projectId);
}

function init() {
  if (app) return;
  app = initializeApp(config);
  // lokalna kopia bazy na telefonie -> działa też offline
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  });
  auth = getAuth(app);
  // anonimowe „konto” – bez maila i hasła, tylko po to, żeby baza wpuściła
  readyPromise = new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => { if (user) resolve(user); });
  });
  const trySignIn = () => {
    if (auth.currentUser) return;
    signInAnonymously(auth).catch((e) => {
      // brak internetu to nie błąd – spróbujemy, gdy wróci sieć
      if (e && e.code !== 'auth/network-request-failed') reportError(e.code || e.message);
    });
  };
  onAuthStateChanged(auth, (user) => { if (!user) trySignIn(); });
  window.addEventListener('online', trySignIn);
}

const clean = (b, who) => ({
  id: b.id, date: b.date, ts: b.ts, color: b.color, note: (b.note || '').slice(0, 120), who,
});

const fromSnap = (snap) => snap.docs.map((d) => d.data());

export async function connect(room, me, onError) {
  if (onError) reportError = onError;
  init();
  const balls = collection(db, 'rooms', room, 'balls');
  const members = collection(db, 'rooms', room, 'members');
  const unsubs = [];

  const api = {
    ready: () => readyPromise,

    async setMember(name) {
      await readyPromise;
      await setDoc(doc(members, me), { name: String(name).slice(0, 30), joinedAt: Date.now() });
    },

    async pushBall(b) {
      await readyPromise;
      await setDoc(doc(balls, b.id), clean(b, me));
    },

    async removeBall(id) {
      await readyPromise;
      await deleteDoc(doc(balls, id));
    },

    async pushMany(list) {
      await readyPromise;
      for (let i = 0; i < list.length; i += 400) {
        const batch = writeBatch(db);
        for (const b of list.slice(i, i + 400)) batch.set(doc(balls, b.id), clean(b, me));
        await batch.commit();
      }
    },

    // na żywo: wszystkie kulki z danego dnia (moje i drugiej osoby)
    watchDay(dateKey, cb) {
      let first = true, unsub = null, stopped = false;
      readyPromise.then(() => {
        if (stopped) return;
        unsub = onSnapshot(query(balls, where('date', '==', dateKey)), (snap) => {
          const changes = snap.docChanges().map((c) => ({ type: c.type, ball: c.doc.data() }));
          cb(fromSnap(snap), changes, first);
          first = false;
        }, (err) => reportError(err.code || err.message));
      });
      const stop = () => { stopped = true; if (unsub) unsub(); };
      unsubs.push(stop);
      return stop;
    },

    watchMembers(cb) {
      let unsub = null, stopped = false;
      readyPromise.then(() => {
        if (stopped) return;
        unsub = onSnapshot(members, (snap) => {
          cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }, (err) => reportError(err.code || err.message));
      });
      const stop = () => { stopped = true; if (unsub) unsub(); };
      unsubs.push(stop);
      return stop;
    },

    async range(from, to) {
      await readyPromise;
      return fromSnap(await getDocs(query(balls, where('date', '>=', from), where('date', '<=', to))));
    },

    close() { unsubs.splice(0).forEach((f) => f()); },
  };
  return api;
}

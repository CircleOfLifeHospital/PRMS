import {
  auth, db,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup,
  collection, addDoc, getDocs, getDoc,
  query, where, orderBy, serverTimestamp,
  doc, updateDoc, deleteDoc, onSnapshot, setDoc
} from './firebase-init.js';

/* ══════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════ */
const page = location.pathname.split('/').pop() || 'index.html';
const $ = id => document.getElementById(id);

function showErr(id, msg) {
  const el = $(id); if (!el) return;
  el.textContent = msg; el.classList.add('show');
}
function hideErr(id) { const el=$(id); if(el) el.classList.remove('show'); }
function showSuccess(id) {
  const el=$(id); if(!el) return;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 3500);
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-AU', {day:'2-digit',month:'short',year:'numeric'});
}

function initTheme() {
  const toggle = $('themeToggle'); if (!toggle) return;
  const apply = t => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
    const label = $('themeLabel');
    toggle.innerHTML = t === 'dark' ? '☀️ <span id="themeLabel">Light Mode</span>' : '🌙 <span id="themeLabel">Dark Mode</span>';
  };
  apply(localStorage.getItem('theme') || 'light');
  toggle.addEventListener('click', () => apply(
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  ));
}

/* Tab navigation for dashboards */
function initTabs() {
  const tabs = document.querySelectorAll('.tab-nav a[data-tab]');
  const panels = document.querySelectorAll('.tab-panel');
  if (!tabs.length) return;
  tabs.forEach(tab => {
    tab.addEventListener('click', e => {
      e.preventDefault();
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.tab);
      if (target) target.classList.add('active');
    });
  });
}

/* Simple search filter for tables */
function filterTable(inputId, bodyId) {
  const input = $(inputId), tbody = $(bodyId);
  if (!input || !tbody) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    tbody.querySelectorAll('tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

/* ══════════════════════════════════════════════════════════
   GOOGLE SIGN-IN HELPER
   ══════════════════════════════════════════════════════════ */
async function googleSignIn(expectedRole, redirectUrl) {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    // Check if user doc exists
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      const data = snap.data();
      if (data.role !== expectedRole) {
        await signOut(auth);
        showErr('errorMsg', `This Google account is registered as a ${data.role}, not a ${expectedRole}.`);
        return;
      }
      location.href = redirectUrl;
    } else {
      // Auto-create patient account via Google
      if (expectedRole === 'patient') {
        await setDoc(doc(db, 'users', user.uid), {
          name: user.displayName || 'Patient',
          email: user.email,
          role: 'patient',
          createdAt: serverTimestamp()
        });
        await addDoc(collection(db, 'patients'), {
          uid: user.uid,
          name: user.displayName || '',
          email: user.email,
          dob: '', medicare: '', contact: '', address: '',
          createdAt: serverTimestamp()
        });
        location.href = redirectUrl;
      } else {
        await signOut(auth);
        showErr('errorMsg', 'No account found for this Google account. Please contact your administrator.');
      }
    }
  } catch(err) {
    showErr('errorMsg', err.message);
  }
}

/* ══════════════════════════════════════════════════════════
   LOGIN PAGES
   ══════════════════════════════════════════════════════════ */
async function handleLogin(role, redirect) {
  const emailEl = $('email'), passEl = $('password'), btn = $('loginBtn');
  if (!emailEl) return;

  hideErr('errorMsg');

  async function doLogin() {
    const email = emailEl.value.trim(), pass = passEl.value;
    if (!email || !pass) { showErr('errorMsg', 'Please enter your email and password.'); return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      // Verify role
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      if (snap.exists() && snap.data().role !== role) {
        await signOut(auth);
        showErr('errorMsg', `This account is not registered as a ${role}.`);
        btn.disabled = false; btn.textContent = 'Sign In'; return;
      }
      location.href = redirect;
    } catch(err) {
      const msgs = {
        'auth/invalid-credential': 'Incorrect email or password.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/too-many-requests': 'Too many attempts. Try again later.',
      };
      showErr('errorMsg', msgs[err.code] || err.message);
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  }

  btn.addEventListener('click', doLogin);

  // *** Enter key to submit ***
  [emailEl, passEl].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  });

  // Google button
  const gBtn = $('googleBtn');
  if (gBtn) {
    gBtn.addEventListener('click', () => googleSignIn(role, redirect));
  }
}

/* ══════════════════════════════════════════════════════════
   DASHBOARD AUTH GUARD + LOGOUT
   ══════════════════════════════════════════════════════════ */
async function requireAuth(expectedRole, loginPage) {
  return new Promise(resolve => {
    onAuthStateChanged(auth, async user => {
      if (!user) { location.href = loginPage; return; }
      const snap = await getDoc(doc(db, 'users', user.uid));
      const data = snap.exists() ? snap.data() : null;
      if (!data || data.role !== expectedRole) { location.href = loginPage; return; }

      // Populate sidebar user info
      const nameEl = $('userName');
      if (nameEl) nameEl.textContent = data.name || user.email;
      const avatarEl = $('userAvatar');
      if (avatarEl) avatarEl.textContent = (data.name || user.email || 'U')[0].toUpperCase();

      const logoutBtn = $('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          await signOut(auth);
          location.href = loginPage;
        });
      }

      resolve({ user, data });
    });
  });
}

/* ══════════════════════════════════════════════════════════
   ADMIN DASHBOARD
   ══════════════════════════════════════════════════════════ */
async function initAdminDashboard() {
  await requireAuth('admin', 'admin-login.html');
  initTheme(); initTabs();

  // Stats
  async function loadStats() {
    const [patSnap, staffSnap, recSnap, logSnap] = await Promise.all([
      getDocs(collection(db, 'patients')),
      getDocs(query(collection(db, 'users'), where('role', '!=', 'patient'))),
      getDocs(collection(db, 'records')),
      getDocs(collection(db, 'accessLog'))
    ]);
    if($('statPatients')) $('statPatients').textContent = patSnap.size;
    if($('statStaff'))    $('statStaff').textContent    = staffSnap.size;
    if($('statRecords'))  $('statRecords').textContent  = recSnap.size;
    if($('statLogs'))     $('statLogs').textContent     = logSnap.size;
  }
  loadStats();

  // Staff table — realtime
  const staffBody = $('staffBody');
  if (staffBody) {
    onSnapshot(query(collection(db, 'users'), where('role', '!=', 'patient')), snap => {
      if (snap.empty) { staffBody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">👥</div><p>No staff accounts found.</p></div></td></tr>'; return; }
      staffBody.innerHTML = snap.docs.map(d => {
        const s = d.data();
        return `<tr>
          <td>${s.name||'—'}</td>
          <td>${s.email||'—'}</td>
          <td><span class="badge badge-${s.role}">${s.role||'—'}</span></td>
          <td>${s.department||'—'}</td>
        </tr>`;
      }).join('');
    });
    filterTable('staffSearch', 'staffBody');
  }

  // Patients table — realtime
  const patientsBody = $('patientsBody');
  if (patientsBody) {
    onSnapshot(collection(db, 'patients'), snap => {
      if (snap.empty) { patientsBody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🧑‍⚕️</div><p>No patients registered.</p></div></td></tr>'; return; }
      patientsBody.innerHTML = snap.docs.map(d => {
        const p = d.data();
        return `<tr>
          <td><code>${d.id.slice(0,8)}</code></td>
          <td>${p.name||'—'}</td>
          <td>${p.email||'—'}</td>
          <td>${p.dob||'—'}</td>
          <td>${p.medicare||'—'}</td>
          <td>${p.contact||'—'}</td>
        </tr>`;
      }).join('');
    });
    filterTable('patientSearch', 'patientsBody');
  }

  // Access log — realtime
  const logBody = $('logBody');
  if (logBody) {
    onSnapshot(query(collection(db, 'accessLog'), orderBy('timestamp','desc')), snap => {
      if (snap.empty) { logBody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">🔍</div><p>No log entries yet.</p></div></td></tr>'; return; }
      logBody.innerHTML = snap.docs.map(d => {
        const l = d.data();
        return `<tr><td>${fmtDate(l.timestamp)}</td><td>${l.patientId||'—'}</td><td>${l.staffId||'—'}</td><td>${l.action||'—'}</td></tr>`;
      }).join('');
    });
  }

  // Add Staff
  const saveStaffBtn = $('saveStaffBtn');
  if (saveStaffBtn) {
    saveStaffBtn.addEventListener('click', async () => {
      const name=$('sName').value.trim(), email=$('sEmail').value.trim(),
            role=$('sRole').value, dept=$('sDept').value.trim();
      if (!name||!email||!role) { showErr('staffError','Please fill all required fields.'); return; }
      hideErr('staffError');
      saveStaffBtn.disabled = true;
      try {
        // Create auth user — password = email prefix + "123" as default
        const tmpPass = email.split('@')[0] + 'Colh123!';
        const cred = await createUserWithEmailAndPassword(auth, email, tmpPass);
        await setDoc(doc(db, 'users', cred.user.uid), {
          name, email, role, department: dept, createdAt: serverTimestamp()
        });
        await addDoc(collection(db, 'accessLog'), { action: `Staff created: ${name}`, staffId: cred.user.uid, patientId: '—', timestamp: serverTimestamp() });
        showSuccess('staffSuccess');
        ['sName','sEmail','sDept'].forEach(id => $(id) && ($(id).value=''));
        $('sRole').value = '';
        loadStats();
      } catch(err) {
        showErr('staffError', err.message);
      }
      saveStaffBtn.disabled = false;
    });
  }

  // Register Patient (admin)
  const savePatientBtn = $('savePatientBtn');
  if (savePatientBtn) {
    savePatientBtn.addEventListener('click', async () => {
      const name=$('rpName').value.trim(), email=$('rpEmail').value.trim(),
            dob=$('rpDOB').value, medicare=$('rpMedicare').value.trim(),
            contact=$('rpContact').value.trim(), address=$('rpAddress').value.trim();
      if (!name||!email) { showErr('patientRegError','Name and email are required.'); return; }
      hideErr('patientRegError');
      savePatientBtn.disabled = true;
      try {
        const tmpPass = email.split('@')[0] + 'Patient123!';
        const cred = await createUserWithEmailAndPassword(auth, email, tmpPass);
        await setDoc(doc(db, 'users', cred.user.uid), {
          name, email, role: 'patient', createdAt: serverTimestamp()
        });
        await addDoc(collection(db, 'patients'), {
          uid: cred.user.uid, name, email, dob, medicare, contact, address,
          createdAt: serverTimestamp()
        });
        await addDoc(collection(db, 'accessLog'), { action: `Patient registered: ${name}`, staffId: 'admin', patientId: cred.user.uid, timestamp: serverTimestamp() });
        showSuccess('patientRegSuccess');
        ['rpName','rpEmail','rpDOB','rpMedicare','rpContact','rpAddress'].forEach(id => $(id) && ($(id).value=''));
        loadStats();
      } catch(err) {
        showErr('patientRegError', err.message);
      }
      savePatientBtn.disabled = false;
    });
  }
}

/* ══════════════════════════════════════════════════════════
   DOCTOR DASHBOARD
   ══════════════════════════════════════════════════════════ */
async function initDoctorDashboard() {
  const { user } = await requireAuth('doctor', 'doctor-login.html');
  initTheme(); initTabs();

  // Patients — realtime
  const pBody = $('patientsBody');
  if (pBody) {
    onSnapshot(collection(db, 'patients'), snap => {
      if (snap.empty) { pBody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">🧑‍⚕️</div><p>No patients yet.</p></div></td></tr>'; return; }
      pBody.innerHTML = snap.docs.map(d => {
        const p = d.data();
        return `<tr>
          <td><code>${d.id.slice(0,8)}</code></td>
          <td>${p.name||'—'}</td>
          <td>${p.dob||'—'}</td>
          <td>${p.medicare||'—'}</td>
          <td>${p.contact||'—'}</td>
        </tr>`;
      }).join('');
    });
    filterTable('patientSearch', 'patientsBody');
  }

  // Records — realtime
  const rBody = $('recordsBody');
  if (rBody) {
    onSnapshot(query(collection(db, 'records'), orderBy('date','desc')), snap => {
      if (snap.empty) { rBody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📋</div><p>No records yet.</p></div></td></tr>'; return; }
      rBody.innerHTML = snap.docs.map(d => {
        const r = d.data();
        return `<tr>
          <td><code>${(r.patientId||'').slice(0,8)}</code></td>
          <td>${r.patientName||'—'}</td>
          <td>${r.date||'—'}</td>
          <td>${r.diagnosis||'—'}</td>
          <td>${r.treatment||'—'}</td>
          <td>${r.notes||'—'}</td>
        </tr>`;
      }).join('');
    });
    filterTable('recordSearch', 'recordsBody');
  }

  // Prescriptions — realtime
  const presBody = $('prescriptionsBody');
  if (presBody) {
    onSnapshot(query(collection(db, 'prescriptions'), orderBy('startDate','desc')), snap => {
      if (snap.empty) { presBody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">💊</div><p>No prescriptions yet.</p></div></td></tr>'; return; }
      presBody.innerHTML = snap.docs.map(d => {
        const p = d.data();
        return `<tr>
          <td><code>${(p.patientId||'').slice(0,8)}</code></td>
          <td>${p.patientName||'—'}</td>
          <td>${p.medName||'—'}</td>
          <td>${p.dosage||'—'}</td>
          <td>${p.frequency||'—'}</td>
          <td>${p.startDate||'—'}</td>
        </tr>`;
      }).join('');
    });
    filterTable('presSearch', 'prescriptionsBody');
  }

  // Appointments
  const apptBody = $('apptBody');
  if (apptBody) {
    onSnapshot(query(collection(db, 'appointments'), orderBy('date','desc')), snap => {
      if (snap.empty) { apptBody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📅</div><p>No appointments yet.</p></div></td></tr>'; return; }
      apptBody.innerHTML = snap.docs.map(d => {
        const a = d.data();
        return `<tr>
          <td>${a.patientName||'—'}</td>
          <td>${a.date||'—'}</td>
          <td>${a.time||'—'}</td>
          <td>${a.purpose||'—'}</td>
          <td><span class="pill">${a.status||'scheduled'}</span></td>
        </tr>`;
      }).join('');
    });
  }

  // Patient ID autocomplete helper
  async function resolvePatient(idInputId, nameDisplayId) {
    // We'll search patients by ID prefix or name
  }

  // Save diagnosis
  const saveDiagBtn = $('saveDiagnosisBtn');
  if (saveDiagBtn) {
    saveDiagBtn.addEventListener('click', async () => {
      const patientId=$('dPatientId').value.trim(), date=$('dDate').value,
            diagnosis=$('dDiagnosis').value.trim(), treatment=$('dTreatment').value.trim(),
            notes=$('dNotes').value.trim();
      if (!patientId||!diagnosis) { showErr('diagnosisError','Patient ID and Diagnosis are required.'); return; }
      hideErr('diagnosisError');
      saveDiagBtn.disabled = true;
      try {
        // Try to get patient name
        let patientName = patientId;
        const pSnap = await getDocs(query(collection(db,'patients'), where('uid','==',patientId)));
        if (!pSnap.empty) patientName = pSnap.docs[0].data().name || patientId;

        await addDoc(collection(db, 'records'), {
          patientId, patientName, date, diagnosis, treatment, notes,
          doctorId: (await auth.currentUser).uid,
          createdAt: serverTimestamp()
        });
        await addDoc(collection(db, 'accessLog'), {
          action: `Diagnosis added: ${diagnosis}`, staffId: (await auth.currentUser).uid,
          patientId, timestamp: serverTimestamp()
        });
        showSuccess('diagnosisSuccess');
        ['dPatientId','dDate','dDiagnosis','dTreatment','dNotes'].forEach(id => $(id) && ($(id).value=''));
      } catch(err) { showErr('diagnosisError', err.message); }
      saveDiagBtn.disabled = false;
    });
  }

  // Save prescription — realtime push
  const savePresBtn = $('savePrescriptionBtn');
  if (savePresBtn) {
    savePresBtn.addEventListener('click', async () => {
      const patientId=$('pPatientId').value.trim(), medName=$('pMedName').value.trim(),
            dosage=$('pDosage').value.trim(), frequency=$('pFrequency').value.trim(),
            startDate=$('pStartDate').value;
      if (!patientId||!medName) { showErr('prescriptionError','Patient ID and Medication are required.'); return; }
      hideErr('prescriptionError');
      savePresBtn.disabled = true;
      try {
        let patientName = patientId;
        const pSnap = await getDocs(query(collection(db,'patients'), where('uid','==',patientId)));
        if (!pSnap.empty) patientName = pSnap.docs[0].data().name || patientId;

        await addDoc(collection(db, 'prescriptions'), {
          patientId, patientName, medName, dosage, frequency, startDate,
          doctorId: auth.currentUser.uid,
          createdAt: serverTimestamp()
        });
        showSuccess('prescriptionSuccess');
        ['pPatientId','pMedName','pDosage','pFrequency','pStartDate'].forEach(id => $(id) && ($(id).value=''));
      } catch(err) { showErr('prescriptionError', err.message); }
      savePresBtn.disabled = false;
    });
  }

  // Save appointment
  const saveApptBtn = $('saveApptBtn');
  if (saveApptBtn) {
    saveApptBtn.addEventListener('click', async () => {
      const patientId=$('aPatientId').value.trim(), date=$('aDate').value,
            time=$('aTime').value, purpose=$('aPurpose').value.trim(),
            location=$('aLocation').value.trim();
      if (!patientId||!date||!purpose) { showErr('apptError','Patient ID, date, and purpose are required.'); return; }
      hideErr('apptError');
      saveApptBtn.disabled = true;
      try {
        let patientName = patientId;
        const pSnap = await getDocs(query(collection(db,'patients'), where('uid','==',patientId)));
        if (!pSnap.empty) patientName = pSnap.docs[0].data().name || patientId;

        await addDoc(collection(db, 'appointments'), {
          patientId, patientName, date, time, purpose, location: location||'Main Clinic',
          status: 'scheduled', createdAt: serverTimestamp()
        });
        showSuccess('apptSuccess');
        ['aPatientId','aDate','aTime','aPurpose','aLocation'].forEach(id => $(id) && ($(id).value=''));
      } catch(err) { showErr('apptError', err.message); }
      saveApptBtn.disabled = false;
    });
  }
}

/* ══════════════════════════════════════════════════════════
   NURSE DASHBOARD
   ══════════════════════════════════════════════════════════ */
async function initNurseDashboard() {
  await requireAuth('nurse', 'nurse-login.html');
  initTheme(); initTabs();

  // Patients
  const pBody = $('patientsBody');
  if (pBody) {
    onSnapshot(collection(db, 'patients'), snap => {
      if (snap.empty) { pBody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🧑‍⚕️</div><p>No patients yet.</p></div></td></tr>'; return; }
      pBody.innerHTML = snap.docs.map(d => {
        const p = d.data();
        return `<tr><td><code>${d.id.slice(0,8)}</code></td><td>${p.name||'—'}</td><td>${p.dob||'—'}</td><td>${p.medicare||'—'}</td><td>${p.contact||'—'}</td><td>${p.address||'—'}</td></tr>`;
      }).join('');
    });
    filterTable('patientSearch', 'patientsBody');
  }

  // Vitals log — realtime
  const vLog = $('vitalsLogBody');
  if (vLog) {
    onSnapshot(query(collection(db, 'vitals'), orderBy('date','desc')), snap => {
      if (snap.empty) { vLog.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📊</div><p>No vitals recorded.</p></div></td></tr>'; return; }
      vLog.innerHTML = snap.docs.map(d => {
        const v = d.data();
        return `<tr><td>${v.patientName||v.patientId||'—'}</td><td>${v.date||'—'}</td><td>${v.bp||'—'}</td><td>${v.hr||'—'}</td><td>${v.temp||'—'}</td><td>${v.weight||'—'}</td></tr>`;
      }).join('');
    });
  }

  // Save vitals
  const saveVBtn = $('saveVitalsBtn');
  if (saveVBtn) {
    saveVBtn.addEventListener('click', async () => {
      const patientId=$('vPatientId').value.trim(), date=$('vDate').value,
            bp=$('vBP').value.trim(), hr=$('vHR').value, temp=$('vTemp').value, weight=$('vWeight').value;
      if (!patientId) { showErr('vitalsError','Patient ID is required.'); return; }
      hideErr('vitalsError'); saveVBtn.disabled = true;
      try {
        let patientName = patientId;
        const pSnap = await getDocs(query(collection(db,'patients'), where('uid','==',patientId)));
        if (!pSnap.empty) patientName = pSnap.docs[0].data().name || patientId;

        await addDoc(collection(db, 'vitals'), {
          patientId, patientName, date, bp, hr: Number(hr), temp: Number(temp), weight: Number(weight),
          nurseId: auth.currentUser.uid, createdAt: serverTimestamp()
        });
        showSuccess('vitalsSuccess');
        ['vPatientId','vDate','vBP','vHR','vTemp','vWeight'].forEach(id => $(id) && ($(id).value=''));
      } catch(err) { showErr('vitalsError', err.message); }
      saveVBtn.disabled = false;
    });
  }

  // Save nursing note
  const saveNBtn = $('saveNoteBtn');
  if (saveNBtn) {
    saveNBtn.addEventListener('click', async () => {
      const patientId=$('nPatientId').value.trim(), date=$('nDate').value, note=$('nNote').value.trim();
      if (!patientId||!note) { showErr('noteError','Patient ID and note are required.'); return; }
      hideErr('noteError'); saveNBtn.disabled = true;
      try {
        let patientName = patientId;
        const pSnap = await getDocs(query(collection(db,'patients'), where('uid','==',patientId)));
        if (!pSnap.empty) patientName = pSnap.docs[0].data().name || patientId;

        await addDoc(collection(db, 'nursingNotes'), {
          patientId, patientName, date, note,
          nurseId: auth.currentUser.uid, createdAt: serverTimestamp()
        });
        showSuccess('noteSuccess');
        ['nPatientId','nDate','nNote'].forEach(id => $(id) && ($(id).value=''));
      } catch(err) { showErr('noteError', err.message); }
      saveNBtn.disabled = false;
    });
  }
}

/* ══════════════════════════════════════════════════════════
   PATIENT DASHBOARD
   ══════════════════════════════════════════════════════════ */
async function initPatientDashboard() {
  const { user } = await requireAuth('patient', 'patient-login.html');
  initTheme(); initTabs();

  // Get patient doc
  let patientDoc = null;
  const pSnap = await getDocs(query(collection(db, 'patients'), where('uid', '==', user.uid)));
  if (!pSnap.empty) patientDoc = { id: pSnap.docs[0].id, ...pSnap.docs[0].data() };

  // Personal details
  const personalGrid = $('personalGrid');
  if (personalGrid && patientDoc) {
    personalGrid.innerHTML = `
      <div class="info-item"><div class="label">Full Name</div><div class="value">${patientDoc.name||'—'}</div></div>
      <div class="info-item"><div class="label">Date of Birth</div><div class="value">${patientDoc.dob||'—'}</div></div>
      <div class="info-item"><div class="label">Email</div><div class="value">${patientDoc.email||'—'}</div></div>
      <div class="info-item"><div class="label">Medicare No.</div><div class="value">${patientDoc.medicare||'—'}</div></div>
      <div class="info-item"><div class="label">Contact</div><div class="value">${patientDoc.contact||'—'}</div></div>
      <div class="info-item"><div class="label">Address</div><div class="value">${patientDoc.address||'—'}</div></div>
    `;
  }

  // Medical records — realtime
  const rBody = $('recordsBody');
  if (rBody) {
    onSnapshot(query(collection(db, 'records'), where('patientId', '==', user.uid), orderBy('date','desc')), snap => {
      if($('statRecords')) $('statRecords').textContent = snap.size;
      if (snap.empty) { rBody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">📋</div><p>No records yet.</p></div></td></tr>'; return; }
      rBody.innerHTML = snap.docs.map(d => {
        const r = d.data();
        return `<tr><td>${r.date||'—'}</td><td>${r.diagnosis||'—'}</td><td>${r.treatment||'—'}</td><td>${r.notes||'—'}</td></tr>`;
      }).join('');
    });
  }

  // Medications — realtime (real-time push from doctor)
  const mBody = $('medsBody');
  if (mBody) {
    onSnapshot(query(collection(db, 'prescriptions'), where('patientId', '==', user.uid), orderBy('startDate','desc')), snap => {
      if($('statMeds')) $('statMeds').textContent = snap.size;
      if (snap.empty) { mBody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">💊</div><p>No medications prescribed.</p></div></td></tr>'; return; }
      mBody.innerHTML = snap.docs.map(d => {
        const m = d.data();
        return `<tr><td>${m.medName||'—'}</td><td>${m.dosage||'—'}</td><td>${m.frequency||'—'}</td><td>${m.startDate||'—'}</td></tr>`;
      }).join('');
    });
  }

  // Appointments — realtime
  const aBody = $('appointmentsBody');
  if (aBody) {
    onSnapshot(query(collection(db, 'appointments'), where('patientId', '==', user.uid), orderBy('date','desc')), snap => {
      if($('statAppts')) $('statAppts').textContent = snap.size;
      if (snap.empty) { aBody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">📅</div><p>No appointments scheduled.</p></div></td></tr>'; return; }
      aBody.innerHTML = snap.docs.map(d => {
        const a = d.data();
        return `<tr><td>${a.date||'—'}</td><td>${a.time||'—'}</td><td>${a.purpose||'—'}</td><td>${a.location||'—'}</td></tr>`;
      }).join('');
    });
  }

  // Vitals — realtime (cards + history table)
  const vitalsGrid = $('vitalsGrid');
  const vitalsTableBody = $('vitalsTableBody');
  if (vitalsGrid || vitalsTableBody) {
    onSnapshot(query(collection(db, 'vitals'), where('patientId', '==', user.uid), orderBy('date','desc')), snap => {
      if($('statVitals')) $('statVitals').textContent = snap.size;

      // Latest vitals cards
      if (vitalsGrid) {
        if (snap.empty) { vitalsGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">❤️</div><p>No vitals recorded yet.</p></div>'; }
        else {
          const latest = snap.docs[0].data();
          vitalsGrid.innerHTML = `
            <div class="vital-card"><div class="vital-label">Blood Pressure</div><div class="vital-value">${latest.bp||'—'}</div><div class="vital-unit">mmHg</div></div>
            <div class="vital-card"><div class="vital-label">Heart Rate</div><div class="vital-value">${latest.hr||'—'}</div><div class="vital-unit">bpm</div></div>
            <div class="vital-card"><div class="vital-label">Temperature</div><div class="vital-value">${latest.temp||'—'}</div><div class="vital-unit">°C</div></div>
            <div class="vital-card"><div class="vital-label">Weight</div><div class="vital-value">${latest.weight||'—'}</div><div class="vital-unit">kg</div></div>
          `;
        }
      }

      // Full vitals history table
      if (vitalsTableBody) {
        if (snap.empty) { vitalsTableBody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">❤️</div><p>No vitals recorded yet.</p></div></td></tr>'; }
        else {
          vitalsTableBody.innerHTML = snap.docs.map(d => {
            const v = d.data();
            return `<tr><td>${v.date||'—'}</td><td>${v.bp||'—'}</td><td>${v.hr||'—'} bpm</td><td>${v.temp||'—'} °C</td><td>${v.weight||'—'} kg</td></tr>`;
          }).join('');
        }
      }
    });
  }

  // Nursing notes — realtime
  const notesBody = $('notesBody');
  if (notesBody) {
    onSnapshot(query(collection(db, 'nursingNotes'), where('patientId', '==', user.uid), orderBy('date','desc')), snap => {
      if (snap.empty) { notesBody.innerHTML = '<tr><td colspan="2"><div class="empty-state"><div class="empty-icon">📝</div><p>No nursing notes.</p></div></td></tr>'; return; }
      notesBody.innerHTML = snap.docs.map(d => {
        const n = d.data();
        return `<tr><td>${n.date||'—'}</td><td>${n.note||'—'}</td></tr>`;
      }).join('');
    });
  }
}

/* ══════════════════════════════════════════════════════════
   ROUTER
   ══════════════════════════════════════════════════════════ */
switch (page) {
  case 'admin-login.html':
    initTheme();
    handleLogin('admin', 'admin-dashboard.html');
    break;
  case 'doctor-login.html':
    initTheme();
    handleLogin('doctor', 'doctor-dashboard.html');
    break;
  case 'nurse-login.html':
    initTheme();
    handleLogin('nurse', 'nurse-dashboard.html');
    break;
  case 'patient-login.html':
    initTheme();
    handleLogin('patient', 'patient-dashboard.html');
    break;

  case 'admin-dashboard.html':
    initAdminDashboard();
    break;
  case 'doctor-dashboard.html':
    initDoctorDashboard();
    break;
  case 'nurse-dashboard.html':
    initNurseDashboard();
    break;
  case 'patient-dashboard.html':
    initPatientDashboard();
    break;

  default:
    initTheme();
}

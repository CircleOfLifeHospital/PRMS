import {
  auth, db,
  onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
  collection, addDoc, getDocs, getDoc,
  query, where, orderBy, serverTimestamp,
  doc, updateDoc, deleteDoc, onSnapshot
} from './firebase-init.js';

const PAGE = window.location.pathname.split('/').pop() || 'index.html';

const LOGIN_PAGES     = ['patient-login.html','nurse-login.html','doctor-login.html','admin-login.html'];
const DASHBOARD_PAGES = ['patient-dashboard.html','nurse-dashboard.html','doctor-dashboard.html','admin-dashboard.html'];

function initTheme() {
  const toggle = document.getElementById('themeToggle');
  const label  = document.getElementById('themeLabel');
  if (!toggle) return;
  const apply = t => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
    if (toggle.tagName === 'BUTTON' && !label) toggle.textContent = t === 'dark' ? 'light mode' : 'dark mode';
    if (label) label.textContent = t === 'dark' ? 'Light Mode' : 'Dark Mode';
    if (toggle.tagName === 'BUTTON' && label) toggle.firstChild.textContent = t === 'dark' ? 'light mode ' : 'dark mode ';
  };
  apply(localStorage.getItem('theme') || 'light');
  toggle.addEventListener('click', () =>
    apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark')
  );
}


const $   = id => document.getElementById(id);
const val = id => { const e = $(id); return e ? e.value.trim() : ''; };
const setText = (id, t) => { const e = $(id); if (e) e.textContent = t; };

function showErr(id, msg) {
  const e = $(id);
  if (!e) return;
  e.textContent = msg || '';
  e.style.display = msg ? 'block' : 'none';
}
function showSuccess(id) {
  const e = $(id);
  if (!e) return;
  e.style.display = 'block';
  setTimeout(() => { e.style.display = 'none'; }, 3000);
}
function clearForm(ids) {
  ids.forEach(id => { const e = $(id); if (e) e.value = ''; });
}

async function fetchAll(col, constraints = []) {
  try {
    const ref  = collection(db, col);
    const q    = constraints.length ? query(ref, ...constraints) : query(ref);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  } catch (err) {
    console.error(`fetchAll(${col}):`, err);
    return [];
  }
}

function renderTable(tbodyId, rows, colspan, rowFn) {
  const tbody = $(tbodyId);
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:24px;color:var(--text-muted)">No records found.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `<tr>${rowFn(r)}</tr>`).join('');
}

function wireSearch(inputId, tbodyId, rows, colspan, rowFn, keyFn) {
  const input = $(inputId);
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    renderTable(tbodyId, q ? rows.filter(r => keyFn(r).includes(q)) : rows, colspan, rowFn);
  });
}

async function logAccess(action, patientId, staffID) {
  try { await addDoc(collection(db, 'accessLog'), { action, patientId, staffID, timestamp: serverTimestamp() }); }
  catch (e) { console.error('logAccess:', e); }
}

//Role detection

async function getRoleData(user) {
  const pSnap = await getDocs(query(collection(db, 'patients'), where('firebaseUid', '==', user.uid)));
  if (!pSnap.empty) {
    const d = pSnap.docs[0].data();
    return { role: 'patient', id: d.patientId, data: d };
  }
  const sSnap = await getDocs(query(collection(db, 'staff'), where('email', '==', user.email)));
  if (!sSnap.empty) {
    const d = sSnap.docs[0].data();
    return { role: (d.role || '').toLowerCase(), id: sSnap.docs[0].id, data: d };
  }
  return { role: null, id: null, data: null };
}

function dashboardFor(role) {
  return { patient: 'patient-dashboard.html', nurse: 'nurse-dashboard.html', doctor: 'doctor-dashboard.html', admin: 'admin-dashboard.html' }[role] || 'index.html';
}

//Auth state
onAuthStateChanged(auth, async user => {
  if (user) {
    const { role, id, data } = await getRoleData(user);
    if (!role) { await signOut(auth); window.location.href = 'index.html'; return; }

    if (LOGIN_PAGES.includes(PAGE)) {
      window.location.href = dashboardFor(role);
      return;
    }

    initTheme();
    wireLogout();

    if (PAGE === 'patient-dashboard.html')  { if (role==='patient') loadPatient(id, data, user);  else window.location.href = dashboardFor(role); }
    if (PAGE === 'nurse-dashboard.html')    { if (role==='nurse')   loadNurse(id, data);           else window.location.href = dashboardFor(role); }
    if (PAGE === 'doctor-dashboard.html')   { if (role==='doctor')  loadDoctor(id, data);          else window.location.href = dashboardFor(role); }
    if (PAGE === 'admin-dashboard.html')    { if (role==='admin')   loadAdmin(id, data);           else window.location.href = dashboardFor(role); }

  } else {
    if (DASHBOARD_PAGES.includes(PAGE)) window.location.href = 'index.html';
    else { initTheme(); }
  }
});

//Logout
function wireLogout() {
  const btn = $('logoutBtn');
  if (btn) btn.addEventListener('click', async () => { await signOut(auth); window.location.href = 'index.html'; });
}

//Login pages
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (LOGIN_PAGES.includes(PAGE)) wireLogin(PAGE.replace('-login.html', ''));
});

function wireLogin(expectedRole) {
  const btn    = $('loginBtn');
  const errMsg = $('errorMsg');
  if (!btn) return;

  async function doLogin() {
    const email    = val('email');
    const password = val('password');
    if (!email || !password) { showErr('errorMsg', 'Please enter your email and password.'); return; }

    btn.disabled    = true;
    btn.textContent = 'Signing in...';
    if (errMsg) errMsg.style.display = 'none';

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const { role } = await getRoleData(cred.user);

      if (role !== expectedRole) {
        await signOut(auth);
        showErr('errorMsg', `This portal is for ${expectedRole}s only.`);
        btn.disabled = false; btn.textContent = 'Sign In';
        return;
      }
      // onAuthStateChanged will redirect
    } catch (err) {
      const msg =
        err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' ? 'Invalid email or password.' :
        err.code === 'auth/user-not-found'  ? 'No account found with that email.' :
        err.code === 'auth/invalid-email'   ? 'Please enter a valid email address.' :
        err.message;
      showErr('errorMsg', msg);
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  }

  btn.addEventListener('click', doLogin);
  ['email','password'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  });
}


//Patient ID generator
async function generatePatientId() {
  const snap = await getDocs(query(collection(db, 'patients'), orderBy('patientId', 'desc')));
  if (!snap.empty) {
    const last = snap.docs[0].data().patientId || 'P-00000';
    const n = parseInt(last.split('-')[1] || '0');
    if (!isNaN(n)) return `P-${String(n + 1).padStart(5, '0')}`;
  }
  return 'P-00001';
}


// PATIENT DASHBOARD
async function loadPatient(patientId, data, user) {
  const name = data?.name || 'Patient';
  setText('userName', name);
  const av = $('userAvatar'); if (av) av.textContent = name[0].toUpperCase();
  setText('headerSub', `Welcome back, ${name.split(' ')[0]}!`);

  // Personal details
  const grid = $('personalGrid');
  if (grid) grid.innerHTML = `
    <div class="info-item"><div class="info-label">Patient ID</div><div class="info-value">${data.patientId||'—'}</div></div>
    <div class="info-item"><div class="info-label">Full Name</div><div class="info-value">${data.name||'—'}</div></div>
    <div class="info-item"><div class="info-label">Date of Birth</div><div class="info-value">${data.dob||'—'}</div></div>
    <div class="info-item"><div class="info-label">Contact</div><div class="info-value">${data.contact||'—'}</div></div>
    <div class="info-item"><div class="info-label">Medicare No.</div><div class="info-value">${data.medicareNo||'—'}</div></div>
    <div class="info-item"><div class="info-label">Email</div><div class="info-value">${data.email||'—'}</div></div>
  `;

  // Normal Data being loaded
  const [records, vitals, appts] = await Promise.all([
    fetchAll('records',      [where('patientId','==',patientId)]),
    fetchAll('vitals',      [where('patientId','==',patientId)]),
    fetchAll('appointments', [where('patientId','==',patientId)]),
  ]);

  setText('statRecords', records.length);
  setText('statAppts',   appts.length);



  renderTable('recordsBody',      records, 4, r=>`<td>${r.date||'—'}</td><td>${r.diagnosis||'—'}</td><td>${r.treatment||'—'}</td><td>${r.notes||'—'}</td>`);
  renderTable('appointmentsBody', appts,   4, a=>`<td>${a.date||'—'}</td><td>${a.time||'—'}</td><td>${a.purpose||'—'}</td><td>${a.location||'—'}</td>`);

  //Real-time medications via onSnapshot so doctor prescriptions appear instantly
  const medsBody = $('medsBody');
  const statMeds = $('statMeds');
  if (medsBody) {
    onSnapshot(
      query(collection(db, 'medications'), where('patientId','==',patientId)),
      snap => {
        const meds = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        if (statMeds) statMeds.textContent = meds.length;
        renderTable('medsBody', meds, 4,
          m => `<td>${m.medicationName||'—'}</td><td>${m.dosage||'—'}</td><td>${m.frequency||'—'}</td><td>${m.startDate||'—'}</td>`
        );
      },
      err => console.error('medications snapshot:', err)
    );
  }

const saBtn = $('saveAppointmentsBtn');
  if (saBtn) saBtn.addEventListener('click', async () => {
    const patientId = val('aPatientId'), patientName = val('aPatientName');
    if (!patientId || !patientName) { showErr('bookingError','Patient ID and name are required.'); return; }
    try {
      await addDoc(collection(db,'appointments'), {
        patientId, patientName,
        date: val('aDate'), time: val('aTime'),
        doctor: val('aDocName'), timestamp: serverTimestamp()
      });
      await logAccess('Appointments', patientId, );
      showSuccess('bookingSuccess'); showErr('bookingError','');
      clearForm(['aPatientId','aDocName','aDate','aTime']);
    } catch(e) { showErr('bookingError', e.message); }
  });

//Saves appointments via OnSnapshot for the patients to view appointments
const apptBody = $('appointmentsBody');
  if (apptBody) {
    onSnapshot(
      query(collection(db, 'appointments')), 
      where('patientId','==',patientId)),
      snap => {
        const appointments = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        renderTable('appointmentsBody', appointments, 4,
          a => `<td>${a.appointmentname||'—'}</td><td>${a.date||'—'}</td><td>${a.time||'—'}</td><td>${a.patientName || a.patientId ||'—'}</td><td>${a.doctor||'—'}</td>`
        );
      },
      err => console.error('appointments snapshot:', err);
  }
}
  

// NURSE DASHBOARD
async function loadNurse(staffId, data) {
  const name = data?.name || 'Nurse';
  setText('userName', name);
  const av = $('userAvatar'); if (av) av.textContent = name[0].toUpperCase();

  const pRow = p => `<td>${p.patientId||'—'}</td><td>${p.name||'—'}</td><td>${p.dob||'—'}</td><td>${p.medicareNo||'—'}</td><td>${p.contact||'—'}</td><td>${p.address||'—'}</td>`;
  const vRow = v => `<td>${v.patientId||'—'}</td><td>${v.date||'—'}</td><td>${v.bloodPressure||'—'}</td><td>${v.heartRate||'—'}</td><td>${v.temperature||'—'}</td><td>${v.weight||'—'}</td>`;

  const [patients, vitals] = await Promise.all([
    fetchAll('patients', []),
    fetchAll('vitals',   [orderBy('date','desc')])
  ]);

  renderTable('patientsBody',  patients, 6, pRow);
  renderTable('vitalsLogBody', vitals,   6, vRow);
  wireSearch('patientSearch', 'patientsBody', patients, 6, pRow, p=>`${p.patientId} ${p.name} ${p.contact}`.toLowerCase());

  const svBtn = $('saveVitalsBtn');
  if (svBtn) svBtn.addEventListener('click', async () => {
    const patientId = val('vPatientId'), date = val('vDate');
    if (!patientId || !date) { showErr('vitalsError','Patient ID and date are required.'); return; }
    try {
      await addDoc(collection(db,'vitals'), {
        patientId, date,
        bloodPressure: val('vBP'), heartRate: val('vHR'),
        temperature: val('vTemp'), weight: val('vWeight'),
        staffID: staffId, timestamp: serverTimestamp()
      });
      showSuccess('vitalsSuccess'); showErr('vitalsError','');
      clearForm(['vPatientId','vDate','vBP','vHR','vTemp','vWeight']);
      const fresh = await fetchAll('vitals',[orderBy('date','desc')]);
      renderTable('vitalsLogBody', fresh, 6, vRow);
    } catch(e) { showErr('vitalsError', e.message); }
  });

  const snBtn = $('saveNoteBtn');
  if (snBtn) snBtn.addEventListener('click', async () => {
    const patientId = val('nPatientId'), date = val('nDate'), note = val('nNote');
    if (!patientId || !date || !note) { showErr('noteError','All fields are required.'); return; }
    try {
      await addDoc(collection(db,'nursingNotes'), { patientId, date, note, staffID: staffId, timestamp: serverTimestamp() });
      showSuccess('noteSuccess'); showErr('noteError','');
      clearForm(['nPatientId','nDate','nNote']);
    } catch(e) { showErr('noteError', e.message); }
  });
}

// DOCTOR DASHBOARD — 
async function loadDoctor(staffId, data) {
  const name = data?.name || 'Doctor';
  setText('userName', name);
  const av = $('userAvatar'); if (av) av.textContent = name[0].toUpperCase();

  const pRow = p => `<td>${p.patientId||'—'}</td><td>${p.name||'—'}</td><td>${p.dob||'—'}</td><td>${p.medicareNo||'—'}</td><td>${p.contact||'—'}</td>`;
  const rRow = r => `<td>${r.d||'—'}</td><td>${r.date||'—'}</td><td>${r.diagnosis||'—'}</td><td>${r.treatment||'—'}</td><td>${r.notes||'—'}</td>`;

  const [patients, records, appointments] = await Promise.all([
    fetchAll('patients',[]),
    fetchAll('records'),
    fetchAll('appointments'),
  ]);

  renderTable('patientsBody', patients, 5, pRow);
  renderTable('recordsBody',  records,  5, rRow);
  renderTable('AppointmentsBody', appointments, 4, pRow);
  wireSearch('patientSearch','patientsBody', patients, 5, pRow, p=>`${p.patientId} ${p.name}`.toLowerCase());
  wireSearch('recordSearch', 'recordsBody',  records,  5, rRow, r=>`${r.patientId} ${r.diagnosis}`.toLowerCase());

  // Save diagnosis/record
  const sdBtn = $('saveDiagnosisBtn');
  if (sdBtn) sdBtn.addEventListener('click', async () => {
    const patientId = val('dPatientId'), date = val('dDate'), diagnosis = val('dDiagnosis');
    if (!patientId || !date || !diagnosis) { showErr('diagnosisError','Patient ID, date and diagnosis are required.'); return; }
    try {
      await addDoc(collection(db,'records'), {
        patientId, date, diagnosis,
        treatment: val('dTreatment'), notes: val('dNotes'),
        staffID: staffId, timestamp: serverTimestamp()
      });
      await logAccess('Added diagnosis', patientId, staffId);
      showSuccess('diagnosisSuccess'); showErr('diagnosisError','');
      clearForm(['dPatientId','dDate','dDiagnosis','dTreatment','dNotes']);
      const fresh = await fetchAll('records',[orderBy('date','desc')]);
      renderTable('recordsBody', fresh, 5, rRow);
    } catch(e) { showErr('diagnosisError', e.message); }
  });

  const recordBody = $('recordsBody');
  if (recordBody) {
    onSnapshot(
      query(collection(db, 'records'), orderBy('timestamp','desc')),
      snap => {
        const record = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        renderTable('recordsBody', records, 5,
          l => `<td>${l.patientId||'—'}</td><td>${l.date||'—'}</td><td>${l.diagnosis||'—'}</td><td>${l.treatment||'—'}</td><td>${l.notes||'—'}</td>`
        );
      },
      err => console.error('prescriptions snapshot:', err)
    );
  }



  // Save medications
  const spBtn = $('savePrescriptionBtn');
  if (spBtn) spBtn.addEventListener('click', async () => {
    const patientId = val('pPatientId'), medicationName = val('pMedName');
    if (!patientId || !medicationName) { showErr('prescriptionError','Patient ID and medication name are required.'); return; }
    try {
      await addDoc(collection(db,'medications'), {
        patientId, medicationName,
        dosage: val('pDosage'), frequency: val('pFrequency'), startDate: val('pStartDate'),
        staffID: staffId, timestamp: serverTimestamp()
      });
      await logAccess('Prescribed medication', patientId, staffId);
      showSuccess('prescriptionSuccess'); showErr('prescriptionError','');
      clearForm(['pPatientId','pMedName','pDosage','pFrequency','pStartDate']);
    } catch(e) { showErr('prescriptionError', e.message); }
  });

  //Real-time prescriptions view through OnSnapshot function
  const presBody = $('prescriptionsBody');
  if (presBody) {
    onSnapshot(
      query(collection(db, 'medications'), orderBy('timestamp','desc')),
      snap => {
        const meds = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        renderTable('prescriptionsBody', meds, 5,
          m => `<td>${m.patientId||'—'}</td><td>${m.medicationName||'—'}</td><td>${m.dosage||'—'}</td><td>${m.frequency||'—'}</td><td>${m.startDate||'—'}</td>`
        );
      },
      err => console.error('prescriptions snapshot:', err)
    );
  }

    const appointmentsBody = $('AppointmentsBody');
  if (appointmentsBody) {
    onSnapshot(
      query(collection(db, 'appointments'), where('patientId','==',patientId)),
      snap => {
        const appointments = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        renderTable('AppointmentsBody', appointments, 4,
          a => `<td>${a.appointmentname||'—'}</td><td>${a.date||'—'}</td><td>${a.time||'—'}</td><td>${a.patientName || a.patientId ||'—'}</td><td>${a.doctor||'—'}</td>`
        );
      },
      err => console.error('medications snapshot:', err)
    );
  }
}

// ADMIN DASHBOARD
async function loadAdmin(staffId, data) {
  const name = data?.name || 'Admin';
  setText('userName', name);
  const av = $('userAvatar'); if (av) av.textContent = name[0].toUpperCase();

  const sRow = s => `<td>${s.name||'—'}</td><td>${s.email||'—'}</td><td>${s.role||'—'}</td><td>${s.department||'—'}</td>`;
  const pRow = p => `<td>${p.patientId||'—'}</td><td>${p.name||'—'}</td><td>${p.email||'—'}</td><td>${p.dob||'—'}</td><td>${p.medicareNo||'—'}</td><td>${p.contact||'—'}</td>`;
  const lRow = l => `<td>${l.timestamp?.toDate?l.timestamp.toDate().toLocaleString():'—'}</td><td>${l.d||'—'}</td><td>${l.staffID||'—'}</td><td>${l.action||'—'}</td>`;

  const [patients, staff, records, logs] = await Promise.all([
    fetchAll('patients',  []),
    fetchAll('staff',     []),
    fetchAll('records',   []),
    fetchAll('accessLog', [orderBy('timestamp','desc')])
  ]);

  setText('statPatients', patients.length);
  setText('statStaff',    staff.length);
  setText('statLogs',     logs.length);

  renderTable('staffBody',    staff,    4, sRow);
  renderTable('patientsBody', patients, 6, pRow);
  renderTable('logBody',      logs,     4, lRow);

  wireSearch('staffSearch',   'staffBody',    staff,    4, sRow, s=>`${s.name} ${s.email} ${s.role}`.toLowerCase());
  wireSearch('patientSearch', 'patientsBody', patients, 6, pRow, p=>`${p.patientId} ${p.name} ${p.email}`.toLowerCase());


  const asBtn = $('saveStaffBtn');
    if (asBtn) asBtn.addEventListener('click', async () => {
      const sName    = val('sName'),    
            sEmail  = val('sEmail'),
            sRole    = val('sRole'),    
            sDept    = val('sDept'),
            sTempPassword = val('sTempPassword');

      if (!sName || !sEmail) { showErr('staffRegError','Name and email are required.'); return; }
      try {
        const cred    = await createUserWithEmailAndPassword(auth, sEmail, sTempPassword);
        const newId   = await generateStaffId();
        await addDoc(collection(db,'staff'), {
          name: sName, 
          email: sEmail,
          Role: sRole,
          Dept: sDept,
          TempPassword: sTempPassword,
          firebaseUid: cred.user.uid,
        });
        await logAccess('Staff registered');
        showSuccess('staffRegSuccess'); showErr('staffRegError','');
        clearForm(['sName','sEmail','sRole','sDept','STempPassword']);
        const fresh = await fetchAll('staff',[]);
        setText('statStaff', fresh.length);
        renderTable('staffBody', fresh, 6, pRow);
      } catch(e) { showErr('staffRegError', e.message); }
    });

  // Registration of patients 
  const rpBtn = $('savePatientBtn');
  if (rpBtn) rpBtn.addEventListener('click', async () => {
    const pName    = val('rpName'),    
          pEmail  = val('rpEmail'),
          pDob     = val('rpDOB'),    
          pMed    = val('rpMedicare'),
          pContact = val('rpContact'), 
          pAddr   = val('rpAddress'),
          pTempPassword = val('rpTempPassword');
    if (!pName || !pEmail) { showErr('patientRegError','Name and email are required.'); return; }
    try {
      const cred    = await createUserWithEmailAndPassword(auth, pEmail, pTempPassword);
      const newId   = await generatePatientId();
      await addDoc(collection(db,'patients'), {
        patientId: newId, 
        name: pName, 
        email: pEmail,
        dob: pDob, 
        medicareNo: pMed, 
        contact: pContact, 
        address: pAddr,
        firebaseUid: cred.user.uid,
        TempPassword: pTempPass
      });
      await logAccess('Patient registered', newId, staffId);
      showSuccess('patientRegSuccess'); showErr('patientRegError','');
      clearForm(['rpName','rpEmail','rpDOB','rpMedicare','rpContact','rpAddress']);
      const fresh = await fetchAll('patients',[]);
      setText('statPatients', fresh.length);
      renderTable('patientsBody', fresh, 6, pRow);
    } catch(e) { showErr('patientRegError', e.message); }
  });
}

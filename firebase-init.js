import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyC5yUbFT4AQZbp90Cu8sJ4kXqKEdjdg8b0",
  authDomain: "prms-system.firebaseapp.com",
  projectId: "prms-system",
  storageBucket: "prms-system.firebasestorage.app",
  messagingSenderId: "121751529355",
  appId: "1:121751529355:web:f200750a7afbd695f7718e"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';

export {
  collection, addDoc, getDocs, getDoc,
  query, where, orderBy, serverTimestamp,
  doc, updateDoc, deleteDoc, onSnapshot, setDoc
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

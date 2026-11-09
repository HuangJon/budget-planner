/**
 * The live Firebase project. These web settings are safe to publish: they only say which project
 * to talk to. What anyone can read or write is decided by firestore.rules, not by these values.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyBv7Lb7vJDCuVTSoGSkK_pYA1gX0PbL_CE',
  authDomain: 'wheres-my-61a75.firebaseapp.com',
  projectId: 'wheres-my-61a75',
  storageBucket: 'wheres-my-61a75.firebasestorage.app',
  messagingSenderId: '236246651954',
  appId: '1:236246651954:web:1e80f6b535788800c5582b',
};
export const environment = 'live';
export const appCheckSiteKey = null;
/** 'enterprise' for a key made in the Google Cloud console, 'v3' for one from google.com/recaptcha/admin. */
export const appCheckProvider = 'enterprise';
export const FIREBASE_VERSION = '11.10.0';

/**
 * Replaces js/config/firebase.js when the test branch is published to staging.
 * Safe to publish, like the live settings. This project only ever holds test data.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyAkKuZHNCLcwT8Z2rPIyRLTKQfc2uCLMPU',
  authDomain: 'wheres-my-money-staging.firebaseapp.com',
  projectId: 'wheres-my-money-staging',
  storageBucket: 'wheres-my-money-staging.firebasestorage.app',
  messagingSenderId: '729958022227',
  appId: '1:729958022227:web:c529393ba1cf26970f9aa6',
};
export const environment = 'staging';
/** A test owner used only on staging. */
export const ownerUid = 'stagingOwnerTestAccount01';
export const appCheckSiteKey = null;

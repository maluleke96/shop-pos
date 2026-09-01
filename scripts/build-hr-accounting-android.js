/**
 * Build HR + Accounting Android APKs only.
 * Output: Downloads/ShopPOS-Installers/Android/
 */
process.env.BUILD_ANDROID_ONLY = 'hr,accounting';
require('./build-cloud-android-apps.js');

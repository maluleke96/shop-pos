const fs=require('fs');
const src='C:/Users/MALULEKE HAPPY/Downloads/ShopPOS/ShopPOS-Railway-Supabase-Source-v2.9.41/shop-pos/electron/services/store.js';
const dest='C:/Users/MALULEKE HAPPY/Projects/staff-clocking-module/shop-pos/electron/services/store.js';
fs.copyFileSync(src,dest);
console.log('copied',fs.statSync(dest).size);

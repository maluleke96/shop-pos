const fs=require('fs');
const src='C:/Users/MALULEKE HAPPY/Downloads/ShopPOS/ShopPOS-Railway-Supabase-Source-v2.9.41/shop-pos/electron/services/store.js';
const dest='C:/Users/MALULEKE HAPPY/Projects/staff-clocking-module/shop-pos/electron/services/store.js';
fs.copyFileSync(src,dest);
const s=fs.readFileSync(dest,'utf8');
console.log(JSON.stringify({size:fs.statSync(dest).size,hasRecovery:/hasRecoverySecret/.test(s),completeSale:/function completeSale/.test(s)}));

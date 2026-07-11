// 產生 AUTH_PASSWORD_HASH 與 AUTH_SECRET，用法：
//   node scripts/hash-password.mjs <新密碼>
// 將輸出的兩行貼到 .env 後重啟伺服器即可。
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("用法: node scripts/hash-password.mjs <新密碼>");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");

// 注意：分隔符用「:」而非「$」，因為 Next.js 載入 .env 時會把 $xxx 展開成環境變數
console.log(`AUTH_PASSWORD_HASH=s2:${salt}:${hash}`);
console.log(`AUTH_SECRET=${randomBytes(32).toString("hex")}`);

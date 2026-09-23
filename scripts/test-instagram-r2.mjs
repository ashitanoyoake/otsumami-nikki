/**
 * R2 ヘルパーのローカル検証。実R2 / 実Secrets には接続しない。
 */
import {
  createMemoryMediaStore,
  isR2PublicUrl,
  r2ObjectKey,
  r2PublicUrl,
  r2Request,
  readR2ConfigFromEnv,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE,
} from "./r2.mjs";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL: ${message}`);
}

async function main() {
  assert(R2_BUCKET_NAME === "otsumami-instagram", "確定済みバケット名を使う");
  assert(
    R2_PUBLIC_BASE === "https://instagram-media.otsumaminikki.com",
    "公開URLはカスタムドメインのみ",
  );
  assert(r2ObjectKey("abc123", "jpg") === "posts/abc123.jpg", "オブジェクトキーは posts/{id}.{ext}");
  assert(
    r2PublicUrl("abc123", "jpg") === `${R2_PUBLIC_BASE}/posts/abc123.jpg`,
    "公開URLはカスタムドメイン + posts/{id}.{ext}",
  );
  assert(isR2PublicUrl(`${R2_PUBLIC_BASE}/posts/1.jpg`), "カスタムドメインURLを保存済みと判定する");
  assert(!isR2PublicUrl("https://pub-xxx.r2.dev/posts/1.jpg"), "r2.dev は使わない");
  assert(!isR2PublicUrl("images/instagram/posts/1.jpg"), "リポジトリ相対パスは R2 URL ではない");

  const previous = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  };
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;

  let missingMessage = "";
  try {
    readR2ConfigFromEnv();
  } catch (error) {
    missingMessage = error instanceof Error ? error.message : String(error);
  }
  assert(missingMessage.includes("R2_ACCOUNT_ID"), "未設定時は項目名だけを知らせる");
  assert(!missingMessage.includes("secret"), "エラーメッセージに秘密値を含めない");

  process.env.R2_ACCOUNT_ID = "account-id-example";
  process.env.R2_ACCESS_KEY_ID = "access-key-example";
  process.env.R2_SECRET_ACCESS_KEY = "secret-key-example";
  const config = readR2ConfigFromEnv();
  assert(config.bucket === "otsumami-instagram", "設定のバケット名は確定値");
  assert(config.publicBase === R2_PUBLIC_BASE, "設定の公開URLはカスタムドメイン");

  const captured = [];
  await r2Request({
    config,
    method: "PUT",
    key: "posts/test.jpg",
    body: Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex"),
    contentType: "image/jpeg",
    fetchImpl: async (url, options) => {
      captured.push({ url, options });
      return new Response(null, { status: 200 });
    },
  });
  assert(captured.length === 1, "R2 リクエストはモックへ1回送る");
  assert(
    captured[0].url === "https://account-id-example.r2.cloudflarestorage.com/otsumami-instagram/posts/test.jpg",
    "S3互換エンドポイントは ACCOUNT_ID.r2.cloudflarestorage.com / バケット / キー",
  );
  assert(captured[0].options.method === "PUT", "保存は PUT");
  assert(
    String(captured[0].options.headers.Authorization).startsWith("AWS4-HMAC-SHA256 "),
    "SigV4 で署名する",
  );
  assert(
    !JSON.stringify(captured[0]).includes("secret-key-example"),
    "リクエスト内容に Secret Access Key を載せない",
  );

  const store = createMemoryMediaStore();
  const first = await store.put("media1", Buffer.from("one"), "image/jpeg", "jpg");
  assert(first === `${R2_PUBLIC_BASE}/posts/media1.jpg`, "メモリストアも同じ公開URL形式");
  assert((await store.has("media1")) === first, "既存 Media ID は再PUTせず参照できる");
  assert((await store.has("missing")) === null, "未保存 ID は null");

  Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  console.log(`Instagram R2 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import dotenv from "dotenv";
import { BskyAgent } from "@atproto/api";

dotenv.config();  // ← must be called before reading any env vars

// ── Config ────────────────────────────────────────────────────────────────────
const PDS_URL = process.env.PDS_URL;
const HANDLE = process.env.BLUESKY_HANDLE;
const APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD;

const HAPPY_KEYWORDS = ["happy", "smiling", "smile", "joy", "joyful", "cheerful", "delighted", "bliss", "blissful", "elated"];
const LIKE_INTERVAL_MS = 60 * 1000;
const POST_MIN_AGE_MS = 5 * 60 * 1000;
const REAUTH_INTERVAL_MS = 1000 * 60 * 1000;

// ── State ─────────────────────────────────────────────────────────────────────
let agent;  // ← declare here, initialize in main()
let lastAuthTime = 0;
const likedUris = new Set();

// ── Auth ──────────────────────────────────────────────────────────────────────
async function authenticate() {
  const now = Date.now();
  if (now - lastAuthTime < REAUTH_INTERVAL_MS && agent.session) {
    return;
  }

  console.log("[auth] Authenticating with PDS:", PDS_URL);
  await agent.login({ identifier: HANDLE, password: APP_PASSWORD });
  lastAuthTime = Date.now();
  console.log("[auth] Authenticated successfully as", HANDLE);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function containsHappyKeyword(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return HAPPY_KEYWORDS.some((kw) => lower.includes(kw));
}

function isOldEnough(createdAt) {
  const postTime = new Date(createdAt).getTime();
  return Date.now() - postTime > POST_MIN_AGE_MS;
}

// ── Search & Like ─────────────────────────────────────────────────────────────
async function findAndLikePost() {
  console.log("\n[cycle] Starting new cycle at", new Date().toISOString());

  await authenticate();

  const keyword = HAPPY_KEYWORDS[Math.floor(Math.random() * HAPPY_KEYWORDS.length)];
  console.log(`[search] Searching for keyword: "${keyword}"`);

  const results = await agent.app.bsky.feed.searchPosts({
    q: keyword,
    limit: 25,
  });

  const posts = results.data.posts;
  console.log(`[search] Got ${posts?.length ?? 0} results`);

  if (!posts || posts.length === 0) {
    console.log("[search] No posts found.");
    return;
  }

  const candidates = posts.filter((post) => {
    const uri = post.uri;
    const text = post.record?.text ?? "";
    const createdAt = post.record?.createdAt ?? post.indexedAt;

    if (likedUris.has(uri)) {
      console.log(`[filter] Skipping (already liked): ${uri}`);
      return false;
    }
    if (!isOldEnough(createdAt)) {
      console.log(`[filter] Skipping (too new): ${uri}`);
      return false;
    }
    if (!containsHappyKeyword(text)) {
      console.log(`[filter] Skipping (no keyword match): "${text.slice(0, 60)}"`);
      return false;
    }

    return true;
  });

  console.log(`[search] ${candidates.length} eligible candidate(s) after filtering`);

  if (candidates.length === 0) {
    console.log("[search] No eligible posts found this cycle.");
    return;
  }

  const post = candidates[0];
  const { uri, cid } = post;
  const text = post.record?.text ?? "";
  const createdAt = post.record?.createdAt ?? post.indexedAt;

  console.log(`[like] Liking post: ${uri}`);
  console.log(`       Text: "${text.slice(0, 80)}"`);
  console.log(`       Created at: ${createdAt}`);

  await agent.like(uri, cid);
  likedUris.add(uri);

  console.log(`[like] ✓ Liked successfully.`);
}

// ── Main Loop ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Bluesky Happy Bot Starting ===");
  console.log(`PDS:              ${PDS_URL}`);
  console.log(`Handle:           ${HANDLE}`);
  console.log(`Like interval:    ${LIKE_INTERVAL_MS / 1000}s`);
  console.log(`Min post age:     ${POST_MIN_AGE_MS / 1000}s`);
  console.log(`Reauth interval:  ${REAUTH_INTERVAL_MS / 60000} min`);
  console.log("==================================\n");

  if (!PDS_URL || !HANDLE || !APP_PASSWORD) {
    console.error("[fatal] Missing required environment variables. Check your .env file.");
    console.error(`  PDS_URL=${PDS_URL}`);
    console.error(`  BLUESKY_HANDLE=${HANDLE}`);
    console.error(`  BLUESKY_APP_PASSWORD=${APP_PASSWORD ? "***set***" : "MISSING"}`);
    process.exit(1);
  }

  // ← Initialize agent here, AFTER dotenv.config() has run
  agent = new BskyAgent({ service: PDS_URL });

  await findAndLikePost();

  setInterval(async () => {
    await findAndLikePost();
  }, LIKE_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
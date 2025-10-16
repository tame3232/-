// tbot_handler.js
const express = require('express');
const serverless = require('serverless-http');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// =======================================================
// 1. CONFIGURATION
// =======================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DAILY_RESET_MS = 24 * 60 * 60 * 1000;
const SPIN_MAX_ATTEMPTS = 5;
const QUIZ_MAX_ATTEMPTS = 5;
const DAILY_BONUS_POINTS = 500;
const SCRATCH_MAX_CLAIM = 1;
const LUCKYBOX_MAX_ATTEMPTS = 2;
const TABLE_NAME = 'users';

// =======================================================
// 2. VERIFY TELEGRAM INIT DATA
// =======================================================
function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN missing in Environment Variables!");
    return false;
  }

  const parts = initData.split('&').filter(p => !p.startsWith('hash='));
  parts.sort();
  const dataCheckString = parts.join('\n');
  const hashMatch = initData.match(/hash=([a-fA-F0-9]+)/);
  if (!hashMatch) return false;

  const receivedHash = hashMatch[1];
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  if (calculatedHash !== receivedHash) {
    console.log("❌ Hash Mismatch!");
    return false;
  }

  const userDataMatch = initData.match(/user=({[^}]+})/);
  if (userDataMatch) {
    try {
      return JSON.parse(decodeURIComponent(userDataMatch[1]));
    } catch (e) {
      console.error("Error parsing user data:", e);
      return false;
    }
  }
  return false;
}

// =======================================================
// 3. SUPABASE DATABASE FUNCTIONS
// =======================================================
async function getInitialUserData(userId) {
  const defaultData = {
    points: 0,
    spin_data: { attempts: SPIN_MAX_ATTEMPTS, last_spin: 0 },
    quiz_data: { attempts: QUIZ_MAX_ATTEMPTS, last_quiz: 0 },
    daily_bonus: { last_claim: 0 },
    scratch_data: { last_claim: 0, claims_made: 0 },
    luckybox_data: { attempts: LUCKYBOX_MAX_ATTEMPTS, last_claim: 0 },
  };

  const { data: userRecord, error } = await supabase
    .from(TABLE_NAME)
    .select('data')
    .eq('id', userId)
    .single();

  if (error && error.code === 'PGRST116') {
    const { error: insertError } = await supabase
      .from(TABLE_NAME)
      .insert([{ id: userId, data: defaultData }]);

    if (insertError) {
      console.error("Supabase Insert Error:", insertError);
      return defaultData;
    }
    return defaultData;
  }

  if (error) {
    console.error("Supabase Fetch Error:", error);
    return defaultData;
  }

  return { ...defaultData, ...userRecord.data };
}

async function updateUserData(userId, newData) {
  const existingData = await getInitialUserData(userId);
  const updatedData = { ...existingData, ...newData };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update({ data: updatedData })
    .eq('id', userId)
    .select('data')
    .single();

  if (error) {
    console.error("Supabase Update Error:", error);
    return existingData;
  }

  return data.data;
}

// =======================================================
// 4. EXPRESS APP & ROUTES
// =======================================================
const app = express();
app.use(express.json());

app.post('/.netlify/functions/tbot_handler', async (req, res) => {
  const { action, init_data, task_id, prize_options, game_id, points_gained } = req.body;

  const user = verifyTelegramInitData(init_data);
  if (!user) {
    return res.status(401).json({ error: "❌ Unauthorized: Invalid init_data" });
  }

  const userId = user.id;
  let userData = await getInitialUserData(userId);
  const now = Date.now();

  // ====== INITIAL DATA ======
  if (action === "request_initial_data") {
    return res.json({
      action: "initial_data",
      points: userData.points,
      spin_data: userData.spin_data,
      quiz_data: userData.quiz_data,
      daily_bonus: userData.daily_bonus,
      scratch_data: userData.scratch_data,
      luckybox_data: userData.luckybox_data
    });
  }

  // ====== DAILY BONUS ======
  if (action === "claim_daily_bonus") {
    const lastClaim = userData.daily_bonus.last_claim || 0;

    if (now - lastClaim < DAILY_RESET_MS) {
      return res.json({ action: "daily_bonus_claimed", success: false, reason: "Already claimed today" });
    }

    userData.points += DAILY_BONUS_POINTS;
    userData.daily_bonus.last_claim = now;

    const updatedData = await updateUserData(userId, userData);

    return res.json({
      action: "daily_bonus_claimed",
      success: true,
      new_points: updatedData.points,
      last_claim: updatedData.daily_bonus.last_claim
    });
  }

  // ====== GAME PRIZE CLAIM ======
  if (action === "claim_game_prize") {
    if (!points_gained || points_gained < 0) {
      return res.status(400).json({ error: "Invalid points value" });
    }

    let success = false;

    if (game_id === 'scratch_card') {
      const game = userData.scratch_data;

      if (now - game.last_claim >= DAILY_RESET_MS) {
        game.claims_made = 0;
      }

      if (game.claims_made >= SCRATCH_MAX_CLAIM) {
        return res.status(400).json({ error: "Scratch Card already claimed today." });
      }

      game.claims_made += 1;
      game.last_claim = now;
      userData.points += points_gained;
      userData.scratch_data = game;
      success = true;

    } else if (game_id === 'lucky_box') {
      const game = userData.luckybox_data;

      if (now - game.last_claim >= DAILY_RESET_MS) {
        game.attempts = LUCKYBOX_MAX_ATTEMPTS;
        game.last_claim = 0;
      }

      if (game.attempts <= 0) {
        return res.status(400).json({ error: "Lucky Box attempts exhausted." });
      }

      game.attempts -= 1;
      game.last_claim = now;
      userData.points += points_gained;
      userData.luckybox_data = game;
      success = true;
    } else {
      return res.status(400).json({ error: "Unknown game ID" });
    }

    if (success) {
      const updatedData = await updateUserData(userId, userData);
      return res.json({
        action: "game_prize_claimed",
        game_id,
        points_gained,
        new_points: updatedData.points,
        scratch_data: updatedData.scratch_data,
        luckybox_data: updatedData.luckybox_data
      });
    }
  }

  // ====== RESET ======
  if (["request_spin_reset", "request_quiz_reset", "request_full_reset"].includes(action)) {
    let shouldReset = false;

    if (["request_spin_reset", "request_full_reset"].includes(action)) {
      if (now - userData.spin_data.last_spin >=
